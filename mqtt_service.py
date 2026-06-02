from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime

import paho.mqtt.client as mqtt

import database as db
from config import (
    LOCKER_CONTROL_MODE,
    MQTT_ACK_TIMEOUT_SEC,
    MQTT_BROKER_HOST,
    MQTT_BROKER_KEEPALIVE_SEC,
    MQTT_BROKER_PASSWORD,
    MQTT_BROKER_PORT,
    MQTT_BROKER_USERNAME,
    MQTT_CLIENT_ID,
    MQTT_DEVICE_TIMEOUT_SEC,
    MQTT_QOS,
    MQTT_TOPIC_PREFIX,
)

logger = logging.getLogger(__name__)


def _iso_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _mqtt_connect_ok(reason_code) -> bool:
    if reason_code is None:
        return False
    if isinstance(reason_code, int):
        return reason_code == 0
    if hasattr(reason_code, "is_failure"):
        return not reason_code.is_failure
    return reason_code == 0


def _mqtt_disconnect_is_error(reason_code) -> bool:
    if reason_code is None:
        return False
    if isinstance(reason_code, int):
        return reason_code != 0
    if hasattr(reason_code, "is_failure"):
        return reason_code.is_failure
    name = str(reason_code).lower()
    return name not in ("success", "normal disconnection")


def _callback_client(client_id: str) -> mqtt.Client:
    callback_api = getattr(mqtt, "CallbackAPIVersion", None)
    if callback_api is not None:
        return mqtt.Client(
            callback_api_version=callback_api.VERSION2,
            client_id=client_id,
            protocol=mqtt.MQTTv311,
        )
    return mqtt.Client(client_id=client_id, protocol=mqtt.MQTTv311)


@dataclass
class PendingAck:
    event: threading.Event = field(default_factory=threading.Event)
    payload: dict | None = None


class LockerMqttBridge:
    def __init__(self) -> None:
        self._client_id = f"{MQTT_CLIENT_ID}-{os.getpid()}"
        self._client = _callback_client(self._client_id)
        self._client.on_connect = self._on_connect
        self._client.on_connect_fail = self._on_connect_fail
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message
        if MQTT_BROKER_USERNAME:
            self._client.username_pw_set(
                MQTT_BROKER_USERNAME,
                password=MQTT_BROKER_PASSWORD or None,
            )

        self._started = False
        self._lock = threading.Lock()
        self._broker_connected = False
        self._device_last_seen = 0.0
        self._device_payload: dict = {}
        self._locker_states: dict[int, dict] = {}
        self._pending_acks: dict[str, PendingAck] = {}

    @property
    def enabled(self) -> bool:
        return LOCKER_CONTROL_MODE.lower() == "mqtt"

    def start(self) -> None:
        if not self.enabled or self._started:
            return
        logger.info(
            "MQTT bridge %s → %s:%s prefix=%s",
            self._client_id,
            MQTT_BROKER_HOST,
            MQTT_BROKER_PORT,
            MQTT_TOPIC_PREFIX,
        )
        self._client.connect_async(
            MQTT_BROKER_HOST,
            port=MQTT_BROKER_PORT,
            keepalive=MQTT_BROKER_KEEPALIVE_SEC,
        )
        self._client.loop_start()
        self._started = True

    def stop(self) -> None:
        if not self._started:
            return
        self._client.loop_stop()
        try:
            self._client.disconnect()
        except Exception:
            logger.exception("MQTT disconnect error")
        self._started = False

    def publish_open_command(
        self,
        locker_id: int,
        source: str = "backend",
        action: str = "MANUAL",
    ) -> bool:
        if not self.enabled:
            return False
        if not self._broker_connected:
            logger.warning("MQTT not connected, cannot open locker %s", locker_id)
            return False

        request_id = uuid.uuid4().hex
        command = {
            "command": "open",
            "locker_id": locker_id,
            "action": action,
            "request_id": request_id,
            "source": source,
            "sent_at": _iso_now(),
        }
        pending = PendingAck()
        with self._lock:
            self._pending_acks[request_id] = pending

        try:
            info = self._client.publish(
                self._command_topic(locker_id),
                json.dumps(command),
                qos=MQTT_QOS,
            )
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                return False
            if not pending.event.wait(timeout=MQTT_ACK_TIMEOUT_SEC):
                logger.warning("ACK timeout locker=%s", locker_id)
                return False
            return bool((pending.payload or {}).get("ok"))
        finally:
            with self._lock:
                self._pending_acks.pop(request_id, None)

    def sync_locker_occupancy(self) -> None:
        if not self.enabled or not self._broker_connected:
            return
        lockers = db.get_all_lockers()
        occupancy = {
            str(locker["id"]): locker["status"] == db.STATUS_LOCKER_IN_USE
            for locker in lockers
        }
        payload = {"lockers": occupancy, "sent_at": _iso_now()}
        self._client.publish(
            f"{MQTT_TOPIC_PREFIX}/lockers/occupancy",
            json.dumps(payload),
            qos=MQTT_QOS,
            retain=True,
        )

    def status_snapshot(self) -> dict:
        if not self.enabled:
            return {
                "mode": LOCKER_CONTROL_MODE,
                "broker_connected": False,
                "device_online": True,
                "last_device_seen": None,
                "last_device_payload": {},
            }
        with self._lock:
            last_seen = self._device_last_seen
            payload = dict(self._device_payload)
            broker_connected = self._broker_connected
        return {
            "mode": LOCKER_CONTROL_MODE,
            "broker_connected": broker_connected,
            "device_online": self._is_device_online(last_seen),
            "last_device_seen": self._format_timestamp(last_seen),
            "last_device_payload": payload,
        }

    def locker_states(self) -> dict[int, dict]:
        with self._lock:
            return {k: dict(v) for k, v in self._locker_states.items()}

    def _command_topic(self, locker_id: int) -> str:
        return f"{MQTT_TOPIC_PREFIX}/lockers/{locker_id}/command"

    def _status_subscription(self) -> str:
        return f"{MQTT_TOPIC_PREFIX}/lockers/+/status"

    def _device_topic(self) -> str:
        return f"{MQTT_TOPIC_PREFIX}/device/status"

    def _on_connect(self, client, userdata, flags, reason_code, properties=None) -> None:
        ok = _mqtt_connect_ok(reason_code)
        with self._lock:
            self._broker_connected = ok
        if not ok:
            logger.warning("MQTT connect failed: %s", reason_code)
            return
        logger.info("MQTT broker connected")
        client.subscribe(self._status_subscription(), qos=MQTT_QOS)
        client.subscribe(self._device_topic(), qos=MQTT_QOS)
        self.sync_locker_occupancy()

    def _on_connect_fail(self, client, userdata) -> None:
        with self._lock:
            self._broker_connected = False

    def _on_disconnect(self, client, userdata, flags, reason_code, properties=None) -> None:
        with self._lock:
            self._broker_connected = False
        if _mqtt_disconnect_is_error(reason_code):
            logger.warning("MQTT disconnected: %s", reason_code)

    def _on_message(self, client, userdata, msg) -> None:
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except Exception:
            return
        if msg.topic == self._device_topic():
            with self._lock:
                self._device_last_seen = time.time()
                self._device_payload = {**payload, "last_seen": _iso_now()}
            return
        if msg.topic.endswith("/status"):
            self._handle_locker_status(msg.topic, payload)

    def _handle_locker_status(self, topic: str, payload: dict) -> None:
        locker_id = self._locker_id_from_topic(topic)
        if locker_id is None:
            return
        enriched = {**payload, "locker_id": locker_id, "last_seen": _iso_now()}
        with self._lock:
            self._device_last_seen = time.time()
            self._locker_states[locker_id] = enriched
            request_id = str(enriched.get("request_id") or "")
            pending = self._pending_acks.get(request_id)
            if pending is not None:
                pending.payload = enriched
                pending.event.set()

    def _locker_id_from_topic(self, topic: str) -> int | None:
        try:
            suffix = topic.removeprefix(f"{MQTT_TOPIC_PREFIX}/lockers/")
            return int(suffix.split("/", 1)[0])
        except Exception:
            return None

    def _is_device_online(self, last_seen: float) -> bool:
        if last_seen <= 0:
            return False
        return (time.time() - last_seen) <= MQTT_DEVICE_TIMEOUT_SEC

    def _format_timestamp(self, ts: float) -> str | None:
        if ts <= 0:
            return None
        return datetime.fromtimestamp(ts).isoformat(timespec="seconds")


_bridge = LockerMqttBridge()


def start_mqtt_bridge() -> None:
    _bridge.start()


def stop_mqtt_bridge() -> None:
    _bridge.stop()


def publish_open_command(
    locker_id: int,
    source: str = "backend",
    action: str = "MANUAL",
) -> bool:
    return _bridge.publish_open_command(locker_id, source=source, action=action)


def sync_lockers_occupancy() -> None:
    _bridge.sync_locker_occupancy()


def get_bridge_status() -> dict:
    return _bridge.status_snapshot()


def get_locker_hardware_states() -> dict[int, dict]:
    return _bridge.locker_states()

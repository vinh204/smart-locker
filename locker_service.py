"""Điều khiển mở tủ — mock hoặc MQTT (Wokwi / ESP32)."""

import logging

from config import LOCKER_CONTROL_MODE
from mqtt_service import publish_open_command

logger = logging.getLogger(__name__)


def open_locker(locker_id: int, action: str = "MANUAL") -> bool:
    if LOCKER_CONTROL_MODE.lower() == "mqtt":
        logger.info("MQTT open locker=%s action=%s", locker_id, action)
        return publish_open_command(locker_id, source="backend", action=action)

    logger.info("Mock mở tủ %s (%s)", locker_id, action)
    print(f"[TỦ] Mở tủ {locker_id} — {action} (mock)")
    return True

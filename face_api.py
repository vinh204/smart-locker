"""
Luồng tủ khóa: kiểm tra ô trống → gửi đồ (embedding + gán tủ) → lấy đồ (so khớp embedding).
"""

from fastapi import APIRouter, File, Form, UploadFile

import database as db
from face_utils import (
    base64_to_cv2,
    capture_face_embedding,
    distance_to_confidence_percent,
    find_all_matching_deposits,
    is_spoof_rejection,
)
from config import LOCKER_CONTROL_MODE
from locker_service import open_locker
from mqtt_service import (
    get_bridge_status,
    get_locker_hardware_states,
    sync_lockers_occupancy,
)

router = APIRouter(prefix="/face", tags=["Tủ khóa & Khuôn mặt"])

CODE_NO_EMPTY_LOCKERS = "NO_EMPTY_LOCKERS"
CODE_ALREADY_DEPOSITED = "ALREADY_DEPOSITED"
CODE_PICK_LOCKER = "PICK_LOCKER"
CODE_NOT_DEPOSITED = "NOT_DEPOSITED"


async def _read_image(file: UploadFile | None, image_b64: str | None):
    if file and file.filename:
        import cv2
        import numpy as np

        data = await file.read()
        arr = np.frombuffer(data, dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image_b64:
        return base64_to_cv2(image_b64)
    return None


async def _embedding_from_request(
    file: UploadFile | None,
    image_b64: str | None,
    action: str,
) -> tuple[bool, dict | None, list[float] | None]:
    img = await _read_image(file, image_b64)
    if img is None:
        db.log_action(action, "ERROR", message="Thiếu ảnh")
        return False, {
            "ok": False,
            "message": "Vui lòng bật camera và thử lại",
        }, None

    ok, msg, embedding = capture_face_embedding(img)
    if not ok or embedding is None:
        status = "SPOOF" if is_spoof_rejection(msg) else "FAILED"
        db.log_action(action, status, message=msg)
        return False, {"ok": False, "message": msg}, None

    return True, None, embedding


def _fail(action: str, status: str, code: str, message: str, **extra) -> dict:
    db.log_action(action, status, message=message)
    return {"ok": False, "code": code, "message": message, **extra}


@router.get("/status")
async def locker_screen_status():
    """Màn hình tủ + trạng thái MQTT/ESP32."""
    st = db.get_locker_status()
    message = None
    if not st["can_gui_do"]:
        message = "Hiện không còn tủ trống"

    lockers = db.get_all_lockers()
    hardware = get_locker_hardware_states()
    for locker in lockers:
        hw = hardware.get(locker["id"], {})
        locker["hardware"] = hw if hw else None

    bridge = get_bridge_status()
    if LOCKER_CONTROL_MODE.lower() == "mqtt":
        esp_connected = bool(
            bridge.get("broker_connected") and bridge.get("device_online")
        )
    else:
        esp_connected = True

    return {
        "ok": True,
        **st,
        "message": message,
        "lockers": lockers,
        "control_mode": LOCKER_CONTROL_MODE.lower(),
        "esp_connected": esp_connected,
        "mqtt": bridge,
    }


@router.get("/logs")
async def activity_logs(limit: int = 5):
    return {"logs": db.get_logs(limit)}


@router.post("/open-locker/{locker_id}")
async def manual_open_locker(locker_id: int):
    """Mở tủ thủ công từ panel điều khiển."""
    info = db.get_locker(locker_id)
    if not info:
        db.log_action("MANUAL_OPEN", "FAILED", message=f"Không tìm thấy tủ {locker_id}")
        return {"ok": False, "message": "Không tìm thấy tủ"}
    opened = open_locker(locker_id, action="MANUAL")
    db.log_action(
        "MANUAL_OPEN",
        "SUCCESS" if opened else "FAILED",
        message=f"Mở tủ {locker_id} - {info['label']}",
    )
    return {
        "ok": opened,
        "message": (
            f"Đã gửi lệnh mở tủ {locker_id}"
            if opened
            else f"Không mở được tủ {locker_id} — kiểm tra Wokwi/MQTT"
        ),
        "locker_id": locker_id,
        "locker_opened": opened,
    }


@router.post("/manual/gui-do/{locker_id}")
async def manual_gui_do(locker_id: int):
    info = db.get_locker(locker_id)
    if not info:
        db.log_action("MANUAL_GUI_DO", "FAILED", message=f"Không tìm thấy tủ {locker_id}")
        return {"ok": False, "message": "Không tìm thấy tủ"}
    if not info["is_empty"]:
        db.log_action("MANUAL_GUI_DO", "FAILED", message=f"Tủ {locker_id} đang được sử dụng")
        return {"ok": False, "message": f"Tủ {locker_id} đang được sử dụng"}
    if not db.occupy_locker(locker_id):
        db.log_action("MANUAL_GUI_DO", "FAILED", message=f"Không thể giữ tủ {locker_id}")
        return {"ok": False, "message": f"Không thể giữ tủ {locker_id}"}

    sync_lockers_occupancy()
    opened = open_locker(locker_id, action="GUI_DO")
    sync_lockers_occupancy()
    db.log_action("MANUAL_GUI_DO", "SUCCESS", message=f"Gửi đồ thủ công - tủ {locker_id}")
    return {
        "ok": True,
        "message": f"Đã đánh dấu gửi đồ thủ công và mở tủ {locker_id}",
        "locker_id": locker_id,
        "locker_opened": opened,
    }


@router.post("/manual/lay-do/{locker_id}")
async def manual_lay_do(locker_id: int):
    info = db.get_locker(locker_id)
    if not info:
        db.log_action("MANUAL_LAY_DO", "FAILED", message=f"Không tìm thấy tủ {locker_id}")
        return {"ok": False, "message": "Không tìm thấy tủ"}
    if info["is_empty"]:
        db.log_action("MANUAL_LAY_DO", "FAILED", message=f"Tủ {locker_id} đang trống")
        return {"ok": False, "message": f"Tủ {locker_id} đang trống"}
    if not db.release_locker(locker_id):
        db.log_action("MANUAL_LAY_DO", "FAILED", message=f"Không thể trả tủ {locker_id}")
        return {"ok": False, "message": f"Không thể trả tủ {locker_id}"}

    sync_lockers_occupancy()
    opened = open_locker(locker_id, action="LAY_DO")
    sync_lockers_occupancy()
    db.log_action("MANUAL_LAY_DO", "SUCCESS", message=f"Lấy đồ thủ công - tủ {locker_id}")
    return {
        "ok": True,
        "message": f"Đã lấy đồ thủ công và trả tủ {locker_id}",
        "locker_id": locker_id,
        "locker_opened": opened,
    }


@router.post("/gui-do")
async def gui_do(
    file: UploadFile | None = File(None),
    image: str | None = Form(None),
    intent: str | None = Form(None),
):
    """
    Gửi đồ. intent=new — mở tủ mới dù đã có phiên gửi trước đó.
    """
    action = "GUI_DO"
    st = db.get_locker_status()

    if not st["can_gui_do"]:
        return _fail(
            action,
            "FAILED",
            CODE_NO_EMPTY_LOCKERS,
            "Hiện không còn tủ trống. Vui lòng lấy đồ trước khi gửi tiếp.",
        )

    ok_embed, err, embedding = await _embedding_from_request(file, image, action)
    if not ok_embed:
        return err

    active = db.get_active_deposits()
    matches, _ = find_all_matching_deposits(embedding, active)
    if matches and (intent or "").strip().lower() != "new":
        locker_ids = [int(m["locker_id"]) for m in matches]
        return _fail(
            action,
            "PENDING",
            CODE_ALREADY_DEPOSITED,
            "Bạn đã gửi đồ trước đó. Bạn muốn lấy đồ hay mở tủ mới?",
            locker_ids=locker_ids,
            choices=["lay_do", "gui_do_new"],
        )

    started = db.start_deposit(embedding)
    if started is None:
        return _fail(
            action,
            "FAILED",
            CODE_NO_EMPTY_LOCKERS,
            "Hiện không còn tủ trống",
        )

    deposit_id, locker_id = started
    opened = open_locker(locker_id, action="GUI_DO")
    sync_lockers_occupancy()
    db.log_action(action, "SUCCESS", message=f"Gửi đồ thành công - tủ {locker_id}")
    return {
        "ok": True,
        "message": f"Gửi đồ thành công. Mở tủ số {locker_id}. Vui lòng đặt đồ vào tủ.",
        "deposit_id": deposit_id,
        "locker_id": locker_id,
        "status": "dang_su_dung",
        "locker_opened": opened,
    }


@router.post("/lay-do")
async def lay_do(
    file: UploadFile | None = File(None),
    image: str | None = Form(None),
    locker_id: int | None = Form(None),
    open_all: bool = Form(False),
):
    """
    Lấy đồ. locker_id — mở một tủ khi có nhiều phiên; open_all=true — mở tất cả tủ của bạn.
    """
    action = "LAY_DO"
    active = db.get_active_deposits()
    if not active:
        return _fail(
            action,
            "FAILED",
            CODE_NOT_DEPOSITED,
            "Bạn chưa thực hiện gửi đồ",
        )

    ok_embed, err, embedding = await _embedding_from_request(file, image, action)
    if not ok_embed:
        return err

    matches, distance = find_all_matching_deposits(embedding, active)
    confidence = distance_to_confidence_percent(distance)

    if not matches:
        return _fail(
            action,
            "FAILED",
            CODE_NOT_DEPOSITED,
            "Bạn chưa thực hiện gửi đồ",
            confidence=confidence,
        )

    if len(matches) > 1 and locker_id is None and not open_all:
        locker_ids = [int(m["locker_id"]) for m in matches]
        return _fail(
            action,
            "PENDING",
            CODE_PICK_LOCKER,
            "Bạn đang sử dụng nhiều tủ. Chọn tủ cần mở hoặc mở tất cả.",
            locker_ids=locker_ids,
            choices=["pick_locker", "open_all"],
            confidence=confidence,
        )

    if open_all:
        targets = matches
    elif locker_id is not None:
        targets = [m for m in matches if int(m["locker_id"]) == locker_id]
        if not targets:
            return _fail(
                action,
                "FAILED",
                CODE_NOT_DEPOSITED,
                f"Bạn chưa gửi đồ vào tủ {locker_id}",
                confidence=confidence,
            )
    else:
        targets = matches[:1]

    opened_lockers: list[int] = []
    for dep in targets:
        lid = db.complete_deposit(dep["id"])
        if lid is None:
            continue
        open_locker(lid, action="LAY_DO")
        opened_lockers.append(lid)

    if not opened_lockers:
        return _fail(
            action,
            "FAILED",
            CODE_NOT_DEPOSITED,
            "Không tìm thấy phiên gửi đồ hợp lệ",
            confidence=confidence,
        )

    if len(opened_lockers) == 1:
        lid = opened_lockers[0]
        msg = f"Lấy đồ thành công. Mở tủ số {lid}."
        log_msg = f"Lấy đồ thành công - tủ {lid}"
    else:
        ids = ", ".join(str(x) for x in sorted(opened_lockers))
        msg = f"Lấy đồ thành công. Đã mở tủ: {ids}."
        log_msg = f"Lấy đồ thành công - tủ {ids}"

    db.log_action(action, "SUCCESS", confidence=confidence, message=log_msg)
    sync_lockers_occupancy()
    return {
        "ok": True,
        "message": msg,
        "locker_id": opened_lockers[0] if len(opened_lockers) == 1 else None,
        "locker_ids": opened_lockers,
        "confidence": confidence,
        "locker_opened": True,
    }

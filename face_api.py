"""
Luồng tủ khóa: kiểm tra ô trống → gửi đồ (embedding + gán tủ) → lấy đồ (so khớp embedding).
"""

from fastapi import APIRouter, File, Form, UploadFile

import database as db
from face_utils import (
    base64_to_cv2,
    capture_face_embedding,
    distance_to_confidence_percent,
    find_matching_deposit,
    is_spoof_rejection,
)
from locker_service import open_locker

router = APIRouter(prefix="/face", tags=["Tủ khóa & Khuôn mặt"])


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


@router.get("/status")
async def locker_screen_status():
    """Màn hình tủ: kiểm tra còn ô trống không."""
    st = db.get_locker_status()
    message = None
    if not st["can_gui_do"]:
        message = "Hiện không còn tủ trống"
    return {
        "ok": True,
        **st,
        "message": message,
        "lockers": db.get_all_lockers(),
        "esp_connected": True,
    }


@router.get("/logs")
async def activity_logs(limit: int = 5):
    return {"logs": db.get_logs(limit)}


@router.post("/open-locker/{locker_id}")
async def manual_open_locker(locker_id: int):
    """Mở tủ thủ công từ panel điều khiển."""
    lockers = {l["id"]: l for l in db.get_all_lockers()}
    if locker_id not in lockers:
        return {"ok": False, "message": "Không tìm thấy tủ"}
    opened = open_locker(locker_id)
    info = lockers[locker_id]
    db.log_action("MANUAL", "SUCCESS", message=f"Mở tủ {locker_id} — {info['label']}")
    return {
        "ok": True,
        "message": f"Đã gửi lệnh mở tủ {locker_id}",
        "locker_id": locker_id,
        "locker_opened": opened,
    }


@router.post("/gui-do")
async def gui_do(
    file: UploadFile | None = File(None),
    image: str | None = Form(None),
):
    action = "GUI_DO"
    st = db.get_locker_status()
    if not st["can_gui_do"]:
        msg = "Hiện không còn tủ trống"
        db.log_action(action, "FAILED", message=msg)
        return {"ok": False, "message": msg}

    img = await _read_image(file, image)
    if img is None:
        db.log_action(action, "ERROR", message="Thiếu ảnh")
        return {"ok": False, "message": "Vui lòng bật camera và thử lại"}

    ok, msg, embedding = capture_face_embedding(img)
    if not ok or embedding is None:
        status = "SPOOF" if is_spoof_rejection(msg) else "FAILED"
        db.log_action(action, status, message=msg)
        return {"ok": False, "message": msg}

    started = db.start_deposit(embedding)
    if started is None:
        msg = "Hiện không còn tủ trống"
        db.log_action(action, "FAILED", message=msg)
        return {"ok": False, "message": msg}

    deposit_id, locker_id = started
    opened = open_locker(locker_id)

    db.log_action(
        action,
        "SUCCESS",
        message=f"Gửi đồ thành công — tủ {locker_id}",
    )
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
):
    action = "LAY_DO"
    active = db.get_active_deposits()
    if not active:
        msg = "Chưa có ai gửi đồ trong hệ thống"
        db.log_action(action, "FAILED", message=msg)
        return {"ok": False, "message": msg}

    img = await _read_image(file, image)
    if img is None:
        db.log_action(action, "ERROR", message="Thiếu ảnh")
        return {"ok": False, "message": "Vui lòng bật camera và thử lại"}

    ok, msg, embedding = capture_face_embedding(img)
    if not ok or embedding is None:
        status = "SPOOF" if is_spoof_rejection(msg) else "FAILED"
        db.log_action(action, status, message=msg)
        return {"ok": False, "message": msg}

    matched, distance = find_matching_deposit(embedding, active)
    confidence = distance_to_confidence_percent(distance)

    if matched is None:
        if confidence <= 0:
            msg = "Không tìm thấy phiên gửi đồ nào trong hệ thống."
        else:
            msg = (
                f"Khuôn mặt không khớp với ai đã gửi đồ (độ tin cậy {confidence}%, chưa đủ). "
                "Hãy dùng đúng người đã gửi đồ trước đó."
            )
        db.log_action(action, "FAILED", confidence=confidence, message=msg)
        return {"ok": False, "message": msg, "confidence": confidence}

    locker_id = db.complete_deposit(matched["id"])
    if locker_id is None:
        msg = "Không tìm thấy tủ tương ứng với phiên gửi đồ này"
        db.log_action(action, "FAILED", message=msg)
        return {"ok": False, "message": msg}

    opened = open_locker(locker_id)
    db.log_action(
        action,
        "SUCCESS",
        confidence=confidence,
        message=f"Lấy đồ thành công — tủ {locker_id}",
    )
    return {
        "ok": True,
        "message": f"Lấy đồ thành công. Mở tủ số {locker_id}.",
        "deposit_id": matched["id"],
        "locker_id": locker_id,
        "confidence": confidence,
        "locker_opened": opened,
    }

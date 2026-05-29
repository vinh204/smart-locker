"""Điều khiển mở khóa tủ — bước sau sẽ nối ESP32."""

import logging

logger = logging.getLogger(__name__)


def open_locker(locker_id: int) -> bool:
    """
    Mở khóa ô tủ. Hiện tại chỉ ghi log (mô phỏng).
  Bước tiếp theo: gọi HTTP tới ESP32 theo số ô.
    """
    logger.info("MO TU: o so %s", locker_id)
    print(f"[LOCKER] Mo o tu so {locker_id}")
    return True

"""Điều khiển mở khóa tủ — bước sau sẽ nối ESP32."""

import logging

logger = logging.getLogger(__name__)


def open_locker(locker_id: int) -> bool:
    """
    Mở khóa ô tủ. Hiện tại chỉ ghi log (mô phỏng).
  Bước tiếp theo: gọi HTTP tới ESP32 theo số ô.
    """
    logger.info("Mở tủ số %s", locker_id)
    print(f"[TỦ] Đã mở tủ số {locker_id} (chế độ mô phỏng)")
    return True

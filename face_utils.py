import math
import os
import tempfile
from pathlib import Path

import cv2
import numpy as np
from deepface import DeepFace

from config import (
    DETECTOR_BACKEND,
    ENABLE_ANTI_SPOOF,
    MAX_FACE_RATIO,
    MAX_HEAD_TILT_DEG,
    MIN_FACE_HEIGHT_IMG_RATIO,
    MIN_FACE_RATIO,
    MIN_FACE_WIDTH_IMG_RATIO,
    VERIFY_THRESHOLD,
)

FACE_DB_DIR = Path(__file__).resolve().parent / "face_db"
FACE_DB_DIR.mkdir(exist_ok=True)

MODEL_NAME = "ArcFace"


def base64_to_cv2(image_b64: str) -> np.ndarray:
    import base64

    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]
    data = base64.b64decode(image_b64)
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Không giải mã được ảnh từ camera.")
    return img


def _save_temp(img: np.ndarray) -> str:
    fd, path = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    cv2.imwrite(path, img, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    return path


def _is_face_detection_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return (
        "not detected" in text
        or "no face" in text
        or "could not be detected" in text
        or "face could not" in text
    )


def _is_missing_torch_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return (
        "install torch" in text
        or "pip install torch" in text
        or "no module named 'torch'" in text
        or ("torch" in text and "anti spoof" in text)
        or ("torch" in text and "anti-spoof" in text)
    )


def _check_geometry(img, facial_area, left_eye, right_eye) -> tuple[bool, str]:
    w = facial_area.get("w", 0)
    h = facial_area.get("h", 0)
    if w <= 0 or h <= 0:
        return False, "Không đo được kích thước khuôn mặt. Nhìn thẳng vào giữa khung."

    img_h, img_w = img.shape[:2]
    width_ratio = w / max(img_w, 1)
    height_ratio = h / max(img_h, 1)
    if width_ratio < MIN_FACE_WIDTH_IMG_RATIO or height_ratio < MIN_FACE_HEIGHT_IMG_RATIO:
        return (
            False,
            f"Khuôn mặt quá nhỏ ({width_ratio:.0%} ngang, {height_ratio:.0%} dọc). "
            f"Tiến gần camera hơn (cần tối thiểu {MIN_FACE_WIDTH_IMG_RATIO:.0%}).",
        )

    ratio = w / h
    if ratio < MIN_FACE_RATIO or ratio > MAX_FACE_RATIO:
        return (
            False,
            f"Tỷ lệ khuôn mặt chưa phù hợp ({ratio:.2f}). Giữ đầu thẳng, nhìn vào camera.",
        )

    if left_eye is not None and right_eye is not None:
        dy = right_eye[1] - left_eye[1]
        dx = right_eye[0] - left_eye[0]
        tilt_deg = abs(math.degrees(math.atan2(dy, dx)))
        if tilt_deg > MAX_HEAD_TILT_DEG:
            return (
                False,
                f"Đầu đang nghiêng {tilt_deg:.1f}° (tối đa {MAX_HEAD_TILT_DEG:.0f}°). Nhìn thẳng camera.",
            )

    return True, "Hình học khuôn mặt hợp lệ"


def _check_anti_spoof(path: str) -> tuple[bool, str]:
    if not ENABLE_ANTI_SPOOF:
        return True, "Bỏ qua kiểm tra chống giả mạo"

    try:
        faces = DeepFace.extract_faces(
            img_path=path,
            detector_backend=DETECTOR_BACKEND,
            anti_spoofing=True,
            enforce_detection=True,
        )
        if not faces:
            return False, "Không phát hiện khuôn mặt. Đưa mặt vào giữa khung xanh."

        if not bool(faces[0].get("is_real", True)):
            return (
                False,
                "Phát hiện ảnh in hoặc màn hình. Vui lòng dùng khuôn mặt thật trước camera.",
            )
        return True, "Xác nhận người thật"
    except Exception as exc:
        if _is_face_detection_error(exc):
            return False, "Không phát hiện khuôn mặt. Đưa mặt vào giữa khung xanh."
        if _is_missing_torch_error(exc):
            return (
                False,
                "Chống giả mạo cần PyTorch. Chạy: pip install torch",
            )
        return False, f"Lỗi kiểm tra chống giả mạo: {exc}"


def capture_face_embedding(img: np.ndarray) -> tuple[bool, str, list[float] | None]:
    """Kiểm tra chống giả mạo + hình học + trích xuất embedding ArcFace."""
    path = _save_temp(img)
    try:
        live_ok, live_msg = _check_anti_spoof(path)
        if not live_ok:
            return False, live_msg, None

        try:
            result = DeepFace.represent(
                img_path=path,
                model_name=MODEL_NAME,
                detector_backend=DETECTOR_BACKEND,
                enforce_detection=True,
            )
        except Exception as exc:
            if _is_face_detection_error(exc):
                return (
                    False,
                    "Không phát hiện khuôn mặt khi phân tích. Nhìn thẳng vào giữa khung.",
                    None,
                )
            return False, f"Lỗi AI nhận diện: {exc}", None

        if not result or "embedding" not in result[0]:
            return (
                False,
                "Không trích xuất được đặc trưng khuôn mặt. Thử chỉnh ánh sáng hoặc tiến gần camera.",
                None,
            )

        item = result[0]
        geom_ok, geom_msg = _check_geometry(
            img,
            item.get("facial_area") or {},
            item.get("left_eye"),
            item.get("right_eye"),
        )
        if not geom_ok:
            return False, geom_msg, None

        emb = item["embedding"]
        if isinstance(emb, np.ndarray):
            emb = emb.tolist()
        return True, "Xác thực khuôn mặt thành công", [float(x) for x in emb]
    finally:
        if os.path.exists(path):
            os.remove(path)


def cosine_distance(vec_a: list[float], vec_b: list[float]) -> float:
    a = np.asarray(vec_a, dtype=np.float64)
    b = np.asarray(vec_b, dtype=np.float64)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 1.0
    return float(1.0 - np.dot(a, b) / (na * nb))


def distance_to_confidence_percent(distance: float) -> float:
    pct = max(0.0, min(100.0, (1.0 - distance / VERIFY_THRESHOLD) * 100.0))
    return round(pct, 2)


def is_spoof_rejection(message: str) -> bool:
    text = (message or "").lower()
    return any(
        kw in text
        for kw in (
            "giả mạo",
            "gia mao",
            "ảnh in",
            "anh in",
            "màn hình",
            "man hinh",
            "chống giả",
            "chong gia",
        )
    )


def find_matching_deposit(
    query_embedding: list[float],
    active_deposits: list[dict],
) -> tuple[dict | None, float]:
    if not active_deposits:
        return None, 1.0

    best_dep = None
    best_dist = float("inf")
    for dep in active_deposits:
        dist = cosine_distance(query_embedding, dep["embedding"])
        if dist < best_dist:
            best_dist = dist
            best_dep = dep

    if best_dep is None or best_dist > VERIFY_THRESHOLD:
        return None, best_dist
    return best_dep, best_dist

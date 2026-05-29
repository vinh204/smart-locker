import math
import os
import tempfile
from pathlib import Path

import cv2
import numpy as np
from deepface import DeepFace

from config import VERIFY_THRESHOLD

FACE_DB_DIR = Path(__file__).resolve().parent / "face_db"
FACE_DB_DIR.mkdir(exist_ok=True)

MODEL_NAME = "ArcFace"
DETECTOR_BACKEND = "retinaface"
DISTANCE_METRIC = "cosine"
MAX_HEAD_TILT_DEG = 8.0
MIN_FACE_RATIO = 0.6
MAX_FACE_RATIO = 1.25


def base64_to_cv2(image_b64: str) -> np.ndarray:
    import base64

    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]
    data = base64.b64decode(image_b64)
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Không giải mã được ảnh Base64")
    return img


def _save_temp(img: np.ndarray) -> str:
    fd, path = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    cv2.imwrite(path, img)
    return path


def _row_distance(row) -> float:
    """Đọc khoảng cách từ kết quả DeepFace (tương thích nhiều phiên bản)."""
    if "distance" in row.index:
        return float(row["distance"])
    legacy = f"{MODEL_NAME}_{DISTANCE_METRIC}"
    if legacy in row.index:
        return float(row[legacy])
    for col in row.index:
        if str(col).endswith(f"_{DISTANCE_METRIC}"):
            return float(row[col])
    raise KeyError(
        f"Không tìm thấy cột khoảng cách. Các cột có sẵn: {list(row.index)}"
    )


def _row_folder_name(row) -> str:
    identity = str(row.get("identity", "") or "")
    if not identity:
        raise ValueError("Thiếu trường identity trong kết quả DeepFace")
    return Path(identity).parent.name


def _deepface_find(img_path: str):
    """Tìm kiếm DB — similarity_search=True để luôn có bản ghi gần nhất."""
    return DeepFace.find(
        img_path=img_path,
        db_path=str(FACE_DB_DIR),
        model_name=MODEL_NAME,
        detector_backend=DETECTOR_BACKEND,
        distance_metric=DISTANCE_METRIC,
        enforce_detection=True,
        similarity_search=True,
        silent=True,
    )


def check_liveness(img: np.ndarray) -> tuple[bool, str]:
    path = _save_temp(img)
    try:
        faces = DeepFace.extract_faces(
            img_path=path,
            detector_backend=DETECTOR_BACKEND,
            anti_spoofing=True,
            enforce_detection=True,
        )
        if not faces:
            return False, "Không phát hiện khuôn mặt"
        face = faces[0]
        is_real = bool(face.get("is_real", True))
        if not is_real:
            return False, "Cảnh báo giả mạo (Anti-spoofing)"
        return True, "Xác nhận người thật"
    except Exception as exc:
        return False, f"Lỗi kiểm tra liveness: {exc}"
    finally:
        if os.path.exists(path):
            os.remove(path)


def evaluate_face_geometry(img: np.ndarray) -> tuple[bool, str]:
    path = _save_temp(img)
    try:
        result = DeepFace.represent(
            img_path=path,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True,
        )
        if not result:
            return False, "Không trích xuất được đặc trưng khuôn mặt"

        facial_area = result[0].get("facial_area") or {}
        left_eye = result[0].get("left_eye")
        right_eye = result[0].get("right_eye")

        if left_eye is None or right_eye is None:
            objs = DeepFace.extract_faces(
                img_path=path,
                detector_backend=DETECTOR_BACKEND,
                anti_spoofing=False,
                enforce_detection=True,
            )
            if objs and "facial_area" in objs[0]:
                facial_area = objs[0]["facial_area"]

        w = facial_area.get("w", 0)
        h = facial_area.get("h", 0)
        if w <= 0 or h <= 0:
            return False, "Không đo được kích thước khuôn mặt"

        ratio = w / h
        if ratio < MIN_FACE_RATIO or ratio > MAX_FACE_RATIO:
            return (
                False,
                f"Tỷ lệ khuôn mặt không hợp lệ ({ratio:.2f}). Vui lòng nhìn thẳng camera.",
            )

        if left_eye is not None and right_eye is not None:
            dy = right_eye[1] - left_eye[1]
            dx = right_eye[0] - left_eye[0]
            tilt_deg = abs(math.degrees(math.atan2(dy, dx)))
            if tilt_deg > MAX_HEAD_TILT_DEG:
                return (
                    False,
                    f"Góc nghiêng đầu {tilt_deg:.1f}° vượt quá {MAX_HEAD_TILT_DEG}°. Nhìn thẳng camera.",
                )

        return True, "Hình học khuôn mặt hợp lệ"
    except Exception as exc:
        return False, f"Lỗi đánh giá hình học: {exc}"
    finally:
        if os.path.exists(path):
            os.remove(path)


def check_duplicate_face(img: np.ndarray) -> tuple[bool, str | None]:
    """True = trùng (chặn đăng ký), False = không trùng."""
    if not any(FACE_DB_DIR.iterdir()):
        return False, None

    path = _save_temp(img)
    try:
        df = _deepface_find(path)
        if df and len(df) > 0 and not df[0].empty:
            best = df[0].iloc[0]
            distance = _row_distance(best)
            if distance <= VERIFY_THRESHOLD:
                return True, _row_folder_name(best)
        return False, None
    except ValueError:
        return False, None
    except Exception:
        return False, None
    finally:
        if os.path.exists(path):
            os.remove(path)


def recognize_face(img: np.ndarray) -> tuple[str | None, float, str]:
    """
    Returns (folder_name or None, distance, message).
    Lower cosine distance = better match.
    """
    if not any(FACE_DB_DIR.iterdir()):
        return None, 1.0, "Cơ sở dữ liệu khuôn mặt trống"

    path = _save_temp(img)
    try:
        df = _deepface_find(path)
        if not df or len(df) == 0 or df[0].empty:
            return None, 1.0, "Không khớp người dùng nào"

        best = df[0].iloc[0]
        distance = _row_distance(best)
        folder_name = _row_folder_name(best)

        if distance > VERIFY_THRESHOLD:
            return None, distance, "Độ tin cậy không đủ để mở khóa"

        return folder_name, distance, "Xác thực thành công"
    except Exception as exc:
        return None, 1.0, f"Lỗi nhận diện: {exc}"
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


def validate_face_clear(img: np.ndarray) -> tuple[bool, str]:
    """Kiểm tra khuôn mặt đủ rõ để chụp (anti-spoof + hình học)."""
    is_live, live_msg = check_liveness(img)
    if not is_live:
        return False, "Khuôn mặt không rõ hoặc không hợp lệ. Vui lòng chụp lại."
    geom_ok, geom_msg = evaluate_face_geometry(img)
    if not geom_ok:
        return False, "Khuôn mặt không rõ. Vui lòng nhìn thẳng camera và chụp lại."
    return True, "Khuôn mặt hợp lệ"


def extract_embedding(img: np.ndarray) -> tuple[list[float] | None, str]:
    """Tạo vector embedding ArcFace từ ảnh."""
    path = _save_temp(img)
    try:
        result = DeepFace.represent(
            img_path=path,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True,
        )
        if not result or "embedding" not in result[0]:
            return None, "Không tạo được embedding. Vui lòng chụp lại."
        emb = result[0]["embedding"]
        if isinstance(emb, np.ndarray):
            emb = emb.tolist()
        return [float(x) for x in emb], "OK"
    except Exception as exc:
        return None, f"Không tạo được embedding: {exc}. Vui lòng chụp lại."
    finally:
        if os.path.exists(path):
            os.remove(path)


def capture_face_embedding(img: np.ndarray) -> tuple[bool, str, list[float] | None]:
    """Kiểm tra rõ mặt + trích xuất embedding trong một luồng."""
    ok, msg = validate_face_clear(img)
    if not ok:
        return False, msg, None
    embedding, emb_msg = extract_embedding(img)
    if embedding is None:
        return False, emb_msg, None
    return True, "OK", embedding


def find_matching_deposit(
    query_embedding: list[float],
    active_deposits: list[dict],
) -> tuple[dict | None, float]:
    """
    So khớp embedding với các phiên gửi đồ đang active.
    Trả (deposit dict, distance) hoặc (None, 1.0).
    """
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


def save_face_image(img: np.ndarray, folder_name: str, filename: str = "face.jpg") -> Path:
    user_dir = FACE_DB_DIR / folder_name
    user_dir.mkdir(parents=True, exist_ok=True)
    out = user_dir / filename
    cv2.imwrite(str(out), img)
    return out


MIN_FACE_WIDTH_IMG_RATIO = 0.2
MIN_FACE_HEIGHT_IMG_RATIO = 0.22


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


def check_liveness(img: np.ndarray) -> tuple[bool, str]:
    path = _save_temp(img)
    try:
        faces = DeepFace.extract_faces(
            img_path=path,
            detector_backend=DETECTOR_BACKEND,
            anti_spoofing=True,
            enforce_detection=True,
        )
        if not faces:
            return False, "Khong phat hien khuon mat. Vui long nhin vao giua khung."

        face = faces[0]
        if not bool(face.get("is_real", True)):
            return (
                False,
                "Anti-spoof that bai. Vui long dung khuon mat that, khong chup qua anh hoac man hinh.",
            )

        return True, "Xac nhan nguoi that"
    except Exception as exc:
        if _is_face_detection_error(exc):
            return False, "Khong phat hien khuon mat. Vui long nhin vao giua khung."
        if _is_missing_torch_error(exc):
            return False, f"Loi kiem tra anti-spoof: {exc}"
        return False, f"Loi kiem tra anti-spoof: {exc}"
    finally:
        if os.path.exists(path):
            os.remove(path)


def evaluate_face_geometry(img: np.ndarray) -> tuple[bool, str]:
    path = _save_temp(img)
    try:
        result = DeepFace.represent(
            img_path=path,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True,
        )
        if not result:
            return False, "Khong trich xuat duoc dac trung khuon mat."

        item = result[0]
        facial_area = item.get("facial_area") or {}
        left_eye = item.get("left_eye")
        right_eye = item.get("right_eye")

        if left_eye is None or right_eye is None:
            objs = DeepFace.extract_faces(
                img_path=path,
                detector_backend=DETECTOR_BACKEND,
                anti_spoofing=False,
                enforce_detection=True,
            )
            if objs and "facial_area" in objs[0]:
                facial_area = objs[0]["facial_area"]

        w = facial_area.get("w", 0)
        h = facial_area.get("h", 0)
        if w <= 0 or h <= 0:
            return False, "Khong do duoc kich thuoc khuon mat."

        img_h, img_w = img.shape[:2]
        width_ratio = w / max(img_w, 1)
        height_ratio = h / max(img_h, 1)
        if width_ratio < MIN_FACE_WIDTH_IMG_RATIO or height_ratio < MIN_FACE_HEIGHT_IMG_RATIO:
            return (
                False,
                f"Khuon mat qua nho ({width_ratio:.0%} x {height_ratio:.0%}). Vui long tien gan camera hon.",
            )

        ratio = w / h
        if ratio < MIN_FACE_RATIO or ratio > MAX_FACE_RATIO:
            return (
                False,
                f"Ty le khuon mat khong hop le ({ratio:.2f}). Vui long nhin thang camera.",
            )

        if left_eye is not None and right_eye is not None:
            dy = right_eye[1] - left_eye[1]
            dx = right_eye[0] - left_eye[0]
            tilt_deg = abs(math.degrees(math.atan2(dy, dx)))
            if tilt_deg > MAX_HEAD_TILT_DEG:
                return (
                    False,
                    f"Goc nghieng dau {tilt_deg:.1f} do vuot qua {MAX_HEAD_TILT_DEG} do. Vui long nhin thang camera.",
                )

        return True, "Hinh hoc khuon mat hop le"
    except Exception as exc:
        if _is_face_detection_error(exc):
            return False, "Khong phat hien khuon mat. Vui long nhin vao giua khung."
        return False, f"Loi danh gia khuon mat: {exc}"
    finally:
        if os.path.exists(path):
            os.remove(path)


def validate_face_clear(img: np.ndarray) -> tuple[bool, str]:
    is_live, live_msg = check_liveness(img)
    if not is_live:
        return False, live_msg

    geom_ok, geom_msg = evaluate_face_geometry(img)
    if not geom_ok:
        return False, geom_msg

    return True, "Khuon mat hop le"

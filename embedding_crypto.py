import json
from functools import lru_cache
from pathlib import Path

from config import EMBEDDING_ENCRYPTION_KEY

try:
    from cryptography.fernet import Fernet, InvalidToken
except ImportError as exc:
    raise RuntimeError(
        "Thieu dependency 'cryptography'. Hay chay: pip install -r requirements.txt"
    ) from exc


EMBEDDING_PREFIX = "enc:v1:"
KEY_FILE_PATH = Path(__file__).resolve().parent / ".embedding_fernet.key"


def is_encrypted_embedding(value: str | None) -> bool:
    return bool(value and value.startswith(EMBEDDING_PREFIX))


def serialize_embedding(embedding: list[float]) -> str:
    payload = json.dumps(embedding, separators=(",", ":")).encode("utf-8")
    token = _get_fernet().encrypt(payload).decode("ascii")
    return f"{EMBEDDING_PREFIX}{token}"


def deserialize_embedding(value: str | None) -> list[float] | None:
    if value is None:
        return None

    if is_encrypted_embedding(value):
        token = value[len(EMBEDDING_PREFIX) :].encode("ascii")
        try:
            payload = _get_fernet().decrypt(token)
        except InvalidToken as exc:
            raise RuntimeError(
                "Khong giai ma duoc embedding. Kiem tra lai khoa ma hoa."
            ) from exc
        data = json.loads(payload.decode("utf-8"))
    else:
        # Tuong thich voi du lieu cu chua duoc ma hoa.
        data = json.loads(value)

    return [float(item) for item in data]


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    key = _load_or_create_key()
    try:
        return Fernet(key)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(
            "Khoa ma hoa embedding khong hop le. "
            "Hay dung Fernet key hop le hoac xoa file khoa cu de tao lai."
        ) from exc


def _load_or_create_key() -> bytes:
    if EMBEDDING_ENCRYPTION_KEY:
        return EMBEDDING_ENCRYPTION_KEY.encode("ascii")

    if KEY_FILE_PATH.exists():
        return KEY_FILE_PATH.read_text(encoding="utf-8").strip().encode("ascii")

    key = Fernet.generate_key()
    KEY_FILE_PATH.write_text(key.decode("ascii"), encoding="utf-8")
    return key

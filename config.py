import os

# So o tu trong he thong
LOCKER_COUNT = 3

# "mqtt" -> Wokwi/ESP32 | "mock" -> chi log
_mode = os.environ.get("LOCKER_CONTROL_MODE", "mqtt").strip().lower()
LOCKER_CONTROL_MODE = _mode if _mode in ("mqtt", "mock") else "mqtt"

# MQTT (khop voi wokwi/sketch.ino)
MQTT_BROKER_HOST = "broker.hivemq.com"
MQTT_BROKER_PORT = 1883
MQTT_BROKER_USERNAME = ""
MQTT_BROKER_PASSWORD = ""
MQTT_CLIENT_ID = "smart-locker-backend"
MQTT_TOPIC_PREFIX = "smart-locker/demo"
MQTT_QOS = 1
MQTT_BROKER_KEEPALIVE_SEC = 30
MQTT_ACK_TIMEOUT_SEC = 4.0
MQTT_DEVICE_TIMEOUT_SEC = 20.0

# Khoa ma hoa embedding luu trong SQLite.
# Khuyen nghi dat bang bien moi truong EMBEDDING_ENCRYPTION_KEY.
EMBEDDING_ENCRYPTION_KEY = os.environ.get("EMBEDDING_ENCRYPTION_KEY", "").strip()

# Nguong cosine distance khi so khop embedding (ArcFace)
VERIFY_THRESHOLD = 0.68

# Nhan dien khuon mat
DETECTOR_BACKEND = "opencv"
ENABLE_ANTI_SPOOF = True

# Kiem tra hinh hoc khuon mat
MAX_HEAD_TILT_DEG = 15.0
MIN_FACE_RATIO = 0.55
MAX_FACE_RATIO = 1.35
MIN_FACE_WIDTH_IMG_RATIO = 0.12
MIN_FACE_HEIGHT_IMG_RATIO = 0.14

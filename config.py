# Số ô tủ trong hệ thống (có thể đổi theo phần cứng thực tế)
LOCKER_COUNT = 3

# Ngưỡng cosine distance khi so khớp embedding (ArcFace)
VERIFY_THRESHOLD = 0.68

# Nhận diện khuôn mặt
DETECTOR_BACKEND = "opencv"  # opencv ổn định hơn với webcam; retinaface chính xác hơn nhưng nặng
ENABLE_ANTI_SPOOF = True

# Kiểm tra hình học khuôn mặt (nới nhẹ cho webcam)
MAX_HEAD_TILT_DEG = 15.0
MIN_FACE_RATIO = 0.55
MAX_FACE_RATIO = 1.35
MIN_FACE_WIDTH_IMG_RATIO = 0.12
MIN_FACE_HEIGHT_IMG_RATIO = 0.14

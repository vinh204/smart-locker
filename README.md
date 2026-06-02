# Smart Locker

Dự án demo hệ thống tủ đồ thông minh kết hợp nhận diện khuôn mặt và điều khiển tủ qua MQTT.

Ứng dụng gồm:
- Backend FastAPI xử lý xác thực ảnh, chống giả mạo và so khớp khuôn mặt.
- SQLite lưu trạng thái tủ, phiên gửi/lấy đồ và lịch sử thao tác.
- Frontend web xác thực bằng webcam và dashboard điều khiển thủ công.
- Cầu nối MQTT đến Wokwi ESP32 mô phỏng `LED`, `LCD`, `buzzer` (servo đã loại bỏ khỏi mô phỏng hiện tại).

## Trạng thái repo hiện tại

- `main.py` khởi tạo FastAPI, mount `static/` và mở 2 trang chính `/` và `/dashboard`.
- `face_api.py` cung cấp API gửi đồ, lấy đồ, trạng thái tủ và chức năng điều khiển thủ công.
- `database.py` quản lý SQLite với các bảng: `lockers`, `deposits`, `logs`.
- `face_utils.py` chuyển ảnh, trích embedding ArcFace, so khớp cosine và kiểm tra anti-spoof.
- `locker_service.py` mở tủ qua MQTT hoặc chế độ mock.
- `mqtt_service.py` là cầu nối MQTT, publish lệnh mở tủ và đồng bộ trạng thái occupancy.
- `config.py` chứa cấu hình MQTT, số lượng tủ, nhận diện khuôn mặt và chế độ điều khiển.
- `wokwi/sketch.ino` là firmware ESP32 mô phỏng (LED/LCD/buzzer, không dùng servo trong mô phỏng hiện tại).
- `wokwi/diagram.json` là sơ đồ phần cứng Wokwi.

## Cấu trúc chính

| Tệp | Vai trò |
|-----|--------|
| `main.py` | Khởi tạo FastAPI, mount `static/`, trang index và dashboard |
| `face_api.py` | Router `/face` xử lý gửi đồ, lấy đồ, trạng thái, logs, dashboard thủ công |
| `database.py` | SQLite cho `lockers`, `deposits`, `logs` |
| `face_utils.py` | Xử lý ảnh, chống giả mạo, trích embedding và so khớp |
| `locker_service.py` | Mở tủ qua MQTT hoặc mock |
| `mqtt_service.py` | Cầu nối MQTT, publish lệnh, subscribe trạng thái, đồng bộ occupancy |
| `config.py` | Cấu hình tủ, MQTT, nhận diện khuôn mặt |
| `wokwi/sketch.ino` | Firmware ESP32 mô phỏng Wokwi (LED/LCD/buzzer) |
| `wokwi/diagram.json` | Sơ đồ phần cứng mô phỏng Wokwi |
| `static/index.html` | Trang xác thực khuôn mặt |
| `static/dashboard.html` | Dashboard điều khiển thủ công |
| `static/styles.css` | CSS giao diện |
| `static/app.js` | Logic frontend xác thực khuôn mặt |
| `static/dashboard.js` | Logic frontend dashboard |
| `face_db.sqlite` | Database SQLite chứa trạng thái tủ và logs |

## Yêu cầu

- Python 3.11+
- Windows / Linux / Mac
- Mạng để tải model DeepFace lần đầu và file `face-api.js` từ CDN

Cài đặt:

```bash
cd d:\PYTHON\smart-locker
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Chạy server

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Mở trình duyệt:
- `http://localhost:8000` — giao diện xác thực khuôn mặt
- `http://localhost:8000/dashboard` — dashboard thủ công

> Không cần dùng `--reload` khi chạy cùng mô phỏng MQTT/Wokwi.

## Chế độ điều khiển tủ

Backend hỗ trợ 2 chế độ:

- `mqtt` — gửi lệnh mở tủ qua MQTT đến Wokwi ESP32
- `mock` — chỉ log thao tác, không cần MQTT

Mặc định `LOCKER_CONTROL_MODE=mqtt`. Đổi sang mock bằng biến môi trường:

```bash
set LOCKER_CONTROL_MODE=mock
```

## Wokwi và MQTT

Hiện tại Wokwi mô phỏng ESP32 chỉ dùng `LED`, `LCD`, `buzzer`; phần servo đã bị loại bỏ do mô phỏng không ổn định.

Để chạy mô phỏng Wokwi:

1. Mở [wokwi.com](https://wokwi.com).
2. Import thư mục `wokwi/`.
3. Chạy mô phỏng.
4. `wokwi/sketch.ino` và `config.py` phải cùng `MQTT_TOPIC_PREFIX` là `smart-locker/demo`.
5. Khi backend và ESP32 kết nối, dashboard sẽ hiển thị trạng thái MQTT và ESP.

## Luồng nghiệp vụ

### Gửi đồ

1. Người dùng mở camera trên trang chính.
2. Ảnh được gửi đến endpoint `POST /face/gui-do`.
3. Backend kiểm tra anti-spoof và trích xuất embedding.
4. Nếu có tủ trống, hệ thống gán tủ, tạo phiên gửi đồ, đồng bộ occupancy và mở tủ.
5. Nếu người dùng đã gửi đồ trước đó, hệ thống sẽ yêu cầu chọn mở tủ hiện có hoặc mở tủ mới.

### Lấy đồ

1. Người dùng gửi ảnh lên `POST /face/lay-do`.
2. Backend so khớp embedding với các phiên gửi đồ đang hoạt động.
3. Nếu nhiều tủ phù hợp, frontend yêu cầu chọn tủ hoặc mở tất cả.
4. Khi xác thực thành công, tủ được mở và phiên gửi đồ hoàn tất.

### Điều khiển thủ công

Dashboard cho phép:
- Chọn tủ
- Gửi đồ thủ công (`POST /face/manual/gui-do/{locker_id}`)
- Lấy đồ thủ công (`POST /face/manual/lay-do/{locker_id}`)
- Mở tủ trực tiếp (`POST /face/open-locker/{locker_id}`)

## API chính

- `GET /face/status` — trả trạng thái tủ, số lượng trống/đang dùng, `esp_connected`, trạng thái MQTT.
- `GET /face/logs` — trả lịch sử thao tác.
- `POST /face/gui-do` — gửi đồ bằng ảnh camera/file upload.
- `POST /face/lay-do` — lấy đồ bằng ảnh camera/file upload.
- `POST /face/manual/gui-do/{locker_id}` — gửi đồ thủ công.
- `POST /face/manual/lay-do/{locker_id}` — lấy đồ thủ công.
- `POST /face/open-locker/{locker_id}` — mở tủ trực tiếp để kiểm tra.

## Ghi chú kỹ thuật

- `LOCKER_COUNT` mặc định là `3`.
- `VERIFY_THRESHOLD` dùng để so khớp cosine embedding.
- `ENABLE_ANTI_SPOOF = True` yêu cầu model và dependency đủ.
- `mqtt_service.py` đồng bộ occupancy từ database và nhận trạng thái ESP32 qua MQTT.
- `wokwi/sketch.ino` hiện mô phỏng ESP32 và cập nhật LCD/LED; không có servo trong mô phỏng thực tế.

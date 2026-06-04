# Smart Locker

Hệ thống tủ đồ thông minh dùng nhận diện khuôn mặt để gửi và lấy đồ, kèm mô phỏng ESP32 trên Wokwi qua MQTT.

Project hiện có 3 phần chạy cùng nhau:

- Backend `FastAPI` xử lý xác thực khuôn mặt, chống giả mạo, quản lý trạng thái tủ và cung cấp API.
- Frontend web dùng webcam để tự chụp khuôn mặt và điều khiển luồng gửi đồ/lấy đồ.
- Mô phỏng `ESP32` trên `Wokwi` nhận lệnh mở tủ qua MQTT, điều khiển `servo`, `LED`, `LCD`, `buzzer`.

## Tính năng hiện có

- Gửi đồ bằng khuôn mặt qua trang `/`.
- Lấy đồ bằng khuôn mặt qua trang `/`.
- Tự động chụp khi khuôn mặt đứng ổn định trong khung.
- Dùng `DeepFace` + `ArcFace` để trích xuất embedding và so khớp.
- Kiểm tra chống giả mạo (`anti-spoof`) nếu bật trong cấu hình.
- Kiểm tra thêm hình học khuôn mặt: kích thước mặt, tỉ lệ mặt, góc nghiêng đầu.
- Một người có thể đang dùng nhiều tủ:
  - Khi gửi thêm đồ, hệ thống hỏi muốn lấy đồ cũ hay mở tủ mới.
  - Khi lấy đồ, hệ thống có thể cho chọn một tủ hoặc mở tất cả tủ khớp.
- Đồng bộ trạng thái tủ từ SQLite sang ESP32 qua MQTT.
- Lưu lịch sử thao tác trong SQLite.

## Kiến trúc nhanh

```text
Webcam/Browser
    -> static/index.html + static/app.js
    -> POST /face/gui-do | /face/lay-do
    -> face_api.py
    -> face_utils.py
    -> database.py (SQLite)
    -> locker_service.py
    -> mqtt_service.py
    -> broker.hivemq.com
    -> Wokwi ESP32 (wokwi/sketch.ino)
```

## Cấu trúc thư mục

```text
smart-locker/
|- main.py                 # Khởi tạo FastAPI, mount static, mở trang chính /
|- face_api.py             # API gửi đồ, lấy đồ, logs, trạng thái, thao tác thủ công
|- face_utils.py           # Anti-spoof, kiểm tra hình học, embedding, so khớp
|- database.py             # SQLite: lockers, deposits, logs
|- locker_service.py       # Chọn cách mở tủ: MQTT hoặc mock
|- mqtt_service.py         # Bridge MQTT, ACK lệnh mở, heartbeat thiết bị
|- config.py               # Cấu hình tủ, MQTT, ngưỡng nhận diện
|- requirements.txt
|- static/
|  |- index.html           # Màn hình xác thực khuôn mặt
|  |- app.js               # Luồng webcam, auto-scan, gọi API
|  |- styles.css
|- wokwi/
|  |- sketch.ino           # Firmware ESP32 mô phỏng
|  |- diagram.json         # Sơ đồ phần cứng Wokwi
|  |- libraries.txt
```

File `face_db.sqlite` sẽ được tạo tự động khi chạy ứng dụng lần đầu.

## Công nghệ sử dụng

- Python 3.11+
- FastAPI + Uvicorn
- DeepFace
- TensorFlow
- PyTorch
- OpenCV
- SQLite
- MQTT với `paho-mqtt`
- Frontend thuần HTML/CSS/JavaScript
- `@vladmandic/face-api` tải từ CDN để hỗ trợ phát hiện mặt trên trình duyệt

## Cài đặt

### Windows PowerShell

```powershell
cd D:\PYTHON\smart-locker
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Linux / macOS

```bash
cd /path/to/smart-locker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Chạy ứng dụng

### Cách 1: chạy bằng Uvicorn

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Khuyến nghị không dùng `--reload` khi đang test cùng MQTT/Wokwi để tránh phát sinh nhiều tiến trình backend và làm kết nối MQTT bị lặp.

### Cách 2: chạy trực tiếp file Python

```bash
python main.py
```

Mở trình duyệt:

- `http://localhost:8000` -> giao diện xác thực khuôn mặt và theo dõi trạng thái tủ

## Chế độ điều khiển tủ

Ứng dụng có 2 chế độ:

- `mqtt`: gửi lệnh mở tủ thật sang ESP32/Wokwi qua MQTT
- `mock`: chỉ log thao tác mở tủ, không cần MQTT

Mặc định đang là `mqtt`.

### Đổi sang mock trên PowerShell

```powershell
$env:LOCKER_CONTROL_MODE = "mock"
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Đổi sang mock trên CMD

```cmd
set LOCKER_CONTROL_MODE=mock
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Đổi sang mock trên Bash

```bash
export LOCKER_CONTROL_MODE=mock
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Cấu hình chính

Các cấu hình hiện nằm trong `config.py`:

- `LOCKER_COUNT = 3`: số tủ mặc định.
- `LOCKER_CONTROL_MODE = "mqtt"`: chế độ mở tủ.
- `MQTT_BROKER_HOST = "broker.hivemq.com"`: broker công khai đang dùng.
- `MQTT_TOPIC_PREFIX = "smart-locker/demo"`: prefix topic giữa backend và ESP32.
- `VERIFY_THRESHOLD = 0.68`: ngưỡng so khớp embedding.
- `ENABLE_ANTI_SPOOF = True`: bật chống giả mạo.
- `DETECTOR_BACKEND = "opencv"`: backend phát hiện mặt cho DeepFace.

Nếu nhiều nhóm cùng dùng broker công khai, nên đổi `MQTT_TOPIC_PREFIX` để tránh đụng topic.

## Luồng nghiệp vụ thực tế

### 1. Gửi đồ

1. Người dùng mở camera ở trang chính.
2. Frontend dùng `face-api.js` để dò mặt và tự chụp khi mặt đứng ổn định trong khung.
3. Ảnh được gửi lên `POST /face/gui-do`.
4. Backend:
   - đọc ảnh
   - chống giả mạo nếu đang bật
   - trích xuất embedding bằng `ArcFace`
   - kiểm tra xem người này đã có phiên gửi đồ nào đang hoạt động chưa
5. Nếu người dùng đã gửi trước đó, API trả về lựa chọn:
   - lấy đồ cũ
   - mở tủ mới để gửi thêm
6. Nếu hợp lệ và còn tủ trống, hệ thống:
   - chọn tủ trống đầu tiên
   - lưu phiên gửi đồ vào SQLite
   - cập nhật trạng thái occupancy
   - gửi lệnh mở tủ

### 2. Lấy đồ

1. Ảnh được gửi lên `POST /face/lay-do`.
2. Backend so khớp embedding với tất cả phiên gửi đồ còn hoạt động.
3. Nếu khớp nhiều tủ, frontend hiển thị lựa chọn:
   - mở một tủ cụ thể
   - mở tất cả tủ của người dùng
4. Khi xác thực thành công, hệ thống:
   - đánh dấu phiên gửi đồ là đã lấy
   - giải phóng tủ trong SQLite
   - gửi lệnh mở tủ

## API hiện có

### Trạng thái và lịch sử

- `GET /face/status`
  - Trả về số tủ tổng, số tủ trống, số tủ đang dùng, danh sách tủ, trạng thái MQTT/ESP32.
- `GET /face/logs?limit=5`
  - Trả về lịch sử thao tác gần nhất.

### Xác thực khuôn mặt

- `POST /face/gui-do`
  - Form hỗ trợ:
    - `file`: ảnh upload
    - `image`: ảnh base64 từ webcam
    - `intent`: nếu là `new` thì bỏ qua cảnh báo đã gửi trước đó và tạo phiên gửi mới
- `POST /face/lay-do`
  - Form hỗ trợ:
    - `file`: ảnh upload
    - `image`: ảnh base64 từ webcam
    - `locker_id`: chọn đúng tủ cần lấy khi có nhiều kết quả khớp
    - `open_all`: mở tất cả tủ khớp

### Thao tác thủ công

- `POST /face/manual/gui-do/{locker_id}`
- `POST /face/manual/lay-do/{locker_id}`
- `POST /face/open-locker/{locker_id}`

Ba endpoint trên hiện được giữ lại cho mục đích debug/nội bộ, nhưng không còn được gắn với một trang giao diện riêng.

## Database

SQLite được quản lý trong `database.py` với 3 bảng:

- `lockers`: trạng thái từng tủ
- `deposits`: phiên gửi đồ, embedding, thời gian tạo, trạng thái
- `logs`: lịch sử thao tác, kết quả, thông báo, thời gian

Các trạng thái đang dùng:

- Tủ:
  - `trong`
  - `dang_su_dung`
- Phiên gửi đồ:
  - `dang_su_dung`
  - `da_lay`

## MQTT và Wokwi

### Backend MQTT đang làm gì

- Kết nối broker bằng `paho-mqtt`.
- Subscribe:
  - `smart-locker/demo/lockers/+/status`
  - `smart-locker/demo/device/status`
- Publish:
  - `smart-locker/demo/lockers/{id}/command`
  - `smart-locker/demo/lockers/occupancy`
- Chờ ACK từ ESP32 sau khi gửi lệnh mở tủ.
- Theo dõi heartbeat để suy ra `device_online`.

### Firmware Wokwi đang làm gì

File `wokwi/sketch.ino` hiện mô phỏng:

- `3 LED` tương ứng 3 tủ
- `3 servo` mở/đóng cửa tủ
- `LCD 16x2`
- `buzzer`

Hành vi chính:

- Khi nhận lệnh mở tủ, servo quay từ `0` đến `90` độ, giữ `5 giây`, rồi đóng lại.
- `GUI_DO` làm tủ chuyển sang trạng thái đang sử dụng.
- `LAY_DO` làm tủ trở lại trạng thái trống.
- LCD hiển thị trạng thái theo nghiệp vụ gửi đồ/lấy đồ.
- Thiết bị gửi heartbeat định kỳ lên MQTT.

### Chạy mô phỏng Wokwi

1. Mở `https://wokwi.com`.
2. Import thư mục `wokwi/`.
3. Chạy mô phỏng.
4. Đảm bảo backend và `sketch.ino` dùng cùng:
   - `MQTT_HOST`
   - `MQTT_PORT`
   - `MQTT_TOPIC_PREFIX`
5. Chạy backend ở chế độ `mqtt`.
6. Mở `/` để kiểm tra trạng thái kết nối.

## Phụ thuộc mạng và tải model

Lần chạy đầu hoặc lúc demo, project có thể cần mạng cho các phần sau:

- `DeepFace` tải model cần thiết.
- `face-api.js` và model trình duyệt tải từ CDN.
- MQTT public broker `broker.hivemq.com`.
- Wokwi chạy trên nền web.

## Một số lỗi dễ gặp

### Camera không mở được

- Kiểm tra quyền camera của trình duyệt.
- Dùng `https` hoặc `localhost` nếu trình duyệt chặn camera ở origin không an toàn.

### Chống giả mạo báo lỗi PyTorch

`face_utils.py` đang yêu cầu `torch` khi `ENABLE_ANTI_SPOOF = True`.

Nếu máy yếu hoặc chưa cài đúng môi trường, có 2 hướng:

- cài đủ dependency từ `requirements.txt`
- tạm đổi `ENABLE_ANTI_SPOOF = False` trong `config.py` để demo luồng cơ bản

### ESP32 không hiện đã kết nối

- Kiểm tra backend có chạy ở `LOCKER_CONTROL_MODE=mqtt`.
- Kiểm tra Wokwi đang chạy.
- Kiểm tra `MQTT_TOPIC_PREFIX` có khớp giữa `config.py` và `wokwi/sketch.ino`.
- Nếu dùng broker công khai, thử đổi prefix topic riêng.

## Gợi ý demo nhanh

### Demo không cần Wokwi

1. Chuyển sang `LOCKER_CONTROL_MODE=mock`.
2. Chạy backend.
3. Mở `/`.
4. Thử gửi đồ và lấy đồ bằng camera.

### Demo đầy đủ với Wokwi

1. Chạy backend ở chế độ `mqtt`.
2. Mở mô phỏng Wokwi.
3. Chờ trạng thái ESP32 chuyển sang đã kết nối.
4. Dùng trang `/` để gửi đồ/lấy đồ.
5. Theo dõi LED, LCD, servo và buzzer trên Wokwi.

## Tệp quan trọng nên đọc khi phát triển tiếp

- `face_api.py`: nắm toàn bộ luồng nghiệp vụ.
- `face_utils.py`: logic AI và kiểm tra khuôn mặt.
- `mqtt_service.py`: giao tiếp backend <-> ESP32.
- `static/app.js`: trải nghiệm người dùng ở màn hình chính.
- `wokwi/sketch.ino`: hành vi phần cứng mô phỏng.

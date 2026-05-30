# Smart Locker – Nhận diện khuôn mặt + IoT (ESP32)

## Bước 1 (hiện tại): Nhận diện khuôn mặt

Chỉ gồm **2 nút** trên giao diện web:

| Nút | API | Việc làm |
|-----|-----|----------|
| **Gửi đồ** | `POST /face/gui-do` | Chỉ xác thực + ghi log (không đăng ký khuôn mặt mới) |
| **Lấy đồ** | `POST /face/lay-do` | Chỉ xác thực + ghi log |

Web xử lý khuôn mặt trực tiếp từ ảnh camera, không dùng thư mục `face_db/`.

Chưa có ESP32, mở tủ, nhật ký trên web — làm ở bước sau.

| Tệp | Vai trò |
|-----|--------|
| `main.py` | Server + trang chủ |
| `face_api.py` | `/face/gui-do`, `/face/lay-do` |
| `database.py` | SQLite `users`, `logs` (action `GUI_DO`, `LAY_DO`) |
| `face_utils.py` | DeepFace ArcFace + RetinaFace |
| `static/index.html` | Camera + 2 nút |

## Cấu trúc (toàn dự án)

| Tệp | Vai trò |
|-----|--------|
| `firmware/esp32_lcd_code/` | ESP32 (bước sau) |

## Cài đặt

```bash
cd d:\PYTHON\smart-locker
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Lần chạy đầu DeepFace sẽ tải mô hình (cần mạng, dung lượng lớn).

## Chạy server

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Mở trình duyệt: `http://localhost:8000`

## Cấu hình ESP32

1. Sửa `WIFI_SSID`, `WIFI_PASS` trong `esp32_lcd_code.ino`.
2. Nạp firmware bằng Arduino IDE (board ESP32, thư viện `LiquidCrystal_I2C`, `WebServer`).
3. Ghi IP ESP32; sửa trong `main.py`:

```python
ESP_LCD_IP = "192.168.100.161"  # IP thực của ESP32
```

Server gọi: `GET http://<ESP_IP>/update?line1=...&line2=...`

## API chính

- **GET `/face/status`** – Trạng thái tủ, số ô trống và danh sách các tủ
- **POST `/face/gui-do`** – Chụp ảnh, chống giả mạo, trích xuất embedding và gán tủ trống
- **POST `/face/lay-do`** – Chụp ảnh, so khớp embedding với các phiên gửi đồ đang hoạt động
- **GET `/face/logs`** – Lấy nhật ký hoạt động gần nhất
- **POST `/face/open-locker/{locker_id}`** – Mở tủ thủ công từ panel điều khiển

## Mô phỏng không có ESP32

API `/verify` vẫn trả kết quả AI; trường `esp_unlock: false` nếu không kết nối được ESP32.

## Lưu ý

- Cần webcam và đủ RAM/GPU cho TensorFlow + DeepFace.
- Relay/LCD: chỉnh `RELAY_PIN`, mức HIGH/LOW và địa chỉ I2C LCD (`0x27` / `0x3F`) theo phần cứng thực tế.

# Smart Locker

Ứng dụng demo tủ đồ thông minh dùng nhận diện khuôn mặt với FastAPI, DeepFace và giao diện web chạy trực tiếp trên webcam của trình duyệt.

## Trạng thái repo hiện tại

- Backend nhận ảnh từ web, chống giả mạo, trích xuất embedding và so khớp người gửi/lấy đồ.
- Frontend dùng `face-api` phía client để canh khuôn mặt vào giữa khung rồi tự chụp.
- Dữ liệu trạng thái tủ, phiên gửi đồ và lịch sử thao tác được lưu trong SQLite.
- Chức năng mở tủ hiện là mô phỏng: `locker_service.py` chỉ ghi log và trả `True`.
- Repo hiện không chứa firmware ESP32; phần cứng thật chưa được tích hợp trong mã nguồn này.

## Cấu trúc chính

| Tệp | Vai trò |
|-----|--------|
| `main.py` | Khởi tạo FastAPI, mount thư mục `static/`, trả trang chủ `/` |
| `face_api.py` | API gửi đồ, lấy đồ, trạng thái tủ, lịch sử và mở tủ thủ công |
| `database.py` | SQLite cho `lockers`, `deposits`, `logs` |
| `face_utils.py` | Chuyển ảnh, chống giả mạo, trích embedding ArcFace, so khớp cosine |
| `locker_service.py` | Lớp mô phỏng mở tủ |
| `config.py` | Số lượng tủ, ngưỡng so khớp, anti-spoof và các ràng buộc hình học |
| `static/index.html` | Khung HTML của giao diện |
| `static/styles.css` | CSS của giao diện |
| `static/app.js` | Logic frontend: camera, quét mặt, gọi API, render trạng thái |
| `face_db.sqlite` | File SQLite tạo ra khi chạy ứng dụng |

## Cài đặt

```bash
cd d:\PYTHON\smart-locker
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Lưu ý:

- Lần chạy đầu `DeepFace` có thể tải model, nên cần mạng và khá tốn dung lượng.
- Giao diện web cũng tải model `face-api` từ CDN khi mở trang.

## Chạy server

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Mở trình duyệt tại `http://localhost:8000`.

## Luồng nghiệp vụ hiện tại

### Gửi đồ

1. Frontend mở webcam và chờ mặt nằm ổn định trong khung.
2. Ảnh được gửi lên `POST /face/gui-do`.
3. Backend kiểm tra anti-spoof, trích embedding và tìm tủ trống.
4. Nếu người đó đã có phiên gửi đồ đang hoạt động, API trả lựa chọn lấy đồ hoặc mở thêm tủ.
5. Nếu hợp lệ, hệ thống tạo phiên gửi đồ mới, gán tủ và gọi hàm mở tủ mô phỏng.

### Lấy đồ

1. Frontend chụp lại khuôn mặt và gửi lên `POST /face/lay-do`.
2. Backend so khớp embedding với các phiên gửi đồ còn hoạt động.
3. Nếu khớp nhiều tủ, frontend hiển thị hộp thoại chọn một tủ hoặc mở tất cả.
4. Khi lấy đồ thành công, phiên gửi đồ được đánh dấu hoàn tất và tủ được trả về trạng thái trống.

## API chính

- `GET /face/status`: Trạng thái số lượng tủ, danh sách tủ và cờ `esp_connected` cho UI.
- `GET /face/logs`: Lấy lịch sử thao tác gần nhất.
- `POST /face/gui-do`: Gửi đồ bằng ảnh camera hoặc file upload.
- `POST /face/lay-do`: Lấy đồ bằng ảnh camera hoặc file upload.
- `POST /face/open-locker/{locker_id}`: Mở tủ thủ công từ giao diện điều khiển.

## Ghi chú kỹ thuật

- `LOCKER_COUNT` mặc định là `3` trong `config.py`.
- Embedding được so khớp bằng cosine distance với ngưỡng `VERIFY_THRESHOLD`.
- `ENABLE_ANTI_SPOOF = True` yêu cầu môi trường có đủ dependency, bao gồm `torch`.
- API `/face/status` hiện trả `esp_connected: true` cố định để UI hiển thị trạng thái kết nối.
- Nếu muốn nối phần cứng thật, điểm bắt đầu hợp lý là `locker_service.py` và endpoint `/face/status`.

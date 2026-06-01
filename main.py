"""
Server chính — Bước 1 chỉ bật module nhận diện khuôn mặt.
Các bước sau (ESP32, điều khiển tủ, …) sẽ gắn thêm sau.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

import database as db
from face_api import router as face_router

STATIC_DIR = Path(__file__).resolve().parent / "static"
STATIC_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Tủ đồ thông minh - Nhận diện khuôn mặt")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.include_router(face_router)

db.init_db()


def render_page(name: str) -> HTMLResponse:
    html_path = STATIC_DIR / name
    return HTMLResponse(
        html_path.read_text(encoding="utf-8"),
        headers={"Cache-Control": "no-store"},
    )


@app.get("/", response_class=HTMLResponse)
async def index():
    return render_page("index.html")


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard():
    return render_page("dashboard.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

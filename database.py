import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

from config import LOCKER_COUNT

DB_PATH = Path(__file__).resolve().parent / "face_db.sqlite"

STATUS_LOCKER_EMPTY = "trong"
STATUS_LOCKER_IN_USE = "dang_su_dung"
STATUS_DEPOSIT_ACTIVE = "dang_su_dung"
STATUS_DEPOSIT_DONE = "da_lay"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_type TEXT NOT NULL,
                status TEXT NOT NULL,
                confidence REAL,
                message TEXT,
                timestamp TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS lockers (
                id INTEGER PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'trong'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS deposits (
                id TEXT PRIMARY KEY,
                locker_id INTEGER NOT NULL,
                embedding TEXT,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL,
                FOREIGN KEY (locker_id) REFERENCES lockers(id)
            )
            """
        )
        conn.commit()

    _init_lockers()


def _init_lockers():
    with get_connection() as conn:
        for i in range(1, LOCKER_COUNT + 1):
            conn.execute(
                "INSERT OR IGNORE INTO lockers (id, status) VALUES (?, ?)",
                (i, STATUS_LOCKER_EMPTY),
            )
        conn.execute(
            "DELETE FROM lockers WHERE id > ? AND status = ?",
            (LOCKER_COUNT, STATUS_LOCKER_EMPTY),
        )
        conn.commit()


def count_empty_lockers() -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM lockers WHERE status = ?",
            (STATUS_LOCKER_EMPTY,),
        ).fetchone()
    return int(row["c"])


def count_active_deposits() -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM deposits WHERE status = ? AND embedding IS NOT NULL",
            (STATUS_DEPOSIT_ACTIVE,),
        ).fetchone()
    return int(row["c"])


def get_locker_status() -> dict:
    with get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM lockers").fetchone()["c"]
        empty = count_empty_lockers()
        in_use = total - empty
        active = count_active_deposits()
    return {
        "total_lockers": total,
        "empty_lockers": empty,
        "in_use_lockers": in_use,
        "active_deposits": active,
        "can_gui_do": empty > 0,
        "can_lay_do": active > 0,
    }


def start_deposit(embedding: list[float]) -> tuple[str, int] | None:
    """
    Gán ô trống + lưu embedding trong một giao dịch.
    Trả (deposit_id, locker_id) hoặc None nếu hết tủ.
    """
    deposit_id = str(uuid.uuid4())
    now = datetime.now().isoformat(timespec="seconds")
    with get_connection() as conn:
        row = conn.execute(
            "SELECT id FROM lockers WHERE status = ? ORDER BY id LIMIT 1",
            (STATUS_LOCKER_EMPTY,),
        ).fetchone()
        if not row:
            return None
        locker_id = int(row["id"])
        updated = conn.execute(
            "UPDATE lockers SET status = ? WHERE id = ? AND status = ?",
            (STATUS_LOCKER_IN_USE, locker_id, STATUS_LOCKER_EMPTY),
        )
        if updated.rowcount == 0:
            return None
        conn.execute(
            """
            INSERT INTO deposits (id, locker_id, embedding, created_at, status)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                deposit_id,
                locker_id,
                json.dumps(embedding),
                now,
                STATUS_DEPOSIT_ACTIVE,
            ),
        )
        conn.commit()
    return deposit_id, locker_id


def get_active_deposits() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, locker_id, embedding, created_at, status
            FROM deposits
            WHERE status = ? AND embedding IS NOT NULL
            """,
            (STATUS_DEPOSIT_ACTIVE,),
        ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["embedding"] = json.loads(item["embedding"])
        result.append(item)
    return result


def complete_deposit(deposit_id: str) -> int | None:
    """Đánh dấu đã lấy đồ, xóa embedding, trả ô. Trả locker_id."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT locker_id FROM deposits WHERE id = ? AND status = ?",
            (deposit_id, STATUS_DEPOSIT_ACTIVE),
        ).fetchone()
        if not row:
            return None
        locker_id = int(row["locker_id"])
        conn.execute(
            """
            UPDATE deposits
            SET status = ?, embedding = NULL
            WHERE id = ?
            """,
            (STATUS_DEPOSIT_DONE, deposit_id),
        )
        conn.execute(
            "UPDATE lockers SET status = ? WHERE id = ?",
            (STATUS_LOCKER_EMPTY, locker_id),
        )
        if locker_id > LOCKER_COUNT:
            conn.execute("DELETE FROM lockers WHERE id = ?", (locker_id,))
        conn.commit()
    return locker_id


def get_all_lockers() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute("SELECT id, status FROM lockers ORDER BY id").fetchall()
    result = []
    for row in rows:
        empty = row["status"] == STATUS_LOCKER_EMPTY
        result.append(
            {
                "id": int(row["id"]),
                "status": row["status"],
                "is_empty": empty,
                "label": "Trống" if empty else "Đang sử dụng",
            }
        )
    return result


def get_logs(limit: int = 5) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM logs ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def log_action(
    action_type: str,
    status: str,
    confidence: float | None = None,
    message: str | None = None,
) -> None:
    now = datetime.now().isoformat(timespec="seconds")
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO logs (action_type, status, confidence, message, timestamp)
            VALUES (?, ?, ?, ?, ?)
            """,
            (action_type, status, confidence, message, now),
        )
        conn.commit()

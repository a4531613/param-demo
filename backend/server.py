"""
Lightweight parameter configuration service using Python stdlib + SQLite.
Run with: python backend/server.py
This serves both the JSON API under /api/* and the Vue frontend in /frontend.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"
DB_PATH = ROOT / "backend" / "data.db"


# --- Database helpers ----------------------------------------------------- #


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS applications (
            app_id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_code TEXT NOT NULL UNIQUE,
            app_name TEXT,
            description TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS environments (
            env_id INTEGER PRIMARY KEY AUTOINCREMENT,
            env_code TEXT NOT NULL,
            env_name TEXT,
            app_id INTEGER NOT NULL,
            description TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(app_id, env_code),
            FOREIGN KEY(app_id) REFERENCES applications(app_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS config_types (
            type_id INTEGER PRIMARY KEY AUTOINCREMENT,
            type_code TEXT NOT NULL,
            type_name TEXT NOT NULL,
            app_id INTEGER NOT NULL,
            env_id INTEGER NOT NULL,
            description TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(app_id, env_id, type_code),
            FOREIGN KEY(app_id) REFERENCES applications(app_id) ON DELETE CASCADE,
            FOREIGN KEY(env_id) REFERENCES environments(env_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS config_type_fields (
            field_id INTEGER PRIMARY KEY AUTOINCREMENT,
            field_key TEXT NOT NULL,
            field_name TEXT NOT NULL,
            field_type TEXT NOT NULL,
            field_length INTEGER,
            is_required INTEGER NOT NULL DEFAULT 0,
            regex_pattern TEXT,
            default_value TEXT,
            enum_options TEXT,
            description TEXT,
            type_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(type_id, field_key),
            FOREIGN KEY(type_id) REFERENCES config_types(type_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS config_versions (
            version_id INTEGER PRIMARY KEY AUTOINCREMENT,
            version_no TEXT NOT NULL,
            app_id INTEGER NOT NULL,
            env_id INTEGER NOT NULL,
            type_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft', -- draft/pending/published/rejected
            is_current INTEGER NOT NULL DEFAULT 0,
            effective_from TEXT,
            effective_to TEXT,
            description TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(type_id, version_no),
            FOREIGN KEY(app_id) REFERENCES applications(app_id) ON DELETE CASCADE,
            FOREIGN KEY(env_id) REFERENCES environments(env_id) ON DELETE CASCADE,
            FOREIGN KEY(type_id) REFERENCES config_types(type_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS config_items (
            item_id INTEGER PRIMARY KEY AUTOINCREMENT,
            version_id INTEGER NOT NULL,
            field_id INTEGER NOT NULL,
            field_key TEXT NOT NULL,
            field_value TEXT NOT NULL,
            value_format TEXT NOT NULL DEFAULT 'plain',
            description TEXT,
            is_enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(version_id, field_id),
            UNIQUE(version_id, field_key),
            FOREIGN KEY(version_id) REFERENCES config_versions(version_id) ON DELETE CASCADE,
            FOREIGN KEY(field_id) REFERENCES config_type_fields(field_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id INTEGER,
            payload TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
    )
    conn.commit()
    conn.close()


def db_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


# --- Core operations ------------------------------------------------------ #


def get_or_create_app_env(
    conn: sqlite3.Connection, app_code: str, env_code: str
) -> Tuple[int, int]:
    cur = conn.execute("SELECT app_id FROM applications WHERE app_code = ?", (app_code,))
    row = cur.fetchone()
    if row:
        app_id = row["app_id"]
    else:
        cur = conn.execute(
            "INSERT INTO applications (app_code, app_name) VALUES (?, ?)",
            (app_code, app_code),
        )
        app_id = cur.lastrowid
    cur = conn.execute(
        "SELECT env_id FROM environments WHERE app_id = ? AND env_code = ?",
        (app_id, env_code),
    )
    row = cur.fetchone()
    if row:
        env_id = row["env_id"]
    else:
        cur = conn.execute(
            "INSERT INTO environments (env_code, env_name, app_id) VALUES (?, ?, ?)",
            (env_code, env_code, app_id),
        )
        env_id = cur.lastrowid
    return app_id, env_id


def record_audit(
    conn: sqlite3.Connection,
    actor: str,
    action: str,
    target_type: str,
    target_id: Optional[int],
    payload: Dict[str, Any],
) -> None:
    conn.execute(
        "INSERT INTO audit_logs (actor, action, target_type, target_id, payload) VALUES (?, ?, ?, ?, ?)",
        (actor, action, target_type, target_id, json.dumps(payload)),
    )


# --- HTTP Handler --------------------------------------------------------- #


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "ParamDemo/0.1"

    # Silence default logging
    def log_message(self, fmt: str, *args: Any) -> None:  # pragma: no cover - reduce noise
        return

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._set_cors()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            return self.handle_api_get(parsed)
        return self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown path")
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid JSON")
            return
        actor = self.headers.get("X-User", "system")
        return self.handle_api_post(parsed, data, actor)

    # --- API routing ----------------------------------------------------- #

    def handle_api_get(self, parsed) -> None:
        path = parsed.path
        params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
        if path == "/api/health":
            return self.send_json({"status": "ok", "timestamp": now_iso()})
        if path == "/api/apps":
            return self.list_apps()
        if path == "/api/types":
            return self.list_types(params)
        if path == "/api/config":
            return self.get_config(params)
        if path == "/api/versions":
            return self.list_versions(params)
        self.send_error(HTTPStatus.NOT_FOUND, "API not found")

    def handle_api_post(self, parsed, data: Dict[str, Any], actor: str) -> None:
        path = parsed.path
        if path == "/api/types":
            return self.create_type(data, actor)
        if path == "/api/versions":
            return self.create_version(data, actor)
        if path.endswith("/submit") and path.startswith("/api/versions/"):
            version_id = int(path.split("/")[3])
            return self.update_version_status(version_id, "pending", actor)
        if path.endswith("/publish") and path.startswith("/api/versions/"):
            version_id = int(path.split("/")[3])
            return self.publish_version(version_id, actor)
        self.send_error(HTTPStatus.NOT_FOUND, "API not found")

    # --- API handlers ---------------------------------------------------- #

    def list_apps(self) -> None:
        conn = db_connect()
        rows = conn.execute(
            "SELECT app_id, app_code, app_name, description FROM applications ORDER BY app_code"
        ).fetchall()
        conn.close()
        self.send_json([dict(row) for row in rows])

    def list_types(self, params: Dict[str, str]) -> None:
        app_code = params.get("appCode")
        env_code = params.get("envCode")
        conn = db_connect()
        query = """
        SELECT ct.type_id, ct.type_code, ct.type_name, ct.description,
               a.app_code, e.env_code
        FROM config_types ct
        JOIN applications a ON a.app_id = ct.app_id
        JOIN environments e ON e.env_id = ct.env_id
        """
        clauses = []
        args: list[Any] = []
        if app_code:
            clauses.append("a.app_code = ?")
            args.append(app_code)
        if env_code:
            clauses.append("e.env_code = ?")
            args.append(env_code)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY a.app_code, e.env_code, ct.type_code"
        rows = conn.execute(query, args).fetchall()
        conn.close()
        self.send_json([dict(row) for row in rows])

    def create_type(self, data: Dict[str, Any], actor: str) -> None:
        required = ["appCode", "envCode", "typeCode", "typeName"]
        if any(k not in data for k in required):
            return self.send_error(HTTPStatus.BAD_REQUEST, "Missing required fields")
        app_code = data["appCode"]
        env_code = data["envCode"]
        type_code = data["typeCode"]
        type_name = data["typeName"]
        description = data.get("description", "")
        fields = data.get("fields", [])
        conn = db_connect()
        try:
            app_id, env_id = get_or_create_app_env(conn, app_code, env_code)
            cur = conn.execute(
                """
                INSERT INTO config_types (type_code, type_name, app_id, env_id, description)
                VALUES (?, ?, ?, ?, ?)
                """,
                (type_code, type_name, app_id, env_id, description),
            )
            type_id = cur.lastrowid
            for field in fields:
                conn.execute(
                    """
                    INSERT INTO config_type_fields
                        (field_key, field_name, field_type, field_length, is_required,
                         regex_pattern, default_value, enum_options, description, type_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        field["fieldKey"],
                        field.get("fieldName", field["fieldKey"]),
                        field.get("fieldType", "string"),
                        field.get("fieldLength"),
                        1 if field.get("isRequired") else 0,
                        field.get("regexPattern"),
                        field.get("defaultValue"),
                        field.get("enumOptions"),
                        field.get("description", ""),
                        type_id,
                    ),
                )
            record_audit(
                conn,
                actor,
                "create_type",
                "config_type",
                type_id,
                {"appCode": app_code, "envCode": env_code, "typeCode": type_code},
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            conn.close()
            return self.send_error(HTTPStatus.CONFLICT, f"Conflict: {exc}")
        conn.close()
        self.send_json({"typeId": type_id}, status=HTTPStatus.CREATED)

    def create_version(self, data: Dict[str, Any], actor: str) -> None:
        required = ["appCode", "envCode", "typeCode", "versionNo"]
        if any(k not in data for k in required):
            return self.send_error(HTTPStatus.BAD_REQUEST, "Missing required fields")
        items = data.get("items", [])
        app_code = data["appCode"]
        env_code = data["envCode"]
        type_code = data["typeCode"]
        version_no = data["versionNo"]
        description = data.get("description", "")
        effective_from = data.get("effectiveFrom")
        conn = db_connect()
        try:
            app_id, env_id = get_or_create_app_env(conn, app_code, env_code)
            cur = conn.execute(
                """
                SELECT type_id FROM config_types
                WHERE app_id = ? AND env_id = ? AND type_code = ?
                """,
                (app_id, env_id, type_code),
            )
            row = cur.fetchone()
            if not row:
                raise ValueError("config type not found; create it first")
            type_id = row["type_id"]
            cur = conn.execute(
                """
                INSERT INTO config_versions
                    (version_no, app_id, env_id, type_id, status, is_current,
                     effective_from, description)
                VALUES (?, ?, ?, ?, 'draft', 0, ?, ?)
                """,
                (version_no, app_id, env_id, type_id, effective_from, description),
            )
            version_id = cur.lastrowid
            # Load field definitions
            field_rows = conn.execute(
                "SELECT field_id, field_key FROM config_type_fields WHERE type_id = ?",
                (type_id,),
            ).fetchall()
            field_map = {r["field_key"]: r["field_id"] for r in field_rows}
            for item in items:
                fkey = item["fieldKey"]
                if fkey not in field_map:
                    raise ValueError(f"fieldKey not defined: {fkey}")
                conn.execute(
                    """
                    INSERT INTO config_items
                        (version_id, field_id, field_key, field_value, value_format, description)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        version_id,
                        field_map[fkey],
                        fkey,
                        str(item.get("value", "")),
                        item.get("valueFormat", "plain"),
                        item.get("description", ""),
                    ),
                )
            record_audit(
                conn,
                actor,
                "create_version",
                "config_version",
                version_id,
                {"appCode": app_code, "envCode": env_code, "typeCode": type_code, "versionNo": version_no},
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            conn.rollback()
            conn.close()
            return self.send_error(HTTPStatus.CONFLICT, f"Conflict: {exc}")
        except ValueError as exc:
            conn.rollback()
            conn.close()
            return self.send_error(HTTPStatus.BAD_REQUEST, str(exc))
        conn.close()
        self.send_json({"versionId": version_id}, status=HTTPStatus.CREATED)

    def update_version_status(self, version_id: int, status: str, actor: str) -> None:
        conn = db_connect()
        cur = conn.execute(
            "SELECT version_id, status FROM config_versions WHERE version_id = ?",
            (version_id,),
        )
        row = cur.fetchone()
        if not row:
            conn.close()
            return self.send_error(HTTPStatus.NOT_FOUND, "Version not found")
        conn.execute(
            "UPDATE config_versions SET status = ?, updated_at = ? WHERE version_id = ?",
            (status, now_iso(), version_id),
        )
        record_audit(conn, actor, "update_version_status", "config_version", version_id, {"status": status})
        conn.commit()
        conn.close()
        self.send_json({"versionId": version_id, "status": status})

    def publish_version(self, version_id: int, actor: str) -> None:
        conn = db_connect()
        cur = conn.execute(
            """
            SELECT version_id, type_id, app_id, env_id, status
            FROM config_versions WHERE version_id = ?
            """,
            (version_id,),
        )
        row = cur.fetchone()
        if not row:
            conn.close()
            return self.send_error(HTTPStatus.NOT_FOUND, "Version not found")
        if row["status"] not in ("draft", "pending"):
            conn.close()
            return self.send_error(HTTPStatus.BAD_REQUEST, "Only draft/pending can be published")
        now = now_iso()
        # mark others as not current
        conn.execute(
            """
            UPDATE config_versions
            SET is_current = 0, effective_to = ?
            WHERE type_id = ? AND is_current = 1
            """,
            (now, row["type_id"]),
        )
        conn.execute(
            """
            UPDATE config_versions
            SET status = 'published', is_current = 1, effective_from = COALESCE(effective_from, ?), updated_at = ?
            WHERE version_id = ?
            """,
            (now, now, version_id),
        )
        record_audit(conn, actor, "publish_version", "config_version", version_id, {"publishedAt": now})
        conn.commit()
        conn.close()
        self.send_json({"versionId": version_id, "status": "published", "publishedAt": now})

    def list_versions(self, params: Dict[str, str]) -> None:
        app_code = params.get("appCode")
        env_code = params.get("envCode")
        type_code = params.get("typeCode")
        conn = db_connect()
        query = """
        SELECT v.version_id, v.version_no, v.status, v.is_current,
               v.effective_from, v.effective_to,
               a.app_code, e.env_code, t.type_code
        FROM config_versions v
        JOIN applications a ON a.app_id = v.app_id
        JOIN environments e ON e.env_id = v.env_id
        JOIN config_types t ON t.type_id = v.type_id
        """
        clauses = []
        args: list[Any] = []
        if app_code:
            clauses.append("a.app_code = ?")
            args.append(app_code)
        if env_code:
            clauses.append("e.env_code = ?")
            args.append(env_code)
        if type_code:
            clauses.append("t.type_code = ?")
            args.append(type_code)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY v.created_at DESC"
        rows = conn.execute(query, args).fetchall()
        conn.close()
        self.send_json([dict(r) for r in rows])

    def get_config(self, params: Dict[str, str]) -> None:
        app_code = params.get("appCode")
        env_code = params.get("envCode")
        type_code = params.get("typeCode")
        version_no = params.get("versionNo")
        if not app_code or not env_code or not type_code:
            return self.send_error(HTTPStatus.BAD_REQUEST, "appCode/envCode/typeCode required")
        conn = db_connect()
        cur = conn.execute(
            """
            SELECT t.type_id, a.app_id, e.env_id FROM config_types t
            JOIN applications a ON a.app_id = t.app_id
            JOIN environments e ON e.env_id = t.env_id
            WHERE a.app_code = ? AND e.env_code = ? AND t.type_code = ?
            """,
            (app_code, env_code, type_code),
        )
        type_row = cur.fetchone()
        if not type_row:
            conn.close()
            return self.send_error(HTTPStatus.NOT_FOUND, "Config type not found")
        args: list[Any] = [type_row["type_id"]]
        version_clause = "is_current = 1"
        if version_no:
            version_clause = "version_no = ?"
            args.append(version_no)
        ver = conn.execute(
            f"""
            SELECT version_id, version_no, status, effective_from, effective_to, is_current
            FROM config_versions
            WHERE type_id = ? AND {version_clause}
            ORDER BY created_at DESC
            LIMIT 1
            """,
            tuple(args),
        ).fetchone()
        if not ver:
            conn.close()
            return self.send_error(HTTPStatus.NOT_FOUND, "No version found")
        items = conn.execute(
            """
            SELECT field_key, field_value, value_format, description
            FROM config_items
            WHERE version_id = ?
            ORDER BY field_key
            """,
            (ver["version_id"],),
        ).fetchall()
        conn.close()
        self.send_json(
            {
                "appCode": app_code,
                "envCode": env_code,
                "typeCode": type_code,
                "versionNo": ver["version_no"],
                "status": ver["status"],
                "effectiveFrom": ver["effective_from"],
                "items": [dict(i) for i in items],
            }
        )

    # --- Static file serving --------------------------------------------- #

    def serve_static(self, path: str) -> None:
        if path == "/":
            path = "/index.html"
        target = (FRONTEND_DIR / path.lstrip("/")).resolve()
        if not target.exists() or FRONTEND_DIR not in target.parents and target != FRONTEND_DIR:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return
        content = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        if target.suffix == ".html":
            self.send_header("Content-Type", "text/html; charset=utf-8")
        elif target.suffix == ".js":
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
        elif target.suffix == ".css":
            self.send_header("Content-Type", "text/css; charset=utf-8")
        else:
            self.send_header("Content-Type", "application/octet-stream")
        self._set_cors()
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    # --- Response helpers ------------------------------------------------ #

    def _set_cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-User")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def send_json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._set_cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run_server(host: str = "0.0.0.0", port: int = 8000) -> None:
    init_db()
    server = HTTPServer((host, port), RequestHandler)
    print(f"Serving on http://{host}:{port}")
    print(f"Frontend: http://{host}:{port}/")
    print(f"API health: http://{host}:{port}/api/health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()


if __name__ == "__main__":
    run_server()

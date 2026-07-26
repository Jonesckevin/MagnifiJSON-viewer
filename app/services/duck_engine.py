"""DuckDB Engine — singleton in-memory DuckDB connection with thread safety."""

import re
import threading
from pathlib import Path
from typing import Optional

import duckdb

_ALLOWED_RE = re.compile(
    r"^\s*(SELECT|WITH|DESCRIBE|SHOW|SUMMARIZE|EXPLAIN)\b", re.IGNORECASE
)
_FORBIDDEN_RE = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|COPY|EXPORT|IMPORT)\b",
    re.IGNORECASE,
)


def _to_view_name(filename: str) -> str:
    """Convert a filename to a safe DuckDB view name (no extension, word chars only)."""
    stem = Path(filename).stem
    name = re.sub(r"[^\w]", "_", stem)
    # Ensure it doesn't start with a digit
    if name and name[0].isdigit():
        name = "f_" + name
    return name or "json_view"


class _DuckEngine:
    def __init__(self):
        self._lock = threading.Lock()
        self._conn: Optional[duckdb.DuckDBPyConnection] = None
        self._views: dict[str, str] = {}  # view_name -> file_path
        self._init_conn()

    def _init_conn(self):
        self._conn = duckdb.connect(database=":memory:")
        # Enable JSON extension
        self._conn.execute("INSTALL json; LOAD json;")
        # Try to enable SQLite extension for sqlite_scan support.
        try:
            self._conn.execute("INSTALL sqlite; LOAD sqlite;")
        except Exception:
            pass

    # ── View management ──

    def register(
        self,
        filename: str,
        file_path: Path,
        format_hint: str = "json",
        options: Optional[dict] = None,
    ) -> dict:
        """Register a file as a DuckDB view. Returns schema info."""
        view_name = _to_view_name(filename)
        # Escape single quotes in path for the SQL string literal
        fp = str(file_path).replace("\\", "/").replace("'", "''")
        fmt = (format_hint or "json").lower()
        options = options or {}

        if fmt == "json":
            create_sql = (
                f"CREATE OR REPLACE VIEW \"{view_name}\" AS "
                f"SELECT * FROM read_json_auto("
                f"'{fp}', "
                f"auto_detect=true, "
                f"sample_size=-1, "
                f"map_inference_threshold=-1"
                f")"
            )
        elif fmt == "csv":
            delim = str(options.get("delimiter", ",")).replace("'", "''")
            create_sql = (
                f"CREATE OR REPLACE VIEW \"{view_name}\" AS "
                f"SELECT * FROM read_csv_auto("
                f"'{fp}', "
                f"header=true, "
                f"delim='{delim}', "
                f"sample_size=-1, "
                f"strict_mode=false, "
                f"ignore_errors=true, "
                f"all_varchar=false"
                f")"
            )
        elif fmt == "sqlite":
            table_name = str(options.get("table", "")).strip()
            if not table_name:
                raise RuntimeError("SQLite registration requires a table name")
            safe_table = table_name.replace('"', '""')
            create_sql = (
                f"CREATE OR REPLACE VIEW \"{view_name}\" AS "
                f"SELECT * FROM sqlite_scan('{fp}', '{safe_table}')"
            )
        else:
            raise RuntimeError(f"Unsupported registration format: {format_hint}")

        with self._lock:
            self._conn.execute(create_sql)
            self._views[view_name] = str(file_path)
        schema = self.describe(view_name)
        return {"view_name": view_name, "schema": schema}

    def unregister(self, filename: str):
        """Drop the view for a given filename."""
        view_name = _to_view_name(filename)
        with self._lock:
            try:
                self._conn.execute(f'DROP VIEW IF EXISTS "{view_name}"')
            except Exception:
                pass
            self._views.pop(view_name, None)

    def view_name(self, filename: str) -> str:
        """Return the DuckDB view name for a filename."""
        return _to_view_name(filename)

    def is_registered(self, filename: str) -> bool:
        return _to_view_name(filename) in self._views

    def list_views(self) -> list[str]:
        return list(self._views.keys())

    # ── Schema ──

    def describe(self, view_name: str) -> list[dict]:
        """Return column names and DuckDB types for a view."""
        with self._lock:
            try:
                rows = self._conn.execute(f'DESCRIBE "{view_name}"').fetchall()
                return [{"name": r[0], "type": r[1]} for r in rows]
            except Exception:
                return []

    def row_count(self, view_name: str) -> int:
        with self._lock:
            try:
                r = self._conn.execute(f'SELECT COUNT(*) FROM "{view_name}"').fetchone()
                return int(r[0]) if r else 0
            except Exception:
                return 0

    # ── Query ──

    def execute(self, sql: str, params: Optional[list] = None) -> list[dict]:
        """Execute SQL and return list of dicts."""
        with self._lock:
            try:
                if params:
                    rel = self._conn.execute(sql, params)
                else:
                    rel = self._conn.execute(sql)
                cols = [d[0] for d in rel.description]
                return [dict(zip(cols, row)) for row in rel.fetchall()]
            except duckdb.Error as exc:
                raise RuntimeError(str(exc)) from exc

    # ── SQL Validation ──

    def validate_sql(self, sql: str) -> str:
        """Ensure SQL is read-only. Returns cleaned SQL or raises ValueError."""
        cleaned = sql.strip().rstrip(";")
        if not cleaned:
            raise ValueError("Empty query")
        if not _ALLOWED_RE.match(cleaned):
            raise ValueError(
                "Only SELECT, WITH, DESCRIBE, SHOW, and EXPLAIN queries are allowed"
            )
        if _FORBIDDEN_RE.search(cleaned):
            raise ValueError("Query contains forbidden write operations")
        return cleaned


duck_engine = _DuckEngine()

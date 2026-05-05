"""Data Router — paginated rows, schema, and raw tree view for loaded JSON files."""

import json
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from services.duck_engine import duck_engine
from services.json_manager import get_tree, load_and_register

router = APIRouter(prefix="/api/data", tags=["data"])


def _ensure_registered(filename: str):
    """Auto-load a file if it isn't already registered with DuckDB."""
    if not duck_engine.is_registered(filename):
        load_and_register(filename)


def _serialize_row(row: dict) -> dict:
    """Serialize a row's values for JSON transport."""
    out = {}
    for k, v in row.items():
        if isinstance(v, (dict, list)):
            out[k] = json.dumps(v, default=str)
        elif isinstance(v, bytes):
            out[k] = f"[BINARY {len(v)}B]"
        else:
            out[k] = v
    return out


@router.get("/schema")
def get_schema(file: str = Query(...)):
    _ensure_registered(file)
    view = duck_engine.view_name(file)
    schema = duck_engine.describe(view)
    if not schema:
        raise HTTPException(404, f"File not found or unreadable: {file}")
    return {"file": file, "view_name": view, "schema": schema}


@router.get("/tree")
def get_json_tree(file: str = Query(...)):
    try:
        tree = get_tree(file)
    except FileNotFoundError:
        raise HTTPException(404, f"File not found: {file}")
    except Exception as exc:
        raise HTTPException(400, str(exc))
    return {"file": file, "tree": tree}


@router.get("/rows")
def get_rows(
    file: str = Query(...),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=5000),
    sort_col: Optional[str] = None,
    sort_dir: str = Query("ASC", pattern="^(ASC|DESC)$"),
    search: Optional[str] = None,
    search_col: Optional[str] = None,
    regex: bool = False,
):
    _ensure_registered(file)
    view = duck_engine.view_name(file)
    schema = duck_engine.describe(view)
    if not schema:
        raise HTTPException(404, f"File not found or empty: {file}")

    col_names = [c["name"] for c in schema]
    safe_view = f'"{view}"'

    # Validate sort column
    if sort_col and sort_col not in col_names:
        sort_col = None

    # ── ORDER BY clause ──────────────────────────────────────
    order_clause = ""
    if sort_col:
        sc = f'"{sort_col.replace(chr(34), chr(34) * 2)}"'
        order_clause = f" ORDER BY {sc} {sort_dir}"

    # ── Regex search: fetch all, filter in Python ────────────
    if regex and search:
        try:
            pattern = re.compile(search, re.IGNORECASE)
        except re.error as exc:
            raise HTTPException(400, f"Invalid regex: {exc}")

        sql = f"SELECT * FROM {safe_view}{order_clause}"
        try:
            all_rows = duck_engine.execute(sql)
        except RuntimeError as exc:
            raise HTTPException(400, str(exc))

        filtered = []
        for row in all_rows:
            for cn in col_names:
                if search_col and cn != search_col:
                    continue
                val = row.get(cn)
                if val is not None and pattern.search(str(val)):
                    filtered.append(row)
                    break

        total = len(filtered)
        page = filtered[offset: offset + limit]
        return {
            "file": file,
            "columns": col_names,
            "schema": schema,
            "rows": [_serialize_row(r) for r in page],
            "total": total,
            "offset": offset,
            "limit": limit,
        }

    # ── String / no search: parameterised SQL ────────────────
    where_clause = ""
    params: list = []

    if search:
        if search_col and search_col in col_names:
            sc = f'"{search_col.replace(chr(34), chr(34) * 2)}"'
            where_clause = f" WHERE CAST({sc} AS VARCHAR) ILIKE ?"
            params = [f"%{search}%"]
        else:
            conditions = [
                f"CAST(\"{c['name'].replace(chr(34), chr(34) * 2)}\" AS VARCHAR) ILIKE ?"
                for c in schema
            ]
            where_clause = f" WHERE ({' OR '.join(conditions)})"
            params = [f"%{search}%"] * len(schema)

    # Count
    count_sql = f"SELECT COUNT(*) AS c FROM {safe_view}{where_clause}"
    try:
        result = duck_engine.execute(count_sql, params if params else None)
        total = result[0]["c"] if result else 0
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))

    # Fetch page
    page_sql = (
        f"SELECT * FROM {safe_view}{where_clause}{order_clause} LIMIT ? OFFSET ?"
    )
    page_params = params + [limit, offset]
    try:
        rows = duck_engine.execute(page_sql, page_params)
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))

    return {
        "file": file,
        "columns": col_names,
        "schema": schema,
        "rows": [_serialize_row(r) for r in rows],
        "total": total,
        "offset": offset,
        "limit": limit,
    }

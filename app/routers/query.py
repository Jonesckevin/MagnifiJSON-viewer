"""Query Router — execute read-only DuckDB SQL and manage saved queries."""

import json
import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.duck_engine import duck_engine

router = APIRouter(prefix="/api/query", tags=["query"])

SAVED_QUERIES_FILE = Path("/app/exports/saved_queries.json")


# ── Saved query helpers ──────────────────────────────────────────

def _load_saved() -> list:
    if not SAVED_QUERIES_FILE.exists():
        return []
    try:
        raw = json.loads(SAVED_QUERIES_FILE.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            return []

        normalized = []
        changed = False
        for item in raw:
            if not isinstance(item, dict):
                changed = True
                continue
            name = str(item.get("name", "")).strip()
            sql = str(item.get("sql", ""))
            if not name or not sql:
                changed = True
                continue
            qid = str(item.get("id", "")).strip()
            if not qid:
                qid = str(uuid.uuid4())[:8]
                changed = True
            normalized.append(
                {
                    "id": qid,
                    "name": name,
                    "sql": sql,
                    "description": str(item.get("description", "")),
                }
            )

        if changed:
            _save_all(normalized)
        return normalized
    except Exception:
        return []


def _save_all(queries: list):
    SAVED_QUERIES_FILE.parent.mkdir(parents=True, exist_ok=True)
    SAVED_QUERIES_FILE.write_text(json.dumps(queries, indent=2), encoding="utf-8")


# ── Row serializer ───────────────────────────────────────────────

def _serialize_row(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if isinstance(v, (dict, list)):
            out[k] = json.dumps(v, default=str)
        elif isinstance(v, bytes):
            out[k] = f"[BINARY {len(v)}B]"
        else:
            out[k] = v
    return out


# ── Models ───────────────────────────────────────────────────────

class ExecuteRequest(BaseModel):
    sql: str
    limit: int = 500


class ValidateRequest(BaseModel):
    sql: str


class SaveQueryRequest(BaseModel):
    name: str
    sql: str
    description: Optional[str] = ""


# ── Endpoints ────────────────────────────────────────────────────

@router.post("/execute")
def execute_sql(req: ExecuteRequest):
    try:
        sql = duck_engine.validate_sql(req.sql)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    limit = min(req.limit, 5000)
    has_limit = bool(re.search(r"\bLIMIT\b", sql, re.IGNORECASE))

    try:
        if has_limit:
            rows = duck_engine.execute(sql)
        else:
            rows = duck_engine.execute(f"{sql} LIMIT {limit}")
    except RuntimeError as exc:
        raise HTTPException(400, f"SQL error: {exc}")

    columns = list(rows[0].keys()) if rows else []
    processed = [_serialize_row(r) for r in rows]

    return {
        "columns": columns,
        "rows": processed,
        "total": len(processed),
        "truncated": not has_limit and len(processed) >= limit,
    }


@router.post("/validate")
def validate_sql(req: ValidateRequest):
    sql_raw = req.sql or ""
    if not sql_raw.strip():
        return {"valid": True, "message": ""}

    try:
        cleaned = duck_engine.validate_sql(sql_raw)
    except ValueError as exc:
        return {"valid": False, "message": str(exc)}

    # Parse/compile check using EXPLAIN to catch syntax errors early.
    try:
        duck_engine.execute(f"EXPLAIN {cleaned}")
    except RuntimeError as exc:
        return {"valid": False, "message": f"Syntax/parse error: {exc}"}

    return {"valid": True, "message": "SQL looks valid", "cleaned": cleaned}


@router.get("/saved")
def list_saved():
    return {"queries": _load_saved()}


@router.post("/saved")
def save_query(req: SaveQueryRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(400, "Query name is required")

    queries = _load_saved()
    for q in queries:
        if q["name"] == name:
            q["sql"] = req.sql
            q["description"] = req.description or ""
            _save_all(queries)
            return {"saved": q}

    new_q = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "sql": req.sql,
        "description": req.description or "",
    }
    queries.append(new_q)
    _save_all(queries)
    return {"saved": new_q}


@router.delete("/saved/{qid}")
def delete_saved_query(qid: str):
    queries = _load_saved()
    remaining = [
        q for q in queries
        if q.get("id") != qid and q.get("name") != qid
    ]
    if len(remaining) == len(queries):
        raise HTTPException(404, "Query not found")
    _save_all(remaining)
    return {"deleted": qid}

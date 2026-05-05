"""Files Router — upload, list, load, and delete supported data files."""

import json
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from services import json_manager
from services.duck_engine import duck_engine

router = APIRouter(prefix="/api/files", tags=["files"])

UPLOAD_DIR = Path("/app/upload")
MAX_FILE_SIZE = 200 * 1024 * 1024  # 200 MB
ALLOWED_EXTENSIONS = {
    ".json", ".jsonl", ".ndjson",
    ".xml",
    ".csv", ".tsv", ".psv",
    ".xlsx", ".xls",
    ".sqlite", ".sqlite3", ".db",
}


@router.get("")
def list_files():
    return {"files": json_manager.list_files()}


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise HTTPException(400, f"Unsupported file type '{suffix}'. Allowed: {allowed}")

    safe_name = Path(file.filename).name
    if not safe_name or safe_name.startswith("."):
        raise HTTPException(400, "Invalid filename")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    dest = UPLOAD_DIR / safe_name

    total_size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            total_size += len(chunk)
            if total_size > MAX_FILE_SIZE:
                dest.unlink(missing_ok=True)
                raise HTTPException(
                    413, f"File too large (max {MAX_FILE_SIZE // 1024 // 1024} MB)"
                )
            out.write(chunk)

    try:
        meta = json_manager.load_and_register(safe_name)
    except (json.JSONDecodeError, ValueError) as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(422, f"Invalid or unreadable file: {exc}")
    except Exception as exc:
        # Keep file but report the DuckDB issue
        meta = {
            "filename": safe_name,
            "shape": "unknown",
            "schema": [],
            "row_count": 0,
            "size": total_size,
            "warning": str(exc),
        }

    return meta


@router.post("/{filename}/load")
def load_file(filename: str):
    """(Re-)register an already-uploaded file with DuckDB."""
    safe_name = Path(filename).name
    if not safe_name or ".." in filename:
        raise HTTPException(400, "Invalid filename")

    try:
        meta = json_manager.load_and_register(safe_name)
    except FileNotFoundError:
        raise HTTPException(404, f"File not found: {filename}")
    except Exception as exc:
        raise HTTPException(400, str(exc))

    return meta


@router.delete("/{filename}")
def delete_file(filename: str):
    safe_name = Path(filename).name
    if not safe_name or ".." in filename:
        raise HTTPException(400, "Invalid filename")

    path = UPLOAD_DIR / safe_name
    if not path.exists():
        raise HTTPException(404, "File not found")

    duck_engine.unregister(safe_name)
    path.unlink()
    return {"deleted": safe_name}

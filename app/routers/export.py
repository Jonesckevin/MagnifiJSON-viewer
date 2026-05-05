"""Export Router — create, list, download, and delete exports."""

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from services import export_manager
from services.duck_engine import duck_engine
from services.json_manager import load_and_register

router = APIRouter(prefix="/api/exports", tags=["exports"])

EXPORT_DIR = Path("/app/exports")


class ExportRequest(BaseModel):
    file: str
    format: str = "csv"  # csv | json | sql
    sql: Optional[str] = None  # If set, export this SQL result instead of full view


def _ensure_registered(filename: str):
    if not duck_engine.is_registered(filename):
        load_and_register(filename)


@router.get("")
def list_exports():
    return {"exports": export_manager.list_exports()}


@router.post("")
def create_export(req: ExportRequest):
    if req.format not in ("csv", "json", "sql"):
        raise HTTPException(400, f"Unsupported format: {req.format}")

    try:
        _ensure_registered(req.file)
    except FileNotFoundError:
        raise HTTPException(404, f"File not found: {req.file}")

    view = duck_engine.view_name(req.file)
    schema = duck_engine.describe(view)

    if req.sql:
        try:
            sql = duck_engine.validate_sql(req.sql)
            rows = duck_engine.execute(sql)
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(400, str(exc))
    else:
        try:
            rows = duck_engine.execute(f'SELECT * FROM "{view}"')
        except RuntimeError as exc:
            raise HTTPException(400, str(exc))

    source = Path(req.file).stem

    if req.format == "csv":
        filename = export_manager.export_csv(rows, source)
    elif req.format == "json":
        filename = export_manager.export_json(rows, source)
    else:
        filename = export_manager.export_sql(rows, source, schema)

    return {"filename": filename}


@router.get("/download/{filename:path}")
def download_export(filename: str):
    safe = Path(filename)
    if ".." in safe.parts:
        raise HTTPException(400, "Invalid filename")
    filepath = EXPORT_DIR / safe
    if not filepath.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(filepath, filename=safe.name, media_type="application/octet-stream")


@router.delete("/{filename:path}")
def delete_export(filename: str):
    if not export_manager.delete_export(filename):
        raise HTTPException(404, "File not found or cannot be deleted")
    return {"deleted": filename}

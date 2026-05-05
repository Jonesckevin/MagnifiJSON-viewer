"""MagnifiJSON — WebUI entry point."""

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path

app = FastAPI(title="MagnifiJSON", version="1.0")

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "upload"
EXPORTS_DIR = BASE_DIR / "exports"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

from routers import files, data, query, graphs, export
from services.state_manager import router as state_router

app.include_router(files.router)
app.include_router(data.router)
app.include_router(query.router)
app.include_router(graphs.router)
app.include_router(export.router)
app.include_router(state_router)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

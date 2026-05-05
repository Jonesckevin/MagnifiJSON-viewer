"""State Manager — persistent server-side UI state via exports/.app_state.json."""

import json
from pathlib import Path
from fastapi import APIRouter

STATE_FILE = Path("/app/exports/.app_state.json")
router = APIRouter(prefix="/api/state", tags=["state"])

DEFAULTS: dict = {
    "active_file": None,
    "active_view": "table",
    "column_visibility": {},
    "column_widths": {},
    "search": {"text": "", "regex": False, "column": ""},
    "theme": "dark",
    "page_size": 50,
    "sidebar_width": 260,
    "detail_height": 240,
    "graph_config": {
        "chart_type": "bar",
        "x_col": "",
        "y_col": "",
        "aggregation": "COUNT",
    },
}


def _load() -> dict:
    if STATE_FILE.exists():
        try:
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            return {**DEFAULTS, **data}
        except (json.JSONDecodeError, OSError):
            pass
    return dict(DEFAULTS)


def _save(state: dict):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")


@router.get("")
async def get_state():
    return _load()


@router.put("")
async def update_state(body: dict):
    state = _load()
    state.update(body)
    _save(state)
    return state


@router.delete("")
async def reset_state():
    state = dict(DEFAULTS)
    _save(state)
    return state

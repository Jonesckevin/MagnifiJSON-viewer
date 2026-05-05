"""Graphs Router — chart data and chart suggestions for Apache ECharts."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.duck_engine import duck_engine
from services.graph_service import get_chart_data, suggest_charts
from services.json_manager import load_and_register

router = APIRouter(prefix="/api/graphs", tags=["graphs"])


class ChartRequest(BaseModel):
    file: str
    chart_type: str = "bar"
    x_col: str
    y_col: Optional[str] = None
    aggregation: str = "COUNT"
    limit: int = 50


def _ensure_registered(filename: str):
    if not duck_engine.is_registered(filename):
        load_and_register(filename)


@router.post("/data")
def chart_data(req: ChartRequest):
    try:
        _ensure_registered(req.file)
    except FileNotFoundError:
        raise HTTPException(404, f"File not found: {req.file}")

    try:
        data = get_chart_data(
            file=req.file,
            chart_type=req.chart_type,
            x_col=req.x_col,
            y_col=req.y_col or "",
            aggregation=req.aggregation,
            limit=min(req.limit, 200),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(400, f"Chart error: {exc}")

    return data


@router.get("/suggest")
def suggest(file: str = Query(...)):
    try:
        _ensure_registered(file)
    except FileNotFoundError:
        raise HTTPException(404, f"File not found: {file}")

    view = duck_engine.view_name(file)
    schema = duck_engine.describe(view)
    return {"suggestions": suggest_charts(schema)}

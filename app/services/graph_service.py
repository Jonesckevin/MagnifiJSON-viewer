"""Graph Service — DuckDB aggregation queries returning ECharts-compatible data."""

from services.duck_engine import duck_engine

AGGREGATIONS = {"COUNT", "COUNT_DISTINCT", "SUM", "AVG", "MIN", "MAX"}
CHART_TYPES = {"bar", "line", "pie", "scatter", "histogram", "radar"}
_NUMERIC_HINTS = (
    "INTEGER", "BIGINT", "FLOAT", "DOUBLE", "DECIMAL",
    "HUGEINT", "UBIGINT", "SMALLINT", "TINYINT", "REAL",
    "NUMERIC", "INT", "NUMBER",
)


def _is_numeric(type_str: str) -> bool:
    t = type_str.upper()
    return any(hint in t for hint in _NUMERIC_HINTS)


def _safe_col(col: str) -> str:
    return f'"{col.replace(chr(34), chr(34) * 2)}"'


def get_chart_data(
    file: str,
    chart_type: str,
    x_col: str,
    y_col: str,
    aggregation: str = "COUNT",
    limit: int = 50,
) -> dict:
    view = duck_engine.view_name(file)
    schema = duck_engine.describe(view)
    col_names = {c["name"] for c in schema}
    safe_view = f'"{view}"'
    agg = aggregation.upper()

    if chart_type not in CHART_TYPES:
        raise ValueError(f"Unsupported chart type: {chart_type}")
    if agg not in AGGREGATIONS:
        raise ValueError(f"Unsupported aggregation: {aggregation}")
    if x_col not in col_names:
        raise ValueError(f"Column not found: {x_col}")

    sx = _safe_col(x_col)

    # ── Scatter (no aggregation) ──
    if chart_type == "scatter":
        sy = _safe_col(y_col) if y_col in col_names else sx
        sql = (
            f"SELECT TRY_CAST({sx} AS DOUBLE) AS x, TRY_CAST({sy} AS DOUBLE) AS y "
            f"FROM {safe_view} "
            f"WHERE TRY_CAST({sx} AS DOUBLE) IS NOT NULL "
            f"AND TRY_CAST({sy} AS DOUBLE) IS NOT NULL "
            f"LIMIT ?"
        )
        rows = duck_engine.execute(sql, [limit * 5])
        return {
            "chart_type": "scatter",
            "data": [[r.get("x"), r.get("y")] for r in rows],
            "x_name": x_col,
            "y_name": y_col if y_col in col_names else x_col,
            "title": f"{x_col} vs {y_col if y_col in col_names else x_col}",
        }

    # ── Histogram (binned distribution) ──
    if chart_type == "histogram":
        target = y_col if y_col in col_names else x_col
        st = _safe_col(target)
        sql = (
            f"WITH base AS ("
            f"  SELECT TRY_CAST({st} AS DOUBLE) AS v FROM {safe_view}"
            f"), stats AS ("
            f"  SELECT MIN(v) AS mn, MAX(v) AS mx FROM base WHERE v IS NOT NULL"
            f") "
            f"SELECT "
            f"  CAST("
            f"    CASE "
            f"      WHEN (SELECT mx - mn FROM stats) IS NULL OR (SELECT mx - mn FROM stats) = 0 THEN v "
            f"      ELSE ROUND((v - (SELECT mn FROM stats)) / NULLIF((SELECT mx - mn FROM stats) / 20.0, 0))"
            f"           * ((SELECT mx - mn FROM stats) / 20.0) + (SELECT mn FROM stats) "
            f"    END AS VARCHAR"
            f"  ) AS bucket, "
            f"  COUNT(*) AS count "
            f"FROM base WHERE v IS NOT NULL "
            f"GROUP BY bucket "
            f"ORDER BY TRY_CAST(bucket AS DOUBLE) "
            f"LIMIT ?"
        )
        rows = duck_engine.execute(sql, [limit])
        return {
            "chart_type": "bar",
            "x_axis": [str(r.get("bucket", "")) for r in rows],
            "series": [{"name": f"{target} frequency", "data": [r.get("count", 0) for r in rows]}],
            "title": f"Distribution of {target}",
        }

    # ── Bar / Line / Pie / Radar (GROUP BY aggregation) ──
    if agg == "COUNT":
        agg_expr = "COUNT(*)"
        agg_label = "Count"
    elif agg == "COUNT_DISTINCT" and y_col in col_names:
        agg_expr = f"COUNT(DISTINCT {_safe_col(y_col)})"
        agg_label = f"Count Distinct {y_col}"
    elif y_col in col_names:
        agg_expr = f"{agg}(CAST({_safe_col(y_col)} AS DOUBLE))"
        agg_label = f"{agg} of {y_col}"
    else:
        agg_expr = "COUNT(*)"
        agg_label = "Count"

    sql = (
        f"SELECT CAST({sx} AS VARCHAR) AS label, {agg_expr} AS value "
        f"FROM {safe_view} WHERE {sx} IS NOT NULL "
        f"GROUP BY {sx} ORDER BY value DESC LIMIT ?"
    )
    rows = duck_engine.execute(sql, [limit])
    labels = [str(r.get("label", "")) for r in rows]
    values = [r.get("value", 0) for r in rows]

    return {
        "chart_type": chart_type,
        "x_axis": labels,
        "series": [{"name": agg_label, "data": values}],
        "title": f"{agg_label} by {x_col}",
    }


def suggest_charts(schema: list[dict]) -> list[dict]:
    """Suggest viable chart configurations given a schema."""
    numeric = [c for c in schema if _is_numeric(c["type"])]
    categorical = [c for c in schema if not _is_numeric(c["type"])]
    suggestions = []

    if categorical and numeric:
        suggestions.append({
            "chart_type": "bar",
            "x_col": categorical[0]["name"],
            "y_col": numeric[0]["name"],
            "aggregation": "SUM",
            "label": f"Bar: {numeric[0]['name']} by {categorical[0]['name']}",
        })
        suggestions.append({
            "chart_type": "pie",
            "x_col": categorical[0]["name"],
            "y_col": numeric[0]["name"],
            "aggregation": "SUM",
            "label": f"Pie: {categorical[0]['name']} distribution",
        })
        suggestions.append({
            "chart_type": "line",
            "x_col": categorical[0]["name"],
            "y_col": numeric[0]["name"],
            "aggregation": "AVG",
            "label": f"Line: avg {numeric[0]['name']} by {categorical[0]['name']}",
        })

    if len(numeric) >= 2:
        suggestions.append({
            "chart_type": "scatter",
            "x_col": numeric[0]["name"],
            "y_col": numeric[1]["name"],
            "aggregation": "NONE",
            "label": f"Scatter: {numeric[0]['name']} vs {numeric[1]['name']}",
        })

    if numeric:
        suggestions.append({
            "chart_type": "histogram",
            "x_col": numeric[0]["name"],
            "y_col": numeric[0]["name"],
            "aggregation": "COUNT",
            "label": f"Histogram: {numeric[0]['name']} distribution",
        })

    if categorical:
        suggestions.append({
            "chart_type": "bar",
            "x_col": categorical[0]["name"],
            "y_col": "",
            "aggregation": "COUNT",
            "label": f"Count by {categorical[0]['name']}",
        })

    return suggestions

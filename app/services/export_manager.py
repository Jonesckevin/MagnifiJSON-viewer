"""Export Manager — CSV / JSON / SQL export for JSON view data."""

import csv
import io
import json
from datetime import datetime
from pathlib import Path

EXPORT_DIR = Path("/app/exports")


def _clean_value(v):
    """Flatten complex values to strings for text-based exports."""
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return json.dumps(v, default=str)
    return v


def list_exports() -> list[dict]:
    if not EXPORT_DIR.exists():
        return []
    exports = []
    for f in sorted(EXPORT_DIR.iterdir()):
        if f.is_file() and not f.name.startswith("."):
            stat = f.stat()
            exports.append(
                {
                    "name": f.name,
                    "size": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                }
            )
    return exports


def export_csv(rows: list[dict], source_name: str) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    stem = Path(source_name).stem
    filename = f"{stem}_{ts}.csv"
    filepath = EXPORT_DIR / filename

    if not rows:
        filepath.write_text("", encoding="utf-8")
        return filename

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=rows[0].keys())
    writer.writeheader()
    for row in rows:
        writer.writerow({k: _clean_value(v) for k, v in row.items()})

    filepath.write_text(output.getvalue(), encoding="utf-8")
    return filename


def export_json(rows: list[dict], source_name: str) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    stem = Path(source_name).stem
    filename = f"{stem}_{ts}.json"
    filepath = EXPORT_DIR / filename
    filepath.write_text(json.dumps(rows, indent=2, default=str), encoding="utf-8")
    return filename


def export_sql(rows: list[dict], source_name: str, columns: list[dict]) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    stem = Path(source_name).stem
    filename = f"{stem}_{ts}.sql"
    filepath = EXPORT_DIR / filename

    safe_table = stem.replace('"', '""')
    col_names = [c["name"] for c in columns]
    col_list = ", ".join(f'"{c.replace(chr(34), chr(34) * 2)}"' for c in col_names)

    lines = [
        f'-- MagnifiJSON Export: "{safe_table}" at {datetime.now().isoformat()}',
        "",
    ]
    for row in rows:
        vals = []
        for cn in col_names:
            v = row.get(cn)
            if v is None:
                vals.append("NULL")
            elif isinstance(v, bool):
                vals.append("TRUE" if v else "FALSE")
            elif isinstance(v, (int, float)):
                vals.append(str(v))
            elif isinstance(v, (dict, list)):
                safe_v = json.dumps(v, default=str).replace("'", "''")
                vals.append(f"'{safe_v}'")
            else:
                safe_v = str(v).replace("'", "''")
                vals.append(f"'{safe_v}'")
        lines.append(f'INSERT INTO "{safe_table}" ({col_list}) VALUES ({", ".join(vals)});')

    filepath.write_text("\n".join(lines), encoding="utf-8")
    return filename


def delete_export(filename: str) -> bool:
    safe = Path(filename)
    if ".." in safe.parts:
        return False
    filepath = EXPORT_DIR / safe
    if filepath.exists() and filepath.is_file():
        filepath.unlink()
        return True
    return False

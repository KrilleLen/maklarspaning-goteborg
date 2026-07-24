#!/usr/bin/env python3
"""Patch the bundled people updater to support both historic workforce formats."""
from __future__ import annotations

import sys
from pathlib import Path

OLD = '''def workforce_by_brand(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {row["brand"]: row for row in data["workforce"]}
'''

NEW = '''def workforce_by_brand(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = data.get("workforce", [])
    if isinstance(raw, dict):
        rows = []
        for key, value in raw.items():
            if isinstance(value, dict):
                row = dict(value)
                row.setdefault("brand", str(key))
                rows.append(row)
    elif isinstance(raw, list):
        rows = [row for row in raw if isinstance(row, dict)]
    else:
        rows = []
    return {
        str(row.get("brand", "")).strip(): row
        for row in rows
        if str(row.get("brand", "")).strip()
    }
'''


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_people_engine.py TARGET")
    path = Path(sys.argv[1])
    text = path.read_text(encoding="utf-8")
    if NEW in text:
        print(f"{path}: workforce compatibility already applied")
        return 0
    if OLD not in text:
        raise SystemExit(f"expected workforce_by_brand block not found in {path}")
    path.write_text(text.replace(OLD, NEW), encoding="utf-8")
    print(f"{path}: workforce compatibility applied")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

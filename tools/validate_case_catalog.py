#!/usr/bin/env python3
"""Validate the complete Case catalog and every indexed Case package."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CASES_ROOT = PROJECT_ROOT / "cases"
INDEX_PATH = CASES_ROOT / "index.json"
PACKAGE_VALIDATOR = Path(__file__).with_name("validate_case_package.py")


def main() -> int:
    errors: list[str] = []
    try:
        catalog = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print("CASE CATALOG INVALID\n- missing cases/index.json")
        return 1
    except json.JSONDecodeError as exc:
        print(f"CASE CATALOG INVALID\n- invalid cases/index.json: {exc}")
        return 1

    entries = catalog.get("cases")
    if not isinstance(entries, list) or not entries:
        errors.append("cases/index.json must contain a non-empty cases array")
        entries = []

    indexed_paths: set[str] = set()
    case_ids: set[str] = set()
    results: list[tuple[str, str]] = []

    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            errors.append(f"cases[{index}] must be an object")
            continue
        case_id = entry.get("case_id")
        rel_path = entry.get("path")
        if not isinstance(case_id, str) or not case_id:
            errors.append(f"cases[{index}] missing case_id")
            continue
        if case_id in case_ids:
            errors.append(f"duplicate case_id: {case_id}")
        case_ids.add(case_id)
        if not isinstance(rel_path, str) or not rel_path:
            errors.append(f"{case_id} missing path")
            continue
        if rel_path in indexed_paths:
            errors.append(f"duplicate case path: {rel_path}")
        indexed_paths.add(rel_path)
        if rel_path != case_id:
            errors.append(f"{case_id} path must equal case_id: {rel_path}")
        case_dir = CASES_ROOT / rel_path
        if not case_dir.is_dir():
            errors.append(f"{case_id} directory does not exist: cases/{rel_path}")
            continue

        run = subprocess.run(
            [sys.executable, str(PACKAGE_VALIDATOR), str(case_dir)],
            check=False,
            capture_output=True,
            text=True,
        )
        if run.returncode != 0:
            detail = run.stdout.strip() or run.stderr.strip() or "validation failed"
            errors.append(f"{case_id} package invalid:\n{detail}")
        else:
            summary = run.stdout.strip().splitlines()
            results.append((case_id, summary[-1] if summary else "CASE PACKAGE VALID"))

    actual_dirs = {
        path.name
        for path in CASES_ROOT.iterdir()
        if path.is_dir() and not path.name.startswith(".")
    }
    unindexed = sorted(actual_dirs - indexed_paths)
    missing_dirs = sorted(indexed_paths - actual_dirs)
    if unindexed:
        errors.append(f"unindexed Case directories: {unindexed}")
    if missing_dirs:
        errors.append(f"indexed Case directories missing: {missing_dirs}")

    if errors:
        print("CASE CATALOG INVALID")
        for error in errors:
            print(f"- {error}")
        return 1

    print("CASE CATALOG VALID")
    print(f"cases={len(entries)}")
    for case_id, summary in results:
        print(f"- {case_id}: {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Promote reviewed computational assets listed in the manuscript registry."""

from __future__ import annotations

import csv
import argparse
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
REGISTRY = ASSETS / "assets.csv"
REQUIRED_COLUMNS = {"asset", "source_project", "source_output"}


def load_assets(selected: set[str] | None = None) -> list[tuple[Path, Path]]:
    """Read and preflight each source-to-manuscript asset mapping."""
    with REGISTRY.open(newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or set(reader.fieldnames) != REQUIRED_COLUMNS:
            raise ValueError(f"{REGISTRY} must contain: {sorted(REQUIRED_COLUMNS)}")
        rows = list(reader)

    if not rows:
        raise ValueError(f"{REGISTRY} must contain at least one asset.")

    mappings = []
    for number, row in enumerate(rows, start=2):
        destination_name = row["asset"].strip()
        if selected is not None and destination_name not in selected:
            continue
        project_name = row["source_project"].strip()
        output_name = row["source_output"].strip()
        if not all((destination_name, project_name, output_name)):
            raise ValueError(f"Missing value in {REGISTRY}:{number}")

        destination = (ROOT / destination_name).resolve()
        if not destination.is_relative_to(ASSETS.resolve()):
            raise ValueError(
                f"Asset destination must be under assets/: {destination_name}"
            )

        project = (ROOT / project_name).resolve()
        source = (project / output_name).resolve()
        if not source.is_relative_to(project) or not source.is_file():
            raise FileNotFoundError(f"Asset source is missing: {source}")
        mappings.append((source, destination))
    if selected is not None and len(mappings) != len(selected):
        raise ValueError("Every requested asset must have exactly one registry entry")
    return mappings


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--promote",
        action="append",
        metavar="ASSET",
        help="explicitly approved registry asset to copy from upstream (repeatable)",
    )
    args = parser.parse_args()
    if not args.promote:
        with REGISTRY.open(newline="") as handle:
            rows = list(csv.DictReader(handle))
        for row in rows:
            path = (ROOT / row["asset"]).resolve()
            if (
                not path.is_relative_to(ASSETS.resolve())
                or not path.is_file()
                or not path.stat().st_size
            ):
                raise FileNotFoundError(
                    f"Missing or invalid local asset: {row['asset']}"
                )
        print(
            f"Verified {len(rows)} local assets; upstream files are only needed for explicit --promote"
        )
        return
    mappings = load_assets(set(args.promote))
    for source, destination in mappings:
        if source == destination:
            print(f"Already manuscript-owned: {destination.relative_to(ROOT)}")
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        print(f"Promoted {source} -> {destination.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

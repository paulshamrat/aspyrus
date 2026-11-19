"""Optional plain-text ownership records; legacy JSON remains the default."""

import ast
import json
import os
from pathlib import Path
import pprint


def plain_records():
    return os.environ.get("ASPYRUS_PLAIN_RECORDS") == "1"


def record_name(stem):
    return stem + (".log" if plain_records() else ".json")


def read_record(path):
    path = Path(path)
    value = (
        json.loads(path.read_text())
        if path.suffix == ".json"
        else ast.literal_eval(path.read_text())
    )
    if not isinstance(value, dict):
        raise ValueError(f"Invalid provenance mapping: {path}")
    return value


def record_text(value):
    if plain_records():
        return (
            "# Workflow provenance; parsed Python literals, never executed.\n"
            + pprint.pformat(value, width=110, sort_dicts=False)
            + "\n"
        )
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"

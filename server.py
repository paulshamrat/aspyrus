#!/usr/bin/env python3
"""Compatibility launcher for existing source checkouts. Prefer installed localleaf."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend" / "src"))
from localleaf.cli import main  # noqa: E402

if __name__ == "__main__":
    main()

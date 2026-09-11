"""Optional project configuration, resolved relative to localleaf.toml."""

import tomllib
from pathlib import Path


def project_settings(file):
    file = Path(file).resolve()
    for parent in file.parents:
        config = parent / "localleaf.toml"
        if config.is_file():
            settings = tomllib.loads(config.read_text(encoding="utf-8")).get("project", {})
            if not isinstance(settings, dict):
                raise ValueError("[project] must be a TOML table")
            if settings.get("engine", "pdflatex") not in {"pdflatex", "xelatex", "lualatex"}:
                raise ValueError("Unsupported engine in localleaf.toml")
            if "output_dir" in settings and not isinstance(settings["output_dir"], str):
                raise ValueError("output_dir must be a path string")
            return parent, settings
    return file.parent, {}


def output_directory(file, override=None):
    root, settings = project_settings(file)
    if override:
        return Path(override).resolve()
    if settings.get("output_dir"):
        return (root / settings["output_dir"]).resolve()
    return Path(file).resolve().parent / ".localleaf_build"

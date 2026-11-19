#!/usr/bin/env python3
"""Build both authored documents and the complete figure package from local inputs."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

import fitz

ROOT = Path(__file__).resolve().parents[1]
DOCUMENTS = ("main", "supplementary")
FIGURE_DECK = Path("assets/figures/figures.pdf")


def snapshot() -> dict[str, bytes]:
    """Include manuscript inputs only; no archives, feedback, caches or upstream projects."""
    paths = [ROOT / ".aspyrus.json"]
    paths.extend(ROOT / name / f"{name}.tex" for name in DOCUMENTS)
    for folder in ("assets", "references"):
        paths.extend(
            p
            for p in (ROOT / folder).rglob("*")
            if p.is_file() and p != ROOT / FIGURE_DECK
        )
    result = {}
    for path in paths:
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise ValueError(f"Manuscript input must be a local file: {path}")
        result[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    return result


def validate_word(path: Path) -> int:
    with zipfile.ZipFile(path) as archive:
        if archive.testzip():
            raise ValueError(f"Corrupt Word export: {path}")
        xml = ET.fromstring(archive.read("word/document.xml"))
    count = sum(node.tag.endswith("}oMath") for node in xml.iter())
    return count


def build_package(stage: Path, toc_graphic: Path | None) -> Path:
    package = stage / "package"
    package.mkdir()
    deck = fitz.open()
    for name in DOCUMENTS:
        figure_file = stage / name / "figures.pdf"
        if figure_file.is_file():
            with fitz.open(figure_file) as figures:
                deck.insert_pdf(figures)
    if toc_graphic is not None:
        page = deck.new_page(width=612, height=792)
        page.insert_text((54, 64), "TOC Graphic", fontname="tiro", fontsize=12)
        page.insert_image(
            fitz.Rect(54, 88, 558, 738),
            filename=str(stage / toc_graphic),
            keep_proportion=True,
        )
    if len(deck):
        (package / FIGURE_DECK).parent.mkdir(parents=True, exist_ok=True)
        deck.save(package / FIGURE_DECK)
    deck.close()
    return package


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--aspyrus-root",
        type=Path,
        default=Path(os.environ.get("ASPYRUS_ROOT", ROOT.parent)),
        help="external Aspyrus installation; no manuscript code is vendored",
    )
    parser.add_argument(
        "--toc-graphic",
        type=Path,
        help="optional manuscript-relative PNG/JPEG to append to the combined figure deck",
    )
    args = parser.parse_args()
    toc_graphic = None
    if args.toc_graphic is not None:
        candidate = ROOT / args.toc_graphic
        if (
            args.toc_graphic.is_absolute()
            or not candidate.resolve().is_relative_to(ROOT / "assets")
            or candidate.suffix.lower() not in {".png", ".jpg", ".jpeg"}
            or not candidate.is_file()
        ):
            raise ValueError("--toc-graphic must name a local PNG/JPEG under assets/")
        toc_graphic = candidate.relative_to(ROOT)
    tools = args.aspyrus_root.resolve() / "src/tools"
    if not (tools / "export.py").is_file():
        raise FileNotFoundError(
            "Set --aspyrus-root or ASPYRUS_ROOT to an Aspyrus installation"
        )
    sys.path.insert(0, str(tools))
    engine = importlib.import_module("export")
    inputs = snapshot()
    build_root = ROOT / ".aspyrus_build/manuscript"
    export_root = ROOT
    log_root = ROOT / "logs/manuscript"
    for folder in (build_root, export_root, log_root):
        folder.mkdir(parents=True, exist_ok=True)
    marker = build_root / "MANUSCRIPT_DONE"
    marker.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix="clean-", dir=build_root) as temporary:
        stage = Path(temporary)
        for relative, content in inputs.items():
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        # Bootstrap the circular main/supplementary label relationship using
        # local sources. These initial passes are not published deliverables.
        with (log_root / "bootstrap.log").open("w") as log:
            for name in DOCUMENTS:
                subprocess.run(
                    [
                        "pdflatex",
                        "-no-shell-escape",
                        "-halt-on-error",
                        "-interaction=nonstopmode",
                        f"{name}.tex",
                    ],
                    cwd=stage / name,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    check=True,
                )
                # This bootstrap PDF is a disposable label pass, not an owned
                # Aspyrus deliverable. Retain its AUX and retire only this file.
                (stage / name / f"{name}.pdf").unlink()
        # The last main pass captures supplementary's completed AUX, including
        # its bibliography. Both final records therefore describe current inputs.
        for name in ("main", "supplementary", "main"):
            print(f"Compiling {name} from local manuscript inputs", flush=True)
            engine.compile_all(stage / name / f"{name}.tex")
        counts = {
            name: validate_word(stage / name / f"{name}.docx") for name in DOCUMENTS
        }
        package = build_package(stage, toc_graphic)
        document_hashes = {
            f"{name}/{name}.{suffix}": hashlib.sha256(
                (stage / name / f"{name}.{suffix}").read_bytes()
            ).hexdigest()
            for name in DOCUMENTS
            for suffix in ("pdf", "docx")
        }
        if snapshot() != inputs:
            raise ValueError(
                "Manuscript inputs changed during build; retry after saving"
            )
        # Respect Aspyrus output ownership and recoverable publication for each
        # document. No manually edited or unowned deliverable is overwritten.
        for name in DOCUMENTS:
            destination = ROOT / name
            records = {f".{name}-export.json", ".figures-export.json"}
            names = {
                filename
                for filename in {f"{name}.pdf", f"{name}.docx", "figures.pdf"} | records
                if (stage / name / filename).is_file()
            }
            with engine.project_lock(destination):
                old = {}
                for record in (f".{name}-export.json", ".figures-export.json"):
                    record_path = destination / record
                    if record_path.exists():
                        data = json.loads(record_path.read_text())
                        if (
                            data.get("schema") != engine.SCHEMA
                            or data.get("document") != f"{name}.tex"
                        ):
                            raise ValueError(
                                f"Export belongs to another document: {record_path}"
                            )
                        old.update(data["output_sha256"])
                engine.preflight(
                    destination,
                    old,
                    names - records,
                )
                obsolete = set(old) - names
                if "figures.pdf" in obsolete:
                    obsolete.add(".figures-export.json")
                engine.publish(destination, stage / name, names, obsolete)
                shutil.copy2(stage / name / f"{name}.aux", destination / f"{name}.aux")
                shutil.copy2(
                    stage / name / f"{name}.aux",
                    destination / ".aspyrus_build" / f"{name}.aux",
                )
                shutil.copy2(
                    stage / name / ".aspyrus_build/last-build.log",
                    log_root / f"{name}.log",
                )
                shutil.copy2(
                    stage / name / ".aspyrus_build/last-build.log",
                    destination / ".aspyrus_build/last-build.log",
                )
        figure_pages = 0
        if (package / FIGURE_DECK).is_file():
            with fitz.open(package / FIGURE_DECK) as figures:
                figure_pages = len(figures)
        report = {
            "input_sha256": {
                p: hashlib.sha256(b).hexdigest() for p, b in inputs.items()
            },
            "native_word_equations": counts,
            "figure_package_pages": figure_pages,
            "inputs": "local main/, supplementary/, assets/, references/ and .aspyrus.json only",
            "aspyrus_tool_sha256": {
                name: hashlib.sha256((tools / name).read_bytes()).hexdigest()
                for name in ("export.py", "tex2docx.py")
            },
        }
        report["output_sha256"] = {
            p.relative_to(package).as_posix(): hashlib.sha256(
                p.read_bytes()
            ).hexdigest()
            for p in package.rglob("*")
            if p.is_file()
        }
        report["document_output_sha256"] = document_hashes
        report["supplementary_workbook"] = (
            "assets/tables/supplementary_tables.xlsx"
            if (stage / "assets/tables/supplementary_tables.xlsx").is_file()
            else None
        )
        (package / "build_report.json").write_text(json.dumps(report, indent=2) + "\n")
        for path in package.rglob("*"):
            if path.is_file() and not path.stat().st_size:
                raise ValueError(f"Empty build product: {path}")
        with engine.project_lock(export_root):
            previous = export_root / "build_report.json"
            old = (
                json.loads(previous.read_text())["output_sha256"]
                if previous.exists()
                else {}
            )
            names = {
                p.relative_to(package).as_posix()
                for p in package.rglob("*")
                if p.is_file()
            }
            engine.preflight(export_root, old, names - {"build_report.json"})
            engine.publish(export_root, package, names, set(old) - names)
        marker.write_text("Verified local manuscript build completed.\n")
    print(f"Complete manuscript package: {export_root}")


if __name__ == "__main__":
    main()

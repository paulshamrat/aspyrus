#!/usr/bin/env python3
"""Audit a dated manuscript-feedback package without changing manuscript source.

The feedback package is immutable input.  This tool inventories DOCX/Markdown
files, compares conventional ``main.docx`` and ``supplementary.docx`` files to
the active document exports, and writes only dated audit records and a run log.
Revision batches use explicit ``edit/<date>/`` or ``submission/`` packages,
with reports under the revision's ``audit/``. Clean main files are preferred
only for submission packages; ambiguous filenames require explicit selection.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import subprocess
import sys
import re
import zipfile
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

from docx import Document


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOG_ROOT = REPO_ROOT / "logs/feedback"
COMPARISON_DOCUMENTS = ("main", "supplementary")


def compact(value: str) -> str:
    """Normalize presentation-only differences for stable paragraph matching."""
    value = value.replace("–", "-").replace("—", "-").replace("−", "-")
    value = value.replace("α", "alpha").replace("β", "beta").replace("Δ", "delta")
    value = value.replace("²", "2").replace("³", "3")
    return re.sub(r"\s+", " ", value).strip().lower()


def single_line(value: str) -> str:
    """Return a tab-safe TSV value."""
    return " ".join(value.split())


def sha256_text(*parts: str) -> str:
    return hashlib.sha256("\0".join(parts).encode("utf-8")).hexdigest()[:16]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class Paragraph:
    index: int
    style: str
    text: str
    normalized: str


def paragraphs(path: Path) -> list[Paragraph]:
    """Return non-empty body paragraphs in visible document order."""
    document = Document(path)
    result: list[Paragraph] = []
    for index, paragraph in enumerate(document.paragraphs, start=1):
        # Include native Word equation text and hyperlink runs, which
        # python-docx's paragraph.text does not expose.
        text = single_line(
            "".join(
                node.text or ""
                for node in paragraph._p.iter()
                if node.tag
                in {
                    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t",
                    "{http://schemas.openxmlformats.org/officeDocument/2006/math}t",
                }
            )
        )
        if text:
            result.append(Paragraph(index, paragraph.style.name, text, compact(text)))
    return result


def xml_count(contents: bytes, tag: bytes) -> int:
    return contents.count(tag)


def docx_inventory(path: Path) -> dict[str, str]:
    """Return structural review markers without modifying the DOCX package."""
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        document_xml = archive.read("word/document.xml")
        comments_xml = (
            archive.read("word/comments.xml") if "word/comments.xml" in names else b""
        )
    document = Document(path)
    nondefault_runs = 0
    highlighted_runs = 0
    color_counts: Counter[str] = Counter()
    for paragraph in document.paragraphs:
        for run in paragraph.runs:
            color = run.font.color.rgb
            if color is not None:
                color_counts[str(color).upper()] += 1
                nondefault_runs += 1
            if run.font.highlight_color is not None:
                highlighted_runs += 1
    return {
        "paragraphs": str(len(document.paragraphs)),
        "tables": str(len(document.tables)),
        "tracked_insertions": str(xml_count(document_xml, b"<w:ins")),
        "tracked_deletions": str(xml_count(document_xml, b"<w:del")),
        "comment_references": str(xml_count(document_xml, b"<w:commentRangeStart")),
        "comment_bodies": str(xml_count(comments_xml, b"<w:comment ")),
        "highlighted_runs": str(highlighted_runs),
        "colored_runs": str(nondefault_runs),
        "run_colors": ";".join(
            f"{color}:{count}" for color, count in sorted(color_counts.items())
        ),
    }


def tex_visible(value: str) -> str:
    """Make a lightweight visible-text approximation for source-line hints."""
    value = re.sub(r"\\[A-Za-z]+", " ", value)
    value = value.replace("{", " ").replace("}", " ").replace("~", " ")
    return compact(value)


def source_line_hint(source_path: Path, active_text: str) -> str:
    """Locate an approximate source line using the first visible word sequence."""
    words = re.findall(r"[a-z0-9]+", compact(active_text))[:7]
    if len(words) < 4 or not source_path.exists():
        return ""
    needle = " ".join(words)
    for index, line in enumerate(
        source_path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if needle in tex_visible(line):
            return str(index)
    return ""


def change_rows(
    document: str, active_path: Path, feedback_path: Path, source_path: Path
) -> list[dict[str, str]]:
    """Classify paragraph-level additions, deletions, and replacements."""
    active = paragraphs(active_path)
    feedback = paragraphs(feedback_path)
    matcher = SequenceMatcher(
        None,
        [item.normalized for item in active],
        [item.normalized for item in feedback],
        autojunk=False,
    )
    rows: list[dict[str, str]] = []
    for (
        tag,
        active_start,
        active_end,
        feedback_start,
        feedback_end,
    ) in matcher.get_opcodes():
        if tag == "equal":
            continue
        active_items = active[active_start:active_end]
        feedback_items = feedback[feedback_start:feedback_end]
        kind = {"replace": "replacement", "delete": "deletion", "insert": "addition"}[
            tag
        ]
        active_text = " | ".join(item.text for item in active_items)
        feedback_text = " | ".join(item.text for item in feedback_items)
        active_range = (
            ""
            if not active_items
            else f"{active_items[0].index}-{active_items[-1].index}"
        )
        feedback_range = (
            ""
            if not feedback_items
            else f"{feedback_items[0].index}-{feedback_items[-1].index}"
        )
        change_id = f"{document}_{sha256_text(kind, active_text, feedback_text)}"
        rows.append(
            {
                "change_id": change_id,
                "document": document,
                "classification": kind,
                "active_export_paragraphs": active_range,
                "feedback_paragraphs": feedback_range,
                "source_file": source_path.name,
                "source_line_hint": source_line_hint(source_path, active_text),
                "active_text": active_text,
                "feedback_text": feedback_text,
                "initial_status": "unresolved",
            }
        )
    return rows


def formatting_rows(document: str, path: Path) -> list[dict[str, str]]:
    """Record only explicitly colored or highlighted feedback runs."""
    result: list[dict[str, str]] = []
    docx = Document(path)
    for paragraph_index, paragraph in enumerate(docx.paragraphs, start=1):
        for run_index, run in enumerate(paragraph.runs, start=1):
            color = run.font.color.rgb
            highlight = run.font.highlight_color
            if color is None and highlight is None:
                continue
            result.append(
                {
                    "document": document,
                    "paragraph": str(paragraph_index),
                    "run": str(run_index),
                    "text": single_line(run.text),
                    "color": str(color).upper() if color is not None else "",
                    "highlight": str(highlight) if highlight is not None else "",
                }
            )
    return result


def read_existing_decisions(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as handle:
        return {row["change_id"]: row for row in csv.DictReader(handle, delimiter="\t")}


def write_tsv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=fieldnames, delimiter="\t", lineterminator="\n"
        )
        writer.writeheader()
        # Use an explicit missing-value marker.  In addition to making the
        # audit files easier to read, this avoids trailing tab characters
        # when a final optional TSV field has no value.
        writer.writerows(
            {fieldname: (row.get(fieldname) or "NA") for fieldname in fieldnames}
            for row in rows
        )


def comparison_inputs(source: Path, active: Path, received: Path) -> dict:
    """Record exact inputs and reject stale exports when provenance is available."""
    record = active.with_name(f".{active.stem}-export.json")
    evidence = {
        "files": {
            role: {"path": str(path.resolve()), "sha256": sha256_file(path)}
            for role, path in (
                ("source", source),
                ("active_export", active),
                ("received", received),
            )
        },
        "export_provenance": "unverified: legacy export has no ownership record",
    }
    if record.exists():
        data = json.loads(record.read_text(encoding="utf-8"))
        expected = data.get("output_sha256", {}).get(active.name)
        stale = data.get("source_sha256") != sha256_file(
            source
        ) or expected != sha256_file(active)
        for name, digest in data.get("dependency_sha256", {}).items():
            path = (REPO_ROOT / name).resolve()
            if (
                not path.is_relative_to(REPO_ROOT)
                or not path.is_file()
                or sha256_file(path) != digest
            ):
                stale = True
        if stale:
            raise ValueError(
                f"Stale or modified export: {active}. Rebuild before auditing."
            )
        evidence["export_provenance"] = (
            "verified source, recorded dependencies and DOCX hashes"
        )
        evidence["ownership_record"] = {
            "path": str(record.resolve()),
            "sha256": sha256_file(record),
        }
    return evidence


def feedback_locations(package: Path) -> tuple[Path, Path, Path]:
    """Resolve one explicit exchange; never choose a revision's latest file."""
    if package.parent.name == "edit":
        revision = package.parent.parent
        event = Path(revision.name) / "edit" / package.name
        return package, revision / "audit/edit" / package.name, event
    if package.name in {"submission", "submitted", "decision"}:
        revision = package.parent
        event_name = "submission" if package.name == "submitted" else package.name
        event = Path(revision.name) / event_name
        audit = revision / "audit"
        folder = (
            audit / "checks/decision"
            if event_name == "decision"
            else audit / event_name
        )
        return package, folder, event
    if (package / "edit").is_dir():
        raise ValueError(
            "Select an explicit edit/<date> or submission package, not a revision root"
        )
    if (package / "submission").is_dir():
        return (
            package / "submission",
            package / "audit/submission",
            Path(package.name) / "submission",
        )
    return package, package / "audit", Path(package.name)


def comparison_file(package: Path, document: str, explicit: str | None) -> Path:
    if explicit:
        if Path(explicit).name != explicit:
            raise ValueError(
                "Comparison filenames must be basenames within the selected package"
            )
        selected = package / explicit
        if not selected.is_file():
            raise FileNotFoundError(selected)
        return selected
    conventional = package / f"{document}.docx"
    if (
        document == "main"
        and package.name in {"submission", "submitted"}
        and (package / "main_clean.docx").is_file()
    ):
        return package / "main_clean.docx"
    candidates = sorted(package.glob(f"{document}_*.docx"))
    if conventional.is_file():
        if package.parent.name == "edit" and candidates:
            raise ValueError(
                f"Ambiguous {document} files; select --{document}-file explicitly"
            )
        return conventional
    if len(candidates) > 1:
        raise ValueError(
            f"Ambiguous {document} files; select --{document}-file explicitly"
        )
    return candidates[0] if candidates else conventional


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--feedback-dir",
        type=Path,
        required=True,
        help="explicit immutable edit exchange or submission package",
    )
    parser.add_argument(
        "--export-dir",
        type=Path,
        help="optional flat export directory; defaults to document folders",
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        help="optional flat source directory; defaults to document folders",
    )
    parser.add_argument(
        "--audit-root",
        type=Path,
        help="override report root; revision packages default to their revision audit folder",
    )
    parser.add_argument(
        "--main-file", help="main DOCX basename; required for ambiguous exchanges"
    )
    parser.add_argument("--supplementary-file", help="supplementary DOCX basename")
    parser.add_argument("--log-root", type=Path, default=DEFAULT_LOG_ROOT)
    parser.add_argument(
        "--review",
        action="store_true",
        help="Compact word-level CLI review instead of the legacy audit",
    )
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Review each change and explicitly choose whether to save TEX",
    )
    parser.add_argument("--document", choices=COMPARISON_DOCUMENTS, default="main")
    parser.add_argument(
        "--original", type=Path, help="Exact sent DOCX baseline, when available"
    )
    parser.add_argument(
        "--style",
        choices=("normal", "red", "blue"),
        default="normal",
        help="Default accepted-text style; override per change",
    )
    parser.add_argument(
        "--aspyrus-root",
        type=Path,
        default=Path(
            os.environ.get("ASPYRUS_ROOT", REPO_ROOT.parents[1] / "tools/aspyrus")
        ),
    )
    args = parser.parse_args()

    feedback_dir = args.feedback_dir.resolve()
    if not feedback_dir.is_dir():
        raise FileNotFoundError(f"Feedback directory does not exist: {feedback_dir}")
    input_dir, default_audit, event_path = feedback_locations(feedback_dir)
    event = event_path.as_posix()
    audit_dir = args.audit_root / event_path if args.audit_root else default_audit
    if args.review or args.interactive:
        engine = args.aspyrus_root.resolve() / "src/tools/docreview.py"
        if not engine.is_file():
            parser.error(
                "Missing external docreview.py; set --aspyrus-root or ASPYRUS_ROOT"
            )
        document = args.document
        received = comparison_file(
            input_dir, document, getattr(args, document + "_file")
        )
        source = (args.source_dir or REPO_ROOT / document) / f"{document}.tex"
        current = (args.export_dir or REPO_ROOT / document) / f"{document}.docx"
        command = [
            sys.executable,
            str(engine),
            "--source",
            str(source),
            "--current",
            str(current),
            "--returned",
            str(received),
            "--output",
            str(audit_dir),
            "--style",
            args.style,
        ]
        if args.original:
            command += ["--original", str(args.original.resolve())]
        if args.interactive:
            command += ["--interactive"]
        raise SystemExit(subprocess.run(command, check=False).returncode)
    selected = {
        document: comparison_file(
            input_dir, document, getattr(args, document + "_file")
        )
        for document in COMPARISON_DOCUMENTS
    }
    log_dir = args.log_root / event
    audit_dir.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)
    marker = audit_dir / "FEEDBACK_AUDIT_DONE"
    marker.unlink(missing_ok=True)
    messages = [f"Auditing immutable feedback package: {feedback_dir}"]
    messages.append(f"Comparison input directory: {input_dir}")

    package_rows: list[dict[str, str]] = []
    all_files = sorted(path for path in input_dir.iterdir() if path.is_file())
    for path in all_files:
        row = {
            "path": str(path.relative_to(REPO_ROOT))
            if path.is_relative_to(REPO_ROOT)
            else str(path),
            "type": path.suffix.lower().lstrip(".") or "file",
            "bytes": str(path.stat().st_size),
            "sha256": sha256_file(path),
            "paragraphs": "",
            "tables": "",
            "tracked_insertions": "",
            "tracked_deletions": "",
            "comment_references": "",
            "comment_bodies": "",
            "highlighted_runs": "",
            "colored_runs": "",
            "run_colors": "",
        }
        if path.suffix.lower() == ".docx":
            row.update(docx_inventory(path))
        package_rows.append(row)
    write_tsv(
        audit_dir / "package_inventory.tsv",
        list(package_rows[0]) if package_rows else ["path"],
        package_rows,
    )

    input_evidence = {}
    all_changes: list[dict[str, str]] = []
    all_formatting: list[dict[str, str]] = []
    for document in COMPARISON_DOCUMENTS:
        feedback_path = selected[document]
        messages.append(f"{document} comparison file: {feedback_path}")
        active_path = (args.export_dir or REPO_ROOT / document) / f"{document}.docx"
        source_path = (args.source_dir or REPO_ROOT / document) / f"{document}.tex"
        rows: list[dict[str, str]] = []
        if feedback_path.exists() and (
            not active_path.exists() or not source_path.exists()
        ):
            raise FileNotFoundError(
                f"Build the active {document} before auditing {feedback_path}"
            )
        if feedback_path.exists() and active_path.exists() and source_path.exists():
            input_evidence[document] = comparison_inputs(
                source_path, active_path, feedback_path
            )
            rows = change_rows(document, active_path, feedback_path, source_path)
            all_formatting.extend(formatting_rows(document, feedback_path))
        else:
            missing = [
                str(path)
                for path in (feedback_path, active_path, source_path)
                if not path.exists()
            ]
            messages.append(f"Skipped {document}: missing {' ; '.join(missing)}")
        write_tsv(
            audit_dir / f"{document}_changes.tsv",
            [
                "change_id",
                "document",
                "classification",
                "active_export_paragraphs",
                "feedback_paragraphs",
                "source_file",
                "source_line_hint",
                "active_text",
                "feedback_text",
                "initial_status",
            ],
            rows,
        )
        all_changes.extend(rows)

    write_tsv(
        audit_dir / "formatting_changes.tsv",
        ["document", "paragraph", "run", "text", "color", "highlight"],
        all_formatting,
    )
    write_tsv(
        audit_dir / "proposed_changes.tsv",
        list(all_changes[0]) if all_changes else ["change_id"],
        all_changes,
    )

    decisions_path = audit_dir / "decisions.tsv"
    existing = read_existing_decisions(decisions_path)
    previous_path = audit_dir / "previous_decisions.tsv"
    previous = read_existing_decisions(previous_path)
    current_ids = {row["change_id"] for row in all_changes}
    previous.update(
        {key: row for key, row in existing.items() if key not in current_ids}
    )
    if previous:
        write_tsv(
            previous_path,
            ["change_id", "decision", "rationale"],
            list(previous.values()),
        )
    decisions = [
        {
            "change_id": row["change_id"],
            "decision": existing.get(row["change_id"], {}).get(
                "decision", "unresolved"
            ),
            "rationale": existing.get(row["change_id"], {}).get("rationale", ""),
        }
        for row in all_changes
    ]
    write_tsv(decisions_path, ["change_id", "decision", "rationale"], decisions)

    (audit_dir / "comparison_inputs.json").write_text(
        json.dumps(
            {
                "documents": input_evidence,
                "audit_script_sha256": sha256_file(Path(__file__)),
                "scope": "Paragraph text and explicit run formatting only; native equation properties, tables, images, references and layout require separate verification.",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    counts = Counter(row["classification"] for row in all_changes)
    summary = [
        f"# Feedback audit: {event}\n\n",
        "This audit reads immutable received files and the current active exports. It does not modify TeX, DOCX, input files, or exports.\n\n",
        "## Detected text changes\n\n",
    ]
    for kind in ("addition", "deletion", "replacement"):
        summary.append(f"- {kind}: {counts[kind]}\n")
    summary.extend(
        [
            f"\n- explicitly formatted feedback runs: {len(all_formatting)}\n",
            "- decisions begin as `unresolved` and are preserved across reruns when the change ID is unchanged. Unmatched prior decisions remain in `previous_decisions.tsv`; they are not applied to new proposals.\n",
            "- `comparison_inputs.json` records exact inputs and export provenance. Legacy exports without records are explicitly unverified.\n",
            "- paragraph comparisons do not certify native equation properties, tables, images, reference identity or layout; verify these separately before submission.\n",
        ]
    )
    (audit_dir / "summary.md").write_text("".join(summary), encoding="utf-8")
    messages.append(f"Wrote {len(all_changes)} proposed text changes to {audit_dir}")
    messages.append(f"Wrote {len(all_formatting)} explicitly formatted feedback runs")
    (log_dir / "feedback.log").write_text("\n".join(messages) + "\n", encoding="utf-8")
    for output in audit_dir.glob("*.tsv"):
        if not output.stat().st_size:
            raise ValueError(f"Empty audit output: {output}")
    marker.write_text("Verified feedback audit completed.\n", encoding="utf-8")
    print("\n".join(messages))


if __name__ == "__main__":
    main()

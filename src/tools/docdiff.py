#!/usr/bin/env python3
"""Audit and diff incoming Word feedback drafts against manuscript deliverables.

Zero-flag usage:
    python src/tools/docdiff.py
    (Prefers manuscript edit exchanges in feedback/; explicit file selection is recommended.)

Specific usage:
    python src/tools/docdiff.py feedback/rev2/edit/2026-10-04/
    python src/tools/docdiff.py feedback/rev2/edit/2026-10-04/main_comments.docx
    python src/tools/docdiff.py feedback/round1.docx --base main.docx
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
import zipfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from docx import Document

# ANSI terminal colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Diff incoming untracked Word feedback against active manuscript deliverables."
    )
    parser.add_argument(
        "target",
        nargs="?",
        default=None,
        help="Feedback directory or .docx file (default: auto-detect latest .docx in feedback/).",
    )
    parser.add_argument(
        "--base",
        "-b",
        default=None,
        help="Base .docx to compare against (default: auto-detects main.docx or supplementary.docx).",
    )
    parser.add_argument(
        "--no-color",
        action="store_true",
        help="Disable ANSI color codes in terminal output.",
    )
    return parser.parse_args()


# ============================================================================
# Text & Paragraph Helpers
# ============================================================================


def normalize_text(text: str) -> str:
    """Normalize typography, dashes, and whitespace for robust comparison."""
    text = text.replace("–", "-").replace("—", "-").replace("−", "-")
    text = text.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    text = text.replace("α", "alpha").replace("β", "beta").replace("Δ", "delta")
    text = text.replace("²", "2").replace("³", "3")
    return re.sub(r"\s+", " ", text).strip()


@dataclass(frozen=True)
class Paragraph:
    index: int
    text: str
    normalized: str


def extract_paragraphs(docx_path: Path) -> list[Paragraph]:
    """Read non-empty body paragraphs in document order."""
    doc = Document(docx_path)
    paragraphs: list[Paragraph] = []
    idx = 1
    for p in doc.paragraphs:
        raw = " ".join(p.text.split())
        if raw:
            paragraphs.append(Paragraph(idx, raw, normalize_text(raw).lower()))
            idx += 1
    return paragraphs


def xml_count(xml_bytes: bytes, tag: bytes) -> int:
    return xml_bytes.count(tag)


def audit_docx_metadata(path: Path) -> dict[str, str]:
    """Inspect Word OpenXML package for tracked changes, comments, highlights, and colored text."""
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        doc_xml = (
            archive.read("word/document.xml") if "word/document.xml" in names else b""
        )
        comments_xml = (
            archive.read("word/comments.xml") if "word/comments.xml" in names else b""
        )

    doc = Document(path)
    highlighted_runs = 0
    colored_runs = 0
    color_counts: Counter[str] = Counter()

    for p in doc.paragraphs:
        for r in p.runs:
            c = r.font.color.rgb
            if c is not None:
                color_counts[str(c).upper()] += 1
                colored_runs += 1
            if r.font.highlight_color is not None:
                highlighted_runs += 1

    return {
        "paragraphs": str(len(doc.paragraphs)),
        "tables": str(len(doc.tables)),
        "tracked_insertions": str(xml_count(doc_xml, b"<w:ins")),
        "tracked_deletions": str(xml_count(doc_xml, b"<w:del")),
        "comment_markers": str(xml_count(doc_xml, b"<w:commentRangeStart")),
        "comment_bodies": str(xml_count(comments_xml, b"<w:comment ")),
        "highlighted_runs": str(highlighted_runs),
        "colored_runs": str(colored_runs),
        "run_colors": "; ".join(f"{c}:{n}" for c, n in sorted(color_counts.items()))
        or "None",
    }


def find_tex_line_hint(tex_path: Path, text: str) -> int | None:
    """Find approximate line number in source LaTeX matching the start of text."""
    if not tex_path.exists():
        return None
    words = re.findall(r"[A-Za-z0-9]+", normalize_text(text).lower())[:6]
    if len(words) < 3:
        return None
    needle = " ".join(words)

    for lineno, line in enumerate(
        tex_path.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1
    ):
        line_clean = " ".join(re.findall(r"[A-Za-z0-9]+", normalize_text(line).lower()))
        if needle in line_clean:
            return lineno
    return None


def word_level_diff(old_text: str, new_text: str) -> str:
    """Compute inline word diff representation: [-deleted-] {+added+}."""
    old_words = old_text.split()
    new_words = new_text.split()
    matcher = difflib.SequenceMatcher(None, old_words, new_words)
    parts = []
    for tag, alo, ahi, blo, bhi in matcher.get_opcodes():
        if tag == "equal":
            parts.append(" ".join(old_words[alo:ahi]))
        elif tag == "replace":
            del_part = " ".join(old_words[alo:ahi])
            ins_part = " ".join(new_words[blo:bhi])
            parts.append(f"[-{del_part}-] {{+{ins_part}+}}")
        elif tag == "delete":
            del_part = " ".join(old_words[alo:ahi])
            parts.append(f"[-{del_part}-]")
        elif tag == "insert":
            ins_part = " ".join(new_words[blo:bhi])
            parts.append(f"{{+{ins_part}+}}")
    return " ".join(parts)


# ============================================================================
# Discovery & Comparison Controller
# ============================================================================


def find_latest_feedback_file(search_dir: Path) -> Path | None:
    """Prefer manuscript edit exchanges; exclude audit and decision documents."""
    candidates = [
        p
        for p in search_dir.rglob("*.docx")
        if not p.name.startswith("~")
        and not p.name.startswith(".")
        and not {"audit", "decision"}.intersection(p.relative_to(search_dir).parts)
    ]
    manuscripts = [p for p in candidates if p.stem.lower().startswith(("main", "supp"))]
    if manuscripts:
        candidates = manuscripts
    edits = [p for p in candidates if "edit" in p.relative_to(search_dir).parts]
    if edits:
        candidates = edits
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def feedback_report_path(feedback_file: Path) -> Path:
    """Keep reports outside immutable revision package directories."""
    package = feedback_file.parent
    if package.parent.name == "edit":
        folder = package.parent.parent / "audit/edit" / package.name
    elif package.name in {"submission", "submitted", "decision"}:
        event = "submission" if package.name == "submitted" else package.name
        audit = package.parent / "audit"
        folder = audit / "checks/decision" if event == "decision" else audit / event
    else:
        folder = package
    folder.mkdir(parents=True, exist_ok=True)
    return folder / (feedback_file.stem + "_diff.md")


def run_diff(
    feedback_file: Path,
    base_file: Path,
    tex_source: Path | None,
    use_color: bool = True,
) -> int:
    c_green = GREEN if use_color else ""
    c_red = RED if use_color else ""
    c_yellow = YELLOW if use_color else ""
    c_cyan = CYAN if use_color else ""
    c_bold = BOLD if use_color else ""
    c_reset = RESET if use_color else ""

    print(f"{c_bold}=== Manuscript Word Feedback Diff ==={c_reset}")
    print(f"Base deliverable : {c_cyan}{base_file}{c_reset}")
    print(f"Incoming feedback: {c_cyan}{feedback_file}{c_reset}")
    if tex_source and tex_source.exists():
        print(f"Source LaTeX     : {c_cyan}{tex_source}{c_reset}")
    print()

    # Metadata audit
    meta = audit_docx_metadata(feedback_file)
    print(f"{c_bold}Feedback Document Audit:{c_reset}")
    print(f"  • Paragraphs: {meta['paragraphs']}, Tables: {meta['tables']}")
    print(
        f"  • Word Tracked Changes: {meta['tracked_insertions']} insertions, {meta['tracked_deletions']} deletions"
    )
    print(
        f"  • Word Comments: {meta['comment_bodies']} comment bodies ({meta['comment_markers']} markers)"
    )
    print(
        f"  • Highlighted runs: {meta['highlighted_runs']}, Colored text runs: {meta['colored_runs']} ({meta['run_colors']})"
    )
    print("-" * 72)

    active_paras = extract_paragraphs(base_file)
    feedback_paras = extract_paragraphs(feedback_file)

    matcher = difflib.SequenceMatcher(
        None,
        [p.normalized for p in active_paras],
        [p.normalized for p in feedback_paras],
        autojunk=False,
    )

    diff_records = []
    additions = 0
    deletions = 0
    replacements = 0

    for tag, a_start, a_end, f_start, f_end in matcher.get_opcodes():
        if tag == "equal":
            continue
        a_items = active_paras[a_start:a_end]
        f_items = feedback_paras[f_start:f_end]
        a_text = "\n".join(p.text for p in a_items)
        f_text = "\n".join(p.text for p in f_items)
        line_hint = (
            find_tex_line_hint(tex_source, a_text or f_text) if tex_source else None
        )

        record = {
            "tag": tag,
            "active_items": a_items,
            "feedback_items": f_items,
            "active_text": a_text,
            "feedback_text": f_text,
            "line_hint": line_hint,
        }
        diff_records.append(record)

        if tag == "replace":
            replacements += 1
        elif tag == "insert":
            additions += 1
        elif tag == "delete":
            deletions += 1

    if not diff_records:
        print(
            f"{c_green}✓ No paragraph changes detected between base and feedback documents.{c_reset}"
        )
        return 0

    print(
        f"{c_bold}Change Summary:{c_reset} {c_green}{additions} additions{c_reset}, "
        f"{c_red}{deletions} deletions{c_reset}, {c_yellow}{replacements} modified blocks{c_reset}"
    )
    print("=" * 72)

    # Display diffs in terminal
    for i, r in enumerate(diff_records, start=1):
        tag = r["tag"]
        hint_str = (
            f" (approx. line {r['line_hint']} in {tex_source.name})"
            if r["line_hint"]
            else ""
        )

        if tag == "replace":
            print(f"\n{c_yellow}{c_bold}[~ CHANGE #{i}]{hint_str}{c_reset}")
            inline_diff = word_level_diff(r["active_text"], r["feedback_text"])
            print(f"  {c_yellow}Diff:{c_reset} {inline_diff}")

        elif tag == "delete":
            print(f"\n{c_red}{c_bold}[- DELETION #{i}]{hint_str}{c_reset}")
            print(f"  {c_red}{r['active_text']}{c_reset}")

        elif tag == "insert":
            print(f"\n{c_green}{c_bold}[+ ADDITION #{i}]{hint_str}{c_reset}")
            print(f"  {c_green}{r['feedback_text']}{c_reset}")

    report_path = feedback_report_path(feedback_file)
    write_markdown_report(
        report_path, feedback_file, base_file, meta, diff_records, tex_source
    )
    print(
        f"\n{c_bold}Detailed diff report written to:{c_reset} {c_cyan}{report_path}{c_reset}"
    )
    return 0


def write_markdown_report(
    report_path: Path,
    feedback_file: Path,
    base_file: Path,
    meta: dict[str, str],
    records: list[dict],
    tex_source: Path | None,
) -> None:
    lines = [
        "# Manuscript Feedback Audit & Diff Summary",
        "",
        f"- **Feedback Document:** `{feedback_file.name}` (`{feedback_file.parent}`)",
        f"- **Base Document:** `{base_file.name}`",
        f"- **LaTeX Reference:** `{tex_source.name if tex_source else 'N/A'}`",
        "",
        "## Document Properties & Tracked Edits",
        "",
        "| Metric | Value |",
        "| :--- | :--- |",
        f"| Word Tracked Insertions | {meta['tracked_insertions']} |",
        f"| Word Tracked Deletions | {meta['tracked_deletions']} |",
        f"| Word Comments | {meta['comment_bodies']} |",
        f"| Highlighted Text Runs | {meta['highlighted_runs']} |",
        f"| Colored Text Runs | {meta['colored_runs']} |",
        "",
        "## Paragraph Changes",
        "",
    ]

    for i, r in enumerate(records, start=1):
        tag = r["tag"].upper()
        hint = f" *(approx. TeX line {r['line_hint']})*" if r["line_hint"] else ""
        lines.append(f"### Change {i}: {tag}{hint}")
        if r["tag"] == "replace":
            lines.append("**Original:**")
            lines.append(f"> {r['active_text']}")
            lines.append("")
            lines.append("**Feedback:**")
            lines.append(f"> {r['feedback_text']}")
            lines.append("")
            lines.append("**Word-level diff:**")
            lines.append(
                f"```text\n{word_level_diff(r['active_text'], r['feedback_text'])}\n```"
            )
        elif r["tag"] == "delete":
            lines.append("**Deleted text:**")
            lines.append(f"> {r['active_text']}")
        elif r["tag"] == "insert":
            lines.append("**Added text:**")
            lines.append(f"> {r['feedback_text']}")
        lines.append("")

    report_path.write_text("\n".join(lines), encoding="utf-8")


def manuscript_root(directory: Path) -> Path:
    """Discover the active manuscript, not the installed tool directory."""
    directory = directory.resolve()
    for parent in (directory, *directory.parents):
        if (
            (parent / ".aspyrus.json").exists()
            or (parent / ".localleaf.json").exists()
            or (parent / "feedback").is_dir()
        ):
            return parent
    return directory


def base_document(
    root: Path, feedback: Path, explicit: str | None = None
) -> tuple[Path, Path]:
    if explicit:
        base = Path(explicit).resolve()
    else:
        stem = "supplementary" if "supp" in feedback.name.lower() else "main"
        nested = root / stem / (stem + ".docx")
        base = nested if nested.parent.is_dir() else root / (stem + ".docx")
    return base, base.with_suffix(".tex")


def main() -> int:
    args = parse_args()
    repo_root = manuscript_root(Path.cwd())
    feedback_root = repo_root / "feedback"

    target_path: Path | None = None
    if args.target:
        p = Path(args.target)
        if not p.is_absolute():
            p = (Path.cwd() / p).resolve()
        if p.is_dir():
            target_path = find_latest_feedback_file(p)
            if not target_path:
                print(
                    f"Error: No .docx file found inside directory: {p}", file=sys.stderr
                )
                return 1
        elif p.is_file():
            target_path = p
        else:
            print(f"Error: Path does not exist: {p}", file=sys.stderr)
            return 1
    else:
        # Auto-detect newest .docx in feedback/
        if feedback_root.exists():
            target_path = find_latest_feedback_file(feedback_root)

    if not target_path:
        print("=== Manuscript Word Feedback Diff ===")
        print(f"No .docx feedback files found in: {feedback_root}")
        print()
        print("To audit and diff incoming review drafts:")
        print("  1. Place the collaborator or PI Word document in feedback/")
        print(
            "     (e.g., feedback/rev2/edit/YYYY-MM-DD/main.docx or feedback/collaborator_edit.docx)"
        )
        print(f"  2. Rerun: python3 {Path(__file__).resolve()}")
        return 0

    base_docx, tex_source = base_document(repo_root, target_path, args.base)

    if not base_docx.exists():
        print(
            f"Error: Base deliverable {base_docx.name} not found. Open the corresponding TEX document and run LocalLeaf Compile first.",
            file=sys.stderr,
        )
        return 1

    return run_diff(target_path, base_docx, tex_source, use_color=not args.no_color)


if __name__ == "__main__":
    raise SystemExit(main())

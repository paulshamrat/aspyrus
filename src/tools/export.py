#!/usr/bin/env python3
"""Build an authored document or export its figures without splitting prose."""

from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import json
from provenance import plain_records, read_record, record_name, record_text
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

SCHEMA = 2


class ExportError(ValueError):
    """A failed precondition, preservation check, or build."""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def group(text: str, pos: int) -> tuple[str, int]:
    while pos < len(text) and text[pos].isspace():
        pos += 1
    if pos >= len(text) or text[pos] != "{":
        raise ExportError(
            "Expected a literal braced argument; dynamic paths are unsupported"
        )
    start = pos + 1
    depth = 1
    pos += 1
    while pos < len(text):
        if text[pos] == "\\":
            pos += 2
            continue
        if text[pos] == "{":
            depth += 1
        elif text[pos] == "}":
            depth -= 1
            if depth == 0:
                return text[start:pos], pos + 1
        pos += 1
    raise ExportError("Unclosed braced argument")


@dataclass
class Token:
    name: str
    start: int
    end: int
    arg: str = ""
    top: bool = False


TRANSPARENT_ENVS = {
    "collabtext",
    "spacing",
    "singlespace",
    "onehalfspace",
    "doublespace",
    "center",
    "flushleft",
    "flushright",
}


def scan(text: str) -> list[Token]:
    """Recognize structural commands outside comments, groups and verbatim."""
    tokens = []
    depth = 0
    envs = []
    pos = 0
    while pos < len(text):
        char = text[pos]
        top = depth == 0 and (
            envs == ["document"]
            or (
                envs
                and envs[0] == "document"
                and all(e in TRANSPARENT_ENVS for e in envs[1:])
            )
        )
        if char == "%":
            end = text.find("\n", pos)
            end = len(text) if end < 0 else end + 1
            pos = end
            continue
        if char == "\\":
            match = re.match(r"\\([A-Za-z@]+|.)", text[pos:], re.S)
            if not match:
                raise ExportError("Trailing backslash")
            name = match[1]
            end = pos + match.end()
            if name == "verb":
                if end < len(text) and text[end] == "*":
                    end += 1
                close = text.find(text[end], end + 1) if end < len(text) else -1
                if close < 0:
                    raise ExportError("Unclosed verbatim command")
                pos = close + 1
                continue
            arg = ""
            if name in {
                "begin",
                "end",
                "bibliography",
                "bibliographystyle",
                "label",
                "ref",
                "eqref",
                "pageref",
                "autoref",
                "input",
                "include",
                "includeonly",
            }:
                arg, end = group(text, end)
            token = Token(name, pos, end, arg, top)
            tokens.append(token)
            if name == "begin":
                if arg in {"verbatim", "verbatim*", "lstlisting", "minted", "comment"}:
                    close = text.find("\\end{" + arg + "}", end)
                    if close < 0:
                        raise ExportError(f"Unclosed {arg} environment")
                    pos = close + len(arg) + 6
                    continue
                envs.append(arg)
            elif name == "end":
                if not envs or envs.pop() != arg:
                    raise ExportError(f"Unbalanced environment: {arg}")
            pos = end
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth < 0:
                raise ExportError("Unbalanced braces")
        pos += 1
    if envs or depth:
        raise ExportError("Unclosed environment or braces")
    return tokens


def read_labels(aux: str) -> dict[str, tuple[str, str]]:
    labels = {}
    for match in re.finditer(r"\\newlabel\{", aux):
        key, end = group(aux, match.end() - 1)
        value, _ = group(aux, end)
        number, end = group(value, 0)
        page, _ = group(value, end)
        if key in labels and labels[key] != (number, page):
            raise ExportError(f"Duplicate label: {key}")
        labels[key] = (number, page)
    return labels


def run(args: list[str], stage: Path) -> str:
    result = subprocess.run(
        args,
        cwd=stage,
        text=True,
        encoding="utf-8",
        errors="replace",  # TeX diagnostics can contain split multibyte glyphs.
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=180,
    )
    with (stage / "build.log").open("a") as log:
        log.write("\n$ " + " ".join(args) + "\n" + result.stdout)
    if result.returncode:
        raise ExportError(f"{args[0]} failed: {result.stdout[-2200:]}")
    return result.stdout


def latex(stage: Path, stem: str) -> None:
    command = [
        "pdflatex",
        "-no-shell-escape",
        "-halt-on-error",
        "-interaction=nonstopmode",
        "-jobname=" + stem,
        r"\RequirePackage{cmap}\input{glyphtounicode}\pdfgentounicode=1\input{"
        + stem
        + ".tex}",
    ]
    run(command, stage)
    aux = (stage / (stem + ".aux")).read_text()
    if "\\bibdata{" in aux and "\\citation{" in aux:
        run(["bibtex", stem], stage)
    run(command, stage)
    run(command, stage)
    log = (stage / (stem + ".log")).read_text(encoding="utf-8", errors="replace")
    if re.search(
        r"(?:Reference|Citation) .+ undefined|There were undefined|multiply defined|Missing character:",
        log,
    ):
        hint = ""
        tex_path = stage / (stem + ".tex")
        if tex_path.is_file():
            tex_content = tex_path.read_text(encoding="utf-8", errors="ignore")
            ext_targets = re.findall(
                r"\\externaldocument(?:\[[^\]]*\])*\{([^}]+)\}", tex_content
            )
            if ext_targets:
                missing = [
                    t
                    for t in ext_targets
                    if not (stage / t).with_suffix(".aux").is_file()
                ]
                if missing:
                    hint = f" (Note: referenced external document {', '.join(missing)} was not built; compile it first to resolve cross-references)"
        raise ExportError(
            f"Unresolved references/citations or missing glyphs in {stem}.log{hint}"
        )
    pdf = stage / (stem + ".pdf")
    if not pdf.is_file() or not pdf.stat().st_size:
        raise ExportError(f"Missing PDF: {stem}")


def words(text: str) -> Counter:
    text = unicodedata.normalize("NFKD", text).casefold()
    text = re.sub(r"(?<=\w)[-\u00ad]\s*\n\s*(?=\w)", "", text)
    return Counter(re.findall(r"[^\W\d_]{3,}", text))


def bridge_pdf_hyphenation(text: str, expected_words: Counter) -> str:
    """Join wrapped prose around detached caption labels or math glyph rows.

    Poppler can place these above a continuation line. Retain the intervening
    tokens so the coverage check still accounts for every caption label.
    """
    detached = (
        r"(?:Figure|Table)\s+S?\d+\s*:"
        r"|[\d\s;–\-+<>=()\u0300-\u036F\u2200-\u22FF"
        r"\uFE00-\uFE0F\U0001D400-\U0001D7FF]+"
    )
    pattern = (
        r"([^\W\d_]+)-[ \t]*\n"
        rf"((?:[ \t]*(?:{detached})?[ \t]*\n)*)"
        r"[ \t]*(?:[\d;–\-]+[ \t]+)?([^\W\d_]+)"
    )

    def join(match):
        word = match[1] + match[3]
        if word.casefold() not in expected_words:
            return match[0]
        return word + " " + match[2].strip() + " "

    return re.sub(pattern, join, text)


def ast_text(node) -> str:
    if isinstance(node, list):
        return "".join(ast_text(item) for item in node)
    if not isinstance(node, dict):
        return ""
    kind = node.get("t")
    if kind in {"Image", "Math", "RawInline", "RawBlock"}:
        return ""
    if kind == "Str":
        return node["c"]
    if kind in {"Space", "SoftBreak", "LineBreak"}:
        return " "
    if kind in {"Subscript", "Superscript"}:
        return " " + ast_text(node.get("c", [])) + " "
    if kind in {"Para", "Plain", "Header"}:
        return "".join(ast_text(item) for item in node.get("c", [])) + "\n"
    return "".join(ast_text(item) for item in node.get("c", []))


def validate_docx_notation(root: ET.Element) -> None:
    """Reject known broken charge/unit bases before publishing a Word file."""
    ns = {"m": "http://schemas.openxmlformats.org/officeDocument/2006/math"}
    for superscript in root.findall(".//m:sSup", ns):
        base = "".join(n.text or "" for n in superscript.findall("m:e//m:t", ns))
        power = "".join(n.text or "" for n in superscript.findall("m:sup//m:t", ns))
        if not base.replace("\u200b", "").strip() and re.fullmatch(
            r"(?:[+-]\d+|\d+[+-]|[+-])", power.replace("−", "-").strip()
        ):
            raise ExportError(
                "DOCX contains an empty-base charge/unit superscript; "
                "export it as native Word superscript text"
            )
    import tex2docx

    text = "".join(root.itertext())
    if any(marker in text for marker in tex2docx.COLOR_MARKERS):
        raise ExportError("DOCX contains unresolved revision markers")


def docx(stage: Path, stem: str, mode: str) -> dict:
    # Capture the converter's prepared source before it is removed, and compare
    # its Pandoc-visible prose with the real DOCX. Math and image alt text have
    # different representations and are verified separately, not called exact.
    import tex2docx

    original = tex2docx.pypandoc.convert_file
    expected = []

    def capture(file, *args, **kwargs):
        expected.append(json.loads(original(file, to="json", format="latex")))
        return original(file, *args, **kwargs)

    tex2docx.pypandoc.convert_file = capture
    try:
        tex2docx.convert(
            stage / (stem + ".tex"),
            stage / (stem + ".docx"),
            native_inline_math=True,
            cite_mode=mode,
        )
    finally:
        tex2docx.pypandoc.convert_file = original
    with zipfile.ZipFile(stage / (stem + ".docx")) as archive:
        if archive.testzip():
            raise ExportError(f"Invalid DOCX: {stem}")
        texts = []
        drawing_count = 0
        for name in ("word/document.xml", "word/footnotes.xml", "word/endnotes.xml"):
            if name in archive.namelist():
                root = ET.fromstring(archive.read(name))
                validate_docx_notation(root)
                texts.extend(
                    node.text or "" for node in root.iter() if node.tag.endswith("}t")
                )
                drawing_count += sum(
                    node.tag.endswith("}drawing") for node in root.iter()
                )
    raw_ast = ast_text(expected[0]["blocks"])
    # Match exact markers: an adjacent capital letter belongs to the prose.
    for marker in tex2docx.COLOR_MARKERS:
        raw_ast = raw_ast.replace(marker, "")
    raw_ast = re.sub(
        r"([\u2070-\u209F\u1D2C-\u1D6A\u00B2\u00B3\u00B9])", r" \1 ", raw_ast
    )
    expected_words = words(raw_ast)
    actual_words = words(" ".join(texts))
    missing = expected_words - actual_words
    if missing:
        raise ExportError(f"DOCX prose coverage failed for {stem}: {dict(missing)}")
    pdf_text = run(["pdftotext", "-layout", stem + ".pdf", "-"], stage)
    if not pdf_text.strip():
        raise ExportError(f"Empty PDF text: {stem}")
    pdf_text = re.sub(r"(?m)^\s*\d+\s+", "", pdf_text)
    pdf_text = re.sub(r"([\U0001D400-\U0001D7FF])([a-zA-Z])", r"\1 \2", pdf_text)
    pdf_text = re.sub(r"([a-zA-Z])([\U0001D400-\U0001D7FF])", r"\1 \2", pdf_text)
    pdf_text = bridge_pdf_hyphenation(pdf_text, expected_words)
    pdf_text = re.sub(
        r"([^\W\d_]+)-[ \t]*\n(?:\s*[\d;–\-\s]+\n|\s*\n)*\s*(?:[\d;–\-\s]+\s+)?([^\W\d_]+)",
        lambda m: (
            m[1] + m[2]
            if (m[1] + m[2]).casefold() in expected_words
            else m[1] + " " + m[2]
        ),
        pdf_text,
    )
    pdf_missing = expected_words - words(pdf_text)
    if pdf_missing:
        raw_text = run(["pdftotext", "-raw", stem + ".pdf", "-"], stage)
        pdf_missing = pdf_missing - words(raw_text)
    if pdf_missing:
        plain_text = run(["pdftotext", stem + ".pdf", "-"], stage)
        pdf_missing = pdf_missing - words(plain_text)
    if pdf_missing:
        try:
            try:
                import pymupdf as fitz
            except ImportError:
                import fitz

            with fitz.open(stage / f"{stem}.pdf") as doc:
                mupdf_text = " ".join(page.get_text() for page in doc)
                mupdf_words = " ".join(
                    w[4] for page in doc for w in page.get_text("words")
                )
            pdf_missing = pdf_missing - words(mupdf_text) - words(mupdf_words)
        except Exception:
            pass
    if pdf_missing:
        raise ExportError(f"PDF prose coverage failed for {stem}: {dict(pdf_missing)}")
    source = (stage / (stem + ".tex")).read_text()
    image_count = sum(t.name == "includegraphics" for t in scan(source))
    if drawing_count != image_count:
        raise ExportError(
            f"DOCX image inventory mismatch for {stem}: {drawing_count} vs {image_count}"
        )
    return {
        "pdf_nonempty_text": True,
        "pdf_prose_coverage": True,
        "docx_prose_coverage": True,
        "docx_notation_checked": True,
        "docx_images": drawing_count,
        "expected_images": image_count,
        "layout_review": "not automated; inspect PDF/DOCX before submission",
    }


def build_dir(root: Path) -> Path:
    aspyrus = root / ".aspyrus_build"
    localleaf = root / ".localleaf_build"
    if aspyrus.exists():
        return aspyrus
    if localleaf.exists():
        return localleaf
    return aspyrus


@contextmanager
def project_lock(root: Path):
    import fcntl

    work = build_dir(root)
    work.mkdir(exist_ok=True)
    with (work / "operation.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ExportError("Another document build or export is running") from error
        yield work


def preflight(root: Path, old: dict[str, str], names: set[str]) -> None:
    for name in names | set(old):
        path = output_path(root, name)
        if path.exists() and (
            name not in old
            or not path.is_file()
            or digest(path.read_bytes()) != old[name]
        ):
            raise ExportError(
                f"Existing or manually edited export: {name}. Move it aside before exporting again."
            )


def publish(root: Path, stage: Path, names: set[str], obsolete: set[str]) -> None:
    """Rollback ordinary publication errors; report is the last commit marker.

    The filesystem cannot atomically replace several sibling files. A persistent
    backup/journal permits explicit recovery after a process or machine crash.
    """
    work = build_dir(root)
    transaction = work / "publication"
    if transaction.exists():
        raise ExportError(
            "Interrupted publication exists; run export.py recover with the document path"
        )
    transaction.mkdir()
    touched = sorted(names | obsolete)
    existing = []
    try:
        for name in touched:
            path = output_path(root, name)
            if path.exists():
                backup = transaction / name
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, backup)
                existing.append(name)
        (transaction / record_name("journal")).write_text(
            record_text({"touched": touched, "existing": existing})
        )
        for name in sorted(
            name for name in names if not name.endswith((".json", ".log"))
        ):
            destination = output_path(root, name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(output_path(stage, name), destination)
        for name in obsolete:
            output_path(root, name).unlink(missing_ok=True)
        for marker in sorted(
            name for name in names if name.endswith((".json", ".log"))
        ):
            destination = output_path(root, marker)
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(output_path(stage, marker), destination)
    except BaseException:
        recover(root)
        raise
    shutil.rmtree(transaction)


def recover(root: Path) -> None:
    for work in (root / ".aspyrus_build", root / ".localleaf_build"):
        transaction = work / "publication"
        if not transaction.exists():
            continue
        journal = transaction / record_name("journal")
        if not journal.exists() and (transaction / "journal.json").exists():
            journal = transaction / "journal.json"
        if not journal.exists():
            shutil.rmtree(transaction)
            continue
        data = read_record(journal)
        if not all(safe_output(name) for name in data["touched"]) or not set(
            data["existing"]
        ) <= set(data["touched"]):
            raise ExportError("Invalid publication recovery journal")
        for name in data["touched"]:
            if name in data["existing"]:
                destination = output_path(root, name)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(output_path(transaction, name), destination)
            else:
                output_path(root, name).unlink(missing_ok=True)
        shutil.rmtree(transaction)


def safe_output(name: str) -> bool:
    path = Path(name)
    return (
        bool(name)
        and not path.is_absolute()
        and ".." not in path.parts
        and "\\" not in name
        and path.as_posix() == name
        and path.suffix in {".pdf", ".docx", ".json", ".log"}
    )


def output_path(root: Path, name: str) -> Path:
    """Validate relative output paths and reject symlinked parent directories."""
    if not safe_output(name):
        raise ExportError(f"Invalid export path: {name}")
    path = root / name
    for part in (path, *path.parents):
        if part == root:
            break
        if part.is_symlink():
            raise ExportError(f"Refusing to replace symlink: {name}")
    if not path.resolve().is_relative_to(root.resolve()):
        raise ExportError(f"Export escapes project: {name}")
    return path


def project_root(document: Path) -> Path:
    for parent in document.parents:
        if (
            (parent / ".aspyrus.json").is_file()
            or (parent / ".localleaf.json").is_file()
            or (parent / ".git").exists()
        ):
            return parent
    return document.parent


def dependencies(root: Path, document: Path, source: str) -> dict[str, bytes]:
    """Snapshot shared assets and literal TeX dependencies within the project."""
    result = {}

    def add(path):
        resolved = path.resolve()
        if not resolved.is_relative_to(root) or not resolved.is_file():
            raise ExportError(f"Missing dependency or path outside project: {path}")
        relative = Path(os.path.abspath(path)).relative_to(root).as_posix()
        result[relative] = resolved.read_bytes()

    for folder in [root / "assets", root / "references"]:
        if folder.exists():
            for path in folder.rglob("*"):
                if path.is_file():
                    add(path)
    for folder in {root, document.parent}:
        for path in folder.iterdir():
            if path.suffix in {".bib", ".sty", ".cls", ".bst"} and path.is_file():
                add(path)
    for token in scan(source):
        if token.name in {"input", "include", "includeonly"}:
            raise ExportError(
                "Build requires a self-contained TEX document; external inputs are unsupported"
            )
        if token.name == "bibliography":
            for name in token.arg.split(","):
                if Path(name.strip()).is_absolute():
                    raise ExportError("Use a project-relative bibliography path")
                add(document.parent / (name.strip() + ".bib"))
        if token.name == "includegraphics":
            pos = token.end
            while pos < len(source) and source[pos].isspace():
                pos += 1
            if source[pos : pos + 1] == "[":
                pos = source.find("]", pos) + 1
                if not pos:
                    raise ExportError("Unclosed graphics options")
            name, _ = group(source, pos)
            if Path(name).is_absolute():
                raise ExportError("Use a project-relative graphics path")
            path = document.parent / name
            if not path.suffix:
                path = next(
                    (
                        path.with_suffix(ext)
                        for ext in [".pdf", ".png", ".jpg", ".jpeg"]
                        if path.with_suffix(ext).is_file()
                    ),
                    path,
                )
            add(path)
    for m in re.finditer(r"\\externaldocument(?:\[[^\]]*\])*\{([^}]+)\}", source):
        target = m.group(1).strip()
        expected_path = (document.parent / target).with_suffix(".aux")
        if expected_path.is_file():
            add(expected_path)
            continue
        # Check fallback locations in sibling folders or .aspyrus_build
        aux_name = Path(target).name + ".aux"
        fallbacks = [
            (document.parent / target).parent / ".aspyrus_build" / aux_name,
            (document.parent / target).parent / ".localleaf_build" / aux_name,
            root / Path(target).name / ".aspyrus_build" / aux_name,
            root / Path(target).name / aux_name,
            root / Path(target).stem / ".aspyrus_build" / aux_name,
            root / Path(target).stem / aux_name,
        ]
        for fb in fallbacks:
            if fb.is_file():
                resolved = fb.resolve()
                if resolved.is_relative_to(root):
                    expected_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(resolved, expected_path)
                    add(expected_path)
                    break
    return result


def unchanged(document: Path, source: bytes, root: Path, deps: dict[str, bytes]):
    if document.read_bytes() != source:
        raise ExportError("Document changed during the build; save and retry")
    for name, data in deps.items():
        if not (root / name).is_file() or (root / name).read_bytes() != data:
            raise ExportError(f"Dependency changed during the build: {name}")


def figure_plan(source: str):
    tokens = scan(source)
    starts = [t for t in tokens if t.name == "begin" and t.arg == "document"]
    if len(starts) != 1:
        raise ExportError("Require one document environment")
    figures = []
    for i, token in enumerate(tokens):
        if token.name != "begin" or token.arg not in {"figure", "figure*"}:
            continue
        if not token.top:
            raise ExportError("Figure export requires top-level figure environments")
        finish = next(
            t for t in tokens[i + 1 :] if t.name == "end" and t.arg == token.arg
        )
        body_start = token.end
        option = re.match(r"\s*\[[^\]]*\]", source[body_start:])
        if option:
            body_start += option.end()
        body = source[body_start : finish.start]
        captions = [t for t in scan_fragment(body) if t.name == "caption"]
        if len(captions) != 1:
            raise ExportError(
                "Each exported figure must have one numbered caption; nested captions are unsupported"
            )
        caption = captions[0]
        pos = caption.end
        option = re.match(r"\s*\[[^\]]*\]", body[pos:])
        if option:
            pos += option.end()
        _, end = group(body, pos)
        label = "localleafexportfigure" + str(len(figures))
        clean = body[: caption.start] + body[end:]
        # Labels belong to the original document and are restored separately.
        for t in reversed(scan_fragment(clean)):
            if t.name == "label":
                clean = clean[: t.start] + clean[t.end :]
        figures.append(
            {
                "start": token.start,
                "end": finish.end,
                "insert": body_start + end,
                "label": label,
                "body": clean,
            }
        )
    if not figures:
        raise ExportError(
            "This document has no figures to export; existing figures.pdf was left unchanged"
        )
    instrumented = source
    for fig in reversed(figures):
        pos = fig["insert"]
        instrumented = (
            instrumented[:pos] + "\\label{" + fig["label"] + "}" + instrumented[pos:]
        )
    return source[: starts[0].end], figures, instrumented


def scan_fragment(body: str):
    prefix = "\\begin{document}"
    tokens = scan(prefix + body + "\\end{document}")
    return [
        Token(t.name, t.start - len(prefix), t.end - len(prefix), t.arg, t.top)
        for t in tokens
        if len(prefix) <= t.start < len(prefix) + len(body)
    ]


def compile_all(document: Path, mode: str = "numbers") -> dict:
    """Stage all deliverables and publish them in one recoverable transaction."""
    document = document.resolve()
    root, dest, stem = project_root(document), document.parent, document.stem
    raw = document.read_bytes()
    source = raw.decode("utf-8")
    has_figures = any(
        t.name == "begin" and t.arg in {"figure", "figure*"} for t in scan(source)
    )
    if stem == "figures":
        raise ExportError(
            "Rename figures.tex before building: figures.pdf is reserved for figure-only output"
        )
    doc_record = record_name(f".{stem}-export")
    fig_record = record_name(".figures-export")
    names = {stem + ".pdf", stem + ".docx"}
    if has_figures:
        names.add("figures.pdf")
    with project_lock(dest) as work:
        if (work / "publication").exists():
            raise ExportError(
                "Interrupted publication; run export.py recover with the document path"
            )
        deps = dependencies(root, document, source)
        old = {}
        records = {}
        obsolete = set()
        for name, expected in [
            (doc_record, {stem + ".pdf", stem + ".docx"}),
            (fig_record, {"figures.pdf"}),
        ]:
            path = dest / name
            if path.is_symlink():
                raise ExportError("Export record must not be a symlink")
            if not path.exists():
                continue
            data = read_record(path)
            if (
                name == fig_record
                and not has_figures
                and data.get("document") != document.name
            ):
                continue  # A different document's figure export is not ours to retire.
            if data.get("schema") != SCHEMA or data.get("document") != document.name:
                raise ExportError(
                    "This output belongs to another document or export version"
                )
            if set(data["output_sha256"]) != expected:
                raise ExportError("Unexpected output names in export record")
            records[name] = path.read_bytes()
            old.update(data["output_sha256"])
            if name == fig_record and not has_figures:
                obsolete.update({"figures.pdf", fig_record})
        preflight(dest, old, names)
        with tempfile.TemporaryDirectory(prefix="compile-", dir=work) as tmp:
            staged_root = Path(tmp)
            if plain_records():
                (staged_root / ".git").mkdir()
            else:
                (staged_root / ".aspyrus.json").write_text('{"version":1}')
                (staged_root / ".localleaf.json").write_text('{"version":1}')
            staged_doc = staged_root / document.relative_to(root)
            staged_doc.parent.mkdir(parents=True, exist_ok=True)
            for relative, data in deps.items():
                target = staged_root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            staged_doc.write_bytes(raw)
            try:
                report = execute(staged_doc, "build", mode)
                report["checks"]["figure_pdf"] = "not needed"
                markers = {doc_record}
                if has_figures:
                    figure_report = execute(staged_doc, "figures", mode)
                    report["checks"]["figure_pdf"] = figure_report["checks"]
                    markers.add(fig_record)
                (staged_doc.parent / doc_record).write_text(record_text(report))
                unchanged(document, raw, root, deps)
                for name, data in records.items():
                    if (dest / name).read_bytes() != data:
                        raise ExportError("Export ownership changed during build")
                preflight(dest, old, names)
                publish(dest, staged_doc.parent, names | markers, obsolete)
                staged_work = build_dir(staged_doc.parent)
                aux_file = staged_work / (stem + ".aux")
                if aux_file.exists():
                    shutil.copy2(aux_file, work / (stem + ".aux"))
                    shutil.copy2(aux_file, dest / (stem + ".aux"))
                return report
            finally:
                staged_work = build_dir(staged_doc.parent)
                log = staged_work / "last-build.log"
                if log.exists():
                    shutil.copy2(log, work / "last-build.log")


def execute(document: Path, action: str, mode: str = "numbers") -> dict:
    if action == "compile":
        return compile_all(document, mode)
    document = document.resolve()
    if document.suffix != ".tex":
        raise ExportError("Open an authored TEX document")
    root, dest, stem = project_root(document), document.parent, document.stem
    if stem == "figures" and action == "figures":
        raise ExportError(
            "Rename this document before exporting figures.pdf to avoid a document PDF collision"
        )
    report_name = record_name(
        ".figures-export" if action == "figures" else f".{stem}-export"
    )
    names = {"figures.pdf"} if action == "figures" else {stem + ".pdf", stem + ".docx"}
    with project_lock(dest) as work:
        if action == "recover":
            recover(dest)
            return {"recovered": True}
        if (work / "publication").exists():
            raise ExportError(
                "Interrupted publication; run export.py recover with the document path"
            )
        raw = document.read_bytes()
        source = raw.decode("utf-8")
        deps = dependencies(root, document, source)
        old = {}
        if (dest / report_name).is_symlink():
            raise ExportError("Export record must not be a symlink")
        if (dest / report_name).exists():
            previous = read_record(dest / report_name)
            if (
                previous.get("schema") != SCHEMA
                or previous.get("document") != document.name
            ):
                raise ExportError(
                    "This output belongs to another document or export version; move it aside first"
                )
            old = previous["output_sha256"]
            if set(old) != names:
                raise ExportError("Unexpected output names in export record")
        preflight(dest, old, names)
        with tempfile.TemporaryDirectory(prefix="stage-", dir=work) as temp:
            stage_root = Path(temp)
            stage = stage_root / document.parent.relative_to(root)
            stage.mkdir(parents=True, exist_ok=True)
            try:
                for name, data in deps.items():
                    path = stage_root / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                # The shared converter discovers this standard bibliography name.
                bibs = [
                    t.arg.split(",") for t in scan(source) if t.name == "bibliography"
                ]
                if bibs:
                    bibtext = "\n".join(
                        (stage / (name.strip() + ".bib")).read_text()
                        for nameset in bibs
                        for name in nameset
                    )
                    (stage / "references.bib").write_text(bibtext)
                preamble, figures, rendered = (
                    figure_plan(source) if action == "figures" else ("", [], source)
                )
                (stage / (stem + ".tex")).write_text(rendered)
                latex(stage, stem)
                aux = (stage / (stem + ".aux")).read_text()
                if action == "figures":
                    labels = read_labels(aux)
                    external = (
                        "\\makeatletter\n"
                        + "".join(
                            f"\\@namedef{{r@{key}}}{{{{{num}}}{{{page}}}}}\n"
                            for key, (num, page) in labels.items()
                        )
                        + "\\makeatother\n"
                    )
                    pages = []
                    numbers = []
                    for fig in figures:
                        number = labels[fig["label"]][0]
                        numbers.append(number)
                        pages.append(
                            "\\clearpage\n\\noindent\\begin{minipage}{\\textwidth}\n\\centering\n"
                            + fig["body"]
                            + "\n\\par\\medskip\nFigure "
                            + number
                            + "\n\\end{minipage}\n"
                        )
                    figure_tex = (
                        preamble
                        + "\n\\pagestyle{empty}\n"
                        + external
                        + "".join(pages)
                        + "\\end{document}\n"
                    )
                    (stage / "figures.tex").write_text(figure_tex)
                    latex(stage, "figures")
                    info = run(["pdfinfo", "figures.pdf"], stage)
                    if int(re.search(r"Pages:\s+(\d+)", info)[1]) != len(figures):
                        raise ExportError(
                            "Figure layout exceeds one page per figure; reduce its size before export"
                        )
                    if re.search(
                        r"Overfull \\[hv]box",
                        (stage / "figures.log").read_text(
                            encoding="utf-8", errors="replace"
                        ),
                    ):
                        raise ExportError(
                            "A figure exceeds its page bounds; reduce its size before export"
                        )
                    checks = {
                        "figures": numbers,
                        "pages": len(figures),
                        "captions": "omitted from figure PDF; source unchanged",
                    }
                else:
                    if mode != "numbers":
                        import tex2docx

                        rendered = tex2docx.replace_citations(
                            source,
                            tex2docx.parse_bib_map(aux),
                            mode=mode,
                            doi_map=tex2docx.load_doi_map(stage),
                        )
                        (stage / (stem + ".tex")).write_text(rendered)
                        latex(stage, stem)
                    checks = docx(stage, stem, mode)
                report = {
                    "schema": SCHEMA,
                    "document": document.name,
                    "source_sha256": digest(raw),
                    "action": action,
                    "mode": mode,
                    "checks": checks,
                    "dependency_sha256": {
                        name: digest(data) for name, data in deps.items()
                    },
                    "output_sha256": {
                        name: digest((stage / name).read_bytes()) for name in names
                    },
                }
                (stage / report_name).write_text(record_text(report))
                unchanged(document, raw, root, deps)
                preflight(dest, old, names)
                publish(dest, stage, names | {report_name}, set())
                if action == "build":
                    shutil.copy2(stage / (stem + ".aux"), work / (stem + ".aux"))
                    shutil.copy2(stage / (stem + ".aux"), dest / (stem + ".aux"))
                return report
            finally:
                if (stage / "build.log").exists():
                    shutil.copy2(stage / "build.log", work / "last-build.log")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["compile", "build", "figures", "recover"])
    parser.add_argument("document", type=Path)
    parser.add_argument(
        "--mode", choices=["numbers", "keys", "dois"], default="numbers"
    )
    args = parser.parse_args()
    try:
        print(
            json.dumps(
                execute(args.document, args.action, args.mode)["checks"], indent=2
            )
            if args.action != "recover"
            else json.dumps(execute(args.document, args.action))
        )
        return 0
    except (
        ExportError,
        OSError,
        subprocess.TimeoutExpired,
        KeyError,
        ValueError,
    ) as error:
        print(f"LocalLeaf: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

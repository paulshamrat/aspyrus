#!/usr/bin/env python3
"""High-fidelity LaTeX to DOCX exporter for LocalLeaf.

Adopts proven rules from scientific manuscript pipelines:
- Unwraps \\resizebox to preserve tables without Pandoc dropping them.
- Resolves \\ref and \\cite using build .aux/.bbl to avoid broken '??' references.
- Linearizes inline LaTeX mathematics into clean Unicode text so short formulas
  and variables are not converted into distorted Word equation shapes.
- Translates sub/superscripts and Greek letters cleanly.
- Applies consistent academic styling via python-docx (Times New Roman, margins,
  table formatting, configurable line spacing).
"""

from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import pypandoc
from docx import Document

NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ET.register_namespace("w", NS_W)

SUPERSCRIPT_MAP = str.maketrans({
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
    "n": "ⁿ", "i": "ⁱ", "K": "ᴷ", "*": "∗"
})

SUBSCRIPT_MAP = str.maketrans({
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
    "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
    "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ",
    "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ", "o": "ₒ",
    "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "u": "ᵤ", "v": "ᵥ", "x": "ₓ"
})


def _translate_superscript(content: str) -> str:
    return content.translate(SUPERSCRIPT_MAP)


def _translate_subscript(content: str) -> str:
    return content.lower().translate(SUBSCRIPT_MAP)


def parse_brace_block(source: str, start_idx: int) -> tuple[str | None, int]:
    depth = 0
    idx = start_idx
    while idx < len(source):
        char = source[idx]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start_idx + 1:idx], idx + 1
        idx += 1
    return None, start_idx


def _strip_math_group(content: str) -> str:
    while content.startswith("{") and content.endswith("}"):
        inner, pos = parse_brace_block(content, 0)
        if inner is None or pos != len(content):
            break
        content = inner
    return content


def _normalize_simple_math_for_docx(expr: str) -> str:
    greek_map = {
        r"\alpha": "α",
        r"\beta": "β",
        r"\gamma": "γ",
        r"\chi": "χ",
        r"\Delta": "Δ",
        r"\delta": "δ",
        r"\epsilon": "ε",
        r"\eta": "η",
        r"\theta": "θ",
        r"\lambda": "λ",
        r"\mu": "μ",
        r"\pi": "π",
        r"\sigma": "σ",
        r"\tau": "τ",
        r"\phi": "φ",
        r"\omega": "ω",
        r"\Omega": "Ω",
        r"\circ": "°",
        r"\ln": " ln",
        r"\sum": "∑",
        r"\sim": "~",
        r"\rightarrow": "→",
        r"\geq": "≥",
        r"\leq": "≤",
        r"\times": "×",
        r"\cdot": "·",
        r"\vert": "|",
        r"\pm": "±",
    }

    expr = " ".join(expr.split())
    expr = expr.replace(r"\_", "_")
    expr = expr.replace(r"\,", " ")
    expr = expr.replace(r"\!", "")
    expr = expr.replace(r"\ ", " ")

    for latex, unicode_char in greek_map.items():
        expr = expr.replace(latex, unicode_char)

    expr = expr.replace("^°", "°")
    expr = re.sub(r"\^\{([^}]*)\}", lambda m: _translate_superscript(m.group(1)), expr)
    expr = re.sub(r"\^([0-9*+n])", lambda m: _translate_superscript(m.group(1)), expr)
    expr = re.sub(
        r"_\{([^}]*)\}",
        lambda m: _translate_subscript(_strip_math_group(m.group(1))),
        expr,
    )
    expr = re.sub(r"_([A-Za-z0-9]+)", lambda m: _translate_subscript(m.group(1)), expr)

    expr = expr.replace("{", "").replace("}", "")
    return expr


def linearize_inline_math_for_docx(text: str) -> str:
    """Convert inline math to plain Unicode text so Pandoc doesn't distort it into Word math boxes."""
    text = re.sub(
        r"\\\((.+?)\\\)",
        lambda m: _normalize_simple_math_for_docx(m.group(1)),
        text,
        flags=re.S,
    )
    return re.sub(
        r"(?<!\\)\$(.+?)(?<!\\)\$",
        lambda m: _normalize_simple_math_for_docx(m.group(1)),
        text,
        flags=re.S,
    )


def normalize_unit_macros_for_docx(text: str) -> str:
    text = text.replace(r"\AA{}", "Å")
    text = text.replace(r"\AA ", "Å ")
    text = text.replace(r"\AA", "Å")
    text = text.replace(r"\degree", "°")
    text = text.replace(r"\celsius", "°C")
    text = text.replace(r"\micro", "µ")
    return text


def unwrap_resizebox(text: str) -> str:
    """Pandoc can drop LaTeX tables wrapped in \\resizebox; unwrap them first."""
    key = r"\resizebox"
    idx = 0
    chunks: list[str] = []
    while idx < len(text):
        hit = text.find(key, idx)
        if hit == -1:
            chunks.append(text[idx:])
            break
        chunks.append(text[idx:hit])
        pos = hit + len(key)
        while pos < len(text) and text[pos].isspace():
            pos += 1
        if pos >= len(text) or text[pos] != "{":
            chunks.append(key)
            idx = pos
            continue
        _, pos = parse_brace_block(text, pos)  # width
        while pos < len(text) and text[pos].isspace():
            pos += 1
        if pos >= len(text) or text[pos] != "{":
            idx = pos
            continue
        _, pos = parse_brace_block(text, pos)  # height
        while pos < len(text) and text[pos].isspace():
            pos += 1
        if pos >= len(text) or text[pos] != "{":
            idx = pos
            continue
        content, pos2 = parse_brace_block(text, pos)  # content
        if content is None:
            idx = pos
            continue
        chunks.append(content)
        idx = pos2
    return "".join(chunks)


def flatten_singlecol_nested_tabular(text: str) -> str:
    pat = re.compile(
        r"\\begin\{tabular\}\s*\[t\]\s*\{@\{\}l@\{\}\}(.*?)\\end\{tabular\}",
        re.S,
    )

    def repl(match: re.Match[str]) -> str:
        inner = match.group(1).strip()
        inner = re.sub(r"\\\\\s*", "; ", inner)
        inner = re.sub(r"\s+", " ", inner).strip()
        return inner

    return pat.sub(repl, text)


def load_label_map(build_dir: Path, stem: str) -> dict[str, str]:
    label_map = {}
    aux = build_dir / f"{stem}.aux"
    if aux.exists():
        text = aux.read_text(encoding="utf-8", errors="ignore")
        for m in re.finditer(r"\\newlabel\{([^}]+)\}\{\{([^}]*)\}", text):
            label_map[m.group(1)] = m.group(2)
    return label_map


def load_bib_map(build_dir: Path, stem: str) -> dict[str, str]:
    bib_map = {}
    aux = build_dir / f"{stem}.aux"
    if aux.exists():
        text = aux.read_text(encoding="utf-8", errors="ignore")
        for m in re.finditer(r"\\bibcite\{([^}]+)\}\{([^}]*)\}", text):
            key = m.group(1)
            val = m.group(2)
            match = re.match(r"\{?([^{}]+)", val)
            bib_map[key] = match.group(1) if match else val
    return bib_map


def replace_citations_and_refs(text: str, label_map: dict[str, str], bib_map: dict[str, str]) -> str:
    def cite_repl(match: re.Match[str]) -> str:
        keys = [part.strip() for part in match.group(1).split(",") if part.strip()]
        nums = [bib_map.get(key, key) for key in keys]
        return "[" + ", ".join(nums) + "]"

    for pat in (r"\\cite\{([^}]+)\}", r"\\citep\{([^}]+)\}", r"\\citet\{([^}]+)\}"):
        text = re.sub(pat, cite_repl, text)

    text = re.sub(
        r"\\ref\{([^}]+)\}", lambda m: label_map.get(m.group(1), m.group(1)), text
    )
    text = re.sub(
        r"\\eqref\{([^}]+)\}", lambda m: "(" + label_map.get(m.group(1), m.group(1)) + ")", text
    )
    return text


def clean_latex_body_for_pandoc(text: str) -> str:
    """Prepare LaTeX document body for clean Pandoc Word conversion."""
    # 1. Clean conditional commands \ifbps ... \else ... \fi safely
    text = re.sub(r"\\ifbps((?:(?!\\ifbps)[\s\S])*?)\\else((?:(?!\\ifbps)[\s\S])*?)\\fi", r"\1", text)
    text = re.sub(r"\\ifbps((?:(?!\\ifbps)[\s\S])*?)\\fi", r"\1", text)
    text = text.replace(r"\ifbps", "").replace(r"\else", "").replace(r"\fi", "")

    # 2. Section and formatting commands
    text = re.sub(r"\\cvsection\{([^}]+)\}", lambda m: f"\\section*{{{m.group(1)}}}", text)
    text = text.replace(r"\hfill", " — ")
    text = text.replace(r"\thispagestyle{firstpage}", "")
    text = text.replace(r"\thispagestyle{empty}", "")
    text = text.replace(r"\pagestyle{empty}", "")

    # 3. Clean fontsize commands
    text = re.sub(r"\\fontsize\{[^}]+\}\{[^}]+\}", "", text)
    text = text.replace(r"\selectfont", "")
    text = text.replace(r"\par", "\n\n")

    # 4. Spacing brackets: \\[2pt] -> \\
    text = re.sub(r"\\\\\[\d+(\.\d+)?(pt|em|ex|cm|mm|in)\]", r"\\\\", text)
    text = re.sub(r"\\vspace\*?\{[^}]*\}", "\n", text)
    text = re.sub(r"\\hspace\*?\{[^}]*\}", " ", text)

    return text


def postprocess_docx_typography(
    docx_path: Path,
    line_spacing: float = 1.15,
    space_after_pt: float = 2.0,
) -> None:
    """Apply consistent academic Word typography and formatting via python-docx and OpenXML."""
    # 1. Set Times New Roman globally in styles.xml
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    styles_path = "word/styles.xml"
    if styles_path in files:
        styles_root = ET.fromstring(files[styles_path])
        doc_defaults = styles_root.find(f".//{{{NS_W}}}docDefaults")
        if doc_defaults is None:
            doc_defaults = ET.SubElement(styles_root, f"{{{NS_W}}}docDefaults")
        rpr_default_parent = doc_defaults.find(f"{{{NS_W}}}rPrDefault")
        if rpr_default_parent is None:
            rpr_default_parent = ET.SubElement(doc_defaults, f"{{{NS_W}}}rPrDefault")
        rpr_default = rpr_default_parent.find(f"{{{NS_W}}}rPr")
        if rpr_default is None:
            rpr_default = ET.SubElement(rpr_default_parent, f"{{{NS_W}}}rPr")

        def set_rfonts(parent: ET.Element) -> None:
            rfonts = parent.find(f"{{{NS_W}}}rFonts")
            if rfonts is None:
                rfonts = ET.SubElement(parent, f"{{{NS_W}}}rFonts")
            for key in ("ascii", "hAnsi", "cs", "eastAsia"):
                rfonts.attrib[f"{{{NS_W}}}{key}"] = "Times New Roman"
            for themed in ("asciiTheme", "hAnsiTheme", "cstheme", "eastAsiaTheme"):
                rfonts.attrib.pop(f"{{{NS_W}}}{themed}", None)

        set_rfonts(rpr_default)
        for style in styles_root.findall(f".//{{{NS_W}}}style"):
            if style.attrib.get(f"{{{NS_W}}}type") in {"paragraph", "character"}:
                rpr = style.find(f"{{{NS_W}}}rPr")
                if rpr is None:
                    rpr = ET.SubElement(style, f"{{{NS_W}}}rPr")
                set_rfonts(rpr)

        files[styles_path] = ET.tostring(styles_root, encoding="utf-8", xml_declaration=True)

        with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for name, content in files.items():
                zout.writestr(name, content)

    # 2. Line spacing, margins, and table formatting via python-docx
    doc = Document(docx_path)
    for p in doc.paragraphs:
        p.paragraph_format.line_spacing = line_spacing
        p.paragraph_format.space_after = int(space_after_pt * 20)

    for section in doc.sections:
        section.top_margin = int(72 * 20 * 0.75)     # 0.75 in
        section.bottom_margin = int(72 * 20 * 0.75)
        section.left_margin = int(72 * 20 * 0.75)
        section.right_margin = int(72 * 20 * 0.75)

    for table in doc.tables:
        table.autofit = True
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    p.paragraph_format.line_spacing = 1.05
                    p.paragraph_format.space_after = int(max(0, space_after_pt - 1) * 20)

    doc.save(docx_path)


def export_latex_to_docx(
    tex_path: Path,
    out_docx_path: Path,
    build_dir: Path | None = None,
    line_spacing: float = 1.15,
    space_after_pt: float = 2.0,
) -> tuple[bool, str]:
    """Convert LaTeX to high-fidelity DOCX with manuscript rules."""
    try:
        if not tex_path.exists():
            return False, f"TeX file not found: {tex_path}"

        stem = tex_path.stem
        build_dir = build_dir or (tex_path.parent / ".localleaf_build")

        label_map = load_label_map(build_dir, stem)
        bib_map = load_bib_map(build_dir, stem)

        raw_tex = tex_path.read_text(encoding="utf-8", errors="ignore")

        # Extract document body to isolate from custom TeX packages/preambles
        start = raw_tex.find(r"\begin{document}")
        end = raw_tex.rfind(r"\end{document}")
        if start != -1 and end != -1:
            body = raw_tex[start + len(r"\begin{document}"):end]
        else:
            body = raw_tex

        # 1. Clean & normalize LaTeX for Word conversion
        body = clean_latex_body_for_pandoc(body)
        body = unwrap_resizebox(body)
        body = flatten_singlecol_nested_tabular(body)
        body = replace_citations_and_refs(body, label_map, bib_map)
        body = linearize_inline_math_for_docx(body)
        body = normalize_unit_macros_for_docx(body)

        clean_tex = r"""\documentclass{article}
\usepackage{hyperref}
\begin{document}
""" + body + r"""
\end{document}
"""

        out_docx_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_tex = out_docx_path.parent / f".tmp_{stem}_docx_prep.tex"
        tmp_tex.write_text(clean_tex, encoding="utf-8")

        # 2. Convert via Pandoc
        pypandoc.convert_file(
            str(tmp_tex),
            to="docx",
            format="latex",
            outputfile=str(out_docx_path),
            extra_args=[
                "--standalone",
                f"--resource-path={tex_path.parent}:{out_docx_path.parent}",
            ],
        )

        if tmp_tex.exists():
            tmp_tex.unlink()

        # 3. Apply python-docx typography rules
        postprocess_docx_typography(out_docx_path, line_spacing=line_spacing, space_after_pt=space_after_pt)

        return True, f"Successfully exported to {out_docx_path}"
    except Exception as e:
        return False, f"DOCX Export failed: {str(e)}"


if __name__ == "__main__":
    import sys
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("demo/main.tex")
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("demo/.localleaf_build/main.docx")
    ok, msg = export_latex_to_docx(target, out)
    print("Success:", ok)
    print(msg)

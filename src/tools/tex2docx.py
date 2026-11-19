#!/usr/bin/env python3
"""Export manuscript TeX to review-ready DOCX with resolved citations, refs, and high-fidelity Word styling.

Zero-flag usage:
    python scripts/tex2docx.py
    (Auto-detects main.tex, main.aux, main.bbl at root, outputs main.docx)

Custom usage:
    python scripts/tex2docx.py supplementary.tex
    python scripts/tex2docx.py main.tex --out draft.docx
"""

from __future__ import annotations

import argparse
import copy
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import pypandoc
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

INPUT_RE = re.compile(r"\\input\{([^}]+)\}")
NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS_XML = "http://www.w3.org/XML/1998/namespace"
ET.register_namespace("w", NS_W)
REV_START = "CODXREVSTART"
REV_END = "CODXREVEND"
REV_START_RED = "CODXREVREDSTART"
REV_END_RED = "CODXREVREDEND"
REV_START_BLUE = "CODXREVBLUESTART"
REV_END_BLUE = "CODXREVBLUEEND"

COLOR_MARKERS = {
    "CODXSTDREDSTART": ("START", "FF0000"),
    "CODXSTDREDEND": ("END", "FF0000"),
    "CODXSTDBLUESTART": ("START", "0000FF"),
    "CODXSTDBLUEEND": ("END", "0000FF"),
    "CODXREVHIGHLIGHTSTART": ("START", "highlight"),
    "CODXREVHIGHLIGHTEND": ("END", "highlight"),
    REV_START_RED: ("START", "D32F2F"),
    REV_END_RED: ("END", "D32F2F"),
    REV_START_BLUE: ("START", "1976D2"),
    REV_END_BLUE: ("END", "1976D2"),
    REV_START: ("START", "1976D2"),
    REV_END: ("END", "1976D2"),
}
REVIEW_MARGIN_TWIPS = 1080  # 0.75 in
TWIPS_TO_EMU = 635


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert manuscript LaTeX to high-fidelity review DOCX with line numbers, 1.5 spacing, and resolved references."
    )
    parser.add_argument(
        "input_tex",
        nargs="?",
        default=None,
        help="Input TeX file (default: auto-detects main.tex at repository root).",
    )
    parser.add_argument(
        "--out",
        "-o",
        default=None,
        help="Output DOCX file path (default: <input_stem>.docx in the same directory).",
    )
    parser.add_argument(
        "--native-inline-math",
        action="store_true",
        help="Preserve inline LaTeX math as native Word equations instead of Unicode text.",
    )
    parser.add_argument(
        "--mode",
        "--cite-mode",
        default="dois",
        choices=["numbers", "dois", "keys"],
        help="Citation rendering mode for review DOCX (numbers, dois, keys). Default: dois.",
    )
    parser.add_argument(
        "--render-tex",
        action="store_true",
        help="Pre-render TeX source with resolved citations for pdflatex without generating docx.",
    )
    parser.add_argument(
        "--out-tex",
        default=None,
        help="Output path for pre-rendered TeX.",
    )
    return parser.parse_args()


# ============================================================================
# LaTeX Preprocessing & Reference Resolution
# ============================================================================


def parse_label_map(aux_text: str) -> dict[str, str]:
    return {
        m.group(1): m.group(2)
        for m in re.finditer(r"\\newlabel\{([^}]+)\}\{\{([^}]*)\}", aux_text)
    }


def load_label_map(tex_dir: Path, stem: str) -> dict[str, str]:
    paired_stems = {
        "main": "supplementary",
        "supplementary": "main",
        "main_text": "supplementary_information",
        "supplementary_information": "main_text",
    }
    label_map: dict[str, str] = {}
    stems_to_try = [paired_stems.get(stem), stem]
    for s in stems_to_try:
        if not s:
            continue
        candidates = [
            tex_dir / f"{s}.aux",
            tex_dir / ".aspyrus_build" / f"{s}.aux",
            tex_dir / ".localleaf_build" / f"{s}.aux",
            tex_dir.parent / s / f"{s}.aux",
            tex_dir.parent / s / ".aspyrus_build" / f"{s}.aux",
            tex_dir.parent / s / ".localleaf_build" / f"{s}.aux",
        ]
        for aux in candidates:
            if aux.is_file():
                label_map.update(
                    parse_label_map(aux.read_text(encoding="utf-8", errors="ignore"))
                )
                break
    return label_map


def parse_bib_map(aux_text: str) -> dict[str, str]:
    bib_map = {
        m.group(1): m.group(2)
        for m in re.finditer(r"\\bibcite\{([^}]+)\}\{([^}]*)\}", aux_text)
    }
    for key, value in list(bib_map.items()):
        match = re.match(r"\{?([^{}]+)", value)
        if match:
            bib_map[key] = match.group(1)
    return bib_map


def clean_achemso_bbl(bbl_text: str, bib_map: dict[str, str]) -> str:
    """Remove ACS-only bibliography wrappers before Pandoc reads the entries."""
    first_item = bbl_text.find(r"\bibitem")
    if first_item >= 0:
        bbl_text = bbl_text[first_item:]
    bbl_text = re.sub(r"\\end\{(?:mcite)?thebibliography\}[\s\S]*$", "", bbl_text)
    bbl_text = re.sub(
        r"\\mciteBstWouldAddEndPuncttrue[\s\S]*?\\EndOfBibitem", "", bbl_text
    )

    # Pandoc treats unknown \newblock as a command with an argument and
    # discards a following braced title or journal. It is only spacing.
    bbl_text = re.sub(r"\\newblock\b", " ", bbl_text)
    # achemso defines this transparent wrapper in its discarded preamble.
    bbl_text = re.sub(r"\\latin\{([^{}]*)\}", r"{\1}", bbl_text)
    # natbib styles define \doi in the discarded bibliography preamble.
    bbl_text = re.sub(
        r"\\doi\{([^{}]+)\}",
        lambda match: r"\texttt{" + match.group(1) + "}",
        bbl_text,
    )

    # Normalize LaTeX accents so Pandoc does not fragment accented author names (e.g. Patr{\'i}cia)
    latex_accents = {
        "'": {
            "a": "á",
            "e": "é",
            "i": "í",
            "o": "ó",
            "u": "ú",
            "A": "Á",
            "E": "É",
            "I": "Í",
            "O": "Ó",
            "U": "Ú",
            r"\i": "í",
            "c": "ć",
            "C": "Ć",
        },
        "`": {
            "a": "à",
            "e": "è",
            "i": "ì",
            "o": "ò",
            "u": "ù",
            "A": "À",
            "E": "È",
            "I": "Ì",
            "O": "Ò",
            "U": "Ù",
        },
        "^": {
            "a": "â",
            "e": "ê",
            "i": "î",
            "o": "ô",
            "u": "û",
            "A": "Â",
            "E": "Ê",
            "I": "Î",
            "O": "Ô",
            "U": "Û",
        },
        '"': {
            "a": "ä",
            "e": "ë",
            "i": "ï",
            "o": "ö",
            "u": "ü",
            "A": "Ä",
            "E": "Ë",
            "I": "Ï",
            "O": "Ö",
            "U": "Ü",
        },
        "~": {"a": "ã", "n": "ñ", "o": "õ", "A": "Ã", "N": "Ñ", "O": "Õ"},
        "c": {"c": "ç", "C": "Ç"},
    }
    for acc_char, mapping in latex_accents.items():
        escaped_acc = re.escape(acc_char)
        alt_pattern = re.compile(
            r"\{\\" + escaped_acc + r"(?:\{(\\?[a-zA-Z])\}|([a-zA-Z]))\}"
        )
        pattern = re.compile(
            r"\\(?:" + escaped_acc + r"(?:\{(\\?[a-zA-Z])\}|([a-zA-Z]))|"
            r"\{" + escaped_acc + r"(?:\{(\\?[a-zA-Z])\}|([a-zA-Z]))\})"
        )

        def _make_repl(m_map):
            def repl(m):
                for g in m.groups():
                    if g:
                        return m_map.get(g, m.group(0))
                return m.group(0)

            return repl

        bbl_text = alt_pattern.sub(_make_repl(mapping), bbl_text)
        bbl_text = pattern.sub(_make_repl(mapping), bbl_text)

    # Special characters: \o, \O, \aa, \AA, \ae, \AE, \ss
    bbl_text = re.sub(r"\{\\o\}|\\o\{\}|\\o(?![a-zA-Z])", "ø", bbl_text)
    bbl_text = re.sub(r"\{\\O\}|\\O\{\}|\\O(?![a-zA-Z])", "Ø", bbl_text)
    bbl_text = re.sub(r"\{\\aa\}|\\aa\{\}|\\aa(?![a-zA-Z])", "å", bbl_text)
    bbl_text = re.sub(r"\{\\AA\}|\\AA\{\}|\\AA(?![a-zA-Z])", "Å", bbl_text)
    bbl_text = re.sub(r"\{\\ae\}|\\ae\{\}|\\ae(?![a-zA-Z])", "æ", bbl_text)
    bbl_text = re.sub(r"\{\\AE\}|\\AE\{\}|\\AE(?![a-zA-Z])", "Æ", bbl_text)
    bbl_text = re.sub(r"\{\\ss\}|\\ss\{\}|\\ss(?![a-zA-Z])", "ß", bbl_text)

    def numbered_item(match: re.Match[str]) -> str:
        key = match.group(1)
        return rf"\par\noindent\textbf{{[{bib_map.get(key, '?')}]}} "

    return re.sub(r"\\bibitem(?:\[[\s\S]*?\])?\{([^}]+)\}", numbered_item, bbl_text)


def resolve_input(raw: str, current_dir: Path, repo_root: Path) -> Path | None:
    rel = Path(raw)
    candidates = []
    if rel.is_absolute():
        candidates.append(rel)
        if rel.suffix == "":
            candidates.append(rel.with_suffix(".tex"))
    else:
        candidates.append(current_dir / rel)
        candidates.append(repo_root / rel)
        if rel.suffix == "":
            candidates.append((current_dir / rel).with_suffix(".tex"))
            candidates.append((repo_root / rel).with_suffix(".tex"))
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def expand_inputs(path: Path, repo_root: Path, stack: list[Path] | None = None) -> str:
    stack = stack or []
    if path in stack:
        return ""
    text = path.read_text(encoding="utf-8", errors="ignore")
    current_dir = path.parent

    def repl(match: re.Match[str]) -> str:
        resolved = resolve_input(match.group(1), current_dir, repo_root)
        if resolved is None:
            return match.group(0)
        return expand_inputs(resolved, repo_root, stack + [path])

    return INPUT_RE.sub(repl, text)


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
                return source[start_idx + 1 : idx], idx + 1
        idx += 1
    return None, start_idx


def mark_rev_spans(text: str) -> str:
    # Standard scoped colour groups: preserve nested groups and restore outer colour.
    groups = []

    def scoped_colour(match):
        token = match.group(0)
        if token.startswith(r"\begingroup"):
            colour = match.group(1)
            groups.append(colour)
            return f"CODXSTD{colour.upper()}START" if colour else token
        colour = groups.pop() if groups else None
        return f"CODXSTD{colour.upper()}END" if colour else token

    text = re.sub(
        r"\\begingroup(?:[ \t]*\\color\{(red|blue)\})?|\\endgroup",
        scoped_colour,
        text,
    )
    # 1. Environments
    text = re.sub(r"\\begin\{collabtext\}", REV_START_RED, text)
    text = re.sub(r"\\end\{collabtext\}", REV_END_RED, text)
    for environment, start, end in (
        ("redblock", REV_START_RED, REV_END_RED),
        ("blueblock", REV_START_BLUE, REV_END_BLUE),
    ):
        text = text.replace(r"\begin{" + environment + "}", start)
        text = text.replace(r"\end{" + environment + "}", end)

    # 2. Macros
    color_macros = {
        r"\hl": "CODXREVHIGHLIGHTSTART",
        r"\pihighlight": "CODXREVHIGHLIGHTSTART",
        r"\redtext": REV_START_RED,
        r"\bluetext": REV_START_BLUE,
        r"\newdata": REV_START_RED,
        r"\pendingchange": REV_START_RED,
        r"\pitext": REV_START_RED,
        r"\collabcaption": REV_START_RED,
        r"\finalfeedback": REV_START_BLUE,
        r"\rev": REV_START_BLUE,
    }

    idx = 0
    parts: list[str] = []
    keys = list(color_macros.keys()) + [r"\textcolor"]

    while idx < len(text):
        hit_pos = -1
        hit_key = None
        for k in keys:
            pos = text.find(k, idx)
            if pos != -1 and (hit_pos == -1 or pos < hit_pos):
                after = pos + len(k)
                if after >= len(text) or not (
                    text[after].isalpha() or text[after] == "*"
                ):
                    hit_pos = pos
                    hit_key = k

        if hit_pos == -1:
            parts.append(text[idx:])
            break

        parts.append(text[idx:hit_pos])
        pos = hit_pos + len(hit_key)
        while pos < len(text) and text[pos].isspace():
            pos += 1

        if hit_key == r"\textcolor":
            model = re.match(r"\[HTML\]", text[pos:], re.IGNORECASE)
            if model:
                pos += model.end()
        if pos >= len(text) or text[pos] != "{":
            parts.append(hit_key)
            idx = pos
            continue

        if hit_key == r"\textcolor":
            color_name, pos2 = parse_brace_block(text, pos)
            if color_name is None:
                parts.append(hit_key)
                idx = pos
                continue
            pos = pos2
            while pos < len(text) and text[pos].isspace():
                pos += 1
            if pos >= len(text) or text[pos] != "{":
                parts.append(hit_key)
                idx = pos
                continue
            content, pos3 = parse_brace_block(text, pos)
            if content is None:
                parts.append(hit_key)
                idx = pos
                continue
            c = color_name.strip().lower()
            if c in ("red", "blue"):
                colour = c.upper()
                parts.append(
                    f"CODXSTD{colour}START{mark_rev_spans(content)}CODXSTD{colour}END"
                )
            elif c in ("crimson", "d32f2f", "aspyrusred"):
                parts.append(f"{REV_START_RED}{mark_rev_spans(content)}{REV_END_RED}")
            elif c in ("navy", "royalblue", "1976d2", "aspyrusblue"):
                parts.append(f"{REV_START_BLUE}{mark_rev_spans(content)}{REV_END_BLUE}")
            else:
                parts.append(mark_rev_spans(content))
            idx = pos3
        else:
            content, pos2 = parse_brace_block(text, pos)
            if content is None:
                parts.append(hit_key)
                idx = pos
                continue
            start_m = color_macros[hit_key]
            end_m = (
                "CODXREVHIGHLIGHTEND"
                if start_m == "CODXREVHIGHLIGHTSTART"
                else REV_END_RED
                if start_m == REV_START_RED
                else REV_END_BLUE
            )
            parts.append(f"{start_m}{mark_rev_spans(content)}{end_m}")
            idx = pos2

    return "".join(parts)


def unwrap_resizebox(text: str) -> str:
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


def replace_paths(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        content = match.group(1)
        escaped = (
            content.replace("\\", "/")
            .replace("_", r"\_")
            .replace("%", r"\%")
            .replace("&", r"\&")
            .replace("#", r"\#")
        )
        return r"\texttt{" + escaped + "}"

    return re.sub(r"\\path\{([^}]*)\}", repl, text)


def simplify_longtable_for_docx(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        body = match.group(0)
        body = re.sub(
            r"\\multicolumn\{[^}]+\}\{[^}]+\}\{\\textbf\{Table\s+.*?continued\.\}\}\\\\\s*",
            "",
            body,
            flags=re.I | re.S,
        )
        body = re.sub(r"\\endfirsthead\s*.*?\\endlastfoot\s*", "\n", body, flags=re.S)
        body = re.sub(r"\\endfirsthead\s*.*?\\endfoot\s*", "\n", body, flags=re.S)
        return body

    return re.sub(r"\\begin\{longtable\}.*?\\end\{longtable\}", repl, text, flags=re.S)


SUPERSCRIPT_MAP = str.maketrans(
    {
        "0": "⁰",
        "1": "¹",
        "2": "²",
        "3": "³",
        "4": "⁴",
        "5": "⁵",
        "6": "⁶",
        "7": "⁷",
        "8": "⁸",
        "9": "⁹",
        "+": "⁺",
        "-": "⁻",
        "=": "⁼",
        "(": "⁽",
        ")": "⁾",
        "n": "ⁿ",
        "i": "ⁱ",
        "K": "ᴷ",
    }
)

SUBSCRIPT_MAP = str.maketrans(
    {
        "0": "₀",
        "1": "₁",
        "2": "₂",
        "3": "₃",
        "4": "₄",
        "5": "₅",
        "6": "₆",
        "7": "₇",
        "8": "₈",
        "9": "₉",
        "+": "₊",
        "-": "₋",
        "=": "₌",
        "(": "₍",
        ")": "₎",
        "a": "ₐ",
        "e": "ₑ",
        "h": "ₕ",
        "i": "ᵢ",
        "j": "ⱼ",
        "k": "ₖ",
        "l": "ₗ",
        "m": "ₘ",
        "n": "ₙ",
        "o": "ₒ",
        "p": "ₚ",
        "r": "ᵣ",
        "s": "ₛ",
        "t": "ₜ",
        "u": "ᵤ",
        "v": "ᵥ",
        "x": "ₓ",
    }
)


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
        r"\mu": "μ",
        r"\circ": "°",
        r"\ln": " ln",
        r"\sum": "∑",
        r"\sim": "~",
        r"\rightarrow": "->",
        r"\geq": "≥",
        r"\leq": "≤",
        r"\times": "×",
    }

    expr = " ".join(expr.split())
    expr = re.sub(r"\\(?:mathrm|text)\{([^}]*)\}", r"\1", expr)
    expr = expr.replace(r"\_", "_")
    expr = expr.replace(r"\,", "")
    expr = expr.replace(r"\!", "")
    expr = expr.replace(r"\ ", " ")

    for latex, unicode_char in greek_map.items():
        expr = expr.replace(latex, unicode_char)

    expr = re.sub(r"Δ\s+H", "ΔH", expr)
    expr = expr.replace("^°", "°")
    expr = re.sub(
        r"\^\{([^}]*)\}", lambda m: m.group(1).translate(SUPERSCRIPT_MAP), expr
    )

    def _sub_repl(m: re.Match) -> str:
        inner = _strip_math_group(m.group(1))
        inner = re.sub(r"\\(?:mathrm|text)\{([^}]*)\}", r"\1", inner).strip("{}")
        if all(c in SUBSCRIPT_MAP for c in inner.lower()):
            return inner.lower().translate(SUBSCRIPT_MAP)
        return f"@@SUB@@{inner}@@ENDS@@"

    expr = re.sub(r"_\{([^}]*)\}", _sub_repl, expr)
    expr = re.sub(
        r"_([A-Za-z0-9]+)", lambda m: m.group(1).lower().translate(SUBSCRIPT_MAP), expr
    )
    expr = expr.replace("{", "").replace("}", "")
    expr = expr.replace("@@SUB@@", r"\textsubscript{").replace("@@ENDS@@", "}")
    return expr


def linearize_inline_math_for_docx(text: str) -> str:
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
    text = re.sub(r"\\AA\{\}", "Å", text)
    text = re.sub(r"\\AA\\\s+", "Å ", text)
    text = re.sub(r"\\AA(?=CODXREV(?:START|END))", "Å", text)
    return re.sub(r"\\AA(?![A-Za-z])", "Å", text)


def normalize_native_inline_math(text: str) -> str:
    """Use prose for numeric fragments; preserve symbolic native equations."""

    def replace(match: re.Match[str]) -> str:
        expression = match.group(1)
        number = re.fullmatch(
            r"\s*([+\-−]?)([0-9]+(?:\.[0-9]*)?|\.[0-9]+)\s*", expression
        )
        if number:
            # Math minus becomes a real minus in prose; retain precision/sign.
            return number.group(1).replace("-", "−") + number.group(2)
        # Some Word-compatible editors treat open OMML relations as incomplete
        # equations and insert placeholders. Numeric/operator fragments belong
        # in prose; expressions containing variables stay native equations.
        comparison = re.sub(
            r"\\(?:leq?|geq?|lt|gt)(?![A-Za-z])",
            lambda m: {
                r"\le": "≤",
                r"\leq": "≤",
                r"\ge": "≥",
                r"\geq": "≥",
                r"\lt": "<",
                r"\gt": ">",
            }[m.group()],
            expression,
        ).replace(r"\%", "%")
        if re.search(r"[<>=≤≥]", comparison) and re.fullmatch(
            r"\s*(?:[+\-−]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:\s*%)?|[<>=≤≥]+|\s+)+\s*",
            comparison,
        ):
            return comparison.strip().replace("-", "−").replace("%", r"\%")
        # Standalone explicit Greek labels are prose. Avoid editor-specific
        # equation font defaults; embedded upright Greek stays native math.
        greek_letters = dict(
            zip(
                (
                    "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda "
                    "mu nu xi pi rho sigma tau upsilon phi chi psi omega "
                    "Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega"
                ).split(),
                "αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΥΦΨΩ",
                strict=True,
            )
        )
        greek_label = re.fullmatch(
            r"\s*\\mathrm\{\\([A-Za-z]+)\}(\s*[0-9]*)\s*", expression
        )
        if greek_label and greek_label.group(1) in greek_letters:
            return greek_letters[greek_label.group(1)] + greek_label.group(2)

        # Structural biology Greek fold/motif labels (e.g. \alpha/\beta, \alpha, \beta, \alpha 1, \beta 6)
        structural_greek = re.fullmatch(
            r"\s*\\(alpha|beta)(?:\s*/\s*\\(alpha|beta)|\s*([0-9]+))?\s*", expression
        )
        if structural_greek:
            g1 = "α" if structural_greek.group(1) == "alpha" else "β"
            if structural_greek.group(2):
                g2 = "α" if structural_greek.group(2) == "alpha" else "β"
                return f"{g1}/{g2}"
            if structural_greek.group(3):
                return f"{g1}{structural_greek.group(3)}"
            return g1

        # Chemical ions: e.g. \text{Mg}^{2+}, \mathrm{Mg}^{2+}, Mg^{2+}, \text{Na}^+, \text{Cl}^-
        ion = re.fullmatch(
            r"\s*(?:\\(?:mathrm|text)\{)?([A-Z][a-z]?)\}?\^(?:\{([+-]?\d*[+-]?|[+-])\}|([+-]))\s*",
            expression,
        )
        if ion:
            charge_val = ion.group(2) or ion.group(3)
            return ion.group(1) + r"\textsuperscript{" + charge_val + "}"

        # Single-letter variable subscript in prose (e.g. $R_g$, $C_{ij}$)
        var_sub = re.fullmatch(
            r"\s*(?:\\(?:textit|mathit)\{)?([A-Za-z])\}?_(?:\{([A-Za-z0-9]{1,3})\}|([A-Za-z0-9]{1,3}))\s*",
            expression,
        )
        if var_sub:
            sub_val = var_sub.group(2) or var_sub.group(3)
            return r"\textit{" + var_sub.group(1) + r"}\textsubscript{" + sub_val + "}"

        # Coordinate tuples: e.g. (+11.1 \AA, +9.7 \AA), (PC1 \approx -9.7 \AA, PC2 \approx -2.2 \AA)
        coord_tuple = re.fullmatch(
            r"\s*\(\s*(?:\\(?:text|mathrm)\{PC1\}\s*\\approx\s*)?([+\-−]?[0-9]+(?:\.[0-9]*)?)\s*(?:\\(?:text\{\s*)?\\?AA\}?|Å)?\s*,\s*(?:\\(?:text|mathrm)\{PC2\}\s*\\approx\s*)?([+\-−]?[0-9]+(?:\.[0-9]*)?)\s*(?:\\(?:text\{\s*)?\\?AA\}?|Å)?\s*\)\s*",
            expression,
        )
        if coord_tuple:
            c1 = coord_tuple.group(1).replace("-", "−")
            c2 = coord_tuple.group(2).replace("-", "−")
            prefix = "PC1 ≈ " if "PC1" in expression else ""
            prefix2 = "PC2 ≈ " if "PC2" in expression else ""
            return f"({prefix}{c1} Å, {prefix2}{c2} Å)"

        charge = re.fullmatch(r"\s*\^\{([+-]?\d+[+-]?|[+-])\}\s*", expression)
        if charge:
            return r"\textsuperscript{" + charge.group(1) + "}"
        # Convert explicitly paired absolute-value markers to OMML delimiters.
        expression = re.sub(r"\\lvert\s*(.*?)\\rvert", r"\\left|\1\\right|", expression)
        if r"\left" not in expression:
            expression = re.sub(
                r"(?<!\\)\|([^|]+)(?<!\\)\|", r"\\left|\1\\right|", expression
            )
        return r"\(" + expression + r"\)"

    text = re.sub(r"\\\((.*?)\\\)", replace, text, flags=re.S)
    text = re.sub(r"(?<![\\$])\$(?!\$)(.*?)(?<!\\)\$(?!\$)", replace, text)
    return text


def load_doi_map(repo_root: Path) -> dict[str, str]:
    bib_path = repo_root / "references.bib"
    if not bib_path.exists():
        return {}
    doi_map: dict[str, str] = {}
    content = bib_path.read_text(encoding="utf-8", errors="ignore")
    for match in re.finditer(r"@\w+\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n@|\Z)", content):
        key = match.group(1).strip()
        body = match.group(2)
        doi_match = re.search(r"doi\s*=\s*[\"{]([^\"}]+)[\"}]", body, re.IGNORECASE)
        if doi_match:
            d = doi_match.group(1).strip()
            d = re.sub(r"^https?://(dx\.)?doi\.org/", "", d)
            d = re.sub(r"^doi:\s*", "", d, flags=re.IGNORECASE).strip()
            doi_map[key] = d
    return doi_map


def numeric_citation_style(source: str) -> tuple[bool, bool, bool]:
    source = re.sub(r"(?<!\\)%[^\n]*", "", source)
    options = []
    for match in re.finditer(r"\\usepackage(?:\[([^]]*)\])?\{(natbib|cite)\}", source):
        options += (match[1] or "").split(",")
    options = {option.strip() for option in options}
    return (
        bool(options & {"super", "superscript"}),
        bool(options & {"sort", "sort&compress"}),
        "sort&compress" in options,
    )


def numeric_citation(nums: list[str], style: tuple[bool, bool, bool]) -> str:
    superscript, sort, compress = style
    if all(n.isdigit() for n in nums):
        if sort:
            nums = [str(n) for n in sorted({int(n) for n in nums})]
        if compress:
            groups = []
            i = 0
            while i < len(nums):
                j = i
                while j + 1 < len(nums) and int(nums[j + 1]) == int(nums[j]) + 1:
                    j += 1
                groups.extend(
                    [nums[i] + "--" + nums[j]] if j - i >= 2 else nums[i : j + 1]
                )
                i = j + 1
            nums = groups
    value = ",".join(nums)
    return r"\textsuperscript{" + value + "}" if superscript else "[" + value + "]"


def replace_citations(
    text: str,
    bib_map: dict[str, str],
    mode: str = "numbers",
    doi_map: dict[str, str] | None = None,
) -> str:
    doi_map = doi_map or {}
    style = numeric_citation_style(text)

    def cite_repl(match: re.Match[str]) -> str:
        keys = [part.strip() for part in match.group(1).split(",") if part.strip()]
        if mode == "dois":
            rendered = [f"DOI: {doi_map.get(key, key)}" for key in keys]
            return "(" + ", ".join(rendered) + ")"
        elif mode == "keys":
            return "[" + ", ".join(keys) + "]"
        else:
            nums = [bib_map.get(key, key) for key in keys]
            return numeric_citation(nums, style)

    for pat in (
        r"\\cite[a-z*]*\{([^}]+)\}",
        r"\\revref\{([^}]+)\}",
        r"\\citep\{([^}]+)\}",
        r"\\citet\{([^}]+)\}",
    ):
        if mode == "numbers" and style[0]:
            pat = r"[ \t~]*" + pat
        text = re.sub(pat, cite_repl, text)

    return text


def replace_refs(text: str, label_map: dict[str, str]) -> str:
    text = re.sub(
        r"\\ref\{([^}]+)\}", lambda m: label_map.get(m.group(1), m.group(1)), text
    )
    text = re.sub(
        r"\\eqref\{([^}]+)\}",
        lambda m: "(" + label_map.get(m.group(1), m.group(1)) + ")",
        text,
    )
    text = re.sub(
        r"\\pageref\{([^}]+)\}",
        lambda m: label_map.get(m.group(1), m.group(1)),
        text,
    )
    return text


def add_caption_prefixes(text: str, label_map: dict[str, str]) -> str:
    def add_caption_numbers(block: str, kind: str) -> str:
        label_match = re.search(r"\\label\{([^}]+)\}", block)
        if not label_match:
            return block
        number = label_map.get(label_match.group(1))
        if not number:
            return block
        prefix = "Figure" if kind == "figure" else "Table"
        return re.sub(
            r"\\caption(\[[^\]]*\])?\{",
            rf"\\caption{{{prefix} {number}. ",
            block,
            count=1,
        )

    for env, kind in (
        ("figure", "figure"),
        ("figure*", "figure"),
        ("table", "table"),
        ("table*", "table"),
        ("longtable", "table"),
    ):
        env_pat = re.compile(
            r"\\begin\{" + re.escape(env) + r"\}.*?\\end\{" + re.escape(env) + r"\}",
            re.S,
        )
        text = env_pat.sub(lambda m: add_caption_numbers(m.group(0), kind), text)
    return text


# ============================================================================
# Post-Processing Word OpenXML Styling
# ============================================================================


def ensure_body_alignment(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    styles_path = "word/styles.xml"
    styles_root = ET.fromstring(files[styles_path])

    ppr_default = styles_root.find(
        f".//{{{NS_W}}}docDefaults/{{{NS_W}}}pPrDefault/{{{NS_W}}}pPr"
    )
    if ppr_default is None:
        doc_defaults = styles_root.find(f".//{{{NS_W}}}docDefaults")
        if doc_defaults is None:
            doc_defaults = ET.SubElement(styles_root, f"{{{NS_W}}}docDefaults")
        ppr_default_parent = doc_defaults.find(f"{{{NS_W}}}pPrDefault")
        if ppr_default_parent is None:
            ppr_default_parent = ET.SubElement(doc_defaults, f"{{{NS_W}}}pPrDefault")
        ppr_default = ET.SubElement(ppr_default_parent, f"{{{NS_W}}}pPr")
    jc_default = ppr_default.find(f"{{{NS_W}}}jc")
    if jc_default is None:
        jc_default = ET.SubElement(ppr_default, f"{{{NS_W}}}jc")
    jc_default.attrib[f"{{{NS_W}}}val"] = "left"

    body_style_ids = {
        "Normal",
        "BodyText",
        "FirstParagraph",
        "Compact",
        "Abstract",
        "Bibliography",
    }
    for style in styles_root.findall(f".//{{{NS_W}}}style"):
        if style.attrib.get(f"{{{NS_W}}}type") != "paragraph":
            continue
        if style.attrib.get(f"{{{NS_W}}}styleId") not in body_style_ids:
            continue
        ppr = style.find(f"{{{NS_W}}}pPr")
        if ppr is None:
            ppr = ET.SubElement(style, f"{{{NS_W}}}pPr")
        jc = ppr.find(f"{{{NS_W}}}jc")
        if jc is None:
            jc = ET.SubElement(ppr, f"{{{NS_W}}}jc")
        jc.attrib[f"{{{NS_W}}}val"] = "left"

    files[styles_path] = ET.tostring(
        styles_root, encoding="utf-8", xml_declaration=True
    )
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def ensure_body_first_line_indent(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    styles_path = "word/styles.xml"
    styles_root = ET.fromstring(files[styles_path])
    body_style_ids = {"Normal", "BodyText", "Compact", "Abstract"}
    for style in styles_root.findall(f".//{{{NS_W}}}style"):
        if style.attrib.get(f"{{{NS_W}}}type") != "paragraph":
            continue
        paragraph_properties = style.find(f"{{{NS_W}}}pPr")
        if paragraph_properties is None:
            paragraph_properties = ET.SubElement(style, f"{{{NS_W}}}pPr")
        indentation = paragraph_properties.find(f"{{{NS_W}}}ind")
        if indentation is None:
            indentation = ET.SubElement(paragraph_properties, f"{{{NS_W}}}ind")
        if style.attrib.get(f"{{{NS_W}}}styleId") in body_style_ids:
            indentation.attrib[f"{{{NS_W}}}firstLine"] = "360"
        else:
            indentation.attrib[f"{{{NS_W}}}firstLine"] = "0"

    files[styles_path] = ET.tostring(
        styles_root, encoding="utf-8", xml_declaration=True
    )
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def ensure_front_matter_alignment(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    def set_left(paragraph_properties: ET.Element) -> None:
        alignment = paragraph_properties.find(f"{{{NS_W}}}jc")
        if alignment is None:
            alignment = ET.SubElement(paragraph_properties, f"{{{NS_W}}}jc")
        alignment.attrib[f"{{{NS_W}}}val"] = "left"

    styles_path = "word/styles.xml"
    styles_root = ET.fromstring(files[styles_path])
    for style in styles_root.findall(f".//{{{NS_W}}}style"):
        if style.attrib.get(f"{{{NS_W}}}styleId") not in {"Title", "Author", "Date"}:
            continue
        paragraph_properties = style.find(f"{{{NS_W}}}pPr")
        if paragraph_properties is None:
            paragraph_properties = ET.SubElement(style, f"{{{NS_W}}}pPr")
        set_left(paragraph_properties)
    files[styles_path] = ET.tostring(
        styles_root, encoding="utf-8", xml_declaration=True
    )

    document_path = "word/document.xml"
    document_root = ET.fromstring(files[document_path])
    for paragraph in document_root.findall(f".//{{{NS_W}}}p"):
        content = "".join(
            node.text or "" for node in paragraph.findall(f".//{{{NS_W}}}t")
        ).strip()
        if content != "Abstract":
            continue
        paragraph_properties = paragraph.find(f"{{{NS_W}}}pPr")
        if paragraph_properties is None:
            paragraph_properties = ET.Element(f"{{{NS_W}}}pPr")
            paragraph.insert(0, paragraph_properties)
        set_left(paragraph_properties)
    files[document_path] = ET.tostring(
        document_root, encoding="utf-8", xml_declaration=True
    )

    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def ensure_author_affiliation_separator_commas(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    document_path = "word/document.xml"
    document_root = ET.fromstring(files[document_path])

    def author_paragraph(paragraph: ET.Element) -> bool:
        style = paragraph.find(f"{{{NS_W}}}pPr/{{{NS_W}}}pStyle")
        return style is not None and style.attrib.get(f"{{{NS_W}}}val") == "Author"

    def add_text_run(
        parent: ET.Element,
        index: int,
        template: ET.Element,
        text: str,
        superscript: bool,
    ) -> int:
        run = ET.Element(f"{{{NS_W}}}r")
        properties = template.find(f"{{{NS_W}}}rPr")
        if properties is not None:
            properties = copy.deepcopy(properties)
            run.append(properties)
        if superscript:
            if properties is None:
                properties = ET.SubElement(run, f"{{{NS_W}}}rPr")
            vertical = properties.find(f"{{{NS_W}}}vertAlign")
            if vertical is None:
                vertical = ET.SubElement(properties, f"{{{NS_W}}}vertAlign")
            vertical.attrib[f"{{{NS_W}}}val"] = "superscript"
        text_node = ET.SubElement(run, f"{{{NS_W}}}t")
        if text[:1].isspace() or text[-1:].isspace():
            text_node.attrib[f"{{{NS_XML}}}space"] = "preserve"
        text_node.text = text
        parent.insert(index, run)
        return index + 1

    for paragraph in document_root.findall(f".//{{{NS_W}}}p"):
        if not author_paragraph(paragraph):
            continue
        for run in list(paragraph.findall(f"{{{NS_W}}}r")):
            text = "".join(node.text or "" for node in run.findall(f"{{{NS_W}}}t"))
            normalized = re.sub(r"\*,\s*(?=[¹²³])", "*", text)
            normalized = re.sub(r"(?<=[¹²³]),\s*(?=[¹²³*])", ",", normalized)
            normalized = re.sub(r"(?<=[¹²³])(?=[¹²³])", ",", normalized)
            if normalized == text and not re.search(r"(?<=[¹²³]),(?=[¹²³])", text):
                continue
            position = list(paragraph).index(run)
            paragraph.remove(run)
            start = 0
            for match in re.finditer(r"(?<=[¹²³]),(?=[¹²³*])", normalized):
                if match.start() > start:
                    position = add_text_run(
                        paragraph,
                        position,
                        run,
                        normalized[start : match.start()],
                        False,
                    )
                position = add_text_run(paragraph, position, run, ",", True)
                start = match.end()
            if start < len(normalized):
                add_text_run(paragraph, position, run, normalized[start:], False)

    files[document_path] = ET.tostring(
        document_root, encoding="utf-8", xml_declaration=True
    )
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def ensure_front_matter_marker_spacing(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    document_path = "word/document.xml"
    document_root = ET.fromstring(files[document_path])
    for paragraph in document_root.findall(f".//{{{NS_W}}}p"):
        style = paragraph.find(f"{{{NS_W}}}pPr/{{{NS_W}}}pStyle")
        if style is None or style.attrib.get(f"{{{NS_W}}}val") != "Date":
            continue
        for text_node in paragraph.findall(f".//{{{NS_W}}}t"):
            if text_node.text:
                text_node.text = re.sub(r"^([¹²³])\s+", r"\1", text_node.text)
                text_node.text = re.sub(
                    r"^Corresponding author:\s*(?:\*\s*)?Correspondence:\s*",
                    "*Correspondence: ",
                    text_node.text,
                )
                text_node.text = re.sub(
                    r"^\*\s+Correspondence:", "*Correspondence:", text_node.text
                )

    files[document_path] = ET.tostring(
        document_root, encoding="utf-8", xml_declaration=True
    )
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def insert_docx_affiliations(docx_path: Path, affils: list[tuple[str, str]]) -> None:
    if not affils:
        return
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    doc_path = "word/document.xml"
    doc_root = ET.fromstring(files[doc_path])
    body = doc_root.find(f"{{{NS_W}}}body")
    if body is None:
        return

    target_p = None
    insert_before = True
    for p in body.findall(f"{{{NS_W}}}p"):
        style = p.find(f"{{{NS_W}}}pPr/{{{NS_W}}}pStyle")
        if style is not None and style.attrib.get(f"{{{NS_W}}}val") == "Date":
            target_p = p
            insert_before = True
            break

    if target_p is None:
        for p in body.findall(f"{{{NS_W}}}p"):
            style = p.find(f"{{{NS_W}}}pPr/{{{NS_W}}}pStyle")
            if style is not None and style.attrib.get(f"{{{NS_W}}}val") == "Author":
                target_p = p
                insert_before = False

    if target_p is None:
        return

    idx = list(body).index(target_p)
    insert_idx = idx if insert_before else idx + 1

    for mark, text in reversed(affils):
        new_p = ET.Element(f"{{{NS_W}}}p")
        pPr = ET.SubElement(new_p, f"{{{NS_W}}}pPr")
        pStyle = ET.SubElement(pPr, f"{{{NS_W}}}pStyle")
        pStyle.attrib[f"{{{NS_W}}}val"] = "Date"

        if mark:
            r_mark = ET.SubElement(new_p, f"{{{NS_W}}}r")
            rPr_mark = ET.SubElement(r_mark, f"{{{NS_W}}}rPr")
            va = ET.SubElement(rPr_mark, f"{{{NS_W}}}vertAlign")
            va.attrib[f"{{{NS_W}}}val"] = "superscript"
            t_mark = ET.SubElement(r_mark, f"{{{NS_W}}}t")
            t_mark.text = mark

        r_text = ET.SubElement(new_p, f"{{{NS_W}}}r")
        t_text = ET.SubElement(r_text, f"{{{NS_W}}}t")
        t_text.attrib[f"{{{NS_XML}}}space"] = "preserve"
        t_text.text = f" {text}" if mark else text

        body.insert(insert_idx, new_p)

    files[doc_path] = ET.tostring(doc_root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def ensure_reference_paragraphs_left_aligned(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    document_path = "word/document.xml"
    document_root = ET.fromstring(files[document_path])
    in_references = False
    for paragraph in document_root.findall(f".//{{{NS_W}}}p"):
        text = "".join(
            node.text or "" for node in paragraph.findall(f".//{{{NS_W}}}t")
        ).strip()
        if text.lower() == "references":
            in_references = True
            continue
        if not in_references or not text:
            continue
        paragraph_properties = paragraph.find(f"{{{NS_W}}}pPr")
        if paragraph_properties is None:
            paragraph_properties = ET.Element(f"{{{NS_W}}}pPr")
            paragraph.insert(0, paragraph_properties)
        indentation = paragraph_properties.find(f"{{{NS_W}}}ind")
        if indentation is None:
            indentation = ET.SubElement(paragraph_properties, f"{{{NS_W}}}ind")
        indentation.attrib[f"{{{NS_W}}}firstLine"] = "0"

    files[document_path] = ET.tostring(
        document_root, encoding="utf-8", xml_declaration=True
    )
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def ensure_times_new_roman(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    styles_path = "word/styles.xml"
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
        if style.attrib.get(f"{{{NS_W}}}type") not in {"paragraph", "character"}:
            continue
        rpr = style.find(f"{{{NS_W}}}rPr")
        if rpr is None:
            rpr = ET.SubElement(style, f"{{{NS_W}}}rPr")
        set_rfonts(rpr)

    files[styles_path] = ET.tostring(
        styles_root, encoding="utf-8", xml_declaration=True
    )
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def ensure_review_page_layout(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    doc_path = "word/document.xml"
    doc_root = ET.fromstring(files[doc_path])
    for section in doc_root.findall(f".//{{{NS_W}}}sectPr"):
        margins = section.find(f"{{{NS_W}}}pgMar")
        if margins is None:
            margins = ET.SubElement(section, f"{{{NS_W}}}pgMar")
        for side in ("top", "right", "bottom", "left"):
            margins.attrib[f"{{{NS_W}}}{side}"] = str(REVIEW_MARGIN_TWIPS)
        margins.attrib[f"{{{NS_W}}}header"] = "720"
        margins.attrib[f"{{{NS_W}}}footer"] = "720"
        margins.attrib[f"{{{NS_W}}}gutter"] = "0"
    files[doc_path] = ET.tostring(doc_root, encoding="utf-8", xml_declaration=True)

    styles_path = "word/styles.xml"
    styles_root = ET.fromstring(files[styles_path])
    for style in styles_root.findall(f".//{{{NS_W}}}style"):
        if style.attrib.get(f"{{{NS_W}}}styleId") != "Caption":
            continue
        run_properties = style.find(f"{{{NS_W}}}rPr")
        if run_properties is None:
            run_properties = ET.SubElement(style, f"{{{NS_W}}}rPr")
        italic = run_properties.find(f"{{{NS_W}}}i")
        if italic is None:
            italic = ET.SubElement(run_properties, f"{{{NS_W}}}i")
        italic.attrib[f"{{{NS_W}}}val"] = "0"
    files[styles_path] = ET.tostring(
        styles_root, encoding="utf-8", xml_declaration=True
    )

    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def _field_character(field_type: str) -> OxmlElement:
    element = OxmlElement("w:fldChar")
    element.set(qn("w:fldCharType"), field_type)
    return element


def _field_instruction(text: str) -> OxmlElement:
    element = OxmlElement("w:instrText")
    element.set(qn("xml:space"), "preserve")
    element.text = text
    return element


def ensure_footer_page_numbers(docx_path: Path) -> None:
    document = Document(docx_path)
    for section in document.sections:
        footer = section.footer
        footer.is_linked_to_previous = False
        paragraph = footer.paragraphs[0]
        paragraph.clear()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        begin = paragraph.add_run()
        begin._r.append(_field_character("begin"))
        instruction = paragraph.add_run()
        instruction._r.append(_field_instruction(" PAGE "))
        separator = paragraph.add_run()
        separator._r.append(_field_character("separate"))
        paragraph.add_run("1")
        end = paragraph.add_run()
        end._r.append(_field_character("end"))
    document.save(docx_path)


def source_review_font_size(tex: str) -> int:
    """Honor explicit standard class sizes, retaining the legacy review fallback."""
    tex = re.sub(r"(?m)(?<!\\)%.*$", "", tex)
    match = re.search(r"\\documentclass\s*\[([^]]*)\]", tex)
    if match:
        for option in match[1].split(","):
            size = re.fullmatch(r"(10|11|12)pt", option.strip())
            if size:
                return int(size[1])
    return 12


def ensure_uniform_type_size(docx_path: Path, points: int) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    def set_size(run_properties: ET.Element) -> None:
        for tag in ("sz", "szCs"):
            size = run_properties.find(f"{{{NS_W}}}{tag}")
            if size is None:
                size = ET.SubElement(run_properties, f"{{{NS_W}}}{tag}")
            size.attrib[f"{{{NS_W}}}val"] = str(points * 2)  # Word uses half-points.

    styles_path = "word/styles.xml"
    styles_root = ET.fromstring(files[styles_path])
    for style in styles_root.findall(f".//{{{NS_W}}}style"):
        if style.attrib.get(f"{{{NS_W}}}type") not in {
            "paragraph",
            "character",
            "table",
        }:
            continue
        run_properties = style.find(f"{{{NS_W}}}rPr")
        if run_properties is None:
            run_properties = ET.SubElement(style, f"{{{NS_W}}}rPr")
        set_size(run_properties)
    for run_properties in styles_root.findall(
        f".//{{{NS_W}}}docDefaults/{{{NS_W}}}rPrDefault/{{{NS_W}}}rPr"
    ):
        set_size(run_properties)
    files[styles_path] = ET.tostring(
        styles_root, encoding="utf-8", xml_declaration=True
    )

    for path, content in list(files.items()):
        if not path.startswith("word/") or not path.endswith(".xml"):
            continue
        root = ET.fromstring(content)
        changed = False
        for run_properties in root.findall(f".//{{{NS_W}}}rPr"):
            set_size(run_properties)
            changed = True
        if changed:
            files[path] = ET.tostring(root, encoding="utf-8", xml_declaration=True)

    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def ensure_one_and_half_line_spacing(docx_path: Path) -> None:
    document = Document(docx_path)

    def set_spacing(paragraphs, tables) -> None:
        for paragraph in paragraphs:
            paragraph.paragraph_format.line_spacing = 1.5
        for table in tables:
            for row in table.rows:
                for cell in row.cells:
                    set_spacing(cell.paragraphs, cell.tables)

    set_spacing(document.paragraphs, document.tables)
    for section in document.sections:
        set_spacing(section.header.paragraphs, section.header.tables)
        set_spacing(section.footer.paragraphs, section.footer.tables)
    document.save(docx_path)


def ensure_heading_emphasis(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    styles_path = "word/styles.xml"
    styles_root = ET.fromstring(files[styles_path])
    for style in styles_root.findall(f".//{{{NS_W}}}style"):
        style_id = style.attrib.get(f"{{{NS_W}}}styleId", "")
        if style_id != "Title" and not style_id.startswith("Heading"):
            continue
        run_properties = style.find(f"{{{NS_W}}}rPr")
        if run_properties is None:
            run_properties = ET.SubElement(style, f"{{{NS_W}}}rPr")
        bold = run_properties.find(f"{{{NS_W}}}b")
        if bold is None:
            bold = ET.SubElement(run_properties, f"{{{NS_W}}}b")
        bold.attrib[f"{{{NS_W}}}val"] = "1"
        color = run_properties.find(f"{{{NS_W}}}color")
        if color is None:
            color = ET.SubElement(run_properties, f"{{{NS_W}}}color")
        color.attrib[f"{{{NS_W}}}val"] = "000000"

    files[styles_path] = ET.tostring(
        styles_root, encoding="utf-8", xml_declaration=True
    )
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def ensure_author_metadata_upright(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    styles_path = "word/styles.xml"
    styles_root = ET.fromstring(files[styles_path])
    for style in styles_root.findall(f".//{{{NS_W}}}style"):
        if style.attrib.get(f"{{{NS_W}}}styleId") not in {"Author", "Date"}:
            continue
        run_properties = style.find(f"{{{NS_W}}}rPr")
        if run_properties is None:
            run_properties = ET.SubElement(style, f"{{{NS_W}}}rPr")
        bold = run_properties.find(f"{{{NS_W}}}b")
        if bold is None:
            bold = ET.SubElement(run_properties, f"{{{NS_W}}}b")
        bold.attrib[f"{{{NS_W}}}val"] = "0"

    files[styles_path] = ET.tostring(
        styles_root, encoding="utf-8", xml_declaration=True
    )
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def format_tables_for_review_docx(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    doc_path = "word/document.xml"
    doc_root = ET.fromstring(files[doc_path])
    changed = False

    def ensure_child(parent: ET.Element, tag: str) -> ET.Element:
        child = parent.find(tag)
        if child is None:
            child = ET.SubElement(parent, tag)
        return child

    for tbl in doc_root.findall(f".//{{{NS_W}}}tbl"):
        tbl_pr = tbl.find(f"{{{NS_W}}}tblPr")
        if tbl_pr is None:
            tbl_pr = ET.Element(f"{{{NS_W}}}tblPr")
            tbl.insert(0, tbl_pr)

        tbl_w = ensure_child(tbl_pr, f"{{{NS_W}}}tblW")
        tbl_w.attrib[f"{{{NS_W}}}type"] = "pct"
        tbl_w.attrib[f"{{{NS_W}}}w"] = "5000"

        tbl_layout = ensure_child(tbl_pr, f"{{{NS_W}}}tblLayout")
        tbl_layout.attrib[f"{{{NS_W}}}type"] = "autofit"

        tbl_borders = ensure_child(tbl_pr, f"{{{NS_W}}}tblBorders")
        for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
            border = ensure_child(tbl_borders, f"{{{NS_W}}}{edge}")
            border.attrib[f"{{{NS_W}}}val"] = "single"
            border.attrib[f"{{{NS_W}}}sz"] = "4"
            border.attrib[f"{{{NS_W}}}space"] = "0"
            border.attrib[f"{{{NS_W}}}color"] = "000000"

        cell_mar = ensure_child(tbl_pr, f"{{{NS_W}}}tblCellMar")
        for side in ("top", "left", "bottom", "right"):
            mar = ensure_child(cell_mar, f"{{{NS_W}}}{side}")
            mar.attrib[f"{{{NS_W}}}type"] = "dxa"
            mar.attrib[f"{{{NS_W}}}w"] = "80"

        changed = True

    if not changed:
        return

    files[doc_path] = ET.tostring(doc_root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def source_figure_width_fractions(tex_path: Path) -> dict[str, float]:
    widths: dict[str, float] = {}
    if not tex_path.exists():
        return widths
    text = tex_path.read_text(encoding="utf-8", errors="ignore")
    pattern = re.compile(r"\\includegraphics\[(?P<options>[^]]*)\]\{(?P<path>[^}]+)\}")
    for match in pattern.finditer(text):
        width_match = re.search(
            r"(?:^|,)\s*width\s*=\s*(?:(?P<fraction>[0-9]*\.?[0-9]+)\s*)?\\(?:textwidth|linewidth)",
            match.group("options"),
        )
        if width_match is None:
            continue
        fraction = float(width_match.group("fraction") or "1")
        widths[Path(match.group("path")).stem] = fraction
    return widths


def fit_specific_figures(docx_path: Path, source_tex: Path) -> None:
    ns = {
        "w": NS_W,
        "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    }
    ET.register_namespace("wp", ns["wp"])
    ET.register_namespace("a", ns["a"])
    ET.register_namespace("pic", ns["pic"])

    source_widths = source_figure_width_fractions(source_tex)

    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    doc_path = "word/document.xml"
    doc_root = ET.fromstring(files[doc_path])
    section = doc_root.find(f".//{{{NS_W}}}sectPr")
    page_size = section.find(f"{{{NS_W}}}pgSz") if section is not None else None
    margins = section.find(f"{{{NS_W}}}pgMar") if section is not None else None
    page_width_twips = (
        int(page_size.attrib.get(f"{{{NS_W}}}w", "12240"))
        if page_size is not None
        else 12240
    )
    left_margin_twips = (
        int(margins.attrib.get(f"{{{NS_W}}}left", str(REVIEW_MARGIN_TWIPS)))
        if margins is not None
        else REVIEW_MARGIN_TWIPS
    )
    right_margin_twips = (
        int(margins.attrib.get(f"{{{NS_W}}}right", str(REVIEW_MARGIN_TWIPS)))
        if margins is not None
        else REVIEW_MARGIN_TWIPS
    )
    usable_width_emu = (
        page_width_twips - left_margin_twips - right_margin_twips
    ) * TWIPS_TO_EMU
    parent_map = {child: parent for parent in doc_root.iter() for child in parent}
    changed = False

    for inline in doc_root.findall(".//wp:inline", ns):
        c_nv_pr = inline.find(".//pic:cNvPr", ns)
        if c_nv_pr is None:
            continue
        descr = c_nv_pr.attrib.get("descr", "")
        extent = inline.find("wp:extent", ns)
        pic_ext = inline.find(".//a:xfrm/a:ext", ns)
        if extent is None:
            continue
        cx = int(extent.attrib.get("cx", "0"))
        cy = int(extent.attrib.get("cy", "0"))
        if cx <= 0 or cy <= 0:
            continue

        stem = Path(descr).stem
        intended_width = usable_width_emu * source_widths.get(
            stem, cx / usable_width_emu
        )
        width_limit = min(int(round(intended_width)), usable_width_emu)
        if cx > width_limit or (intended_width != cx and intended_width > 0):
            scale = width_limit / cx
            new_cx = int(round(cx * scale))
            new_cy = int(round(cy * scale))
            extent.set("cx", str(new_cx))
            extent.set("cy", str(new_cy))
            if pic_ext is not None:
                pic_ext.set("cx", str(new_cx))
                pic_ext.set("cy", str(new_cy))

        node = inline
        para = None
        while node is not None:
            node = parent_map.get(node)
            if node is not None and node.tag == f"{{{NS_W}}}p":
                para = node
                break
        if para is not None and para.tag == f"{{{NS_W}}}p":
            ppr = para.find(f"{{{NS_W}}}pPr")
            if ppr is None:
                ppr = ET.Element(f"{{{NS_W}}}pPr")
                para.insert(0, ppr)
            jc = ppr.find(f"{{{NS_W}}}jc")
            if jc is None:
                jc = ET.SubElement(ppr, f"{{{NS_W}}}jc")
            jc.attrib[f"{{{NS_W}}}val"] = "center"

        changed = True

    if not changed:
        return

    files[doc_path] = ET.tostring(doc_root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def color_revision_runs(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    doc_path = "word/document.xml"
    doc_root = ET.fromstring(files[doc_path])

    def run_text(run: ET.Element) -> str:
        return "".join(t.text or "" for t in run.findall(f".//{{{NS_W}}}t"))

    def set_run_text(run: ET.Element, text: str) -> None:
        ts = run.findall(f".//{{{NS_W}}}t")
        if not ts:
            t = ET.SubElement(run, f"{{{NS_W}}}t")
            t.text = text
            return
        ts[0].text = text
        for extra in ts[1:]:
            extra.text = ""

    def set_run_color(run: ET.Element, hex_color: str) -> None:
        rpr = run.find(f"{{{NS_W}}}rPr")
        if rpr is None:
            rpr = ET.Element(f"{{{NS_W}}}rPr")
            run.insert(0, rpr)
        color = rpr.find(f"{{{NS_W}}}color")
        if color is None:
            color = ET.SubElement(rpr, f"{{{NS_W}}}color")
        color.attrib[f"{{{NS_W}}}val"] = hex_color

    parent_map = {child: parent for parent in doc_root.iter() for child in parent}
    color_stack: list[str] = []

    def apply_style(run: ET.Element) -> None:
        colours = [colour for colour in color_stack if colour != "highlight"]
        if colours:
            set_run_color(run, colours[-1])
        if "highlight" in color_stack:
            rpr = run.find(f"{{{NS_W}}}rPr")
            if rpr is None:
                rpr = ET.Element(f"{{{NS_W}}}rPr")
                run.insert(0, rpr)
            highlight = rpr.find(f"{{{NS_W}}}highlight")
            if highlight is None:
                highlight = ET.SubElement(rpr, f"{{{NS_W}}}highlight")
            highlight.set(f"{{{NS_W}}}val", "yellow")

    math_namespace = "http://schemas.openxmlformats.org/officeDocument/2006/math"
    for run in [
        node
        for node in doc_root.iter()
        if node.tag in {f"{{{NS_W}}}r", f"{{{math_namespace}}}oMath"}
    ]:
        if run.tag == f"{{{math_namespace}}}oMath":
            if color_stack:
                for math_run in run.findall(f".//{{{math_namespace}}}r"):
                    apply_style(math_run)
                    # OMML run properties precede the Word font/color properties.
                    math_properties = math_run.find(f"{{{math_namespace}}}rPr")
                    if math_properties is not None:
                        math_run.remove(math_properties)
                        math_run.insert(0, math_properties)
                # Large operators, fraction bars and radicals use their own
                # control properties rather than the contained text runs.
                for kind in ("nary", "f", "rad", "d"):
                    for container in run.findall(f".//{{{math_namespace}}}{kind}"):
                        properties = container.find(f"{{{math_namespace}}}{kind}Pr")
                        if properties is None:
                            properties = ET.Element(f"{{{math_namespace}}}{kind}Pr")
                            container.insert(0, properties)
                        control = properties.find(f"{{{math_namespace}}}ctrlPr")
                        if control is None:
                            control = ET.SubElement(
                                properties, f"{{{math_namespace}}}ctrlPr"
                            )
                        apply_style(control)
            continue
        parent = parent_map.get(run)
        if parent is None:
            continue
        text = run_text(run)
        if not text:
            continue

        has_marker = any(m in text for m in COLOR_MARKERS)
        if not has_marker:
            if color_stack:
                apply_style(run)
            continue

        replacement_runs: list[ET.Element] = []
        remaining = text
        template = ET.fromstring(ET.tostring(run))

        while remaining:
            earliest_idx = -1
            earliest_marker = None
            for m in COLOR_MARKERS:
                idx = remaining.find(m)
                if idx != -1 and (earliest_idx == -1 or idx < earliest_idx):
                    earliest_idx = idx
                    earliest_marker = m

            if earliest_idx == -1:
                if remaining:
                    clone = ET.fromstring(ET.tostring(template))
                    set_run_text(clone, remaining)
                    if color_stack:
                        apply_style(clone)
                    replacement_runs.append(clone)
                break

            if earliest_idx > 0:
                segment = remaining[:earliest_idx]
                clone = ET.fromstring(ET.tostring(template))
                set_run_text(clone, segment)
                if color_stack:
                    apply_style(clone)
                replacement_runs.append(clone)

            action, col = COLOR_MARKERS[earliest_marker]
            if action == "START":
                color_stack.append(col)
            elif action == "END" and color_stack:
                color_stack.pop()

            remaining = remaining[earliest_idx + len(earliest_marker) :]

        siblings = list(parent)
        insert_at = siblings.index(run)
        parent.remove(run)
        for offset, replacement in enumerate(replacement_runs):
            parent.insert(insert_at + offset, replacement)

    files[doc_path] = ET.tostring(doc_root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def normalize_visible_symbol_runs(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    doc_path = "word/document.xml"
    doc_root = ET.fromstring(files[doc_path])

    replacements = (
        ("<=", "≤"),
        (">=", "≥"),
        ("->", "→"),
        ("ΔΔ GFmax", "ΔΔGFmax"),
        ("ΔΔ G", "ΔΔG"),
        ("Mg2+", "Mg²+"),
    )

    changed = False
    for t in doc_root.findall(f".//{{{NS_W}}}t"):
        value = t.text or ""
        new_value = value
        for old, new in replacements:
            new_value = new_value.replace(old, new)
        if new_value != value:
            t.text = new_value
            changed = True

    for node in doc_root.iter():
        for key, value in list(node.attrib.items()):
            new_value = value
            for old, new in replacements:
                new_value = new_value.replace(old, new)
            new_value = new_value.replace(r"C\alpha", "Cα")
            new_value = new_value.replace(r"\alpha", "α")
            if new_value != value:
                node.attrib[key] = new_value
                changed = True

    if not changed:
        return

    files[doc_path] = ET.tostring(doc_root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def ensure_heading_number_spacing(docx_path: Path) -> None:
    with zipfile.ZipFile(docx_path, "r") as zin:
        files = {name: zin.read(name) for name in zin.namelist()}

    doc_path = "word/document.xml"
    doc_root = ET.fromstring(files[doc_path])
    changed = False

    heading_num = re.compile(r"^\d+(?:\.\d+)*$")
    heading_num_text = re.compile(r"^(\d+(?:\.\d+)*)([A-Za-z].*)$")

    for para in doc_root.findall(f".//{{{NS_W}}}p"):
        pstyle = para.find(f"./{{{NS_W}}}pPr/{{{NS_W}}}pStyle")
        if pstyle is None:
            continue
        style_id = pstyle.attrib.get(f"{{{NS_W}}}val", "")
        if not style_id.startswith("Heading"):
            continue

        text_nodes = para.findall(f".//{{{NS_W}}}t")
        if not text_nodes:
            continue

        first = text_nodes[0].text or ""
        if heading_num.match(first) and len(text_nodes) > 1:
            second = text_nodes[1].text or ""
            if second and not second.startswith((" ", "\t")):
                text_nodes[1].text = " " + second
                text_nodes[1].attrib[f"{{{NS_XML}}}space"] = "preserve"
                changed = True
            continue

        match = heading_num_text.match(first)
        if match:
            text_nodes[0].text = f"{match.group(1)} {match.group(2)}"
            text_nodes[0].attrib[f"{{{NS_XML}}}space"] = "preserve"
            changed = True

    if not changed:
        return

    files[doc_path] = ET.tostring(doc_root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zout:
        for name, content in files.items():
            zout.writestr(name, content)


def add_docx_left_margin_line_numbers(docx_path: Path) -> None:
    """Enable native continuous left-margin line numbers in DOCX."""
    with zipfile.ZipFile(docx_path, "r") as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    document_name = "word/document.xml"
    root = ET.fromstring(members[document_name])
    for section in root.findall(f".//{{{NS_W}}}sectPr"):
        line_numbers = section.find(f"{{{NS_W}}}lnNumType")
        if line_numbers is None:
            line_numbers = ET.Element(f"{{{NS_W}}}lnNumType")
            section.append(line_numbers)
        line_numbers.attrib[f"{{{NS_W}}}countBy"] = "1"
        line_numbers.attrib[f"{{{NS_W}}}distance"] = "360"
        line_numbers.attrib[f"{{{NS_W}}}restart"] = "continuous"

        order = {
            "headerReference": 10,
            "footerReference": 20,
            "footnotePr": 30,
            "endnotePr": 40,
            "type": 50,
            "pgSz": 60,
            "pgMar": 70,
            "paperSrc": 80,
            "pgBorders": 90,
            "lnNumType": 100,
            "pgNumType": 110,
            "cols": 120,
            "formProt": 130,
            "vAlign": 140,
            "noEndnote": 150,
            "titlePg": 160,
            "textDirection": 170,
            "bidi": 180,
            "rtlGutter": 190,
            "docGrid": 200,
            "printerSettings": 210,
            "sectPrChange": 220,
        }
        children = list(section)
        for child in children:
            section.remove(child)
        for _, child in sorted(
            enumerate(children),
            key=lambda item: (order.get(item[1].tag.rsplit("}", 1)[-1], 999), item[0]),
        ):
            section.append(child)
    members[document_name] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    # Header/footer paragraphs are outside manuscript line numbering. Some
    # Word-compatible renderers otherwise assign them a separate counter.
    for name, content in list(members.items()):
        if not re.fullmatch(r"word/(?:header|footer)\d+\.xml", name):
            continue
        part = ET.fromstring(content)
        for paragraph in part.findall(f".//{{{NS_W}}}p"):
            properties = paragraph.find(f"{{{NS_W}}}pPr")
            if properties is None:
                properties = ET.Element(f"{{{NS_W}}}pPr")
                paragraph.insert(0, properties)
            suppress = properties.find(f"{{{NS_W}}}suppressLineNumbers")
            if suppress is None:
                suppress = ET.SubElement(properties, f"{{{NS_W}}}suppressLineNumbers")
            suppress.set(f"{{{NS_W}}}val", "1")
        members[name] = ET.tostring(part, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in members.items():
            archive.writestr(name, content)


def handle_authblk_front_matter(
    tex: str,
) -> tuple[str, list[tuple[str, str]]]:
    """Parse authblk authors and affiliations for pandoc docx conversion.

    Returns the modified tex (with unified \\author{...} containing superscripts)
    and a list of (mark, affiliation_text) tuples to be inserted into the docx.
    """
    affil_pattern = re.compile(r"\\affil\s*(?:\[(.*?)\])?\s*\{([^}]+)\}", re.DOTALL)
    author_pattern = re.compile(r"\\author\s*(?:\[(.*?)\])?\s*\{([^}]+)\}", re.DOTALL)

    affil_matches = list(affil_pattern.finditer(tex))
    author_matches = list(author_pattern.finditer(tex))

    if not affil_matches and not any(m.group(1) for m in author_matches):
        return tex, []

    affils: list[tuple[str, str]] = []
    for m in affil_matches:
        mark = m.group(1) or ""
        mark = mark.replace(r"\affilmarksep", ",").replace(" ", "").strip()
        text = re.sub(r"\s+", " ", m.group(2)).strip()
        affils.append((mark, text))

    authors: list[str] = []
    for m in author_matches:
        marks = m.group(1) or ""
        marks = marks.replace(r"\affilmarksep", ",").replace(" ", "").strip()
        name = re.sub(r"\s+", " ", m.group(2)).strip()
        if marks:
            authors.append(f"{name}\\textsuperscript{{{marks}}}")
        else:
            authors.append(name)

    cleaned_tex = affil_pattern.sub("", tex)
    cleaned_tex = author_pattern.sub("", cleaned_tex)
    cleaned_tex = re.sub(r"\\renewcommand\\AB@authnote\{[^}]*\}", "", cleaned_tex)
    cleaned_tex = re.sub(
        r"\\DeclareRobustCommand\{\\affilmarksep\}\{[^}]*\}", "", cleaned_tex
    )

    unified_author = "\\author{" + ", ".join(authors) + "}\n"
    if r"\date" in cleaned_tex:
        cleaned_tex = cleaned_tex.replace(r"\date", unified_author + r"\date", 1)
    elif r"\begin{document}" in cleaned_tex:
        cleaned_tex = cleaned_tex.replace(
            r"\begin{document}", unified_author + r"\begin{document}", 1
        )
    else:
        cleaned_tex = unified_author + cleaned_tex

    return cleaned_tex, affils


# ============================================================================
# Main Controller
# ============================================================================


def convert(
    tex_path: Path,
    out_docx: Path,
    native_inline_math: bool = False,
    cite_mode: str = "numbers",
) -> None:
    tex_path = tex_path.resolve()
    out_docx = out_docx.resolve()
    repo_root = tex_path.parent
    stem = tex_path.stem

    aux_candidates = [
        repo_root / f"{stem}.aux",
        repo_root / ".aspyrus_build" / f"{stem}.aux",
        repo_root / ".localleaf_build" / f"{stem}.aux",
    ]
    aux_path = next((c for c in aux_candidates if c.is_file()), aux_candidates[0])

    bbl_candidates = [
        repo_root / f"{stem}.bbl",
        repo_root / ".aspyrus_build" / f"{stem}.bbl",
        repo_root / ".localleaf_build" / f"{stem}.bbl",
    ]
    bbl_path = next((c for c in bbl_candidates if c.is_file()), bbl_candidates[0])

    label_map: dict[str, str] = {}
    bib_map: dict[str, str] = {}
    bbl_text = ""

    if aux_path.exists():
        aux_text = aux_path.read_text(encoding="utf-8", errors="ignore")
        label_map = load_label_map(repo_root, stem)
        bib_map = parse_bib_map(aux_text)
    else:
        print(
            f"Note: {aux_path.name} not found. Run pdflatex first to resolve numeric cross-references."
        )

    if bbl_path.exists():
        bbl_text = bbl_path.read_text(encoding="utf-8", errors="ignore")
        bbl_text = clean_achemso_bbl(bbl_text, bib_map)
    else:
        print(
            f"Note: {bbl_path.name} not found. Run bibtex first to resolve numeric bibliography."
        )

    tex = expand_inputs(tex_path, repo_root)
    font_points = source_review_font_size(tex)
    tex = mark_rev_spans(tex)
    tex = unwrap_resizebox(tex)
    tex = flatten_singlecol_nested_tabular(tex)
    tex = simplify_longtable_for_docx(tex)
    tex = replace_paths(tex)

    if bbl_text:
        tex = re.sub(
            r"\\bibliographystyle\{[^}]+\}\s*\\bibliography\{[^}]+\}",
            lambda _m: "\\section*{References}\n" + bbl_text,
            tex,
            flags=re.S,
        )

    doi_map = load_doi_map(repo_root) if cite_mode == "dois" else {}
    tex = re.sub(r"\\revref\{([^}]*)\}", r"\\cite{\1}", tex)
    tex = replace_citations(tex, bib_map, mode=cite_mode, doi_map=doi_map)
    if label_map:
        tex = replace_refs(tex, label_map)
        tex = add_caption_prefixes(tex, label_map)

    tex, affils = handle_authblk_front_matter(tex)

    tex = tex.replace(
        r"\DeclareRobustCommand{\affilmarksep}{\raisebox{0.35ex}{,}}",
        "",
    )
    tex = tex.replace("\\affilmarksep", ",")

    # Pandoc does not recognize upgreek commands. Explicit labels become plain
    # math runs, while ordinary Greek variables retain native math styling.
    greek_names = (
        "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota "
        "kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon "
        "phi varphi chi psi omega"
    ).split()
    for name in greek_names:
        tex = re.sub(
            r"\\up" + name + r"(?![A-Za-z])",
            lambda _m, name=name: r"\mathrm{" + "\\" + name + "}",
            tex,
        )
    for name in ("Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega").split():
        tex = re.sub(
            r"\\Up" + name.lower() + r"(?![A-Za-z])",
            lambda _m, name=name: r"\mathrm{" + "\\" + name + "}",
            tex,
        )

    if not native_inline_math:
        tex = linearize_inline_math_for_docx(tex)
    else:
        tex = normalize_native_inline_math(tex)
    tex = normalize_unit_macros_for_docx(tex)
    tex = re.sub(
        r"(?<![A-Za-z0-9\\])~(\s*[0-9]+(?:\.[0-9]+)?%?)",
        r" \\textasciitilde{}\1",
        tex,
    )

    tmp_source = out_docx.parent / f"._tmp_{stem}_docx_source.tex"
    tmp_source.write_text(tex, encoding="utf-8")

    out_docx.parent.mkdir(parents=True, exist_ok=True)
    conversion_ok = False
    try:
        pypandoc.convert_file(
            str(tmp_source),
            to="docx",
            format="latex",
            outputfile=str(out_docx),
            extra_args=[
                "--standalone",
                f"--resource-path={repo_root}:{out_docx.parent}",
            ],
        )
        insert_docx_affiliations(out_docx, affils)
        ensure_body_alignment(out_docx)
        ensure_body_first_line_indent(out_docx)
        ensure_front_matter_alignment(out_docx)
        ensure_author_affiliation_separator_commas(out_docx)
        ensure_front_matter_marker_spacing(out_docx)
        ensure_reference_paragraphs_left_aligned(out_docx)
        ensure_times_new_roman(out_docx)
        ensure_review_page_layout(out_docx)
        ensure_footer_page_numbers(out_docx)
        ensure_uniform_type_size(out_docx, font_points)
        ensure_one_and_half_line_spacing(out_docx)
        ensure_heading_emphasis(out_docx)
        ensure_author_metadata_upright(out_docx)
        format_tables_for_review_docx(out_docx)
        fit_specific_figures(out_docx, tex_path)
        color_revision_runs(out_docx)
        normalize_visible_symbol_runs(out_docx)
        ensure_heading_number_spacing(out_docx)
        add_docx_left_margin_line_numbers(out_docx)
        conversion_ok = True
    finally:
        if conversion_ok and tmp_source.exists():
            tmp_source.unlink()


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent

    if args.input_tex is None:
        target_tex = repo_root / "main.tex"
        if not target_tex.exists():
            # Fallback to current working directory
            target_tex = Path.cwd() / "main.tex"
    else:
        target_tex = Path(args.input_tex)
        if not target_tex.is_absolute():
            target_tex = (Path.cwd() / target_tex).resolve()

    if not target_tex.exists():
        print(f"Error: Manuscript TeX file not found: {target_tex}", file=sys.stderr)
        return 1

    if args.render_tex:
        out_tex = (
            Path(args.out_tex).resolve()
            if args.out_tex
            else target_tex.parent / f"._tmp_render_{target_tex.name}"
        )
        content = target_tex.read_text(encoding="utf-8")
        aux_path = target_tex.parent / f"{target_tex.stem}.aux"
        bib_map = (
            parse_bib_map(aux_path.read_text(encoding="utf-8", errors="ignore"))
            if aux_path.exists()
            else {}
        )
        doi_map = load_doi_map(target_tex.parent)
        rendered = replace_citations(content, bib_map, mode=args.mode, doi_map=doi_map)
        out_tex.write_text(rendered, encoding="utf-8")
        print(f"=== [✓] Rendered TeX: {out_tex} (mode: {args.mode}) ===")
        return 0

    if args.out:
        out_docx = Path(args.out).resolve()
    else:
        out_docx = target_tex.parent / f"{target_tex.stem}.docx"

    print(f"Exporting {target_tex.name} -> {out_docx.name} (mode: {args.mode})...")
    convert(
        target_tex,
        out_docx,
        native_inline_math=args.native_inline_math,
        cite_mode=args.mode,
    )
    print(f"=== [✓] Successfully wrote review deliverable: {out_docx} ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

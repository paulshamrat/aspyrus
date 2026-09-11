#!/usr/bin/env python3
"""High-fidelity LaTeX to DOCX exporter for LocalLeaf.

Supports two complementary generation engines:
1. Direct AST CV / Resume Engine:
   - Matches LaTeX CV geometry and typography 1-to-1.
   - Preserves 0.46in / 0.38in margins from LaTeX preamble.
   - Centered 16pt bold contact header with active hyperlinks.
   - Word tab stops for `\\hfill` dates snapping flush to right margin.
   - Borderless tabulars with exact column dimensions.
   - Running header and dynamic "Page X of Y" Word XML footers.
   - Compact bullet and numbered lists matching enumitem / setlist.
   - Full support for `\\ifbps` conditionals, nested bold/italics, and math superscripts.

2. Scientific Manuscript Engine (Pandoc + Postprocessing):
   - Unwraps `\\resizebox` to preserve wide tables without Pandoc dropping them.
   - Resolves `\\ref` and `\\cite` using build `.aux` / `.bbl` to avoid broken "??" references.
   - Linearizes inline LaTeX mathematics into clean Unicode text.
   - Translates sub/superscripts and Greek letters cleanly.
   - Applies consistent academic styling via python-docx and OpenXML styles.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import docx
import pypandoc
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import parse_xml
from docx.shared import Inches, Pt, RGBColor

NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ET.register_namespace("w", NS_W)

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
        "*": "∗",
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
                return source[start_idx + 1 : idx], idx + 1
        idx += 1
    return None, start_idx


def to_inches(val_str: str) -> Inches | None:
    val_str = val_str.strip().lower()
    if val_str.endswith("in"):
        return Inches(float(val_str[:-2]))
    if val_str.endswith("cm"):
        return Inches(float(val_str[:-2]) / 2.54)
    if val_str.endswith("mm"):
        return Inches(float(val_str[:-2]) / 25.4)
    if val_str.endswith("pt"):
        return Inches(float(val_str[:-2]) / 72.0)
    return None


def unwrap_fontsize(text: str) -> str:
    pat = re.compile(r"\{\\fontsize\{[^}]+\}\{[^}]+\}\\selectfont\s*")
    while True:
        m = pat.search(text)
        if not m:
            break
        start_pos = m.start()
        end_pos = m.end()
        content, next_idx = parse_brace_block(text, start_pos)
        if content is not None:
            inner = content[len(m.group(0)) - 1 :]
            text = text[:start_pos] + inner + text[next_idx:]
        else:
            text = text[:start_pos] + text[end_pos:]
    return text


def add_xml_field(paragraph, text_before: str, field_str: str, text_after: str = "") -> None:
    r_before = paragraph.add_run(text_before)
    r_before.font.name = "Times New Roman"
    r_before.font.size = Pt(8.5)
    r_before.font.color.rgb = RGBColor(110, 110, 110)

    fldSimple = parse_xml(
        f'<w:fldSimple xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:instr="{field_str}"/>'
    )
    paragraph._p.append(fldSimple)

    if text_after:
        r_after = paragraph.add_run(text_after)
        r_after.font.name = "Times New Roman"
        r_after.font.size = Pt(8.5)
        r_after.font.color.rgb = RGBColor(110, 110, 110)


def clean_cv_text(s: str) -> str:
    s = s.replace(r"\$", "___DOLLAR___")
    s = s.replace(r"\%", "%")
    s = s.replace(r"\&", "&")
    s = s.replace(r"\_", "_")
    s = s.replace(r"\#", "#")
    s = s.replace(r"---", "—")
    s = s.replace(r"--", "–")
    s = s.replace(r"\\", "")
    s = re.sub(r"\\LaTeX\\?\b", "LaTeX", s)
    s = re.sub(r"\\TeX\\?\b", "TeX", s)
    s = re.sub(r"\\(?:l?dots)\b", "…", s)
    s = re.sub(r"\\quad|\\qquad|~", " ", s)
    s = re.sub(r"\\cdot|\$\s*\\cdot\s*\$", " · ", s)
    s = re.sub(r"\$\s*\\;?\\vert\\;?\s*\$|\\vert", " | ", s)
    s = re.sub(r"\$\^\{\*\}\$|\$\^\*\$", "∗", s)
    s = re.sub(r"\$\^\{\\dagger\}\$|\$\^\\dagger\$", "†", s)
    s = re.sub(r"\$\^\{([^}]+)\}\$", lambda m: _translate_superscript(m.group(1)), s)
    s = re.sub(r"\$_\{([^}]+)\}\$", lambda m: _translate_subscript(m.group(1)), s)
    s = s.replace("___DOLLAR___", "$")
    s = re.sub(r"\\selectfont\b", "", s)
    s = re.sub(r"\\par\b", "", s)
    s = re.sub(r"\\noindent\b", "", s)
    s = re.sub(r"\\vspace\*?\{[^}]*\}", "", s)
    s = re.sub(r"\\hspace\*?\{[^}]*\}", "", s)
    s = re.sub(
        r"\\(small|footnotesize|scriptsize|large|Large|LARGE|huge|Huge|normalsize|centering)\b",
        "",
        s,
    )
    s = re.sub(r"\[\d+(\.\d+)?(pt|em|ex|cm|mm|in)\]", "", s)
    s = s.replace("{", "").replace("}", "")
    return s


def add_hyperlink(paragraph, url: str, text: str, size: float = 9.5) -> None:
    part = paragraph.part
    r_id = part.relate_to(url, docx.opc.constants.RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    hyperlink = parse_xml(
        f'<w:hyperlink xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        f'r:id="{r_id}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>'
    )
    new_run = parse_xml(
        f'<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:rPr>'
        f'<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>'
        f'<w:color w:val="004F87"/><w:u w:val="single"/><w:sz w:val="{int(size * 2)}"/>'
        f"</w:rPr><w:t>{escape(text)}</w:t></w:r>"
    )
    hyperlink.append(new_run)
    paragraph._p.append(hyperlink)


def add_runs(
    paragraph,
    text: str,
    base_size: float = 9.5,
    base_bold: bool = False,
    base_italic: bool = False,
    base_underline: bool = False,
) -> None:
    def visit(
        source,
        size,
        bold,
        italic,
        underline,
        family="Times New Roman",
        strike=False,
        superscript=False,
        subscript=False,
    ):
        idx = 0

        def emit(value):
            value = clean_cv_text(value)
            if not value:
                return
            run = paragraph.add_run(value)
            run.bold, run.italic, run.underline = bold, italic, underline
            run.font.name, run.font.size = family, Pt(size)
            run.font.strike = strike
            run.font.superscript, run.font.subscript = superscript, subscript
            run.font.color.rgb = RGBColor(0, 0, 0)

        while idx < len(source):
            if source[idx] == "{":
                inner, end = parse_brace_block(source, idx)
                if inner is not None:
                    visit(
                        inner, size, bold, italic, underline, family, strike, superscript, subscript
                    )
                    idx = end
                    continue
            size_match = re.match(
                r"\\fontsize\{([\d.]+)pt\}\{([\d.]+)pt\}\\selectfont\s*", source[idx:]
            )
            if size_match:
                size = float(size_match.group(1))
                paragraph.paragraph_format.line_spacing = Pt(float(size_match.group(2)))
                idx += size_match.end()
                continue
            family_match = re.match(r"\\(ttfamily|sffamily|rmfamily)\s*", source[idx:])
            if family_match:
                family = {
                    "ttfamily": "Courier New",
                    "sffamily": "Arial",
                    "rmfamily": "Times New Roman",
                }[family_match.group(1)]
                idx += family_match.end()
                continue
            match = re.match(
                r"\\(textbf|textit|emph|underline|sout|textsuperscript|textsubscript|href|url)\{",
                source[idx:],
            )
            if match:
                command = match.group(1)
                inner, end = parse_brace_block(source, idx + match.end() - 1)
                if inner is not None:
                    if command == "href":
                        label, label_end = parse_brace_block(source, end)
                        if label is not None:
                            add_hyperlink(paragraph, inner, clean_cv_text(label), size=size)
                            idx = label_end
                            continue
                    elif command == "url":
                        add_hyperlink(paragraph, inner, clean_cv_text(inner), size=size)
                    else:
                        visit(
                            inner,
                            size,
                            bold or command == "textbf",
                            italic or command in {"textit", "emph"},
                            underline or command == "underline",
                            family,
                            strike or command == "sout",
                            superscript or command == "textsuperscript",
                            subscript or command == "textsubscript",
                        )
                    idx = end
                    continue
            # Consume an ordinary character or escaped pair without revisiting malformed commands.
            if source[idx] == "\\" and idx + 1 < len(source) and source[idx + 1] in "%&#_$":
                emit(source[idx : idx + 2])
                idx += 2
            else:
                end = idx + 1
                while end < len(source) and source[end] not in "{\\":
                    end += 1
                emit(source[idx:end])
                idx = end

    visit(text, base_size, base_bold, base_italic, base_underline)


def is_cv_document(raw_tex: str) -> bool:
    cv_indicators = [
        r"\cvsection",
        r"\cfoot",
        r"\rhead",
        r"\ifbps",
        r"\hfill",
        "Curriculum Vitae",
        "Resume",
    ]
    matches = sum(1 for ind in cv_indicators if ind in raw_tex)
    return matches >= 2


def export_latex_cv_to_docx(
    tex_path: Path,
    docx_path: Path,
    line_spacing: float = 1.0,
    space_after_pt: float = 0.8,
) -> tuple[bool, str]:
    """Direct high-fidelity AST converter for LaTeX CVs and Resumes to DOCX."""
    try:
        raw_tex = tex_path.read_text(encoding="utf-8", errors="ignore")

        # 1. Parse Margins from \usepackage[...]{geometry}
        top_margin = Inches(0.38)
        bottom_margin = Inches(0.38)
        left_margin = Inches(0.46)
        right_margin = Inches(0.46)

        geom_m = re.search(r"\\usepackage\[(.*?)\]\{geometry\}", raw_tex)
        if geom_m:
            for part in geom_m.group(1).split(","):
                if "=" in part:
                    k, v = part.split("=", 1)
                    k, v = k.strip(), v.strip()
                    in_val = to_inches(v)
                    if in_val is not None:
                        if k == "margin":
                            top_margin = bottom_margin = left_margin = right_margin = in_val
                        elif k == "top":
                            top_margin = in_val
                        elif k == "bottom":
                            bottom_margin = in_val
                        elif k == "left":
                            left_margin = in_val
                        elif k == "right":
                            right_margin = in_val

        content_width = Inches(8.5) - left_margin - right_margin

        # 2. Extract Running Header text
        rhead_text = ""
        m_rhead = re.search(r"\\rhead\{([^}]+)\}", raw_tex)
        if m_rhead:
            rhead_text = clean_cv_text(m_rhead.group(1)).strip()

        # Check conditional \ifbps
        is_bps = True
        bps_match = re.search(r"\\bps(true|false)", raw_tex)
        if bps_match:
            is_bps = bps_match.group(1) == "true"

        start = raw_tex.find(r"\begin{document}")
        end = raw_tex.rfind(r"\end{document}")
        body = (
            raw_tex[start + len(r"\begin{document}") : end]
            if (start != -1 and end != -1)
            else raw_tex
        )

        # Resolve \ifbps
        cond_pat = re.compile(
            r"\\ifbps((?:(?!\\ifbps)[\s\S])*?)\\else((?:(?!\\ifbps)[\s\S])*?)\\fi"
        )
        while cond_pat.search(body):
            body = cond_pat.sub(r"\1" if is_bps else r"\2", body)
        single_if = re.compile(r"\\ifbps((?:(?!\\ifbps)[\s\S])*?)\\fi")
        while single_if.search(body):
            body = single_if.sub(r"\1" if is_bps else "", body)
        body = re.sub(r"\\(ifbps|else|fi)\b", "", body)

        doc = Document()
        for sec in doc.sections:
            sec.page_width = Inches(8.5)
            sec.page_height = Inches(11.0)
            sec.top_margin = top_margin
            sec.bottom_margin = bottom_margin
            sec.left_margin = left_margin
            sec.right_margin = right_margin
            sec.different_first_page_header_footer = True

            ftr_first = sec.first_page_footer.paragraphs[0]
            ftr_first.alignment = WD_ALIGN_PARAGRAPH.CENTER
            add_xml_field(ftr_first, "Page ", "PAGE", " of ")
            ftr_first._p.append(
                parse_xml(
                    '<w:fldSimple xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:instr="NUMPAGES"/>'
                )
            )

            if rhead_text:
                hdr_p = sec.header.paragraphs[0]
                hdr_p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                hdr_run = hdr_p.add_run(rhead_text)
                hdr_run.font.name = "Times New Roman"
                hdr_run.font.size = Pt(8.5)
                hdr_run.font.color.rgb = RGBColor(100, 100, 100)

            ftr_p = sec.footer.paragraphs[0]
            ftr_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            add_xml_field(ftr_p, "Page ", "PAGE", " of ")
            ftr_p._p.append(
                parse_xml(
                    '<w:fldSimple xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:instr="NUMPAGES"/>'
                )
            )

        normal_style = doc.styles["Normal"]
        normal_style.font.name = "Times New Roman"
        normal_style.font.size = Pt(9.5)
        normal_style.font.color.rgb = RGBColor(0, 0, 0)
        normal_style.paragraph_format.line_spacing = line_spacing
        normal_style.paragraph_format.space_after = Pt(space_after_pt)
        normal_style.paragraph_format.space_before = Pt(0)

        cleaned_lines = []
        pending = ""
        depth = 0
        for line in body.splitlines():
            ls = line.strip()
            if not ls or ls.startswith("%"):
                continue
            if ls.startswith(("\\thispagestyle", "\\setlength", "\\renewcommand", "\\pagestyle")):
                continue
            pending += (" " if pending else "") + ls
            unescaped = re.sub(r"\\[{}]", "", ls)
            depth += unescaped.count("{") - unescaped.count("}")
            if depth <= 0:
                cleaned_lines.append(pending)
                pending = ""
                depth = 0
        if pending:
            cleaned_lines.append(pending)

        lines = cleaned_lines
        i = 0
        previous_count = 0
        previous_alignment = None

        def apply_alignment():
            if previous_alignment is not None:
                for paragraph in doc.paragraphs[previous_count:]:
                    paragraph.alignment = previous_alignment

        while i < len(lines):
            apply_alignment()
            previous_count = len(doc.paragraphs)
            previous_alignment = None
            line = lines[i].strip()
            if not line:
                i += 1
                continue

            alignment = re.match(
                r"^\{\\(centering|raggedleft|raggedright|justifying)\s+([\s\S]*)\}$", line
            )
            if alignment:
                previous_alignment = {
                    "centering": WD_ALIGN_PARAGRAPH.CENTER,
                    "raggedleft": WD_ALIGN_PARAGRAPH.RIGHT,
                    "raggedright": WD_ALIGN_PARAGRAPH.LEFT,
                    "justifying": WD_ALIGN_PARAGRAPH.JUSTIFY,
                }[alignment.group(1)]
                line = re.sub(r"\\par\s*$", "", alignment.group(2)).strip()
            spacing = re.fullmatch(r"\\vspace\{([\d.]+)pt\}", line)
            if spacing:
                if doc.paragraphs:
                    doc.paragraphs[-1].paragraph_format.space_after = Pt(float(spacing.group(1)))
                i += 1
                continue
            if line in (r"\newpage", r"\clearpage"):
                doc.add_page_break()
                i += 1
                continue

            # Alignment Block (center, flushleft, flushright)
            m_align_env = re.search(r"\\begin\{(center|flushleft|flushright)\}", line)
            if m_align_env:
                env_type = m_align_env.group(1)
                end_token = f"\\end{{{env_type}}}"
                align_choice = WD_ALIGN_PARAGRAPH.CENTER
                if env_type == "flushleft":
                    align_choice = WD_ALIGN_PARAGRAPH.LEFT
                elif env_type == "flushright":
                    align_choice = WD_ALIGN_PARAGRAPH.RIGHT

                i += 1
                hlines = []
                while i < len(lines) and end_token not in lines[i]:
                    hl = lines[i].strip()
                    if hl and not hl.startswith("%"):
                        hlines.append(hl)
                    i += 1
                i += 1
                header_raw = "\n".join(hlines)
                chunks = [
                    c.strip()
                    for c in re.split(r"\\\\(?:\s*\[[^\]]*\])?|\n\s*\n", header_raw)
                    if c.strip()
                ]
                for idx, c in enumerate(chunks):
                    c = re.sub(r"\s*\n\s*", " ", c).strip()
                    if not c:
                        continue
                    p_head = doc.add_paragraph()
                    p_head.alignment = align_choice
                    p_head.paragraph_format.space_before = Pt(0)
                    if idx == 0:
                        p_head.paragraph_format.space_after = Pt(2.0)
                        add_runs(p_head, c, base_size=16.0, base_bold=True)
                    else:
                        p_head.paragraph_format.space_after = Pt(1.2)
                        add_runs(p_head, c, base_size=9.5)
                continue

            # Section headings
            m_sec = re.match(r"^\\(?:cvsection|section\*?)\{(.*?)\}", line)
            if m_sec:
                sec_source, _ = parse_brace_block(line, line.index("{"))
                sec_title = sec_source or m_sec.group(1)
                p_sec = doc.add_paragraph()
                p_sec.paragraph_format.space_before = Pt(3.5)
                p_sec.paragraph_format.space_after = Pt(1.5)
                p_sec.paragraph_format.keep_with_next = True
                add_runs(p_sec, sec_title, base_size=10.8, base_bold=True)
                i += 1
                continue

            # \hfill entry with right tab stop
            if r"\hfill" in line:
                parts = line.split(r"\hfill", 1)
                left_part = parts[0].strip()
                right_part = parts[1].replace(r"\\", "").strip()
                p_entry = doc.add_paragraph()
                p_entry.paragraph_format.space_before = Pt(1.5)
                p_entry.paragraph_format.space_after = Pt(0.8)
                p_entry.paragraph_format.line_spacing = line_spacing
                p_entry.paragraph_format.tab_stops.add_tab_stop(
                    content_width, WD_TAB_ALIGNMENT.RIGHT
                )
                add_runs(p_entry, left_part, base_size=10.0)
                p_entry.add_run("\t")
                add_runs(p_entry, right_part, base_size=10.0)
                i += 1
                continue

            # Tabular
            if r"\begin{tabular}" in line:
                tab_spec = line
                i += 1
                tlines = []
                while i < len(lines) and r"\end{tabular}" not in lines[i]:
                    tl = lines[i].strip()
                    if tl and not tl.startswith("%"):
                        tlines.append(tl)
                    i += 1
                i += 1
                tab_raw = " ".join(tlines)
                rows = [
                    r.strip() for r in re.split(r"\\\\(?:\s*\[[^\]]*\])?", tab_raw) if r.strip()
                ]
                if rows:
                    col0_w = Inches(1.35)
                    m_cw = re.search(r"p\{([\d\.]+(?:in|cm|mm|pt))\}", tab_spec)
                    if m_cw:
                        parsed_w = to_inches(m_cw.group(1))
                        if parsed_w is not None:
                            col0_w = parsed_w
                    col1_w = content_width - col0_w

                    table = doc.add_table(rows=len(rows), cols=2)
                    table.autofit = False
                    tblPr = table._tbl.tblPr
                    tblBorders = parse_xml(
                        '<w:tblBorders xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                        '<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                        '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                        '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                        '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                        '<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                        '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                        "</w:tblBorders>"
                    )
                    tblPr.append(tblBorders)
                    tblCellMar = parse_xml(
                        '<w:tblCellMar xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                        '<w:top w:w="20" w:type="dxa"/>'
                        '<w:bottom w:w="20" w:type="dxa"/>'
                        '<w:left w:w="0" w:type="dxa"/>'
                        '<w:right w:w="100" w:type="dxa"/>'
                        "</w:tblCellMar>"
                    )
                    tblPr.append(tblCellMar)
                    tblW = parse_xml(
                        f'<w:tblW xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
                        f'w:type="dxa" w:w="{int(content_width / 635)}"/>'
                    )
                    tblPr.append(tblW)
                    table.columns[0].width = col0_w
                    table.columns[1].width = col1_w
                    for r_idx, row_text in enumerate(rows):
                        cells = row_text.split("&", 1)
                        c0 = table.rows[r_idx].cells[0]
                        c1 = table.rows[r_idx].cells[1]
                        c0.width = col0_w
                        c1.width = col1_w
                        c0_p = c0.paragraphs[0]
                        c1_p = c1.paragraphs[0]
                        c0_p.paragraph_format.space_before = Pt(0)
                        c0_p.paragraph_format.space_after = Pt(0.6)
                        c0_p.paragraph_format.line_spacing = line_spacing
                        c1_p.paragraph_format.space_before = Pt(0)
                        c1_p.paragraph_format.space_after = Pt(0.6)
                        c1_p.paragraph_format.line_spacing = line_spacing
                        if len(cells) == 2:
                            add_runs(c0_p, cells[0].strip(), base_size=9.5, base_bold=True)
                            add_runs(c1_p, cells[1].strip(), base_size=9.5)
                        else:
                            add_runs(c0_p, "", base_size=9.5)
                            add_runs(c1_p, cells[0].strip(), base_size=9.5)
                continue

            # Itemize / Enumerate
            if r"\begin{itemize}" in line or r"\begin{enumerate}" in line:
                is_num = r"\begin{enumerate}" in line
                num_idx = 1
                i += 1
                while i < len(lines) and (
                    r"\end{itemize}" not in lines[i] and r"\end{enumerate}" not in lines[i]
                ):
                    il = lines[i].strip()
                    if il.startswith(r"\item"):
                        item_text = il[len(r"\item") :].strip()
                        i += 1
                        while (
                            i < len(lines)
                            and not lines[i].strip().startswith(r"\item")
                            and r"\end{itemize}" not in lines[i]
                            and r"\end{enumerate}" not in lines[i]
                        ):
                            next_l = lines[i].strip()
                            if next_l and not next_l.startswith("%"):
                                item_text += " " + next_l
                            i += 1

                        p_item = doc.add_paragraph()
                        p_item.paragraph_format.space_before = Pt(0)
                        p_item.paragraph_format.space_after = Pt(0.6)
                        p_item.paragraph_format.line_spacing = line_spacing
                        if is_num:
                            p_item.paragraph_format.left_indent = Inches(0.28)
                            p_item.paragraph_format.first_line_indent = Inches(-0.28)
                            r_num = p_item.add_run(f"{num_idx}.  ")
                            r_num.font.name = "Times New Roman"
                            r_num.font.size = Pt(9.5)
                            num_idx += 1
                        else:
                            p_item.paragraph_format.left_indent = Inches(0.22)
                            p_item.paragraph_format.first_line_indent = Inches(-0.22)
                            r_bullet = p_item.add_run("•   ")
                            r_bullet.font.name = "Times New Roman"
                            r_bullet.font.size = Pt(9.5)
                        add_runs(p_item, item_text, base_size=9.5)
                        continue
                    i += 1
                i += 1
                continue

            # Regular paragraph
            p_reg = doc.add_paragraph()
            p_reg.paragraph_format.space_before = Pt(0)
            p_reg.paragraph_format.space_after = Pt(0.8)
            p_reg.paragraph_format.line_spacing = line_spacing
            clean_l = line.replace(r"\\", "").strip()
            if clean_l.startswith(r"{\centering") and clean_l.endswith("}"):
                p_reg.alignment = WD_ALIGN_PARAGRAPH.CENTER
                clean_l = clean_l[len(r"{\centering") : -1].strip()
            elif clean_l.startswith(r"{\raggedleft") and clean_l.endswith("}"):
                p_reg.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                clean_l = clean_l[len(r"{\raggedleft") : -1].strip()
            elif clean_l.startswith(r"{\raggedright") and clean_l.endswith("}"):
                p_reg.alignment = WD_ALIGN_PARAGRAPH.LEFT
                clean_l = clean_l[len(r"{\raggedright") : -1].strip()
            add_runs(p_reg, clean_l, base_size=9.5)
            i += 1

        apply_alignment()
        docx_path.parent.mkdir(parents=True, exist_ok=True)
        doc.save(docx_path)
        return True, f"High-fidelity CV successfully exported to {docx_path}"
    except Exception as e:
        return False, f"CV export error: {e}"


# ==============================================================================
# SCIENTIFIC MANUSCRIPT PIPELINE (Pandoc + Postprocessing)
# ==============================================================================


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


def replace_citations_and_refs(
    text: str, label_map: dict[str, str], bib_map: dict[str, str]
) -> str:
    def cite_repl(match: re.Match[str]) -> str:
        keys = [part.strip() for part in match.group(1).split(",") if part.strip()]
        nums = [bib_map.get(key, key) for key in keys]
        return "[" + ", ".join(nums) + "]"

    for pat in (r"\\cite\{([^}]+)\}", r"\\citep\{([^}]+)\}", r"\\citet\{([^}]+)\}"):
        text = re.sub(pat, cite_repl, text)

    text = re.sub(r"\\ref\{([^}]+)\}", lambda m: label_map.get(m.group(1), m.group(1)), text)
    text = re.sub(
        r"\\eqref\{([^}]+)\}", lambda m: "(" + label_map.get(m.group(1), m.group(1)) + ")", text
    )
    return text


def clean_latex_body_for_pandoc(text: str) -> str:
    """Prepare LaTeX document body for clean Pandoc Word conversion."""
    text = re.sub(
        r"\\ifbps((?:(?!\\ifbps)[\s\S])*?)\\else((?:(?!\\ifbps)[\s\S])*?)\\fi", r"\1", text
    )
    text = re.sub(r"\\ifbps((?:(?!\\ifbps)[\s\S])*?)\\fi", r"\1", text)
    text = text.replace(r"\ifbps", "").replace(r"\else", "").replace(r"\fi", "")

    text = re.sub(r"\\cvsection\{([^}]+)\}", lambda m: f"\\section*{{{m.group(1)}}}", text)
    text = text.replace(r"\hfill", " — ")
    text = text.replace(r"\thispagestyle{firstpage}", "")
    text = text.replace(r"\thispagestyle{empty}", "")
    text = text.replace(r"\pagestyle{empty}", "")

    text = re.sub(r"\\fontsize\{[^}]+\}\{[^}]+\}", "", text)
    text = text.replace(r"\selectfont", "")
    text = text.replace(r"\par", "\n\n")

    text = re.sub(r"\\\\\[\d+(\.\d+)?(pt|em|ex|cm|mm|in)\]", r"\\\\", text)
    text = re.sub(r"\\vspace\*?\{[^}]*\}", "\n", text)
    text = re.sub(r"\\hspace\*?\{[^}]*\}", " ", text)

    return text


def simplify_docx_ion_charges(docx_path: Path | str) -> None:
    """Render Mg2+ charge tokens as ordinary superscript Word text.

    Pandoc exports the ``2+`` portion of ``Mg^{2+}`` as a separate Office-Math
    object, which LibreOffice can draw with corrupt-looking glyphs.
    """
    docx_path = Path(docx_path)
    namespace_math = "http://schemas.openxmlformats.org/officeDocument/2006/math"
    with zipfile.ZipFile(docx_path, "r") as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    document_name = "word/document.xml"
    if document_name not in members:
        return
    root = ET.fromstring(members[document_name])
    parents = {child: parent for parent in root.iter() for child in parent}
    for equation in list(root.findall(f".//{{{namespace_math}}}oMath")):
        value = "".join(node.text or "" for node in equation.findall(f".//{{{namespace_math}}}t"))
        if value.replace("\u200b", "") not in {"2+", "3+", "2-", "3-"}:
            continue
        colors = equation.findall(f".//{{{NS_W}}}color")
        color_value = colors[0].attrib.get(f"{{{NS_W}}}val") if colors else None
        replacement = ET.Element(f"{{{NS_W}}}r")
        properties = ET.SubElement(replacement, f"{{{NS_W}}}rPr")
        ET.SubElement(properties, f"{{{NS_W}}}vertAlign", {f"{{{NS_W}}}val": "superscript"})
        if color_value:
            ET.SubElement(properties, f"{{{NS_W}}}color", {f"{{{NS_W}}}val": color_value})
        ET.SubElement(replacement, f"{{{NS_W}}}t").text = value.replace("\u200b", "")
        parent = parents.get(equation)
        if parent is not None:
            siblings = list(parent)
            parent.insert(siblings.index(equation), replacement)
            parent.remove(equation)
    members[document_name] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in members.items():
            archive.writestr(name, content)


def simplify_docx_plain_numeric_math(docx_path: Path | str) -> None:
    """Render simple inline numbers as ordinary Word text, not Office Math."""
    docx_path = Path(docx_path)
    namespace_math = "http://schemas.openxmlformats.org/officeDocument/2006/math"
    with zipfile.ZipFile(docx_path, "r") as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    document_name = "word/document.xml"
    if document_name not in members:
        return
    root = ET.fromstring(members[document_name])
    parents = {child: parent for parent in root.iter() for child in parent}
    numeric_value = re.compile(r"^[+\-−]?\d+(?:\.\d+)?$")

    def run_color(run: ET.Element) -> str | None:
        color = run.find(f"{{{NS_W}}}rPr/{{{NS_W}}}color")
        return color.attrib.get(f"{{{NS_W}}}val") if color is not None else None

    def nearby_color(parent: ET.Element, equation: ET.Element) -> str | None:
        siblings = list(parent)
        index = siblings.index(equation)
        for offset in range(1, len(siblings)):
            for candidate_index in (index - offset, index + offset):
                if not 0 <= candidate_index < len(siblings):
                    continue
                sibling = siblings[candidate_index]
                if sibling.tag != f"{{{NS_W}}}r":
                    continue
                color = run_color(sibling)
                if color is not None:
                    return color
        return None

    for equation in list(root.findall(f".//{{{namespace_math}}}oMath")):
        value = "".join(node.text or "" for node in equation.findall(f".//{{{namespace_math}}}t"))
        visible_value = value.replace("\u200b", "")
        if not numeric_value.fullmatch(visible_value):
            continue
        colors = equation.findall(f".//{{{NS_W}}}color")
        color_value = colors[0].attrib.get(f"{{{NS_W}}}val") if colors else None
        parent = parents.get(equation)
        if parent is None:
            continue
        if color_value is None:
            color_value = nearby_color(parent, equation)
        replacement = ET.Element(f"{{{NS_W}}}r")
        if color_value is not None:
            properties = ET.SubElement(replacement, f"{{{NS_W}}}rPr")
            ET.SubElement(properties, f"{{{NS_W}}}color", {f"{{{NS_W}}}val": color_value})
        ET.SubElement(replacement, f"{{{NS_W}}}t").text = visible_value
        siblings = list(parent)
        parent.insert(siblings.index(equation), replacement)
        parent.remove(equation)
    members[document_name] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in members.items():
            archive.writestr(name, content)


def format_docx_unit_exponents(docx_path: Path | str) -> None:
    """Render unit exponents as ordinary Word superscripts."""
    docx_path = Path(docx_path)
    with zipfile.ZipFile(docx_path, "r") as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    document_name = "word/document.xml"
    if document_name not in members:
        return
    root = ET.fromstring(members[document_name])

    def run_text(run: ET.Element) -> str:
        return "".join(node.text or "" for node in run.findall(f".//{{{NS_W}}}t"))

    def set_run_text(run: ET.Element, value: str) -> None:
        nodes = run.findall(f".//{{{NS_W}}}t")
        if not nodes:
            ET.SubElement(run, f"{{{NS_W}}}t").text = value
            return
        nodes[0].text = value
        for node in nodes[1:]:
            node.text = ""

    def run_color(run: ET.Element) -> str | None:
        color = run.find(f"{{{NS_W}}}rPr/{{{NS_W}}}color")
        return color.attrib.get(f"{{{NS_W}}}val") if color is not None else None

    def superscript(run: ET.Element, color_value: str | None) -> None:
        properties = run.find(f"{{{NS_W}}}rPr")
        if properties is None:
            properties = ET.Element(f"{{{NS_W}}}rPr")
            run.insert(0, properties)
        vertical = properties.find(f"{{{NS_W}}}vertAlign")
        if vertical is None:
            vertical = ET.SubElement(properties, f"{{{NS_W}}}vertAlign")
        vertical.attrib[f"{{{NS_W}}}val"] = "superscript"
        color = properties.find(f"{{{NS_W}}}color")
        if color_value is None:
            if color is not None:
                properties.remove(color)
        else:
            if color is None:
                color = ET.SubElement(properties, f"{{{NS_W}}}color")
            color.attrib[f"{{{NS_W}}}val"] = color_value

    for paragraph in root.findall(f".//{{{NS_W}}}p"):
        runs = [node for node in list(paragraph) if node.tag == f"{{{NS_W}}}r"]
        for index, run in enumerate(runs[1:], start=1):
            value = run_text(run)
            previous = runs[index - 1]
            previous_text = run_text(previous)
            if value not in {"-1", "−1", "-2", "−2", "-3", "−3"}:
                continue
            if re.search(r"(?:mol|ps|ns|ms|s|cal|J|kcal|kJ|M|mM|μM|nM)\s*$", previous_text):
                set_run_text(run, "−" + value[-1])
                superscript(run, run_color(previous))
            elif previous_text.endswith("Å (^"):
                set_run_text(previous, previous_text[:-3])
                set_run_text(run, "−" + value[-1])
                superscript(run, run_color(previous))

    members[document_name] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in members.items():
            archive.writestr(name, content)


def simplify_docx_prose_math_tokens(docx_path: Path | str) -> None:
    """Keep residue labels and structural symbols out of Office Math."""
    docx_path = Path(docx_path)
    namespace_math = "http://schemas.openxmlformats.org/officeDocument/2006/math"
    with zipfile.ZipFile(docx_path, "r") as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    document_name = "word/document.xml"
    if document_name not in members:
        return
    root = ET.fromstring(members[document_name])
    parents = {child: parent for parent in root.iter() for child in parent}
    prose_token = re.compile(r"(?:[A-Z]\d+[A-Z]?|[αβ]\d*|k)")
    for equation in list(root.findall(f".//{{{namespace_math}}}oMath")):
        value = "".join(node.text or "" for node in equation.findall(f".//{{{namespace_math}}}t"))
        if not prose_token.fullmatch(value):
            continue
        colors = equation.findall(f".//{{{NS_W}}}color")
        color_value = colors[0].attrib.get(f"{{{NS_W}}}val") if colors else None
        replacement = ET.Element(f"{{{NS_W}}}r")
        if color_value:
            properties = ET.SubElement(replacement, f"{{{NS_W}}}rPr")
            ET.SubElement(properties, f"{{{NS_W}}}color", {f"{{{NS_W}}}val": color_value})
        ET.SubElement(replacement, f"{{{NS_W}}}t").text = value
        parent = parents.get(equation)
        if parent is not None:
            siblings = list(parent)
            parent.insert(siblings.index(equation), replacement)
            parent.remove(equation)
    members[document_name] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in members.items():
            archive.writestr(name, content)


def postprocess_docx_typography(
    docx_path: Path,
    line_spacing: float = 1.15,
    space_after_pt: float = 2.0,
) -> None:
    """Apply consistent academic Word typography and formatting via python-docx and OpenXML."""
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

    doc = Document(docx_path)
    for p in doc.paragraphs:
        p.paragraph_format.line_spacing = line_spacing
        p.paragraph_format.space_after = Pt(space_after_pt)

    for section in doc.sections:
        section.top_margin = Inches(0.75)
        section.bottom_margin = Inches(0.75)
        section.left_margin = Inches(0.75)
        section.right_margin = Inches(0.75)

    for table in doc.tables:
        table.autofit = True
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    p.paragraph_format.line_spacing = 1.05
                    p.paragraph_format.space_after = Pt(max(0, space_after_pt - 1))

    doc.save(docx_path)

    # Apply manuscript math and unit typography rules
    try:
        simplify_docx_ion_charges(docx_path)
    except Exception:
        pass
    try:
        simplify_docx_plain_numeric_math(docx_path)
    except Exception:
        pass
    try:
        format_docx_unit_exponents(docx_path)
    except Exception:
        pass
    try:
        simplify_docx_prose_math_tokens(docx_path)
    except Exception:
        pass


def export_latex_manuscript_to_docx(
    tex_path: Path,
    out_docx_path: Path,
    build_dir: Path | None = None,
    line_spacing: float = 1.15,
    space_after_pt: float = 2.0,
) -> tuple[bool, str]:
    """Convert LaTeX academic manuscript to DOCX via Pandoc + Academic Postprocessing."""
    stem = tex_path.stem
    build_dir = build_dir or (tex_path.parent / ".localleaf_build")

    label_map = load_label_map(build_dir, stem)
    bib_map = load_bib_map(build_dir, stem)

    raw_tex = tex_path.read_text(encoding="utf-8", errors="ignore")

    start = raw_tex.find(r"\begin{document}")
    end = raw_tex.rfind(r"\end{document}")
    if start != -1 and end != -1:
        body = raw_tex[start + len(r"\begin{document}") : end]
    else:
        body = raw_tex

    body = clean_latex_body_for_pandoc(body)
    body = unwrap_resizebox(body)
    body = flatten_singlecol_nested_tabular(body)
    body = replace_citations_and_refs(body, label_map, bib_map)
    body = linearize_inline_math_for_docx(body)
    body = normalize_unit_macros_for_docx(body)

    clean_tex = (
        r"""\documentclass{article}
\usepackage{hyperref}
\begin{document}
"""
        + body
        + r"""
\end{document}
"""
    )

    out_docx_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_tex = out_docx_path.parent / f".tmp_{stem}_docx_prep.tex"
    tmp_tex.write_text(clean_tex, encoding="utf-8")

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

    postprocess_docx_typography(
        out_docx_path, line_spacing=line_spacing, space_after_pt=space_after_pt
    )
    return True, f"Successfully exported to {out_docx_path}"


# ==============================================================================
# MAIN ROUTER
# ==============================================================================


def export_latex_to_docx(
    tex_path: Path,
    out_docx_path: Path,
    build_dir: Path | None = None,
    line_spacing: float = 1.0,
    space_after_pt: float = 1.0,
) -> tuple[bool, str]:
    """Convert LaTeX to high-fidelity DOCX, intelligently selecting direct CV engine or Pandoc."""
    if not tex_path.exists():
        return False, f"TeX file not found: {tex_path}"

    raw_tex = tex_path.read_text(encoding="utf-8", errors="ignore")

    # If it is a CV or resume, use the 1-to-1 high fidelity AST engine
    if is_cv_document(raw_tex):
        ok, msg = export_latex_cv_to_docx(
            tex_path,
            out_docx_path,
            line_spacing=line_spacing,
            space_after_pt=space_after_pt,
        )
        if ok:
            return True, msg
        # If direct engine encountered an unhandled exception, fall back to manuscript pipeline
        print(f"Warning: Direct CV engine fallback due to: {msg}")

    # Fall back to Pandoc scientific manuscript pipeline
    return export_latex_manuscript_to_docx(
        tex_path=tex_path,
        out_docx_path=out_docx_path,
        build_dir=build_dir,
        line_spacing=max(1.0, line_spacing),
        space_after_pt=space_after_pt,
    )


if __name__ == "__main__":
    import sys

    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("demo/main.tex")
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("demo/.localleaf_build/main.docx")
    ok, msg = export_latex_to_docx(target, out)
    print("Success:", ok)
    print(msg)

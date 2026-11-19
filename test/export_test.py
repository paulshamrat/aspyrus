"""Independent documents, figure exports and publication safety regressions."""

import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zlib
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "tools"))
import export  # noqa: E402


class DiagnosticDecodingTests(unittest.TestCase):
    def test_non_utf8_diagnostics_do_not_hide_success_or_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            stage = Path(temporary)
            command = [
                sys.executable,
                "-c",
                "import sys; sys.stdout.buffer.write(bytes([197]))",
            ]
            self.assertIn("\ufffd", export.run(command, stage))
            self.assertIn("\ufffd", (stage / "build.log").read_text())
            with self.assertRaises(export.ExportError):
                export.run(command[:-1] + [command[-1] + "; sys.exit(1)"], stage)

    def test_latex_log_decoding_still_rejects_undefined_references(self):
        with tempfile.TemporaryDirectory() as temporary:
            stage = Path(temporary)
            (stage / "main.aux").write_text("")
            (stage / "main.pdf").write_bytes(b"test PDF existence")
            log = stage / "main.log"
            log.write_bytes(bytes([197]))
            with patch.object(export, "run"):
                export.latex(stage, "main")
                log.write_bytes(bytes([197]) + b"\nThere were undefined references.")
                with self.assertRaises(export.ExportError):
                    export.latex(stage, "main")


PREAMBLE = r"""\documentclass{article}
\usepackage{graphicx,amsmath}
\begin{document}
"""
FIGURE = r"""\begin{figure}[htbp]
\centering
\begin{minipage}{0.4\textwidth}\includegraphics[width=\linewidth]{../assets/panel.png}\end{minipage}
\begin{minipage}{0.4\textwidth}\includegraphics[width=\linewidth]{../assets/panel.png}\end{minipage}
\caption[Short caption]{Complete detailed caption with {nested} text.}\label{fig:main}
\end{figure}
"""
SUPP = r"""\clearpage
\section{Supplementary}
\renewcommand{\thefigure}{S\arabic{figure}}\setcounter{figure}{0}
Supplementary observations.
""" + FIGURE.replace("fig:main", "fig:supp").replace(
    "Complete detailed", "Supplementary detailed"
)
MAIN = (
    r"""\section{Main}
Main prose cites a reference\cite{Example} and Figure~\ref{fig:main}.
"""
    + FIGURE
)
TAIL = "\\bibliographystyle{plain}\n\\bibliography{../references/references}\n\\end{document}\n"


def png():
    def chunk(kind, data):
        return (
            struct.pack("!I", len(data))
            + kind
            + data
            + struct.pack("!I", zlib.crc32(kind + data))
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack("!2I5B", 40, 30, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress((b"\0" + b"\x20\x60\x90" * 40) * 30))
        + chunk(b"IEND", b"")
    )


class SourceTests(unittest.TestCase):
    def test_docx_notation_guard_rejects_known_broken_exports(self):
        template = '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:sSup><m:e><m:r><m:t>{base}</m:t></m:r></m:e><m:sup><m:r><m:t>{power}</m:t></m:r></m:sup></m:sSup></m:oMath>'
        for base, power in (("", "2+"), ("\u200b", "−1"), (" ", "-2")):
            with (
                self.subTest(power=power),
                self.assertRaisesRegex(export.ExportError, "empty-base"),
            ):
                export.validate_docx_notation(
                    ET.fromstring(template.format(base=base, power=power))
                )
        export.validate_docx_notation(
            ET.fromstring(template.format(base="x", power="-2"))
        )
        with self.assertRaisesRegex(export.ExportError, "revision markers"):
            export.validate_docx_notation(ET.fromstring("<root>CODXREVREDSTART</root>"))

    def test_explicit_review_font_sizes_and_legacy_fallback(self):
        import tex2docx

        for points in (10, 11, 12):
            self.assertEqual(
                tex2docx.source_review_font_size(
                    rf"\documentclass[letterpaper,{points}pt]{{article}}"
                ),
                points,
            )
        self.assertEqual(
            tex2docx.source_review_font_size(r"\documentclass{article}"), 12
        )
        self.assertEqual(
            tex2docx.source_review_font_size("% " + r"\documentclass[11pt]{article}"),
            12,
        )

    def test_pdf_hyphenation_retains_detached_labels_and_math_rows(self):
        expected = export.words("Figure 2: All variants reach the maximum entropy.")
        extracted = (
            "All vari-\n Figure 2:\n ants reach the maxi-\n ∑︀𝐾\n123 mum entropy."
        )
        bridged = export.bridge_pdf_hyphenation(extracted, expected)
        self.assertFalse(expected - export.words(bridged))
        self.assertIn("Figure 2:", bridged)
        self.assertIn("∑︀𝐾", bridged)
        unrelated = "vari-\n unrelated prose\n ants"
        self.assertEqual(export.bridge_pdf_hyphenation(unrelated, expected), unrelated)
        self.assertTrue(expected - export.words(bridged.replace("variants", "")))

    def test_all_figures_keep_panel_bodies_and_omit_only_captions_labels(self):
        source = PREAMBLE + MAIN + SUPP + TAIL
        _, figures, instrumented = export.figure_plan(source)
        self.assertEqual(len(figures), 2)
        for figure in figures:
            self.assertEqual(figure["body"].count("includegraphics"), 2)
            self.assertNotIn("caption", figure["body"])
            self.assertNotIn("label", figure["body"])
        for figure in figures:
            instrumented = instrumented.replace("\\label{" + figure["label"] + "}", "")
        self.assertEqual(instrumented, source)

    def test_comments_verbatim_no_supplementary_requirement(self):
        source = (
            PREAMBLE + "% \\begin{figure} fake\n\\verb|\\begin{figure}|\n" + MAIN + TAIL
        )
        self.assertEqual(len(export.figure_plan(source)[1]), 1)
        with self.assertRaisesRegex(export.ExportError, "no figures"):
            export.figure_plan(PREAMBLE + "A short report.\\end{document}")

    def test_ambiguous_figures_rejected(self):
        for figure in [
            FIGURE.replace("\\caption[Short caption]", "\\caption*"),
            "\\begin{minipage}{\\textwidth}" + FIGURE + "\\end{minipage}",
            FIGURE.replace("\\end{figure}", "\\caption{Second}\\end{figure}"),
        ]:
            with self.assertRaises(export.ExportError):
                export.figure_plan(PREAMBLE + figure + TAIL)


class FilesystemTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / ".localleaf_build").mkdir()

    def test_unowned_edited_and_symlink_outputs_are_protected(self):
        path = self.root / "figures.pdf"
        path.write_bytes(b"original")
        with self.assertRaises(export.ExportError):
            export.preflight(self.root, {}, {path.name})
        old = {path.name: export.digest(path.read_bytes())}
        export.preflight(self.root, old, {path.name})
        path.write_bytes(b"edited")
        with self.assertRaises(export.ExportError):
            export.preflight(self.root, old, {path.name})
        path.unlink()
        path.symlink_to(self.root / "missing")
        with self.assertRaises(export.ExportError):
            export.preflight(self.root, old, {path.name})

    def test_nested_publication_recovery_and_path_boundaries(self):
        name = "assets/figures/figures.pdf"
        stage = self.root / "stage"
        (stage / name).parent.mkdir(parents=True)
        (stage / name).write_bytes(b"new deck")
        export.preflight(self.root, {}, {name})
        export.publish(self.root, stage, {name}, set())
        self.assertEqual((self.root / name).read_bytes(), b"new deck")
        old = {name: export.digest(b"new deck")}
        export.preflight(self.root, old, {name})
        (stage / name).write_bytes(b"replacement")
        (stage / "build_report.json").write_text("{}")
        original = export.os.replace

        def fail_marker(src, dest):
            if Path(src).name == "build_report.json":
                raise OSError("marker failure")
            return original(src, dest)

        with patch.object(export.os, "replace", side_effect=fail_marker):
            with self.assertRaises(OSError):
                export.publish(self.root, stage, {name, "build_report.json"}, set())
        self.assertEqual((self.root / name).read_bytes(), b"new deck")
        self.assertFalse((self.root / "build_report.json").exists())
        for invalid in (
            "../escape.pdf",
            "/tmp/escape.pdf",
            "assets/../escape.pdf",
            "./deck.pdf",
        ):
            with self.assertRaises(export.ExportError):
                export.preflight(self.root, {}, {invalid})
        (self.root / "link").symlink_to(stage, target_is_directory=True)
        with self.assertRaises(export.ExportError):
            export.preflight(self.root, {}, {"link/assets/figures/figures.pdf"})

    def test_publication_rolls_back(self):
        stage = self.root / "stage"
        stage.mkdir()
        for name in ["paper.pdf", "paper.docx"]:
            (stage / name).write_text("new")
            (self.root / name).write_text("old")
        original = export.os.replace

        def fail(src, dest):
            if Path(src).name == "paper.pdf":
                raise OSError("disk failure")
            return original(src, dest)

        with patch.object(export.os, "replace", fail), self.assertRaises(OSError):
            export.publish(self.root, stage, {"paper.pdf", "paper.docx"}, set())
        self.assertEqual((self.root / "paper.docx").read_text(), "old")
        self.assertEqual((self.root / "paper.pdf").read_text(), "old")

    def test_lock_changed_inputs_and_escape(self):
        with export.project_lock(self.root), self.assertRaises(export.ExportError):
            with export.project_lock(self.root):
                pass
        doc = self.root / "paper.tex"
        doc.write_bytes(b"original")
        (self.root / "workbook.xlsx").write_bytes(b"changed")
        with self.assertRaises(export.ExportError):
            export.unchanged(doc, b"original", self.root, {"workbook.xlsx": b"old"})
        with self.assertRaises(export.ExportError):
            export.unchanged(doc, b"old", self.root, {})
        (self.root / "leak.png").symlink_to("/etc/passwd")
        with self.assertRaises(export.ExportError):
            export.dependencies(
                self.root, doc, PREAMBLE + r"\includegraphics{leak.png}\end{document}"
            )


@unittest.skipUnless(
    all(
        shutil.which(n)
        for n in ["pdflatex", "bibtex", "pandoc", "pdftotext", "pdfinfo"]
    ),
    "TeX/Pandoc/Poppler required",
)
class BuildTests(unittest.TestCase):
    def test_standard_colours_match_pdf_and_word_and_restore_groups(self):
        import fitz

        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "main.tex"
            source.write_text(
                r"\documentclass{article}\usepackage{xcolor,amsmath}"
                r"\begin{document}\textcolor{red}{Redinline} "
                r"\textcolor{blue}{Blueinline}."
                "\n\n\\begingroup\\color{red}\nRedouter.\n\n"
                "\\begingroup\\color{blue}\nBlueinner with \\(x^2\\).\n\\endgroup\n\n"
                "Redrestored.\n\\endgroup\n\nOrdinary."
                r"\end{document}"
            )
            export.compile_all(source)
            expected = {
                "Redinline": "FF0000",
                "Blueinline": "0000FF",
                "Redouter": "FF0000",
                "Blueinner": "0000FF",
                "Redrestored": "FF0000",
            }
            ns = {
                "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
            }
            with zipfile.ZipFile(source.with_suffix(".docx")) as archive:
                xml = ET.fromstring(archive.read("word/document.xml"))
            for run in xml.findall(".//m:oMath//m:r", ns):
                self.assertEqual(
                    run.find("w:rPr/w:color", ns).get("{" + ns["w"] + "}val"), "0000FF"
                )
            for word, colour in expected.items():
                run = next(
                    r
                    for r in xml.findall(".//w:r", ns)
                    if word in "".join(t.text or "" for t in r.findall("w:t", ns))
                )
                self.assertEqual(
                    run.find("w:rPr/w:color", ns).get(
                        "{"
                        + "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                        + "}val"
                    ),
                    colour,
                )
            with fitz.open(source.with_suffix(".pdf")) as pdf:
                spans = [
                    span
                    for page in pdf
                    for block in page.get_text("dict")["blocks"]
                    if "lines" in block
                    for line in block["lines"]
                    for span in line["spans"]
                ]
            for word, colour in expected.items():
                self.assertEqual(
                    next(span["color"] for span in spans if word in span["text"]),
                    int(colour, 16),
                )
            self.assertEqual(
                next(span["color"] for span in spans if "Ordinary" in span["text"]), 0
            )

    def test_universal_colours_match_pdf_and_word_with_nested_blocks(self):
        import fitz

        with tempfile.TemporaryDirectory() as tmp:
            doc = Path(tmp) / "main.tex"
            doc.write_text(
                r"\documentclass{article}\usepackage{xcolor,amsmath}"
                r"\definecolor{aspyrusred}{HTML}{D32F2F}"
                r"\definecolor{aspyrusblue}{HTML}{1976D2}"
                r"\newcommand{\redtext}[1]{\textcolor{aspyrusred}{#1}}"
                r"\newcommand{\bluetext}[1]{\textcolor{aspyrusblue}{#1}}"
                r"\newenvironment{redblock}{\begingroup\color{aspyrusred}}{\endgroup}"
                r"\newenvironment{blueblock}{\begingroup\color{aspyrusblue}}{\endgroup}"
                r"\begin{document}\redtext{Redinline} and \bluetext{Blueinline}."
                "\n\n\\begin{redblock}\nRedouter.\n\n"
                r"\begin{blueblock}Blueinner with \(x^2\).\end{blueblock}"
                "\n\nRedrestored.\n\\end{redblock}\n\nOrdinary."
                r"\end{document}"
            )
            export.compile_all(doc)
            expected = {
                "Redinline": "D32F2F",
                "Blueinline": "1976D2",
                "Redouter": "D32F2F",
                "Blueinner": "1976D2",
                "Redrestored": "D32F2F",
            }
            ns = {
                "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
            }
            with zipfile.ZipFile(doc.with_suffix(".docx")) as z:
                xml = ET.fromstring(z.read("word/document.xml"))
            for word, colour in expected.items():
                run = next(
                    r
                    for r in xml.findall(".//w:r", ns)
                    if word in "".join(t.text or "" for t in r.findall("w:t", ns))
                )
                self.assertEqual(
                    run.find("w:rPr/w:color", ns).get("{" + ns["w"] + "}val"), colour
                )
            self.assertIsNotNone(xml.find(".//m:oMath", ns))
            for run in xml.findall(".//m:oMath//m:r", ns):
                self.assertEqual(
                    run.find("w:rPr/w:color", ns).get("{" + ns["w"] + "}val"), "1976D2"
                )
            ordinary = next(
                run
                for run in xml.findall(".//w:r", ns)
                if "Ordinary" in "".join(t.text or "" for t in run.findall("w:t", ns))
            )
            self.assertIsNone(ordinary.find("w:rPr/w:color", ns))
            with fitz.open(doc.with_suffix(".pdf")) as pdf:
                spans = [
                    span
                    for page in pdf
                    for block in page.get_text("dict")["blocks"]
                    if "lines" in block
                    for line in block["lines"]
                    for span in line["spans"]
                ]
            self.assertEqual(
                next(s["color"] for s in spans if "Ordinary" in s["text"]), 0
            )
            for word, colour in expected.items():
                self.assertEqual(
                    next(s["color"] for s in spans if word in s["text"]),
                    int(colour, 16),
                )

    def test_bare_inline_numbers_export_as_text_without_flattening_equations(self):
        import tex2docx

        with tempfile.TemporaryDirectory() as tmp:
            doc = Path(tmp) / "main.tex"
            source = (PREAMBLE + r"\usepackage{xcolor}").replace(
                r"\begin{document}", ""
            ) + (
                r"\newcommand{\redtext}[1]{\textcolor[HTML]{D32F2F}{#1}}"
                r"\newcommand{\bluetext}[1]{\textcolor[HTML]{1976D2}{#1}}"
                r"\begin{document}"
                r"Bare values \redtext{\(-2.50\)}~\AA{} and \bluetext{$+1.25$}~\AA{}. "
                r"Zero \(0\), fraction $ .75 $, integer $42$, and plus \(+0.00\). "
                r"Symbolic \(x=2.50\), threshold $x<0.75$, and fraction $\frac{1}{2}$ stay editable. "
                r"Display \[42\] stays an equation."
                + FIGURE.replace(
                    "Complete detailed caption with {nested} text.",
                    r"A shift of \(-2.50\)~\AA{}.",
                )
                + "\n\\end{document}\n"
            )
            doc.write_text(source)
            self.assertEqual(
                tex2docx.normalize_native_inline_math(r"\(-2.50\), $+1.25$."),
                "−2.50, +1.25.",
            )
            # Scientific notation and expressions are intentionally outside this narrow rule.
            for expression in (
                r"x+1",
                r"10^{-2}",
                r"1\times10^3",
                r"\Delta",
                r"\frac{1}{2}",
            ):
                self.assertEqual(
                    tex2docx.normalize_native_inline_math(r"\(" + expression + r"\)"),
                    r"\(" + expression + r"\)",
                )
            (Path(tmp) / "assets").mkdir()
            (Path(tmp) / "assets/panel.png").write_bytes(png())
            doc.write_text(source.replace("../assets/panel.png", "assets/panel.png"))
            original = doc.read_bytes()
            export.compile_all(doc)
            self.assertEqual(doc.read_bytes(), original)
            with zipfile.ZipFile(doc.with_suffix(".docx")) as archive:
                xml = ET.fromstring(archive.read("word/document.xml"))
            ns = {
                "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
                "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            }
            prose = "".join(node.text or "" for node in xml.findall(".//w:t", ns))
            for value in ("−2.50", "+1.25", ".75", "42", "+0.00"):
                self.assertIn(value, prose)
            self.assertEqual(prose.count("−2.50"), 2)  # Body and figure caption.
            equations = xml.findall(".//m:oMath", ns)
            self.assertEqual(len(equations), 4)
            self.assertIsNotNone(xml.find(".//m:f", ns))
            self.assertIn(
                "42",
                "".join(t.text or "" for t in xml.findall(".//m:oMathPara//m:t", ns)),
            )
            for value, colour in (("−2.50", "D32F2F"), ("+1.25", "1976D2")):
                run = next(
                    run
                    for run in xml.findall(".//w:r", ns)
                    if value in "".join(t.text or "" for t in run.findall("w:t", ns))
                )
                self.assertEqual(
                    run.find("w:rPr/w:color", ns).get("{" + ns["w"] + "}val"), colour
                )

    def test_upright_greek_labels_preserve_symbolic_math_and_descriptive_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = Path(tmp) / "main.tex"
            (Path(tmp) / "assets").mkdir()
            (Path(tmp) / "assets/panel.png").write_bytes(png())
            source = PREAMBLE.replace(
                r"\begin{document}", r"\usepackage{upgreek,xcolor}\begin{document}"
            ) + (
                r"Labels C\(\upalpha\), \(\upbeta3\), Y86. "
                r"Variable \(\chi_1\) and \(H_{\mathrm{norm}}\); mixed \(\upalpha+x\). "
                r"\textcolor[HTML]{D32F2F}{\(\upalpha\)}."
                + FIGURE.replace("../assets/panel.png", "assets/panel.png").replace(
                    "Complete detailed caption with {nested} text.",
                    r"Label \(\upalpha\) and variable \(\chi_2\).",
                )
                + "\n\\end{document}\n"
            )
            doc.write_text(source)
            export.compile_all(doc)
            self.assertEqual(doc.read_text(), source)
            with zipfile.ZipFile(doc.with_suffix(".docx")) as archive:
                xml = ET.fromstring(archive.read("word/document.xml"))
            ns = {
                "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
            }
            runs = xml.findall(".//m:r", ns)
            for letter in ("α", "n", "o", "r", "m"):
                matches = [
                    r for r in runs if r.findtext("m:t", namespaces=ns) == letter
                ]
                self.assertTrue(matches, letter)
                for run in matches:
                    self.assertEqual(
                        run.find("m:rPr/m:sty", ns).get("{" + ns["m"] + "}val"), "p"
                    )
            for letter in ("χ", "H"):
                run = next(
                    r for r in runs if r.findtext("m:t", namespaces=ns) == letter
                )
                self.assertIsNone(run.find("m:rPr/m:sty", ns))
            prose = "".join(t.text or "" for t in xml.findall(".//w:t", ns))
            self.assertIn("Cα", prose)
            self.assertIn("β3", prose)
            self.assertNotIn("β", [r.findtext("m:t", namespaces=ns) for r in runs])
            self.assertNotIn("upalpha", "".join(xml.itertext()))

    def test_numeric_inequality_fragments_do_not_export_incomplete_equations(self):
        import tex2docx

        for fragment, expected in (
            (r"10\%<", r"10\%<"),
            (r"<40\%", r"<40\%"),
            (r"\leq10\%", r"≤10\%"),
            (r"\geq 40\%", r"≥ 40\%"),
            (r">-0.50", ">−0.50"),
            (r"\lt +.75", "< +.75"),
        ):
            for opening, closing in ((r"\(", r"\)"), ("$", "$")):
                with self.subTest(fragment=fragment, opening=opening):
                    self.assertEqual(
                        tex2docx.normalize_native_inline_math(
                            opening + fragment + closing
                        ),
                        expected,
                    )
        for expression in (r"n=46", r"10\%<x<40\%", r"\frac{1}{2}<x", r"10^{-2}"):
            self.assertEqual(
                tex2docx.normalize_native_inline_math(r"\(" + expression + r"\)"),
                r"\(" + expression + r"\)",
            )
        with tempfile.TemporaryDirectory() as tmp:
            doc = Path(tmp) / "main.tex"
            (Path(tmp) / "assets").mkdir()
            (Path(tmp) / "assets/panel.png").write_bytes(png())
            source = PREAMBLE.replace(
                r"\begin{document}", r"\usepackage{xcolor}\begin{document}"
            ) + (
                r"Prose \textcolor[HTML]{D32F2F}{\(10\%<\)} value "
                r"\textcolor[HTML]{1976D2}{$<40\%$}. Counts \(n=46\). "
                r"Complete symbolic \(10\%<x<40\%\). Display \[10\%<40\%\]."
                + FIGURE.replace("../assets/panel.png", "assets/panel.png").replace(
                    "Complete detailed caption with {nested} text.",
                    r"Threshold \(10\%<\) value \(<40\%\); \(n=29\).",
                )
                + "\n\\end{document}\n"
            )
            doc.write_text(source)
            original = doc.read_bytes()
            export.compile_all(doc)
            self.assertEqual(doc.read_bytes(), original)
            with zipfile.ZipFile(doc.with_suffix(".docx")) as archive:
                xml = ET.fromstring(archive.read("word/document.xml"))
            ns = {
                "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
            }
            equations = [
                "".join(t.text or "" for t in math.findall(".//m:t", ns))
                for math in xml.findall(".//m:oMath", ns)
            ]
            self.assertNotIn("10%<", equations)
            self.assertNotIn("<40%", equations)
            self.assertIn("n=46", equations)
            self.assertIn("n=29", equations)
            self.assertIn("10%<x<40%", equations)
            self.assertIn("10%<40%", equations)
            for text, colour in (("10%<", "D32F2F"), ("<40%", "1976D2")):
                run = next(
                    r
                    for r in xml.findall(".//w:r", ns)
                    if text in "".join(t.text or "" for t in r.findall("w:t", ns))
                )
                self.assertEqual(
                    run.find("w:rPr/w:color", ns).get("{" + ns["w"] + "}val"),
                    colour,
                )

    def test_highlights_preserve_text_nested_formatting_and_native_equations(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = Path(tmp) / "main.tex"
            doc.write_text(
                PREAMBLE.replace(
                    r"\begin{document}", r"\usepackage{soul,xcolor}\begin{document}"
                )
                + r"\newcommand{\redtext}[1]{\textcolor[HTML]{D32F2F}{#1}}"
                + r"\newcommand{\pihighlight}[1]{\hl{#1}}"
                + r"Before \hl{\textbf{Highlighted words}}, after. "
                + r"\textcolor[HTML]{D32F2F}{\pihighlight{Coloured words}}. Equation \hl{$x+1$}."
                + "\n\\end{document}\n"
            )
            original = doc.read_bytes()
            export.compile_all(doc)
            self.assertEqual(doc.read_bytes(), original)
            with zipfile.ZipFile(doc.with_suffix(".docx")) as archive:
                xml = ET.fromstring(archive.read("word/document.xml"))
            ns = {
                "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
                "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
            }
            text = "".join(xml.itertext())
            self.assertIn(
                "Before Highlighted words, after. Coloured words. Equation", text
            )
            self.assertNotIn("CODXREV", text)
            for value in ("Highlighted words", "Coloured words"):
                run = next(
                    run
                    for run in xml.findall(".//w:r", ns)
                    if value in "".join(t.text or "" for t in run.findall("w:t", ns))
                )
                self.assertEqual(
                    run.find("w:rPr/w:highlight", ns).get("{" + ns["w"] + "}val"),
                    "yellow",
                )
                if value == "Coloured words":
                    self.assertEqual(
                        run.find("w:rPr/w:color", ns).get("{" + ns["w"] + "}val"),
                        "D32F2F",
                    )
                else:
                    self.assertIsNotNone(run.find("w:rPr/w:b", ns))
            math = xml.find(".//m:oMath", ns)
            self.assertIsNotNone(math)
            self.assertIsNotNone(math.find(".//w:highlight", ns))

    def test_compile_preserves_native_word_equations(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc = Path(tmp) / "main.tex"
            doc.write_text(
                PREAMBLE.replace(
                    r"\documentclass{article}", r"\documentclass[11pt]{article}"
                )
                + r"\newcommand{\newdata}[1]{#1}"
                + r"Entropy follows \newdata{\(H=-\sum_{i=1}^{K}p_i\ln(p_i)\)}. "
                + r"Correlation follows \(r=\sqrt{1-e^{-2I/3}}\)."
                + r" Mg\(^{2+}\) and \newdata{\(\lvert\Delta H_{\mathrm{norm}}\rvert\geq0.15\)}."
                + r" \newdata{Network observations remain intact}."
                + r" Units are kcal mol\(^{-1}\) \AA\(^{-2}\)."
                + r" Alternative Mg$^{2+}$ units mol$^{-1}$ \AA$^{-2}$ and $|x|$ remain editable."
                + "\n\\end{document}\n"
            )
            export.compile_all(doc)
            with zipfile.ZipFile(doc.with_suffix(".docx")) as archive:
                xml = ET.fromstring(archive.read("word/document.xml"))
                styles = ET.fromstring(archive.read("word/styles.xml"))
            ns = {
                "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
                "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            }
            for style_id in (
                "Normal",
                "BodyText",
                "FirstParagraph",
                "Compact",
                "Abstract",
                "Bibliography",
            ):
                style = styles.find(f'.//w:style[@w:styleId="{style_id}"]', ns)
                if style is not None:
                    self.assertEqual(
                        style.find("w:pPr/w:jc", ns).get("{" + ns["w"] + "}val"),
                        "left",
                    )
            self.assertEqual(
                styles.find(".//w:docDefaults/w:pPrDefault/w:pPr/w:jc", ns).get(
                    "{" + ns["w"] + "}val"
                ),
                "left",
            )
            normal = styles.find('.//w:style[@w:styleId="Normal"]', ns)
            self.assertEqual(
                normal.find("w:rPr/w:sz", ns).get("{" + ns["w"] + "}val"), "22"
            )
            self.assertEqual(
                normal.find("w:pPr/w:ind", ns).get("{" + ns["w"] + "}firstLine"),
                "360",
            )
            self.assertEqual(len(xml.findall(".//m:oMath", ns)), 4)
            self.assertIsNotNone(xml.find(".//m:nary", ns))
            self.assertIsNotNone(xml.find(".//m:rad", ns))
            self.assertIsNotNone(xml.find(".//m:d", ns))
            self.assertNotIn("\u200b", "".join(xml.itertext()))
            self.assertIsNotNone(
                xml.find('.//w:rPr/w:vertAlign[@w:val="superscript"]', ns)
            )
            self.assertIn("Mg", "".join(xml.itertext()))
            self.assertIn("2+", "".join(xml.itertext()))
            superscripts = [
                "".join(run.itertext())
                for run in xml.findall(".//w:r", ns)
                if run.find('w:rPr/w:vertAlign[@w:val="superscript"]', ns) is not None
            ]
            for value in ("2+", "-1", "-2"):
                self.assertEqual(superscripts.count(value), 2)
            self.assertEqual(len(xml.findall(".//m:d", ns)), 2)
            self.assertIn(
                "Network observations remain intact.", "".join(xml.itertext())
            )
            self.assertNotIn("textsuperscript", "".join(xml.itertext()))
            self.assertEqual(
                xml.find(".//m:naryPr/m:ctrlPr/w:rPr/w:color", ns).get(
                    "{" + ns["w"] + "}val"
                ),
                "D32F2F",
            )
            for run in xml.find(".//m:oMath", ns).findall(".//m:r", ns):
                self.assertEqual(
                    run.find("w:rPr/w:color", ns).get("{" + ns["w"] + "}val"),
                    "D32F2F",
                )

    def test_combined_and_independent_documents_and_figures(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".localleaf.json").write_text("{}")
            (root / "assets").mkdir()
            (root / "assets/panel.png").write_bytes(png())
            (root / "references").mkdir()
            (root / "references/references.bib").write_text(
                "@article{Example, author={Person, A.}, title={Useful reference}, journal={Preserved Journal}, year={2020}, doi={10.1234/example}}\n"
            )
            sources = {
                "combined": PREAMBLE + MAIN + SUPP + TAIL,
                "main": PREAMBLE + MAIN + TAIL,
                "supplementary": PREAMBLE + SUPP + TAIL,
            }
            for name, source in sources.items():
                folder = root / name
                folder.mkdir()
                doc = folder / (name + ".tex")
                doc.write_text(source)
                report = export.execute(doc, "build")
                self.assertTrue(report["checks"]["pdf_prose_coverage"])
                self.assertEqual(
                    report["checks"]["docx_images"], 4 if name == "combined" else 2
                )
                figures = export.execute(doc, "figures")
                self.assertEqual(
                    figures["checks"]["figures"],
                    ["1", "S1"]
                    if name == "combined"
                    else ["S1"]
                    if name == "supplementary"
                    else ["1"],
                )
                text = subprocess.check_output(
                    ["pdftotext", str(folder / "figures.pdf"), "-"], text=True
                )
                self.assertIn("Figure ", text)
                self.assertNotIn("detailed", text)
                self.assertEqual(doc.read_text(), source)
                self.assertFalse((folder / "figures.tex").exists())
                self.assertFalse((folder / "main_text.tex").exists())
            doc = root / "main/main.tex"
            export.execute(doc, "build", "dois")
            self.assertIn(
                "10.1234/example",
                subprocess.check_output(
                    ["pdftotext", str(doc.with_suffix(".pdf")), "-"], text=True
                ),
            )
            export.execute(doc, "figures")
            saved = doc.with_suffix(".pdf").read_bytes()
            doc.write_text(
                sources["main"].replace("Main prose", r"\badcommand Main prose")
            )
            with self.assertRaises(export.ExportError):
                export.execute(doc, "build")
            self.assertEqual(doc.with_suffix(".pdf").read_bytes(), saved)
            doc.write_text(
                PREAMBLE
                + "A short report without supplements or figures.\\end{document}"
            )
            export.execute(doc, "build")
            oldfig = (doc.parent / "figures.pdf").read_bytes()
            with self.assertRaisesRegex(export.ExportError, "no figures"):
                export.execute(doc, "figures")
            self.assertEqual((doc.parent / "figures.pdf").read_bytes(), oldfig)
            (doc.parent / "figures.pdf").write_bytes(b"hand edited")
            with self.assertRaisesRegex(export.ExportError, "edited export"):
                export.execute(doc, "figures")
            # An independent document cannot claim another document's figure PDF.
            other = doc.parent / "other.tex"
            other.write_text(sources["main"])
            with self.assertRaisesRegex(export.ExportError, "another document"):
                export.execute(other, "figures")
            json.loads((doc.parent / ".main-export.json").read_text())

    def test_unified_build_publishes_together_and_retires_owned_figures(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".localleaf.json").write_text("{}")
            (root / "assets").mkdir()
            (root / "assets/panel.png").write_bytes(png())
            folder = root / "main"
            folder.mkdir()
            doc = folder / "main.tex"
            source = PREAMBLE + "Some text." + FIGURE + r"\end{document}"
            doc.write_text(source)
            report = export.execute(doc, "compile")
            self.assertEqual(report["checks"]["figure_pdf"]["pages"], 1)
            original = {
                p.name: p.read_bytes()
                for p in folder.iterdir()
                if p.suffix in {".pdf", ".docx", ".json"}
            }
            real_execute = export.execute

            def fail_figures(document, action, mode="numbers"):
                if action == "figures":
                    raise export.ExportError("figure stage failed")
                return real_execute(document, action, mode)

            doc.write_text(source.replace("Some text.", "Updated text."))
            with patch.object(export, "execute", side_effect=fail_figures):
                with self.assertRaisesRegex(export.ExportError, "figure stage failed"):
                    export.compile_all(doc)
            for name, data in original.items():
                self.assertEqual((folder / name).read_bytes(), data)
            doc.write_text(PREAMBLE + r"No figures now.\end{document}")
            (folder / "figures.pdf").write_bytes(b"manual edit")
            with self.assertRaisesRegex(export.ExportError, "edited export"):
                export.execute(doc, "compile")
            (folder / "figures.pdf").write_bytes(original["figures.pdf"])
            report = export.execute(doc, "compile")
            self.assertEqual(report["checks"]["figure_pdf"], "not needed")
            self.assertFalse((folder / "figures.pdf").exists())
            self.assertFalse((folder / ".figures-export.json").exists())
            (folder / "figures.pdf").write_bytes(b"unowned figure")
            export.execute(doc, "compile")
            self.assertEqual((folder / "figures.pdf").read_bytes(), b"unowned figure")

    def test_achemso_long_author_list_retains_et_al_in_word(self):
        import tex2docx

        cleaned = tex2docx.clean_achemso_bbl(
            r"\providecommand{\latin}[1]{#1}"
            r"\bibitem{long} Person, A. \latin{et~al.} \newblock {IntactTitle}.",
            {"long": "1"},
        )
        self.assertIn("et~al.", cleaned)
        self.assertNotIn(r"\latin", cleaned)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            doc = root / "paper.tex"
            doc.write_text(
                r"\documentclass{article}\usepackage[numbers]{natbib}"
                r"\begin{document}Long citation\cite{long}; short citation\cite{short}."
                r"\bibliographystyle{achemso}\bibliography{references}\end{document}"
            )
            authors = " and ".join(f"Person{i}, A." for i in range(16))
            (root / "references.bib").write_text(
                "@article{long,author={" + authors + "},title={IntactTitle},"
                "journal={Test Journal},year={2023},volume={63},pages={6183--6191}}\n"
                "@article{short,author={Doe, Jane and Roe, Richard},title={ShortTitle},"
                "journal={Test Journal},year={2023},volume={63},pages={1--2}}"
            )
            export.execute(doc, "compile")
            from docx import Document

            paragraphs = [
                p.text.replace("\u00a0", " ")
                for p in Document(doc.with_suffix(".docx")).paragraphs
            ]
            long = next(p for p in paragraphs if "IntactTitle" in p)
            short = next(p for p in paragraphs if "ShortTitle" in p)
            self.assertIn("et al.", long)
            self.assertIn("6183–6191", long)
            self.assertIn("Doe", short)
            self.assertIn("Roe", short)
            self.assertNotIn("et al.", short)

    def test_numeric_citations_have_real_word_superscripts_and_matching_ranges(self):
        import tex2docx

        style_source = r"\usepackage[super,sort&compress]{natbib}"
        converted = tex2docx.replace_citations(
            style_source + r" Citations\cite{d,c,b,a}.",
            {"a": "1", "b": "2", "c": "3", "d": "6"},
        )
        self.assertIn(r"\textsuperscript{1--3,6}", converted)
        bracketed = tex2docx.replace_citations(
            r"Citation\cite{a,b}.", {"a": "1", "b": "2"}
        )
        self.assertEqual(bracketed, "Citation[1,2].")
        self.assertIn(
            "[a]",
            tex2docx.replace_citations(
                style_source + r"\cite{a}", {"a": "1"}, mode="keys"
            ),
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            doc = root / "paper.tex"
            doc.write_text(
                r"\documentclass{article}"
                + style_source
                + r"\begin{document}Cited result\cite{a,b,c}."
                + "\n"
                + r"\bibliographystyle{unsrtnat}\bibliography{references}\end{document}"
            )
            (root / "references.bib").write_text(
                "\n".join(
                    "@article{"
                    + key
                    + ",author={Person, A.},title={{PreservedTitle} Reference "
                    + key
                    + "},journal={Preserved Journal},year={2020},doi={10.1234/reference}}"
                    for key in "abc"
                )
            )
            export.execute(doc, "compile")
            with zipfile.ZipFile(doc.with_suffix(".docx")) as archive:
                xml = ET.fromstring(archive.read("word/document.xml"))
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            values = [
                "".join(run.itertext())
                for run in xml.findall(".//w:r", ns)
                if run.find('w:rPr/w:vertAlign[@w:val="superscript"]', ns) is not None
            ]
            self.assertIn("1–3", values)
            body = " ".join(xml.itertext())
            self.assertIn("PreservedTitle", body)
            self.assertIn("Preserved Journal", body)
            self.assertIn("10.1234/reference", body)
            with zipfile.ZipFile(doc.with_suffix(".docx")) as archive:
                parts = [
                    n
                    for n in archive.namelist()
                    if n.startswith("word/footer") and n.endswith(".xml")
                ]
                self.assertTrue(parts)
                for name in parts:
                    footer = ET.fromstring(archive.read(name))
                    for paragraph in footer.findall(".//w:p", ns):
                        self.assertIsNotNone(
                            paragraph.find("w:pPr/w:suppressLineNumbers", ns)
                        )

    def test_authblk_authors_and_affiliations_exported_to_docx(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            doc = root / "main.tex"
            doc.write_text(
                r"\documentclass{article}"
                r"\usepackage{authblk}"
                r"\title{Paper Title}"
                r"\author[1,2]{First Author}"
                r"\author[1]{Second Author}"
                r"\affil[1]{Department One, University}"
                r"\affil[2]{Department Two, University}"
                r"\date{*Correspondence: author@university.edu}"
                r"\begin{document}"
                r"Main body prose."
                r"\end{document}"
            )
            export.execute(doc, "compile")
            with zipfile.ZipFile(doc.with_suffix(".docx")) as archive:
                xml = ET.fromstring(archive.read("word/document.xml"))
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            text = " ".join("".join(p.itertext()) for p in xml.findall(".//w:p", ns))
            self.assertIn("First Author", text)
            self.assertIn("Second Author", text)
            self.assertIn("Department One, University", text)
            self.assertIn("Department Two, University", text)
            self.assertIn("*Correspondence: author@university.edu", text)
            superscripts = [
                "".join(run.itertext())
                for run in xml.findall(".//w:r", ns)
                if run.find('w:rPr/w:vertAlign[@w:val="superscript"]', ns) is not None
            ]
            self.assertIn("1,2", superscripts)
            self.assertIn("1", superscripts)
            self.assertIn("2", superscripts)


if __name__ == "__main__":
    unittest.main()

import shutil
import zipfile

import pytest
from docx import Document
from localleaf.export.docx import export_latex_to_docx
from localleaf.export.legacy import postprocess_docx_typography


def test_legacy_typography_units(tmp_path):
    path = tmp_path / "test.docx"
    document = Document()
    document.add_paragraph("Example")
    document.save(path)
    postprocess_docx_typography(path, space_after_pt=2)
    result = Document(path)
    assert result.sections[0].left_margin.inches == 0.75
    assert result.paragraphs[0].paragraph_format.space_after.pt == 2


@pytest.mark.skipif(not shutil.which("pandoc"), reason="Pandoc not installed")
def test_docx_contains_text_and_native_math(tmp_path):
    source = tmp_path / "main.tex"
    source.write_text(
        r"\documentclass{article}\begin{document}Example $x^{2}+y^{2}=z^{2}$\end{document}"
    )
    output = tmp_path / "main.docx"
    success, message = export_latex_to_docx(source, output)
    assert success, message
    with zipfile.ZipFile(output) as archive:
        xml = archive.read("word/document.xml").decode()
    assert "Example" in xml
    assert "oMath" in xml


@pytest.mark.skipif(not shutil.which("pdflatex"), reason="LaTeX not installed")
def test_pdf_compilation(tmp_path):
    from localleaf.documents import LocalLeafState

    source = tmp_path / "main.tex"
    source.write_text(r"\documentclass{article}\begin{document}Example\end{document}")
    doc = LocalLeafState(source)
    result = doc.compile()
    assert result["success"], result["log"]
    assert doc.output_pdf.read_bytes().startswith(b"%PDF")


def test_cv_visual_formatting_exports_to_word(tmp_path):
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from localleaf.export.legacy import export_latex_cv_to_docx

    source = tmp_path / "cv.tex"
    source.write_text(r"""\documentclass{article}
\newcommand{\cvsection}[1]{\section*{#1}}
\begin{document}
{\raggedleft \cvsection{Education}
\par}
\vspace{4pt}
{\fontsize{14pt}{18pt}\selectfont\textbf{Example formatted paragraph}}\par
\end{document}""")
    output = tmp_path / "cv.docx"
    success, message = export_latex_cv_to_docx(source, output)
    assert success, message
    document = Document(output)
    heading = next(p for p in document.paragraphs if p.text == "Education")
    assert heading.alignment == WD_ALIGN_PARAGRAPH.RIGHT
    assert heading.paragraph_format.space_after.pt == 4
    paragraph = next(p for p in document.paragraphs if "Example formatted" in p.text)
    assert all(run.font.size.pt == 14 for run in paragraph.runs)
    assert all(run.bold for run in paragraph.runs)
    assert paragraph.paragraph_format.line_spacing.pt == 18

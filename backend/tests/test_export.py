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

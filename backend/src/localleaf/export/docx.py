"""General DOCX export. Preserve Pandoc's native equation representation."""

import os
import shutil
import subprocess
from pathlib import Path


def export_latex_to_docx(tex_path, out_docx_path, build_dir=None, **options):
    # CV documents use the handover's direct layout-aware exporter.
    from .legacy import export_latex_cv_to_docx, is_cv_document

    if is_cv_document(Path(tex_path).read_text(encoding="utf-8")):
        return export_latex_cv_to_docx(
            Path(tex_path),
            Path(out_docx_path),
            line_spacing=options.get("line_spacing", 1.15),
            space_after_pt=options.get("space_after_pt", 2.0),
        )
    executable = shutil.which("pandoc")
    if not executable:
        return False, "Install Pandoc and ensure it is on PATH to export DOCX."
    tex_path, out_docx_path = Path(tex_path), Path(out_docx_path)
    out_docx_path.parent.mkdir(parents=True, exist_ok=True)
    # Write a temporary output so failed conversion cannot replace a good export.
    import tempfile

    with tempfile.TemporaryDirectory(
        prefix=".localleaf-docx-", dir=out_docx_path.parent
    ) as temporary:
        result_path = Path(temporary) / "document.docx"
        result = subprocess.run(
            [
                executable,
                str(tex_path),
                "--from=latex",
                "--to=docx",
                "--standalone",
                "--citeproc",
                "--output",
                str(result_path),
                "--resource-path",
                str(tex_path.parent),
            ],
            cwd=tex_path.parent,
            capture_output=True,
            text=True,
            timeout=90,
        )
        if result.returncode or not result_path.exists():
            return False, result.stderr.strip() or "Pandoc conversion failed."
        os.replace(result_path, out_docx_path)
    warning = result.stderr.strip()
    return True, "DOCX exported. Review layout and references." + (
        "\n" + warning if warning else ""
    )

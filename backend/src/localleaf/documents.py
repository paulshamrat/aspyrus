"""Document storage and LaTeX compilation for the local application."""

import hashlib
import os
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path


def export_latex_to_docx(*args, **kwargs):
    from .export.docx import export_latex_to_docx as export

    return export(*args, **kwargs)


class ConflictError(Exception):
    pass


class LocalLeafState:
    def __init__(self, target_file=None, output_dir=None):
        self.lock = threading.RLock()
        self.target_file = Path(target_file or "main.tex").resolve()
        self.output_dir = (
            Path(output_dir).resolve()
            if output_dir
            else self.target_file.parent / ".localleaf_build"
        )

        self.output_pdf = self.output_dir / f"{self.target_file.stem}.pdf"
        self.output_log = self.output_dir / f"{self.target_file.stem}.log"
        self.output_docx = self.output_dir / f"{self.target_file.stem}.docx"

    def get_info(self):
        with self.lock:
            return {
                "file_path": str(self.target_file),
                "file_name": self.target_file.name,
                "file_dir": str(self.target_file.parent),
                "output_dir": str(self.output_dir),
                "output_pdf": str(self.output_pdf),
                "output_docx": str(self.output_docx),
                "pdf_exists": self.output_pdf.exists(),
                "docx_exists": self.output_docx.exists(),
                "file_exists": self.target_file.exists(),
                "mtime": self.target_file.stat().st_mtime if self.target_file.exists() else 0,
                "revision": self.revision(),
            }

    def export_docx(self, line_spacing=1.15, space_after_pt=2.0):
        with self.lock:
            if not self.target_file.exists():
                return {"success": False, "error": f"File not found: {self.target_file}"}
            try:
                ok, msg = export_latex_to_docx(
                    self.target_file,
                    out_docx_path=self.output_docx,
                    build_dir=self.output_dir,
                    line_spacing=line_spacing,
                    space_after_pt=space_after_pt,
                )
                size = self.output_docx.stat().st_size if self.output_docx.exists() else 0
                return {
                    "success": ok,
                    "message": msg,
                    "output_docx": str(self.output_docx),
                    "file_name": self.output_docx.name,
                    "size_bytes": size,
                }
            except Exception as e:
                return {"success": False, "error": str(e)}

    def read_content(self):
        with self.lock:
            if not self.target_file.exists():
                return ""
            with open(self.target_file, encoding="utf-8", newline="") as f:
                return f.read()

    def revision(self):
        return hashlib.sha256(
            self.target_file.read_bytes() if self.target_file.exists() else b""
        ).hexdigest()

    def write_content(self, content, revision=None):
        with self.lock:
            if revision is not None and revision != self.revision():
                raise ConflictError("File changed on disk. Reload before saving your edits.")
            self.target_file.parent.mkdir(parents=True, exist_ok=True)
            mode = self.target_file.stat().st_mode if self.target_file.exists() else 0o600
            fd, name = tempfile.mkstemp(prefix=".localleaf-", dir=self.target_file.parent)
            try:
                with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
                    f.write(content)
                    f.flush()
                    os.fsync(f.fileno())
                os.chmod(name, mode)
                os.replace(name, self.target_file)
            finally:
                if os.path.exists(name):
                    os.unlink(name)
            return self.revision()

    def compile(self, engine="pdflatex"):
        if engine not in {"pdflatex", "xelatex", "lualatex"}:
            raise ValueError("Unsupported LaTeX engine")
        with self.lock:
            if not self.target_file.exists():
                return {
                    "success": False,
                    "duration": "0s",
                    "errors": [{"line": 1, "message": f"File not found: {self.target_file}"}],
                    "warnings": [],
                    "log": "",
                }

            start_time = time.time()
            self.output_dir.mkdir(parents=True, exist_ok=True)

            cmd = [
                engine,
                "-interaction=nonstopmode",
                "-synctex=1",
                "-no-shell-escape",
                f"-output-directory={self.output_dir}",
                str(self.target_file),
            ]

            try:
                proc = subprocess.run(
                    cmd,
                    cwd=str(self.target_file.parent),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=45,
                )
                raw_output = proc.stdout
                exit_code = proc.returncode
            except subprocess.TimeoutExpired:
                return {
                    "success": False,
                    "duration": "45s",
                    "errors": [{"line": 1, "message": "Compilation timed out after 45 seconds."}],
                    "warnings": [],
                    "log": "Timeout expired.",
                }
            except Exception as e:
                return {
                    "success": False,
                    "duration": "0s",
                    "errors": [{"line": 1, "message": f"Execution error: {str(e)}"}],
                    "warnings": [],
                    "log": str(e),
                }

            duration = f"{time.time() - start_time:.2f}s"

            log_content = raw_output
            if self.output_log.exists():
                try:
                    with open(self.output_log, encoding="utf-8", errors="replace") as f:
                        log_content = f.read()
                except Exception:
                    pass

            errors, warnings = parse_latex_log(log_content)
            success = (exit_code == 0) and self.output_pdf.exists()

            if not success and len(errors) == 0:
                errors.append(
                    {
                        "line": 1,
                        "message": f"Compiler exited with code {exit_code}. Check raw log for details.",
                    }
                )

            return {
                "success": success,
                "duration": duration,
                "errors": errors,
                "warnings": warnings,
                "log": log_content,
                "pdf_exists": self.output_pdf.exists(),
            }


def parse_latex_log(log_text):
    errors = []
    warnings = []

    lines = log_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]

        if line.startswith("! "):
            msg = line[2:].strip()
            err_line = 1
            snippet = ""
            j = i + 1
            while j < min(i + 8, len(lines)):
                next_line = lines[j]
                m = re.match(r"^l\.(\d+)\s*(.*)", next_line)
                if m:
                    err_line = int(m.group(1))
                    snippet = m.group(2).strip()
                    break
                elif next_line.startswith("! "):
                    break
                j += 1

            errors.append({"line": err_line, "message": msg, "snippet": snippet})

        elif "Warning:" in line:
            m = re.search(r"line\s+(\d+)", line, re.IGNORECASE)
            warn_line = int(m.group(1)) if m else 1
            warnings.append({"line": warn_line, "message": line.strip()})

        i += 1

    return errors, warnings

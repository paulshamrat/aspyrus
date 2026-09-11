#!/usr/bin/env python3
"""
LocalLeaf Server
A lightweight, offline-first local LaTeX editor inspired by Overleaf.
"""

import os
import sys
import json
import time
import re
import argparse
import subprocess
import threading
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pathlib import Path

from docx_exporter import export_latex_to_docx

# Defaults
DEFAULT_PORT = 4848
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
MONACO_DIR = BASE_DIR / "node_modules" / "monaco-editor" / "min"

class LocalLeafState:
    def __init__(self, target_file=None, output_dir=None):
        self.lock = threading.Lock()
        self.recent_files = []
        self.set_target(target_file, output_dir)

    def set_target(self, target_file, output_dir=None):
        if target_file:
            self.target_file = Path(target_file).resolve()
        else:
            cwd_main = Path.cwd() / "main.tex"
            cv_main = Path("/home/paul/cv/pauls/scripts/main.tex")
            if cwd_main.exists():
                self.target_file = cwd_main.resolve()
            elif cv_main.exists():
                self.target_file = cv_main.resolve()
            else:
                self.target_file = cwd_main.resolve()

        if str(self.target_file) not in self.recent_files:
            self.recent_files.insert(0, str(self.target_file))

        # Determine output directory
        if output_dir:
            self.output_dir = Path(output_dir).resolve()
        else:
            parent = self.target_file.parent
            grandparent = parent.parent
            sibling_data_output = grandparent / "data" / "output"
            if parent.name == "scripts" and sibling_data_output.exists():
                self.output_dir = sibling_data_output.resolve()
            elif parent.name == "scripts" and (grandparent / "data").exists():
                sibling_data_output.mkdir(parents=True, exist_ok=True)
                self.output_dir = sibling_data_output.resolve()
            else:
                default_build = parent / ".localleaf_build"
                default_build.mkdir(parents=True, exist_ok=True)
                self.output_dir = default_build.resolve()

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
                "recent_files": self.recent_files[:10]
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
                    "size_bytes": size
                }
            except Exception as e:
                return {"success": False, "error": str(e)}

    def read_content(self):
        with self.lock:
            if not self.target_file.exists():
                return ""
            with open(self.target_file, "r", encoding="utf-8", errors="replace") as f:
                return f.read()

    def write_content(self, content):
        with self.lock:
            self.target_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.target_file, "w", encoding="utf-8") as f:
                f.write(content)
            return self.target_file.stat().st_mtime

    def compile(self, engine="pdflatex"):
        with self.lock:
            if not self.target_file.exists():
                return {
                    "success": False,
                    "duration": "0s",
                    "errors": [{"line": 1, "message": f"File not found: {self.target_file}"}],
                    "warnings": [],
                    "log": ""
                }

            start_time = time.time()
            self.output_dir.mkdir(parents=True, exist_ok=True)

            cmd = [
                engine,
                "-interaction=nonstopmode",
                "-synctex=1",
                f"-output-directory={self.output_dir}",
                str(self.target_file)
            ]

            try:
                proc = subprocess.run(
                    cmd,
                    cwd=str(self.target_file.parent),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    timeout=45
                )
                raw_output = proc.stdout
                exit_code = proc.returncode
            except subprocess.TimeoutExpired:
                return {
                    "success": False,
                    "duration": "45s",
                    "errors": [{"line": 1, "message": "Compilation timed out after 45 seconds."}],
                    "warnings": [],
                    "log": "Timeout expired."
                }
            except Exception as e:
                return {
                    "success": False,
                    "duration": "0s",
                    "errors": [{"line": 1, "message": f"Execution error: {str(e)}"}],
                    "warnings": [],
                    "log": str(e)
                }

            duration = f"{time.time() - start_time:.2f}s"

            log_content = raw_output
            if self.output_log.exists():
                try:
                    with open(self.output_log, "r", encoding="utf-8", errors="replace") as f:
                        log_content = f.read()
                except Exception:
                    pass

            errors, warnings = parse_latex_log(log_content)
            success = (exit_code == 0) and self.output_pdf.exists()

            if not success and len(errors) == 0:
                errors.append({
                    "line": 1,
                    "message": f"Compiler exited with code {exit_code}. Check raw log for details."
                })

            return {
                "success": success,
                "duration": duration,
                "errors": errors,
                "warnings": warnings,
                "log": log_content,
                "pdf_exists": self.output_pdf.exists()
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

            errors.append({
                "line": err_line,
                "message": msg,
                "snippet": snippet
            })

        elif "Warning:" in line:
            m = re.search(r"line\s+(\d+)", line, re.IGNORECASE)
            warn_line = int(m.group(1)) if m else 1
            warnings.append({
                "line": warn_line,
                "message": line.strip()
            })

        i += 1

    return errors, warnings


state = None

class LocalLeafHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_HEAD(self):
        self.handle_get_or_head(head_only=True)

    def do_GET(self):
        self.handle_get_or_head(head_only=False)

    def handle_get_or_head(self, head_only=False):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            self.serve_file(STATIC_DIR / "index.html", "text/html; charset=utf-8", head_only=head_only)
        elif path.startswith("/static/"):
            rel_path = path[len("/static/"):]
            file_path = STATIC_DIR / rel_path
            self.serve_file(file_path, head_only=head_only)
        elif path.startswith("/pdfjs/"):
            rel_path = path[len("/pdfjs/"):]
            file_path = BASE_DIR / "node_modules" / "pdfjs-dist" / "build" / rel_path
            self.serve_file(file_path, head_only=head_only)
        elif path.startswith("/monaco/"):
            rel_path = path[len("/monaco/"):]
            file_path = MONACO_DIR / rel_path
            self.serve_file(file_path, head_only=head_only)
        elif path == "/api/file_info":
            self.send_json(state.get_info(), head_only=head_only)
        elif path == "/api/get_content":
            content = state.read_content()
            self.send_json({
                "content": content,
                "mtime": state.target_file.stat().st_mtime if state.target_file.exists() else 0
            }, head_only=head_only)
        elif path == "/api/pdf":
            if state.output_pdf.exists():
                self.serve_file(state.output_pdf, "application/pdf", head_only=head_only)
            else:
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                if not head_only:
                    self.wfile.write(b"PDF has not been compiled yet.")
        elif path == "/api/docx":
            if state.output_docx.exists():
                self.serve_file(state.output_docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", head_only=head_only)
            else:
                self.send_response(404)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                if not head_only:
                    self.wfile.write(b"DOCX has not been compiled yet.")
        elif path == "/api/log":
            if state.output_log.exists():
                self.serve_file(state.output_log, "text/plain; charset=utf-8", head_only=head_only)
            else:
                self.send_response(404)
                self.end_headers()
        elif path == "/api/browse":
            query = parse_qs(parsed.query)
            root_dir = query.get("dir", [str(state.target_file.parent.parent)])[0]
            tex_files = []
            try:
                p = Path(root_dir)
                for f in p.rglob("*.tex"):
                    parts = set(f.parts)
                    if not parts.intersection({".git", "node_modules", ".localleaf_build", ".cache"}):
                        tex_files.append({
                            "path": str(f.resolve()),
                            "rel_path": str(f.relative_to(p)),
                            "name": f.name
                        })
            except Exception:
                pass
            self.send_json({"files": tex_files}, head_only=head_only)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8", errors="replace") if length > 0 else ""
        data = json.loads(body) if body else {}

        if path == "/api/save_content":
            content = data.get("content", "")
            mtime = state.write_content(content)
            self.send_json({"success": True, "mtime": mtime})

        elif path == "/api/compile":
            content = data.get("content", None)
            if content is not None:
                state.write_content(content)
            engine = data.get("engine", "pdflatex")
            res = state.compile(engine=engine)
            self.send_json(res)

        elif path == "/api/export_docx":
            content = data.get("content", None)
            if content is not None:
                state.write_content(content)
            try:
                line_spacing = float(data.get("line_spacing", 1.15))
            except Exception:
                line_spacing = 1.15
            try:
                space_after_pt = float(data.get("space_after_pt", 2.0))
            except Exception:
                space_after_pt = 2.0
            res = state.export_docx(line_spacing=line_spacing, space_after_pt=space_after_pt)
            self.send_json(res)

        elif path == "/api/switch_file":
            new_file = data.get("file_path", "")
            if new_file and os.path.exists(new_file):
                state.set_target(new_file)
                self.send_json({"success": True, "info": state.get_info()})
            else:
                self.send_json({"success": False, "error": "File not found"})

        else:
            self.send_response(404)
            self.end_headers()

    def serve_file(self, file_path, content_type=None, head_only=False):
        if not file_path.exists() or not file_path.is_file():
            self.send_response(404)
            self.end_headers()
            return

        if not content_type:
            suffix = file_path.suffix.lower()
            types = {
                ".html": "text/html; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".mjs": "application/javascript; charset=utf-8",
                ".json": "application/json; charset=utf-8",
                ".svg": "image/svg+xml",
                ".png": "image/png",
                ".pdf": "application/pdf",
                ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".txt": "text/plain; charset=utf-8",
                ".ttf": "font/ttf",
                ".woff": "font/woff",
                ".woff2": "font/woff2"
            }
            content_type = types.get(suffix, "application/octet-stream")

        try:
            file_size = file_path.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(file_size))
            if file_path.suffix in [".pdf", ".html", ".js", ".mjs", ".css"]:
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")
            self.end_headers()

            if not head_only:
                with open(file_path, "rb") as f:
                    while chunk := f.read(65536):
                        self.wfile.write(chunk)
        except Exception:
            pass

    def send_json(self, obj, head_only=False):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()
        if not head_only:
            self.wfile.write(data)

    def log_message(self, format, *args):
        pass


def run_server(port, target_file, output_dir=None, open_browser=True):
    global state
    state = LocalLeafState(target_file, output_dir)
    server_address = ("127.0.0.1", port)

    try:
        httpd = ThreadingHTTPServer(server_address, LocalLeafHandler)
    except OSError as e:
        if e.errno == 98:
            print(f"[LocalLeaf] Port {port} is already running. Opening browser...")
            url = f"http://localhost:{port}"
            if open_browser:
                webbrowser.open(url)
            sys.exit(0)
        raise

    url = f"http://localhost:{port}"
    print("=" * 62)
    print(" 🍃  LocalLeaf - Offline Local LaTeX Editor")
    print("=" * 62)
    print(f" • Active File: {state.target_file}")
    print(f" • Output PDF:  {state.output_pdf}")
    print(f" • URL:         {url}")
    print("=" * 62)
    print("Press Ctrl+C in terminal to stop.")

    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[LocalLeaf] Stopped cleanly.")
        httpd.server_close()


def main():
    parser = argparse.ArgumentParser(description="LocalLeaf - Offline Overleaf-Style Local LaTeX Editor")
    parser.add_argument("file", nargs="?", default=None, help="Path to .tex file to edit")
    parser.add_argument("-p", "--port", type=int, default=DEFAULT_PORT, help="Port to listen on (default 4848)")
    parser.add_argument("-o", "--output-dir", default=None, help="Directory for compiled PDF")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser automatically")

    args = parser.parse_args()
    run_server(args.port, args.file, args.output_dir, not args.no_browser)


if __name__ == "__main__":
    main()

"""Loopback-only API. Each request addresses an explicitly opened document."""

import json
import mimetypes
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .documents import ConflictError, LocalLeafState
from .projects import output_directory, project_settings

ASSETS = Path(__file__).parent / "assets"
MAX_BODY = 8 * 1024 * 1024


class Application:
    def __init__(self, file, output_dir=None):
        self.lock = threading.RLock()
        self.documents = {}
        self.default = self.open(file, output_dir)

    def open(self, file, output_dir=None):
        path = Path(file).resolve()
        if path.suffix.lower() != ".tex" or (path.exists() and not path.is_file()):
            raise ValueError("Select a .tex file")
        with self.lock:
            key = str(path)
            if key not in self.documents:
                document = LocalLeafState(path, output_directory(path, output_dir))
                if any(
                    other.output_pdf == document.output_pdf for other in self.documents.values()
                ):
                    raise ValueError(
                        "Output filename collision. Configure separate output directories."
                    )
                self.documents[key] = document
            return self.documents[key]


class Handler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def trusted(self):
        host = self.headers.get("Host", "")
        port = self.server.server_port
        if host not in {f"localhost:{port}", f"127.0.0.1:{port}"}:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin == f"http://{host}"

    def respond(self, data, code=200):
        payload = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def document(self, query):
        key = query.get("file", [str(self.server.app.default.target_file)])[0]
        if key not in self.server.app.documents:
            raise ValueError("Document is not open")
        return self.server.app.documents[key]

    def serve(self, file):
        if not file.is_file():
            self.send_error(404)
            return
        data = file.read_bytes()
        self.send_response(200)
        self.send_header(
            "Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        )
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.trusted():
            self.respond({"error": "Untrusted host or origin"}, 403)
            return
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            if not parsed.path.startswith("/api/"):
                relative = unquote(parsed.path).lstrip("/") or "index.html"
                path = (ASSETS / relative).resolve()
                if not path.is_relative_to(ASSETS.resolve()):
                    self.send_error(403)
                    return
                self.serve(path)
                return
            if parsed.path == "/api/health":
                self.respond({"application": "localleaf", "version": "0.1.0a1"})
                return
            doc = self.document(query)
            with doc.lock:
                if parsed.path == "/api/document":
                    root, settings = project_settings(doc.target_file)
                    self.respond(
                        {
                            **doc.get_info(),
                            "content": doc.read_content(),
                            "engine": settings.get("engine", "pdflatex"),
                        }
                    )
                elif parsed.path == "/api/browse":
                    root, _ = project_settings(doc.target_file)
                    files = []
                    for file in root.rglob("*.tex"):
                        if not set(file.parts) & {
                            ".git",
                            "node_modules",
                            ".venv",
                            ".localleaf_build",
                        }:
                            files.append(
                                {
                                    "path": str(file.resolve()),
                                    "name": file.name,
                                    "rel_path": str(file.relative_to(root)),
                                }
                            )
                        if len(files) >= 500:
                            break
                    self.respond({"files": files})
                elif parsed.path in {"/api/pdf", "/api/docx"}:
                    self.serve(doc.output_pdf if parsed.path.endswith("pdf") else doc.output_docx)
                else:
                    self.send_error(404)
        except (ValueError, OSError) as exc:
            self.respond({"error": str(exc)}, 400)

    def do_POST(self):
        if not self.trusted() or self.headers.get("X-LocalLeaf") != "1":
            self.respond({"error": "Untrusted request"}, 403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                raise ValueError("Invalid request size (maximum 8 MiB)")
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object")
            path = urlparse(self.path).path
            if path == "/api/open":
                if not isinstance(data.get("file"), str):
                    raise ValueError("Missing file path")
                doc = self.server.app.open(data["file"])
                self.respond(doc.get_info())
                return
            if path not in {"/api/save", "/api/compile", "/api/export_docx"}:
                self.send_error(404)
                return
            key = data.get("file")
            if not isinstance(key, str) or key not in self.server.app.documents:
                raise ValueError("Document is not open")
            content, revision = data.get("content"), data.get("revision")
            if not isinstance(content, str) or not isinstance(revision, str):
                raise ValueError("Content and revision are required")
            engine = data.get("engine", "pdflatex")
            if engine not in {"pdflatex", "xelatex", "lualatex"}:
                raise ValueError("Unsupported LaTeX engine")
            doc = self.server.app.documents[key]
            with doc.lock:
                revision = doc.write_content(content, revision)
                if path == "/api/compile":
                    result = doc.compile(engine)
                elif path == "/api/export_docx":
                    result = doc.export_docx()
                else:
                    result = {"success": True}
                self.respond({**result, "revision": revision})
        except ConflictError as exc:
            self.respond({"error": str(exc)}, 409)
        except (ValueError, TypeError, OSError) as exc:
            self.respond({"error": str(exc)}, 400)

    def log_message(self, *args):
        pass


def make_server(file, port=4848, output_dir=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    try:
        server.app = Application(file, output_dir)
    except Exception:
        server.server_close()
        raise
    return server

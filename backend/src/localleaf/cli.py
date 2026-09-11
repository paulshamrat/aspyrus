"""Portable command line entry point."""

import argparse
import json
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .server import ASSETS, make_server


def main():
    parser = argparse.ArgumentParser(description="LocalLeaf — local LaTeX editor (alpha)")
    parser.add_argument("file", nargs="?", default="main.tex")
    parser.add_argument("-p", "--port", type=int, default=4848)
    parser.add_argument("-o", "--output-dir")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not (ASSETS / "index.html").exists():
        parser.error("Editor assets missing. From the source checkout run: npm ci && npm run build")
    try:
        server = make_server(args.file, args.port, args.output_dir)
    except OSError as exc:
        # Reuse only a server that identifies itself as LocalLeaf.
        base = f"http://127.0.0.1:{args.port}"
        try:
            with urlopen(base + "/api/health", timeout=2) as response:
                if json.load(response).get("application") != "localleaf":
                    raise ValueError("Port belongs to another application")
            if args.output_dir:
                raise ValueError(
                    "Use another --port when overriding output directory on a running server"
                )
            request = Request(
                base + "/api/open",
                json.dumps({"file": str(Path(args.file).resolve())}).encode(),
                {"Content-Type": "application/json", "X-LocalLeaf": "1"},
            )
            with urlopen(request, timeout=3) as response:
                info = json.load(response)
            url = base + "/?" + urlencode({"file": info["file_path"]})
        except (URLError, ValueError, OSError) as reuse_error:
            parser.error(f"Could not start server: {exc}; {reuse_error}")
        print(f"LOCALLEAF_URL={url}", flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        return
    except ValueError as exc:
        parser.error(str(exc))
    url = f"http://127.0.0.1:{server.server_port}/?" + urlencode(
        {"file": str(server.app.default.target_file)}
    )
    print(f"LOCALLEAF_URL={url}", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

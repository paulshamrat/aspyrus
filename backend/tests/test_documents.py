import json
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from localleaf.documents import ConflictError, LocalLeafState, parse_latex_log
from localleaf.projects import output_directory
from localleaf.server import make_server


def test_conflict_preserves_external_edit(tmp_path):
    file = tmp_path / "main.tex"
    file.write_text("original")
    doc = LocalLeafState(file)
    revision = doc.revision()
    file.write_text("external edit")
    with pytest.raises(ConflictError):
        doc.write_content("stale editor", revision)
    assert file.read_text() == "external edit"


def test_document_isolation_and_engine_validation(tmp_path):
    a, b = [LocalLeafState(tmp_path / name) for name in ("a.tex", "b.tex")]
    a.write_content("A", a.revision())
    b.write_content("B", b.revision())
    assert a.read_content() == "A"
    with pytest.raises(ValueError):
        a.compile("/bin/sh")


def test_output_configuration(tmp_path):
    (tmp_path / "localleaf.toml").write_text('[project]\noutput_dir="data/output"\n')
    assert output_directory(tmp_path / "scripts/main.tex") == tmp_path / "data/output"


def test_diagnostics():
    errors, _ = parse_latex_log("! Undefined control sequence.\nl.12 \\oops")
    assert errors[0]["line"] == 12


@pytest.fixture
def http_server(tmp_path):
    file = tmp_path / "main.tex"
    file.write_text("original")
    server = make_server(file, 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}", file
    server.shutdown()
    thread.join()
    server.server_close()


def request(base, path, data=None, headers=None):
    default = {"Content-Type": "application/json", "X-LocalLeaf": "1"}
    default.update(headers or {})
    req = Request(base + path, json.dumps(data).encode() if data is not None else None, default)
    with urlopen(req, timeout=5) as response:
        return json.load(response)


def test_api_save_conflict_and_cross_document(http_server, tmp_path):
    base, a = http_server
    info = request(base, "/api/document")
    b = tmp_path / "b.tex"
    b.write_text("B")
    request(base, "/api/open", {"file": str(b)})
    payload = {"file": str(a), "content": "edited A", "revision": info["revision"]}
    result = request(base, "/api/save", payload)
    assert result["success"]
    assert a.read_text() == "edited A"
    assert b.read_text() == "B"
    with pytest.raises(HTTPError) as error:
        request(base, "/api/save", payload)
    assert error.value.code == 409


def test_api_rejects_origins_traversal_and_missing_revision(http_server):
    base, file = http_server
    for path, data, headers, expected in [
        ("/api/save", {"file": str(file), "content": "bad"}, {}, 400),
        ("/api/save", {}, {"Origin": "https://example.com"}, 403),
        ("/api/save", {}, {"X-LocalLeaf": ""}, 403),
        ("/../documents.py", None, {}, 403),
        ("/%2e%2e/documents.py", None, {}, 403),
        ("/api/health", None, {"Host": "attacker.example"}, 403),
    ]:
        with pytest.raises(HTTPError) as error:
            request(base, path, data, headers)
        assert error.value.code == expected
    assert file.read_text() == "original"


def test_crlf_noop_save(tmp_path):
    file = tmp_path / "main.tex"
    original = b"first\r\nsecond\r\n"
    file.write_bytes(original)
    doc = LocalLeafState(file)
    doc.write_content(doc.read_content(), doc.revision())
    assert file.read_bytes() == original


def test_output_collision_rejected(tmp_path):
    from localleaf.server import Application

    (tmp_path / "localleaf.toml").write_text('[project]\noutput_dir="output"\n')
    app = Application(tmp_path / "a/main.tex")
    with pytest.raises(ValueError, match="collision"):
        app.open(tmp_path / "b/main.tex")

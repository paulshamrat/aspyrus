# Architecture

LocalLeaf is one repository with a Python backend, a shared browser editor, and a
thin VS Code extension. This alpha intentionally uses only the modules it needs.

- `backend/src/localleaf`: loopback API, per-document locking and revisions,
  project settings, compilation, and DOCX export.
- `editor`: Monaco source editor, clean full-width visual editing, and document actions. No CDN requests.
- `vscode`: launches an installed backend on a free port and embeds its UI.
- `scripts/build.mjs`: assembles the editor assets into Python package data.
- `backend/tests`, `editor/tests`, `tests/fixtures`: regression coverage.

The visual editor records original source ranges. It patches only edited ranges;
no-op saves and mode switches retain the original source. Equations, environments,
conditionals, custom macros, and unsupported inline syntax stay protected. Basic
formatting is serialized from DOM text and known tags, never raw HTML.

Every write includes the file identity and a SHA-256 revision. A document lock
covers revision checking, atomic replacement, and compilation/export. Another tab
with stale content receives HTTP 409. Compilation is serialized per document.
Different documents can build concurrently; configure distinct output directories
when documents share the same filename stem.

The backend accepts loopback hosts, rejects foreign origins, requires a custom
header for writes, validates engine names, limits request bodies, and confines
static assets to their resolved directory. LaTeX runs without shell escape.
This is a local trusted-document tool, not a sandbox for hostile TeX.

Future milestones: richer source mapping, editing included files with a separate
root compilation target, reference-aware export validation, browser interaction
coverage, and tested remote VS Code support. These are not claimed alpha features.

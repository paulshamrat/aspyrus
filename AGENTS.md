# LocalLeaf Development & Maintenance Rules

## Architecture
- LocalLeaf is a minimal, native VS Code and Antigravity IDE extension for distraction-free LaTeX text editing.
- No backend servers, no loopback ports, no Python dependencies, and no DOCX exporters.
- LaTeX source is authoritative: all unedited content (preamble, environments, math tokens, comments) must survive unchanged byte-for-byte.

## Directory Structure
- `src/extension.cjs`: Native VS Code extension controller (registers command, editor/title button, WebviewPanel IPC, file saves).
- `src/parser.js`: Robust, lightweight LaTeX parser and serializer with 100% byte-for-byte fidelity for untouched blocks.
- `src/webview/`: Webview UI (`index.html`, `styles.css`, `editor.js`, and compiled `bundle.js`).
- `package.json`: Extension manifest and packaging scripts.
- `localleaf-0.2.0.vsix`: Packaged extension deliverable.

## Development Workflow
- Work on `dev1` or a dedicated feature branch; do not modify `main` directly.
- To rebuild webview assets: `npm run bundle`
- To package the extension: `npm run package`
- Install into IDE: `code --install-extension localleaf-0.2.0.vsix`

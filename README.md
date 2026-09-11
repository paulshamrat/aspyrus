# 🍃 LocalLeaf

An ultra-lightweight, offline-first, local Overleaf-style LaTeX editor running in your web browser.

Developed in `/home/paul/tools/localleaf`.

---

## 🌟 Highlights

- **Overleaf-Inspired Interface**: Familiar split-screen design with editor on the left and live PDF preview on the right.
- **Powered by Monaco Editor**: The exact editor core used by Overleaf and VS Code, featuring full LaTeX syntax highlighting, line numbers, code folding, and auto-indentation.
- **100% Offline & Local**: Monaco Editor and all dependencies are bundled locally. Zero external CDNs, zero cloud uploads, zero telemetry.
- **Native PDF Viewer**: Uses hardware-accelerated browser PDF rendering with zoom, text selection, search (`Ctrl+F`), and download.
- **Smart Directory Management**:
  - If your document lives in `scripts/` (e.g. `pauls/scripts/main.tex`), LocalLeaf automatically compiles the output PDF to `data/output/main.pdf`.
  - Keeps your Git repository clean—no `.aux`, `.log`, `.out`, or temporary files cluttering your source code!
- **Interactive Error Panel**: Parses LaTeX errors and warnings with clickable **"Jump to Line"** buttons that instantly position your cursor at the error in the editor.
- **Engine Switching**: Switch between `pdflatex`, `lualatex`, and `xelatex` directly from the top toolbar.
- **Dark & Light Themes**: Seamlessly toggle between dark and light modes.

---

## 🚀 Quick Start

### 1. Launch from anywhere
The `localleaf` command is installed in `/home/paul/bin/localleaf` (already in your `$PATH`):

```bash
# Launch editor with your CV:
localleaf /home/paul/cv/pauls/scripts/main.tex

# Or launch in any directory with a main.tex:
cd /home/paul/cv/pauls/scripts
localleaf
```

LocalLeaf will spin up a local server on `http://localhost:4848` and immediately open your browser.

---

## ⌨️ Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl + S` | Save file & Auto-compile (if auto-compile is enabled) |
| `Ctrl + Enter` | Recompile immediately |
| `Ctrl + F` | Search inside editor |
| `Ctrl + H` | Find and Replace |
| Drag middle bar | Resize editor vs. PDF split ratio |

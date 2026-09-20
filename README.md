# LocalLeaf

**LocalLeaf** is an ultra-lightweight, native VS Code and Antigravity IDE extension for distraction-free LaTeX prose editing.

When opening a `.tex` manuscript (such as research papers or articles), the raw code clutter of LaTeX tags, preambles, and environments can be overwhelming. LocalLeaf provides a clean, visual document canvas where you can read and edit your text naturally like a word processor, while maintaining 100% byte-for-byte fidelity with your original LaTeX source.

## Features

- **Native VS Code Integration:** Runs directly inside VS Code and Antigravity IDE with zero external background processes, zero Python dependencies, and zero loopback servers.
- **One-Click Activation:** Click the "Edit Text (LocalLeaf)" button in the editor title bar on any `.tex` file to launch the visual editor side-by-side.
- **Distraction-Free Prose Editing:** Clean paper canvas displaying your manuscript's title, sections, subsections, paragraphs, and lists.
- **Citations, Math & Environment Protection:** Math formulas (`$...$`), citations (`\cite{...}`), cross-references (`\ref{...}`), and complex floats (figures, tables, equations) are displayed as protected inline chips and cards so they cannot be corrupted by accidental typing.
- **Color-Coding Support:** Native rendering and editing of `\textcolor{blue}{...}` and `\textcolor{red}{...}`.
- **Byte-for-Byte Preservation:** Any unedited block (preamble, document structure, comments, math formulas, floats) remains 100% identical to the source file on disk. Only paragraphs you modify are serialized back to LaTeX.
- **Seamless Saving:** Press `Ctrl+S` (`Cmd+S` on macOS) or click Save to update your `.tex` document directly with full VS Code undo/redo integration.

## Installation

Install the compiled `.vsix` extension package into VS Code or Antigravity IDE:

```sh
code --install-extension localleaf-0.2.0.vsix
```

## Usage

1. Open any `.tex` file (e.g. `main.tex`).
2. Click the **Edit Text** icon in the editor title bar (or right-click the file and select **Edit Text (LocalLeaf)**).
3. Read and edit your text in the visual editor.
4. Press `Ctrl+S` to save your changes back to the `.tex` file.

## Packaging from Source

```sh
npm run package
```

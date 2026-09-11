# LocalLeaf

LocalLeaf is an **early alpha** local LaTeX editor for the browser and VS Code.
Edit ordinary text and headings visually, switch to source for complex LaTeX,
compile a PDF, and export a DOCX. Documents stay in their existing projects.

The handover visual interface is restored, including its CV layout and formatting toolbar.
It is not yet a full Overleaf or Word replacement. See [supported LaTeX](docs/supported-latex.md).

## Install from a checkout

Requirements: Python 3.11+, Node.js 22.13+, npm, and a LaTeX installation
providing `pdflatex`, `xelatex`, or `lualatex`. Install Pandoc separately for DOCX.
Dependencies are downloaded during installation; normal editing uses local assets.

```sh
python3 -m venv .venv
source .venv/bin/activate
npm ci
npm run build
python -m pip install -e '.[dev]'
localleaf /absolute/path/to/main.tex
```

On Windows, activate `.venv\Scripts\Activate.ps1` in PowerShell and use `python`.
The Python entry point is portable; the optional root shell launcher is for Linux.

The editor opens on loopback port 4848. Use `--no-browser` to suppress opening,
`--port 0` for a free port, or `--output-dir PATH` to override output placement.
Running the command again opens the requested file in the existing LocalLeaf server.
A missing `.tex` file is created only when saved.

## VS Code

Build the backend assets and install the Python package as above, then:

```sh
npm run package:extension
```

Install the resulting `apps/vscode/localleaf-0.1.1.vsix` using VS Code's
**Extensions: Install from VSIX** command. Set `localleaf.pythonPath` to the
absolute path of your environment's Python. Open a `.tex` file and run
**LocalLeaf: Open LaTeX Editor**. Each panel owns a local backend process.
Save before closing a panel. Local desktop workspaces are the initial target;
remote/web workspaces have not been validated.

## Editing and exports

- **Ctrl/Cmd+S:** save. **Ctrl/Cmd+Enter:** save and compile. **Alt+Z:** code word wrap.
- Visual mode renders CV headers, dated entries, tables, lists, and headings.
- The original toolbar provides font, size, alignment, spacing, and inline formatting.
- Unchanged visual blocks preserve their original source. Unsupported structures remain source-backed; use Code for those.
- Saves detect external changes and refuse to overwrite them. Copy your unsaved
  edits before choosing Reload if you need to reconcile a conflict.
- PDF preview can be hidden and zoomed. It is canvas-based; use an external viewer
  for PDF text selection, search, and accessibility tools.
- CV DOCX uses the original direct exporter; general documents use Pandoc. Layout may differ
  from PDF; inspect conversion messages and the exported document.
- Visual changes autosave; the Auto-compile option controls automatic PDF compilation.

Build artifacts default to `.localleaf_build/` beside the source. An optional
`localleaf.toml` supports other layouts, including `scripts/` and `data/`:

```toml
[project]
engine = "pdflatex"
output_dir = "data/output"
```

Paths are relative to that configuration file. See [configuration](docs/project-configuration.md).
Try the synthetic example with `localleaf examples/article/main.tex`.

## Development and release checks

```sh
ruff check .
ruff format --check .
npm run lint
npm run format:check
pytest
npm test
npm run build
python -m build
npm run package:extension
```

The wheel includes offline editor dependencies. Node.js is needed to build from
source, not to run an already built wheel. External LaTeX and Pandoc executables
are not bundled. Never run the server on a public interface.

See [CONTRIBUTING.md](CONTRIBUTING.md), [architecture](docs/architecture.md),
[export fidelity](docs/export-fidelity.md), and [release checklist](docs/releasing.md).

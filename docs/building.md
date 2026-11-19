# Compilation and export

Save and canvas Ctrl+S use the same confirmed live-document save. A retained canvas reacquires a closed TEX editor handle; a failed buffer or disk save reports an error instead of a false success. Ctrl+S in the raw TEX editor remains the IDE’s normal save. Save writes canvas edits into TEX. Raw TEX edits refresh the canvas; save canvas
work before switching to raw-source editing. Compile (`▶`, Ctrl+Shift+B) waits
for Save, then builds the open document's PDF, DOCX and, when figures exist,
`figures.pdf`. DOCX export preserves braced bibliography titles and journal names.
Bare inline numbers such as `\(-2.50\)` or `$+1.25$` export as ordinary Word text with their signs and precision preserved. Symbolic expressions, scientific notation, fractions and display equations remain editable native equations. This export convention leaves the authored LaTeX and scientific data unchanged.

Numeric/operator-only inline fragments such as `\(10\%<\)` and `\(<40\%\)` export as ordinary Word text, retaining signs, precision, percentages and comparison symbols. Never emit these as incomplete native equations: some editors display missing-operand placeholders. Keep expressions containing variables (including `n=46`), fractions, scientific notation and display math native. Test both delimiter syntaxes, captions and revision colours; do not alter scientific source to fix export compatibility. Bundled-renderer success alone does not establish compatibility with the reader’s editor.

Inline and display equations remain editable native Word equations, including
revision colors on math runs and operator controls.
Standalone numeric superscripts such as `Mg\(^{2+}\)` and `mol\(^{-1}\)` use real Word superscript text,
avoiding empty-base equation placeholders. Paired absolute-value bars use native
equation delimiters. Revision markup adds no spaces around prose or punctuation,
and numeric superscript citations attach to the preceding text.
DOCX color properties are preserved, but LibreOffice previews can display native
equation text in black. Word pagination may differ from the compiled PDF.

There is no separate Export control or preview PDF. Full captions
remain in the document PDF/DOCX; the figure-only PDF has one composed figure per
page with its compiled number beneath it. Compile never splits or rewrites
manuscript source and never builds another document as a side effect.

An empty title-only document has a blank editable body line before its
bibliography. Paste figures at a body caret outside a caption. Copying prose,
figures and captions together works in either drag direction and across canvases.
Image replacements refresh previews without discarding unsaved text. All figure
previews fill the body-text column and resize with the editor pane for readability.
Authored widths such as `width=0.6\textwidth` still control PDF/Word layout and
remain intact when saving or editing captions.
Images keep their proportions; tall figures use normal vertical scrolling.
Canvas margins and PDF/Word figure dimensions stay unchanged. Text highlights
(`\hl`, `\pihighlight`) render in vivid fluorescent yellow in both light and dark
themes. The status
reports unsaved edits, build results and changes since a build in this canvas
session. After reopening, Compile to verify that outputs are current.

See [citations and bibliography](references.md) for supported styles, Canvas
numbering, display modes and metadata verification. DOCX uses native Word
superscript or bracketed runs, preserving supported sorting and compressed ranges.
Superscript spacing is adjusted visually without altering authored TEX whitespace.
During DOCX generation, supported LaTeX accent macros in `.bbl` entries are
normalized to Unicode to reduce word-fragmentation differences. Prose-coverage
checks and rendered bibliography inspection remain separate requirements.

Mathematical expressions render symbolic variables ($H, p_i, K$) in publication serif italics while preserving upright functions ($\ln, \sin, \exp$), numbers, and measurement units, with dedicated thin spacing around functions and mathematical minus signs ($\minus$).
An `Ω` (Insert Symbol) button in the toolbar provides one-click insertion of upright Greek
letters and scientific signs without distracting math italics.

Front matter authored with the standard `authblk` package (`\author[...]` and
`\affil[...]`) is supported in DOCX exports. The engine maps author markers
to native Word superscript runs, injects numbered affiliation paragraphs above the
correspondence line in upright Times New Roman with 1.5 line spacing, and
preserves their text and markers for review in Word.

```text
manuscript/
├── .aspyrus.json                   # optional project boundary/preparation (or .localleaf.json)
├── main/
│   ├── main.tex
│   ├── main.pdf / main.docx
│   └── figures.pdf                   # Compile, when figures exist
├── supplementary/
│   ├── supplementary.tex             # independently authored
│   ├── supplementary.pdf / .docx
│   └── figures.pdf
├── references/
│   ├── references.bib
│   └── bib/                          # optional individual reference records
└── assets/
    ├── assets.csv                  # optional project provenance registry
    ├── figures/
    │   ├── main/                   # numbered main figures
    │   ├── supplementary/          # numbered supplementary figures
    │   ├── figures.pdf             # generated combined deck (paired build)
    │   └── toc.png                 # optional approved TOC graphic
    └── tables/
```

Shared paths such as `../assets/figures/main/figure1.png` and
`\bibliography{../references/references}` resolve within the nearest
`.aspyrus.json`, `.localleaf.json`, or Git root. Without either, the document folder is the boundary.
Paths and symlinks outside that boundary are rejected. Images manually placed in
assets work without a manifest. Build never promotes external computational assets.
The starter examples use separate main and supplementary figure folders. An
approved TOC graphic may live directly under `assets/figures/`, keeping its
original filename; `toc.png` above is illustrative. Its generating code and
inputs remain in the owning computational project. These folders are a starter
convention, not a restriction on supported relative image paths. The New
Manuscript and New Supplementary commands create only the authored TEX file;
copy the bundled example workspace or supply your own assets and references
when starting a complete project.

### Example workflow scripts

The bundled `example/scripts/` includes four optional project utilities:

- `assets.py`: checks registered local assets by default. Use
  `--promote assets/figures/main/figure1.png` to copy one reviewed upstream output.
  Replace the example CSV's placeholder source paths before promotion.
- `bibgen.py`: `--prepare` imports configured article DOIs and generates reference
  reports; `--review-reference KEY` stages source-backed corrections/exceptions.
  No-argument aggregation stays offline. See the
  [scripts README](../example/scripts/README.md#references) for usage.
- `build.py`: builds both authored documents and packages their PDFs, Word files,
  figure deck, and the supplementary workbook when present. Run bibliography
  aggregation first. When copying the example elsewhere, use
  `--aspyrus-root /path/to/aspyrus` or set `ASPYRUS_ROOT`. Python also needs PyMuPDF.
  An optional `--toc-graphic assets/figures/toc.png` appends a local approved
  PNG/JPEG once to the combined deck; no TOC artwork is supplied by the starter.
- `feedback.py --feedback-dir feedback/rev2/edit/YYYY-MM-DD`: compares an explicit
  collaborator exchange with the active exports. Use `--main-file` or
  `--supplementary-file` for specific basenames. Submitted packages prefer the
  clean main; ambiguous candidates fail. It records proposals and decisions,
  preserving original files. Comparison-only runs do not edit source;
  `--interactive` can save explicitly accepted edits. Neither mode creates Git tags.

Current PDF/Word exports stay beside their authored TeX. `assets/figures/figures.pdf`
contains the combined deck; root `build_report.json` records paths and hashes.
The workbook stays in `assets/tables/`; temporary staging and `MANUSCRIPT_DONE`
live in `.aspyrus_build/manuscript/`. No manuscript `data/` folder is created.
Standard collaboration
records use `feedback/<revision>/edit/<date>/`, `submission/`, `decision/` and
`audit/`. Each working stage follows decision → edits → submission. A decision
on Rev1 that prompts Rev2 is stored in `rev2/decision/`; record the reviewed
and working stages and the actual decision date in the revision README.
A terminal decision without further work stays with the evaluated stage.
Reports go under the revision's `audit/`, with logs under `logs/feedback/`.
Legacy flat batches write to their own `audit/` subfolder. Completion markers distinguish
successful runs from incomplete runs. These scripts use no old manuscript
layout or archives. The editor Compile action continues to build only the open
document through the packaged engine; it does not invoke `build.py` or `feedback.py`.

### Packaged engine and optional preparation

`src/tools/export.py` is the generic single-document engine. It builds, checks,
and publishes document and figure exports; it does not submit to a journal.
`tex2docx.py` handles Word conversion, while `docdiff.py` provides a standalone
Word comparison utility. The example's `scripts/build.py` coordinates the paired
document package, and `scripts/feedback.py` produces structured review reports.

Every Compile uses the engine shipped in Aspyrus. A project `compile.sh` is
neither required nor automatically executed. An ordinary TEX document and `.bib`
file need no configuration. For a shared root or custom bibliography preparation:

```json
{
  "version": 1,
  "prepare": ["python3", "scripts/bibgen.py"]
}
```

`prepare` is an optional nonempty argument array, executed from the project root
without a shell, before snapshotting build inputs. It requires VS Code workspace
trust; failures stop the build. Only configure commands you intend to run.
Preparation can update project dependencies; it is not part of deliverable rollback.
It is project-owned behavior, not a script supplied or inferred by Aspyrus.

For command-line use, the packaged Python engine also supports:

```sh
python3 /path/to/aspyrus/src/tools/export.py compile /path/to/main/main.tex --mode numbers
python3 /path/to/aspyrus/src/tools/export.py recover /path/to/main/main.tex
```

This lower-level CLI does not run the optional preparation command: run it
explicitly first, or use Compile in the IDE. Internal `build` and `figures`
actions remain for diagnostics and tests; the toolbar always uses `compile`.

Builds stage under `.aspyrus_build/` (or `.localleaf_build/`), lock concurrent publication, validate
outputs and recheck source/dependency bytes before publishing the complete set.
Hidden `.<stem>-export.json` and `.figures-export.json` retain output ownership.
Unowned, manually edited or another document's outputs cannot be overwritten.
If the last figure is removed, Compile retires only this document's unchanged,
previously recorded figures.pdf and its record. Unowned figure PDFs remain intact.
Handled errors roll back publication; interrupted transactions require `recover`.

Checks cover references, prose coverage (with lineno-tolerant hyphenation across line numbers and citation ranges, and unicode superscript decoupling), DOCX image counts, figure numbering and
one page per figure. Inspect rendered deliverables for layout and math fidelity.
The engine currently requires self-contained TEX with literal project-relative
paths (automatically discovering sibling documents linked via `\externaldocument`); external `\input`/`\include`, nested figure-caption layouts or body-defined
figure macros may require adapting the document. `figures.tex` is reserved because
its output would collide with figures.pdf. Failures preserve prior outputs.

### Build dependencies

The authoring editor needs no Python or build tools. Compile checks for Python 3,
`pypandoc`, `python-docx`, Pandoc, Poppler (`pdftotext`, `pdfinfo`), pdfLaTeX and
BibTeX. Install these plus `cmap` and the LaTeX packages used by your document.
For example, Debian/Ubuntu provides `pandoc`, `poppler-utils`, `texlive-latex-extra`,
`texlive-bibtex-extra` and `texlive-science`; install Python packages into the
Python environment used by the IDE. From the Aspyrus checkout, run
`python3 -m pip install -r requirements.txt`; paired example builds also need
PyMuPDF (`python3 -m pip install PyMuPDF`).
If using a virtual environment, launch the IDE with that environment active.
The package includes the engine, not a full TeX/Pandoc distribution. The current
build engine uses POSIX file locking (`fcntl`); native Windows compilation is
not supported. Use a POSIX environment with the build tools installed.

## Word export typography

DOCX body text, abstracts and bibliography are left-aligned. Body paragraphs retain their 0.25-inch first-line indent; title, heading, table and equation formatting remains separate. PDF alignment follows the authored LaTeX.

Word text follows explicit standard `10pt`, `11pt` or `12pt` document-class options. Without a supported explicit size, the existing 12 pt review fallback applies. The starter uses 11 pt.

PDF prose checks join line-wrapped words even when extraction places a caption label or a row of mathematical glyphs between the word fragments. These checks retain intervening tokens and still reject missing prose.

## Checking Word export changes

Converter fixes need shared regression tests even when manuscript markup also changes.
`test/export_test.py` exercises real PDF/DOCX export of chemical charges, negative
unit powers beside the Angstrom command, absolute-value delimiters, native equations
and revision styling. Builds reject known empty-base signed superscripts and leaked
revision markers before publication. CI already runs this suite; keep fixtures generic.

After converter changes, run `npm test` plus Python formatting, lint and syntax
checks. Render affected Word body text and captions and compare against the PDF.
Prose coverage cannot detect every wrong glyph, and XML color properties do not
guarantee identical rendering in every office application. Record inspected pages,
renderer/version and build input/tool hashes.

Package and install the tested extension, then compare its `src/tools/export.py`
and `src/tools/tex2docx.py` with the checkout used for terminal validation. Save work
and reload the IDE; reopen rebuilt Word files. See the Word Export Regression Rules in [development contract](development-contract.md)
for the failure patterns that must stay covered. Existing manuscripts and copied
starters use the same engine and need no separate converter scripts.

## Maintenance

Python `__pycache__/` and Ruff `.ruff_cache/` directories are disposable. Keep
export records (`.<stem>-export.json`, `.figures-export.json`) with the generated
outputs they describe: deleting a record while retaining its PDF/DOCX makes
those outputs unowned and prevents silent replacement on the next export.

Do not remove a document's `.aspyrus_build/` or `.localleaf_build/` during a build or when it contains
`publication/`. That directory can hold an interrupted transaction's recovery
backups; recover it using the document-path command above first. The persistent
`operation.lock` file alone does not mean a build is running; the OS lock does.
Keep manuscript archives and Aspyrus recovery history separate from routine
cache cleanup.

Older local installers are retained in ignored `.vsix-archive/`; the current
installer stays at the repository root. Keep `node_modules/` for development;
recreate it with `npm ci` when necessary. Neither dependencies nor installer
archives belong in Git or the published VSIX. Do not put private manuscripts,
reference libraries, reviewed assets or feedback in this tool repository.

CI checks every bundled Python tool (including the citation converter), runs the
browser and document-build regressions, and verifies that packaging reproduces
the tracked webview bundle. For documentation-only maintenance, check links,
commands, paths and `git diff --check`; no manuscript rebuild or extension reload
is needed unless runtime code changes.

The starter's feedback README documents the Word-to-LaTeX collaboration workflow.
Keep LaTeX authoritative, preserve exact supplied and submitted files, and reconcile
collaborator Word edits explicitly. The generic `docdiff.py` prefers manuscript edit exchanges
when discovering feedback, excludes documents under `audit/` and `decision/` and writes revision
reports into `audit/` with a document-specific filename. Explicit file selection is
recommended. Folder names do not certify submission or approval.

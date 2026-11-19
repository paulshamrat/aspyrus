# Development contract

## Architecture
- Aspyrus is a minimal, native VS Code and Antigravity IDE extension for distraction-free LaTeX text editing.
- The authoring editor requires no backend servers, loopback ports, or Python. Optional compilation and bundled DOCX review tools use local LaTeX, Pandoc, and Python (`pypandoc`, `python-docx`). Keep generic compilation in the package; optional project preparation belongs in an explicit `.aspyrus.json` (or legacy `.localleaf.json`) argument array.
- LaTeX source is authoritative: all unedited content (preamble, environments, math tokens, comments, labels) must survive unchanged byte-for-byte.

## Directory Structure
- `src/extension.cjs`: Native VS Code extension controller (registers commands, editor/title button, WebviewPanel IPC, file saves, `.aux`/`.bib` context discovery).
- `src/compiler.cjs`: Packaged build coordinator with dependency checks and trusted, explicit project preparation.
- `src/project.cjs`: Canonical shared-resource boundary and local dependency resolution (`.aspyrus.json` / `.localleaf.json`).
- `src/tools/export.py`: Generic single-document build/export engine, with output ownership records and recoverable publication; Python module `export`, not a journal-submission tool.
- `src/tools/docdiff.py`: Feedback review using the active manuscript and its nested or legacy document paths.
- `src/tools/docreview.py`: Conservative Word comparison, recorded decisions and recoverable literal-prose incorporation; shared by interactive and assistant-led review.
- `src/recovery.cjs`: Durable saved-version and draft checkpoints in extension global storage.
- `src/parser.js`: Robust, lightweight LaTeX parser and serializer with 100% byte-for-byte fidelity for untouched blocks.
- `src/tools/tex2docx.py`: Bundled universal LaTeX-to-DOCX review deliverable generator with citation mode resolution.
- `src/webview/`: Webview UI (`index.html`, `styles.css`, `editor.js`, and compiled `bundle.js`).
- `example/`: Canonical reference manuscript workspace (`main/`, `supplementary/`, `assets/`, `references/`, `scripts/`) for quick author scaffolding and independent document architecture.
- `example/scripts/`: Optional generic project utilities: `assets.py`, `bibgen.py`, `build.py`, and `feedback.py`. Keep their single-word names and exclude manuscript-specific assumptions and material.
- `package.json`: Extension manifest and packaging scripts.
- `aspyrus-0.6.1.vsix`: [Gitignored] Packaged extension deliverable (generated on demand via `npm run package`).

## Citation & Environment Handling Rules
- **Safe Figure Previews & Responsive Width Scaling:** Recognized local `\includegraphics{...}` assets within the nearest configured project or Git root must render as non-editable inline previews above their editable captions. Resolve assets only through VS Code `asWebviewUri` and scoped `localResourceRoots`; never use `file://` URLs, remote URLs, or paths outside the canonical project boundary. Missing or unsupported assets must show a visible fallback without changing the LaTeX source. Caption edits must preserve the original graphics command, options, label, and surrounding environment byte-for-byte. Canvas image previews always fill the body-text column as the pane resizes, including figures authored with fractional or absolute widths. Keep their aspect ratios without a viewport-height cap; tall figures use ordinary vertical scrolling. Canvas margins stay unchanged. Preview width is a reading aid, not a publication-layout preview: preserve all original graphics options byte-for-byte through untouched saves, caption edits and clipboard operations. Only authored LaTeX controls PDF and Word figure dimensions.
- **Superscript Citation Whitespace Collapse:** In superscript citation mode (`\usepackage[super]{natbib}`, `achemso`), when an author types a space before `\cite{...}` or `\revref{...}` in LaTeX (e.g. `Example text \cite{...}`), `updateCitationsDisplay` detects the preceding text node whitespace and attaches `.cite-super-space-collapsed` (`margin-left: -0.28em;`). This visually attaches the superscript badge to the preceding word in the authoring canvas to mirror compiled PDF / natbib behavior without deleting or mutating whitespace from the underlying `.tex` source.
- **Fluorescent Yellow Text Highlighting (`\hl`, `\pihighlight`):** Text highlights (`\hl{...}`, `\pihighlight{...}`) render in vivid fluorescent highlighter yellow (`#ffeb3b` in light theme, `#fbc02d` in dark theme) with high-contrast `#111827` text, eliminating previous pale cream or muddy dark brown rendering.
- **Caption Exit Navigation (Enter Key):** Pressing `Enter` while focused inside a figure caption (`.float-caption-body`) must break out of the figure container, insert an editable body paragraph (`<p class="latex-paragraph">`) immediately below the figure, and focus the caret into it. Authors must never be trapped inside caption blocks.
- **Publication Table Card Rendering & Insertion:** Recognized `\begin{table}` and `\begin{tabular}` environments (including `booktabs` macros: `\toprule`, `\midrule`, `\bottomrule`, and `\resizebox`) must render visually as clean, publication-grade table cards with horizontal rules, column alignments (`l`, `c`, `r`), and editable captions. An "Insert Table" button (`#btn-add-table`, `Ctrl+Shift+T`) in the authoring toolbar provides a dedicated modal dialog to configure rows, columns, caption, and label, generating standard `booktabs` LaTeX floats. Untouched table structures, column specifications, and cell contents must serialize back to LaTeX byte-for-byte.
- **Overleaf-Style Grouped Toolbar with Vertical Dividers:** The authoring toolbar must maintain clear visual category separation using subtle vertical dividers (`.toolbar-divider`) matching modern authoring layouts:
  1. Document & History (Save, Undo, Redo, Compile)
  2. Text Formatting (Bold, Italic, Color, Style)
  3. Typography & Symbols (Superscript, Subscript, Symbol Palette `Ω`)
  4. Floats & Elements (Table `▦+`, Image `🖼️+`, Citation `❝+`)
  5. Views & Modes (Citation Display `[1]`/`¹²³`, Theme Toggle `☀️`/`🌙`).
- **LaTeX Accent Normalization in DOCX Bibliography (`clean_achemso_bbl`):** The LaTeX-to-DOCX converter must normalize LaTeX accent macros (`\'`, `\``, `\^`, `\"`, `\~`, `\c`) and Scandinavian/extended European characters (`{\o}`, `\o{}`, `{\aa}`, `\AA`, `\ae`, `\ss`, e.g., `S{\o}ndergaard`, `Patr{\'i}cia`) in `.bbl` entries before passing the bibliography to Pandoc. This reduces false word-fragmentation discrepancies during prose coverage validation; retain real-output regression checks.
- **Standard LaTeX Math Delimiters (`\( ... \)`):** The parser, serializer, display formatter, and upright measurement classifier must support standard LaTeX `\( ... \)` delimiters alongside TeX `$...$`. Trailing empty braces in symbols (e.g. `\AA{}`) must be handled without corrupting adjacent tokens.
- **Revision Styling Environments & Chunk Transparency (`collabtext`, `collabcaption`):** Formatting environments like `\begin{collabtext}` and macros like `\collabcaption` must be treated as transparent during body chunk splitting (`splitBodyChunks`) so they never swallow headings, float environments, or separate body paragraphs. `inlineToHtml` renders inline `collabtext` spans (`class="latex-color" style="color: red" data-latex-env="collabtext"`) and `domNodeToLatex` serializes them back to LaTeX environments losslessly.
- **DOCX colour parity:** Standard named red/blue commands and explicit groups export as FF0000/0000FF. Existing custom redtext/bluetext and block environments retain D32F2F/1976D2. Preserve native Word colouring, math, nesting and text; never infer provenance from colour.
- **Cross-Document Auxiliary Discovery (`\externaldocument`):** When documents use `\externaldocument` (via `xr` / `xr-hyper`) to reference sibling documents (e.g. `main.tex` referencing `supplementary.aux` or vice versa), `extension.cjs` (`getBibContext`), `export.py` (`dependencies()`), and `tex2docx.py` (`load_label_map`) must automatically discover and stage external `.aux` files from adjacent directories and `.aspyrus_build/`, resolving external labels without manual symlinks.
- **Dynamic Counter & Float Label Tracking:** `parser.js` must recognize non-visual metadata blocks and dynamically track `\refstepcounter{(figure|table)}` and accompanying `\label` commands to populate `state.labelMap` and `state.labelKinds`, ensuring supplementary and draft manuscripts immediately display correct figure and table identifiers (`Table S1`, `Figure S1`) even before LaTeX auxiliary files are compiled.
- **Starter Bibliography Style (`unsrtnat`):** Use `unsrtnat` in the numeric starter. Preserve the bibliography style chosen by existing manuscripts; do not impose a new journal style during workflow or documentation changes. Verify reference order across Canvas, PDF and Word.
- **Theme-Safe Manuscript Presentation:** Webview colors must follow the active VS Code body class (`.vscode-light` or `.vscode-dark`) and VS Code theme tokens, never operating-system `prefers-color-scheme` alone. Captioned figures must present a reader-facing numbered caption (for example, `Figure S1. …`) below the preview as ordinary manuscript content: no decorative card, persistent border, hover frame, or focus box. Only a missing/unsupported asset may show a visible fallback. Do not expose filenames or LaTeX labels as authoring-canvas metadata. Any visual prefix must serialize to an empty LaTeX string.
  - Theme observers may refresh the toggle state in auto mode, but must never mutate document.body.classList from an observer callback; that feeds the observer back into itself and can freeze the webview or IDE window.
- **Hidden & Silent LaTeX Commands (`\label`, `\nocite`, `\bibliographystyle`):** Never display non-visual metadata commands (`\label{...}`, `\nocite{...}`, `\bibliographystyle{...}`) as editable text, chips, or visual artifacts on the paper canvas. Keep them hidden (`hidden: true, html: ''`) and serialize them back byte-for-byte to maintain 100% fidelity for BibTeX and auxiliary LaTeX compilers.
- Support both `\cite{...}` and `\revref{...}` as first-class citation tokens.
- Support Dynamic Citation Modes via compact citation-mode icon menu (`btn-cite-mode-menu`):
  - `numbers`: Uses `bibContext.citeNumbers` from the open document’s own `.aux` data, falling back to dynamic sequential numbering in order of document appearance when the open document’s compiled data is unavailable. Correctly handles superscript (`\usepackage[super]{natbib}`) and bracketed numbers.
  - `keys`: Displays raw BibTeX keys for inspection.
  - `dois`: Displays resolved DOIs from `references.bib` for formal citations; raw parenthetical DOIs remain ordinary prose.
- Numeric Canvas citations must remain compact manuscript text: numbers use the theme link blue; bracketed numbers inherit surrounding font and size, with no border, background, padding or margins. Use a subtle hover underline; preserve superscript positioning, click-to-edit, tooltips, source fidelity and the separate key/DOI inspection modes. Do not change reference-token styling or export behavior for this presentation rule.
- Interactive Citation Management in Webview:
  - **Click-to-Edit Badge**: Clicking any citation badge in the text opens the Citation Editor modal showing all attached references, allowing adding/removing keys from that citation cluster.
  - **Toolbar Citation Icon & `Ctrl+Shift+C`**: Inserts a new citation chip at the current cursor position with live search over `references.bib`.
  - **Typed Macro Preservation**: Typing `\cite{...}` or `\revref{...}` directly into the text is preserved by `escapeLatex` without escaping braces, auto-converting to citation chips on save.
- Typography & Publication Layout:
  - All editable, non-mathematical manuscript content—title, headings, prose, lists, and figure/table captions—must inherit the shared system sans-serif authoring stack. For recognized LaTeX article preambles, apply the lightweight source-aware profile only for size and spacing: map 12 pt to 16 px (11 pt to 14.67 px), honor \onehalfspacing as 1.5 line height, and honor explicit \normalsize title/heading/caption settings. Do not introduce per-environment cards or focus treatment. The compiled PDF remains the final typography authority.
  - Authoring prose, abstract text, and captions follow standard left-aligned text editing matching VS Code default editor behavior (`text-align: left`) to keep the editor lightweight and distraction-free, without cluttering the toolbar with alignment buttons. The compiled PDF remains the authoritative typography layout.
  - Inline-math rendering must distinguish symbolic expressions from scientific measurements: keep variables and equations in math typography, but render charge-only superscripts and simple numeric measurements or dimensions (for example, Mg$^{2+}$ and 30 $\times$ 30 $\times$ 30 Å) upright. This is display-only; preserve the original LaTeX token byte-for-byte.
  - **Upright Math & Equation Typography:**
    - Inline math typography must not globally slant non-variable text: numbers (e.g. `0.77`), operators (`>`, `<`, `=`, `+`, `-`, `\pm`, `\le`, `\ge`, `\approx`), uppercase Greek letters ($\Delta$, $\Sigma$, $\Omega$), and text labels (`\text{...}`) render upright (`font-style: normal;`), eliminating distracting tilted equation italics in running scientific thresholds (such as $\Delta\Delta G_{\text{folding}} > 0.77$~kcal/mol).
    - An `Ω` (Insert Symbol) button in the authoring toolbar provides a one-click palette for inserting clean upright Greek characters (`α`, `β`, `γ`, `Δ`, `μ`, `Ω`) and scientific signs (`±`, `×`, `·`, `Å`, `°C`, `≤`, `≥`, `≈`, `≠`, `→`, `′`, `″`) directly into prose without equation wrapping.
  - **Raw Text DOI Invariant:**
    - Pure parenthetical DOI strings in body paragraphs (e.g. `(DOI: 10.1016/...)`) must remain 100% pure editable text nodes. Never intercept them into `<span class="latex-token latex-cite">` chips or assign them numeric citation badges during drafting.
    - Citation display mode controls (`[1]`, `@`, `DOI`) and `updateCitationsDisplay` operate strictly on formal LaTeX citations (`\cite{...}`, `\revref{...}`).
    - The citation mode trigger dynamically displays `[1]` for bracketed numeric manuscripts (`[numbers,sort&compress]{natbib}`) and `¹²³` for superscript manuscripts (`[super]{natbib}`).
  - **Paste as Plain Text (Right-Click Context Menu & `Ctrl+Shift+V`):**
    - Provide a native right-click context menu item (`menus.webview/context`) and standard `Ctrl+Shift+V` (`Cmd+Shift+V` on macOS) shortcut to paste clipboard content as pure, unformatted plain text without cluttering the compact toolbar.
    - Strips external HTML styling, rogue font-families, and background artifacts from web browsers or Word while preserving native line breaks, cursor position at click location, and undo/redo history.
  - **Prime, Degree & Directionality Typography:**
    - Support prime commands (`\prime`, `\prime\prime`, `\prime\prime\prime`), math-mode apostrophes (`$5'$`, `$f'(x)$`, `$x'$`), and degree commands (`^\circ`, `°`), rendering them cleanly with typographic prime and degree glyphs (`′`, `″`, `‴`, `°`).
    - Naturally raised glyphs (primes `′` and degree `°`) are designed at ascender height in modern serif fonts; normalize them without redundant `<sup>` wrappers (`\^\{?([′″‴°])\}?` $\rightarrow$ `′`/`°`) to prevent unnatural double-height floating rendering.
    - Classify biological directionalities and temperatures (`$^\prime$`, `$5^\prime$`, `$5'$`, `$3^\prime$`, `$^\circ$`) as `isUprightMeasurementMath` so they render upright in body text font matching neighboring numbers/prose.
    - Guarantee 2-way serialization parity: `escapeLatex` converts typed or pasted `′` to `$^\prime$`, `mathTextToLatex` and `domMathToLatex` serialize `′` back to `^\prime` (or `^{\prime}` when inside `sup`), and untouched math tokens preserve raw author LaTeX byte-for-byte via `data-latex`.
  - **LaTeX Quote Ligatures (`inlineToHtml`, `escapeLatex`):**
    - Directional LaTeX quote ligatures (`` ` `` / `'` and ` `` ` / ` '' `) must parse into directional curly quotes (‘, ’, “, ”) in `inlineToHtml`.
    - In `escapeLatex`, curly quotes must serialize back into standard LaTeX ligatures (`“` $\to$ ` `` `, `”` $\to$ ` '' `, `‘` $\to$ ` ` `, `’` $\to$ `'`), maintaining 100% byte-for-byte fidelity upon Save.
  - **Large Operator Bounds & Math Typography (`formatMathForDisplay`, `domMathToLatex`):**
    - Symbolic inline math (`.latex-token.latex-math:not(.math-measurement)`) renders with standard journal serif italics (`Times New Roman`, `Cambria Math`, `Latin Modern Math`) so algebraic variables and indexed terms ($H$, $p_i$, $K$, $x$) are visibly distinguished from surrounding sans-serif prose, while upright measurement tokens, functions, numbers, and operators stay upright.
    - Large operators (`\sum`, `\prod`, `\int`, `\coprod`) with limits (`_...`, `^...`) must render as `.math-limits` with stacked upper and lower bounds aligned vertically to the right of the operator and separated by an explicit right margin, preventing horizontal text collisions with subsequent operands (e.g. $\sum_{i=1}^K p_i$ instead of `∑i=1Kpi`).
    - Math functions (`\ln`, `\sin`, `\cos`, `\exp`) must preserve upright typography with dedicated thin spacing before and after the function (`margin-left: 0.14em`, `margin-right: 0.12em`), preventing collisions with preceding variables (e.g. $p_i\ln(p_i)$ renders as $p_i \ln(p_i)$).
    - Mathematical minus signs (`-`) outside HTML tags render with Unicode minus `−` (`\u2212`) and proper operator padding, and map back losslessly to ASCII `-` in `mathTextToLatex`.
    - `domMathToLatex` must reconstruct the original LaTeX large operator float with subscripts and superscripts losslessly upon Save.
- Manual Save, Recovery & Buffer Synchronization:
  - Manual manuscript saving via Save/Ctrl+S. A 750ms debounce, blur, and citation confirmation create durable recovery drafts only; they never overwrite the manuscript. Retain 100 saved versions and 100 drafts in extension global storage, with a Command Palette recovery picker. Checkpoint source before every canvas save and recovery operation. A compile request made while the canvas is dirty must wait for a confirmed canvas-to-buffer save before launching the compiler; never race a compile against an in-flight save.
  - **Self-Originated Save Caret Preservation:** `lastCanvasContent = content;` must be updated synchronously in `src/extension.cjs` immediately upon handling `action === 'save'`. The extension host must never reflect an `externalUpdate` back to the active webview for changes originating from the canvas itself; reflected updates force a full `renderDocument()` DOM rebuild that resets input focus and causes the caret to jump to the very top of the manuscript.
  - Slices live `vscode.workspace.textDocuments` buffer and saves cleanly so the `.tex` file never retains an unsaved white circle (`●`).
  - Distinguish a canvas-originated write from a raw-editor change by exact document content, never a time-window flag. A clean canvas must receive raw TeX edits, and a later Ctrl+S must never restore stale canvas content over them.
  - LaTeX source remains authoritative in a two-way conflict: any genuine raw-editor change replaces the canvas, including a dirty/stale canvas, so Ctrl+S cannot reintroduce deleted blocks.
- Reacquire live TextDocument handles before Save, recovery and checkpoints. Never fall back to a direct disk write that bypasses a dirty editor buffer. Report Save success only when current matching buffers are clean and the on-disk bytes match the requested content.
- Recovery lives in the **Aspyrus: Restore Previous Version** Command Palette action for the focused canvas; retain checkpoints and drafts without a permanent toolbar icon.
- Display equations use a plain centered layout and equation numbers, with no card border or shading. Numeric measurements containing unit macros must stay upright without changing source.
- Render standard top-level author/affiliation/date declarations when `\maketitle` is present. Preserve preamble bytes and macro definitions; the read-only author block is display-only and must never become duplicate body text. Raw TEX changes refresh it.
- Resolve reference tokens using this document's compiled labels and page numbers, with the existing caption numbering as a pre-build fallback for figures/tables. Preserve commands, support forward references, and keep unknown targets visibly unresolved; never invent page numbers. Display-only updates must preserve untouched block snapshots. Test reference refresh, author visibility, and exact Save round trips in the browser.
- **Single Compile workflow:** Keep only Compile (`▶`, Ctrl+Shift+B), which waits for Save and builds the open document PDF, DOCX and figures.pdf when figures exist. No Export menu or separate preview PDF. Use the bundled engine; never autoexecute compile.sh. Optional `.aspyrus.json` (legacy `.localleaf.json`) `prepare` is a nonempty argument array executed without shell interpolation from the root, only in a trusted workspace. Preparation failure stops compilation.
- Keep the toolbar icon-only. Distinguish saved content from built outputs; opening a canvas does not prove deliverables current. A build completion must not hide edits made during the build. `getBibContext(path)` must continue to work without an explicit content argument.
- Never modify citation syntax during visual mode toggles; visual mode is non-destructive and only alters the webview DOM.
- Keep the toolbar a 34px, left-aligned, borderless icon strip with a 10px canvas gap; use menus for secondary controls so it stays lightweight beside a PDF viewer.
- Place Undo and Redo as 22px icon-only curved-arrow controls immediately after Save. They operate on the unified canvas snapshot history (typing and structural edits), preserve selection on click, and call the normal dirty/checkpoint path. Figure removal and insertion use explicit DOM block transactions; never infer success from execCommand returning true.
- **Clipboard ownership:** Selected prose and caption text must retain the native text context menu and clipboard shortcuts. Whole-figure and mixed prose/figure operations require the current selection; never reuse a cached selection after the author selects text. Keep figure wrappers in the canvas editing surface so selections can cross captions in both directions; protect only preview and generated prefix nodes. Scope figure shortcuts to the focused canvas.
- **Cross-canvas clipboard:** The host clipboard is plain text across webviews. Recognize complete figure fragments (including surrounding prose and multiple figures) without relying on a receiving canvas cache. Preserve captions, labels, graphics options and untouched source. Re-resolve preview URIs through the host within the receiving project boundary; display-only preview changes must not alter source or create extra undo steps.
- **Empty-document editing:** Provide an editable body caret before the hidden bibliography. Keep standalone title/bibliography directives separate during parsing. Serialize body siblings created by native Enter/paste inside a title wrapper; never report Save success while dropping those nodes.
- **Confirmed figure transactions:** Match host clipboard replies by request ID, ignore stale replies after source refresh/undo, and do not let another copy overwrite a pending cut. Queue paste until the write and cut finish. Remove the original only after a successful clipboard write and an unchanged source check; failures leave the figure intact and show feedback. Preserve undo/redo and exact figure LaTeX.
- **Icon-first toolbar:** Persistent controls use compact icons with accessible labels and tooltips. Keep only the filename as persistent descriptive text. Use one popover menu for block style (body, section, subsection, list) and one for text color (automatic, blue, red); never restore separate heading/list labels or always-visible color dots. Citation insertion is an icon button, immediately followed by a compact visual-mode button (numbers, key, DOI); both controls share the same height, border treatment, and baseline. Figure insertion (`btn-add-figure`, `Ctrl+Shift+F`) is an icon button providing a project image picker modal with asset previews and automatic LaTeX figure block generation. Underline is intentionally unsupported in the authoring toolbar.

## Development Workflow
- In this private preparation checkout, work on `dev1`. Public releases use a reviewed, sanitized snapshot on `main`; never merge private development history into a public release.
- Run tests: `npm test`
- To rebuild webview assets: `npm run bundle`
- To package the extension: `npm run package`
- Install into IDE: `code --install-extension aspyrus-0.6.1.vsix --force`
- Before committing JavaScript changes, run `npm test`, `node --check` on changed JavaScript/CommonJS files, and `git diff --check`. Require the Chromium interaction test to run for clipboard changes, including both drag directions and a fresh receiving webview with plain-text clipboard data, Save and real PDF/DOCX export; a skipped browser test is not equivalent to browser verification.
- Rebuild and commit `src/webview/bundle.js` with source edits; keep version metadata in `package.json` and `package-lock.json` aligned. Packages stay gitignored. After installation, save work and reload the IDE window to replace both the host and webview code.

## Document and Figure Build Contract

- `src/tools/export.py` builds individual authored TEX documents and exports figures. No required supplementary boundary, automatic prose splitting or generated authored TEX. Reserve figures.tex to avoid collision with the figure-only PDF.
- Unified `compile` stages document and figure products before a single recoverable publication. Internal `build`/`figures` actions are diagnostic APIs, not UI alternatives. No figures is normal. Retire only an unchanged figures.pdf owned by this document; preserve unowned or edited outputs. Keep both ownership records compatible with existing builds.
- Figure PDF includes every top-level figure in the open document, including S numbers, with one composed figure and number-only label per page. Full captions stay in TEX/PDF/DOCX. Reject ambiguous/oversized layouts without replacing any deliverables.
- `src/project.cjs` resolves shared resources within the nearest `.aspyrus.json`, legacy `.localleaf.json`, or Git boundary. Check canonical symlink targets and scope webview resource roots accordingly. Bibliography discovery follows declared paths; never mix another document’s label/citation cache into the open document.
- `.aspyrus.json` (legacy `.localleaf.json`) optionally identifies the project boundary and preparation command; normal projects need no script/config. Dependency checks must give actionable setup guidance. CLI users run preparation explicitly before `export.py compile`; the engine does not execute repository commands itself.
- Keep inline and display math as editable native Word equations in the compile path. Preserve revision colors on math runs and operator controls. Verify DOCX XML and rendering; renderer-specific color or pagination differences are not proof that those properties were lost.
- Mirror supported numeric source settings (superscript/brackets, sort, compression) in canvas and DOCX. Preserve compiled citation numbering; Superscript source settings must produce native Word superscript runs; bracketed styles remain bracketed. Keep review modes and bibliography content. Test actual DOCX XML and rendered output.
- Treat bibliography `\newblock` as spacing in DOCX conversion; preserve braced title words, journal names, and natbib DOI fields. Verify their actual exported text, not only citation numbers. Suppress header/footer line numbers while retaining manuscript line numbers.
- Support standard LaTeX `authblk` front matter in DOCX export: Pandoc's native reader discards `\author[...]` optional arguments and `\affil[...]` macros. `tex2docx.py` must extract author markers and affiliations from `authblk` declarations, format author superscripts natively on the author line, and inject numbered affiliation paragraphs into Word XML under the `Date` style directly before the correspondence block, preserving supported text and markers; verify rendered output separately.
- Watch image changes, creations and deletions within the project. Refresh scoped preview URIs without replacing unsaved source or adding undo entries; cache invalidation must preserve byte-for-byte source fidelity.
- Stage and lock builds; check every subprocess and nonempty/current output, source/dependency hashes, unresolved references, DOCX image inventories, and 100% PDF/DOCX prose coverage (enforcing lineno-tolerant hyphenation bridging across line numbers and citation ranges, and unicode superscript decoupling). Keep render-based review for layout and math.
- Hidden document/figure export records own outputs. Protect unowned/edited deliverables and another source’s figure PDF. Publish records last, roll back handled errors and retain a recovery journal after interruption. No silent overwrite bypass.
- Supplementary templates are independent authored source, never regenerated by export. Numerical tables and scientific manuscript conventions belong in project rules, not generic Aspyrus code.
- Run `npm test` including the real combined/separate-document and figure integration test. Check changed Python with `ruff format --check`, `ruff check`, and `python3 -m py_compile`. Shared-path tests must cover both sibling document folders and symlink escapes. Preserve clipboard, source fidelity and save/recovery regressions.

## Word Export Regression Rules

- Fix shared conversion defects in `src/tools/tex2docx.py` or `export.py`; manuscript markup alone does not protect existing or new projects. Keep generic fixtures in `test/export_test.py`, without private manuscript material.
- Bare inline integers/decimals (including signed values) export as ordinary Word text, retaining signs and precision; use the Unicode minus for a math minus. Keep symbolic expressions, scientific notation, fractions and display math as native equations. Cover both inline delimiter syntaxes, body/captions and revision colours in shared exporter regressions; do not rewrite computational data or scientific LaTeX to fix Word selection behaviour.

- Numeric/operator-only inline fragments such as `\(10\%<\)` and `\(<40\%\)` export as ordinary Word text, retaining signs, precision, percentages and comparison symbols. Never emit these as incomplete native equations: some editors display missing-operand placeholders. Keep expressions containing variables (including `n=46`), fractions, scientific notation and display math native. Test both delimiter syntaxes, captions and revision colours; do not alter scientific source to fix export compatibility. Bundled-renderer success alone does not establish compatibility with the reader’s editor.

- Standalone numeric charges and unit powers must become native Word superscript text, without an empty/zero-width equation base. Cover both inline delimiter syntaxes and unit powers immediately after the Angstrom command. Unit normalization must not consume the backslash of the next command. Reject known empty-base signed superscripts before publication; keep symbolic equations editable as OMML.
- Paired absolute values must export as OMML `m:d` delimiters. Cover plain bars, paired lvert/rvert and left/right forms. Preserve functions, operators, values, subscripts and revision color controls, including delimiter controls.
- Revision markers must add no whitespace and must be removed by exact matching. Preserve punctuation and adjacent capital letters; reject leaked markers. Superscript citation spacing follows source style without altering authored TeX; bracketed citations retain normal spacing.
- Converter changes require real PDF/DOCX integration tests and XML checks for exact superscript values, native delimiters and revision colors. Prose coverage and equation counts alone do not establish correct math rendering. Render affected main and supplementary Word body text and captions, compare against PDFs, and record renderer/version, inspected pages and build input/tool hashes.
- After runtime fixes, package and install the tested engine and compare installed `export.py`/`tex2docx.py` against the checkout. Save work and reload the IDE; reopen rebuilt DOCX files without saving an older open copy over them. Historical validation proves only its recorded inputs, not a later build.

## Example Project Workflows

- Starter figures use `assets/figures/main/` and `assets/figures/supplementary/`. An optional approved TOC PNG/JPEG lives directly under `assets/figures/` with its original filename. These are example conventions, not hardcoded runtime restrictions.
- New Manuscript/New Supplementary create only the authored TEX file. A complete new project needs the copied example workspace or user-provided assets and references; do not imply that these commands scaffold all project files.
- `assets.py` validates registered local files without upstream access by default. Copying requires explicit repeatable `--promote <asset>`; fail clearly for missing selected sources. CSV source paths are placeholders until configured. Never promote assets automatically during Compile.
- `bibgen.py` aggregates atomic reference records; `--check` validates current citations. The example preparation hook calls only this script. Run aggregation explicitly before a terminal paired build after reference changes.
- `build.py` uses the external `src/tools/export.py` engine and manuscript-local inputs, without archives or feedback. A copied example selects its external tool with `--aspyrus-root` or `ASPYRUS_ROOT`. PyMuPDF is an additional dependency for packaging. Do not require equations, a workbook, or a TOC when the authored documents do not contain them.
- The paired build publishes PDF/Word beside their authored TeX and the combined deck at `assets/figures/figures.pdf`, with `build_report.json` at the root, referencing the workbook in `assets/tables/`. Temporary staging and `MANUSCRIPT_DONE` live in `.aspyrus_build/manuscript/`; logs go under `logs/manuscript/`. Never create manuscript `data/` or duplicate delivery copies. Set the completion marker only after verified outputs. Optional `--toc-graphic <local-asset>` appends the approved graphic once to the combined deck. TOC generation code and scientific inputs remain in the owning computational project.
- Exclude the generated `assets/figures/figures.pdf` from paired-build input snapshots. Record its relative path and hash in root `build_report.json`. Retire the old root deck only after verifying its recorded hash; preserve unowned or edited exports. Nested publication must retain rollback/recovery and reject traversal or symlinked output paths. Per-document Compile figure decks remain beside their authored TEX.
- Collaboration records use `feedback/<revision>/edit/<date>/`, `submission/`, `decision/` and `audit/`. Create event folders when needed; the decision prompting the next working stage belongs with that stage (`rev2/decision/` evaluates Rev1 and prompts Rev2 edits). Record the reviewed stage, resulting working stage, letter date and differing filing date in revision READMEs. Terminal decisions with no further work stay with the evaluated stage; do not invent another revision. Preserve hashes and relocation records when moving received files. Original Word and journal files are immutable; LaTeX remains authoritative.
- `feedback.py --feedback-dir <explicit-package>` compares current exports and records proposals under the revision's `audit/`. Use filename selectors for nonconventional/ambiguous documents; submitted packages prefer clean main. Keep legacy flat inputs and output overrides compatible. Preserve decisions across reruns, separate logs, and write completion markers after verification. Never auto-apply edits, approve a submission or create Git tags.
- Generic `docdiff.py` excludes files under `audit/` and `decision/` during discovery, prefers manuscript edit exchanges, and puts document-specific revision reports outside immutable packages. Test discovery, report paths, source/input preservation and selection failures.
- Deduplicate only verified identical files and record retained paths. Keep distinct marked/clean presentations. Source and exact submitted files must be reconciled before a user-authorized milestone; historical reports remain evidence of their recorded inputs. Do not package private records in the starter.
- Ignore example build manifests, caches and `logs/`. Package only the generic source scripts and placeholder assets; exclude received feedback, generated outputs and private project material. Test script changes with the example workflow regressions and a relocated build when the paired-build behavior changes.

- Keep standing workflow rules in the tracked project README/AGENTS and feedback README; shared requirements also belong in Aspyrus and its starter. Audit folders hold comparison results, review decisions and provenance, never the only copy of a required rule.
- Feedback comparisons must record exact source/export/received hashes and audit-script provenance. Reject stale source, recorded dependencies or modified DOCX when export ownership records exist; explicitly identify legacy exports without provenance as unverified. Preserve unmatched decisions in `previous_decisions.tsv` across reruns, without applying them to new change IDs.
- Paragraph diffs do not certify equation properties, tables/workbook coverage, images, numerical values, reference identity/order, front matter or layout. Document normalization, inspect retained differences, and validate those separately before a milestone; native OMML bars/operators may be absent from extracted text. Promote recurring audit defects into shared implementation, regression tests and starter instructions; historical PASS records cover only their recorded inputs.

## Cleanup Boundaries

- Disposable Python/Ruff caches may be removed. Keep source, independent supplementary starters, manuscript archives, reviewed assets and extension recovery history.
- Keep hidden export ownership records with their outputs. Do not delete a record alone as routine cleanup; archive the record and its generated outputs together when retiring an export set.
- Never remove `.localleaf_build/` during an operation or discard a `publication/` recovery journal/backups. Recover interrupted publication first. A persistent `operation.lock` file is expected and is not proof of an active or abandoned lock.

## Future Features (Not Current Behavior)

- A Preview control may open the same document PDF. Do not introduce a second public PDF or resurrect duplicate Compile/Export buttons. Synchronized source/PDF navigation and clickable build diagnostics are future work.
- Consider an optional asset import/provenance interface using a project-owned `assets/assets.csv`. Manual file placement and ordinary TEX paths must remain sufficient. No mandatory manifest and no automatic asset promotion during Compile.

## Maintenance Sanity Checks

- Audit the README feature summary as well as detailed sections when changing controls, build configuration or commands. Do not leave legacy Export controls, automatic compile.sh discovery or removed environment variables documented as current behavior.
- CI must lint, format-check and syntax-check all `src/tools/*.py` and `test/*_test.py`, including tex2docx.py. Packaging must reproduce the tracked bundle. Keep the installed engine and development checkout distinct when explaining CLI commands.
- Preserve the current installer at the root; older installers may be moved intact to ignored `.vsix-archive/` for rollback. Exclude that archive, dependencies, tests and caches from the VSIX. Keep node_modules unless intentionally reinstalling dependencies.
- No private manuscript TEX, bibliography, figures, workbook, feedback or recovery data belongs in this generic tool package. Inspect the package inventory before release; research convention changes belong in manuscript documentation.
- Document supported boundaries honestly: self-contained TEX, numeric citation support and POSIX build locking. Do not claim arbitrary LaTeX, author-year styles or native Windows compilation are supported without implementation and verification.
- Documentation/CI-only cleanup does not require a runtime version bump or extension reinstall. Run the checks affected by the changes; retain build ownership records and recovery journals.

## Simplicity in Changes

- Before editing, reproduce the reported problem, read the affected implementation and trace its callers and actual source-to-output flow. Identify existing helpers, dependencies and regression coverage; fix the responsible layer rather than patching one visible symptom.
- Define the requested behaviour and the existing behaviours that must remain intact. Reuse existing functions, native APIs and installed dependencies when they fit; add code or dependencies only when those mechanisms cannot satisfy the requirement.
- Make the smallest sufficient, readable change. Exclude unrelated refactoring, cleanup, configuration and speculative abstractions; fewer lines do not justify an incorrect or opaque implementation.
- Review the final diff against the requested scope. For shared logic changes, extend the existing regression suite to reproduce the defect and cover affected sibling callers or neighbouring behaviours. Run the relevant existing checks; do not replace established coverage with a single smoke test. Verify source fidelity and rendered outputs when the change affects authoring or export.
- Explain a necessary expansion beyond the authorized scope before performing dependent changes. Routine choices within the agreed scope do not require repeated permission. Report the resulting behaviour, verification and unresolved limitations.
- Keep frequent editing actions on the toolbar; use commands or menus for occasional actions.
- Simplicity never removes source fidelity, recovery, save confirmation, build ownership, accessibility, or required regression checks. Test the reported failure and update only the documentation affected by the behavior.
- Generic editor behavior belongs here; scientific content, stage scope and asset provenance belong in the owning manuscript.

## Universal colour and milestone rules

- Prefer standard textcolor red/blue, soul hl, and explicit begingroup/color/endgroup for new templates. Put group boundaries on separate lines. Preserve nested scope, headings, captions, math and untouched source. Retain custom/legacy macro support without silently rewriting manuscripts. Do not claim arbitrary colour models or shorthand groups are certified by red/blue tests.
- Colours represent presentation only. Authorship and accepted changes belong in revision feedback records. Never infer acceptance from red/blue or automatically incorporate Word edits.
- A verified submission baseline contains normal source text with active colour/highlight wrappers removed, retaining content and reusable preamble definitions. Archive marked source through ordinary Git commits before this step.
- Create one user-authorized annotated tag per verified journal submission (e.g. `rev1-submission`) only after reconciling the exact collaborator-returned files, asset/reference coverage and scientific text. Preserve originals and evidence; do not create tags automatically during builds or audits.
- Changes to colour parsing/export require scope and lossless-source tests plus real PDF/Word checks for inline commands, nested blocks and editable equations.

- Clean manuscript PDFs use `\hypersetup{colorlinks=true,allcolors=black}` in both document preambles. Setting only `citecolor` leaves figure references, external-document links and URLs coloured by Hyperref defaults. Check rendered references and PDF text colours after a clean build; intentional figure artwork and explicit revision markup remain coloured.

- Hyperlink-colour regression coverage must compile both starter documents and inspect actual PDF colours for internal references, external PDF links and URLs. Test link text separately from explicit revision markup and figure artwork; a passing body-text/DOCX check does not prove PDF references are black.
- Before a submission milestone, finish all corrections, rebuild both documents, verify current build input/output hashes, scan PDF text colours and inspect affected pages. Create an annotated tag at the explicitly verified source commit, then inspect both tagged TEX files and compare their hashes with the validated build inputs. A fix made after tagging is outside that tag: disclose it and update the tag only with explicit authorization. Documentation/test-only commits do not require moving an already verified manuscript tag.

## Formatting changes and upgrade checks

- For rendering or export upgrades, review canvas, source serialization, PDF and Word implications together. Update affected README/AGENTS and starter requirements in the same change, or record why no update is needed. Check installed tools against the tested checkout; save and reload the IDE after installation.
- Canvas numbers, operators and uppercase Greek symbols are upright inside mixed expressions; variables and explicitly authored italics remain italic. Cover Unicode signs, captions, actual browser computed styles and lossless source serialization.
- Apply/remove yellow highlighting through the compact highlight menu within a paragraph or caption. Preserve nested formatting, selected text, undo/redo and unaffected source. Use `\hl{...}` with `\usepackage{soul}`; retain legacy `\pihighlight` support. Unsupported preambles must receive actionable feedback rather than silent package insertion. PDF/Word export tests must verify real highlighting and unchanged text; remove active highlight wrappers for a clean submission baseline.
- Toolbar-applied red/blue and menu swatches use the shared D32F2F/1976D2 palette. Test newly applied formatting as well as rendering existing source.

## Word export typography

- DOCX body text, abstracts and bibliography use left alignment. Keep the existing 0.25-inch first-line body indent; preserve dedicated title, heading, table and equation formatting. PDF alignment follows the authored LaTeX. Starter documents explicitly use ragged2e RaggedRight with the article first-line indent retained, matching left-aligned Word body text; captions retain justified formatting and headings/tables/equations retain their own alignment.
- Export regression checks must verify native Word alignment and indentation together.

- DOCX typography follows explicit standard `10pt`, `11pt` or `12pt` document-class options. With no supported explicit size, retain the existing 12 pt review fallback. Test source size, native Word sizes and preserved paragraph indentation together.
- PDF prose validation may bridge hyphenated words around detached caption labels or math-only glyph rows. Retain intervening tokens and require the reconstructed word in the expected inventory; never skip arbitrary prose or suppress missing-word failures. Cover both extraction cases and genuine missing prose in generic regressions.

## Audit organization

Audit records use only three top-level categories: `audit/edit/<date>/` for exchange comparisons, `audit/submission/` for final verification, and `audit/checks/` for other evidence, including decision checks, formatting, migrations and organization. Put small checks in descriptive files under `checks/`; use a subfolder only for a multi-file check. Preserve historical reports and record hashes and relocated paths; do not treat identical bytes from different audit contexts as disposable. The revision README summarizes findings, unresolved issues and next steps. Standing rules belong in README/AGENTS, never only in an audit folder. Logs remain under `logs/feedback/`.

## Greek labels and mathematical italics

Greek typography follows meaning, not alphabet alone. Structural/atom labels (αC, β3, Cα) use explicit upright commands such as `\(\upalpha\)C`, `\(\upbeta3\)` and `C\(\upalpha\)` with `\usepackage{upgreek}`; residue identifiers such as Y86 are prose. Quantities and variables, including χ torsion angles, H, n and k, retain mathematical italics. Descriptive subscripts/labels use `\mathrm{norm}`, `\mathrm{WT}` or `\text{...}`; preserve explicitly authored italics and bibliography styling. Never globally flatten Greek symbols or infer structural meaning from a bare math token. The canvas honors explicit upright Greek and LaTeX's default uppercase Greek styling, including explicit italic overrides. Greek inserted/pasted into prose saves as upright upgreek markup; the symbol toolbar must explain the missing package before insertion and must never add packages silently. Existing unedited math remains byte-for-byte unchanged. Shared Word conversion exports standalone explicit Greek labels as upright prose and embedded upgreek as upright native math runs, retaining variables and colours. Test insertion, save/reopen, browser computed styles, PDF and native DOCX properties together.

## Asset references after editorial changes

- After incorporating collaborator edits or deleting/reordering sections, inventory active figures, supplementary figures, tables and other numbered assets in both documents. Check that retained assets are cited, removed assets have no remaining references, every label resolves, and each citation accurately describes its target (including workbook tables).
- Check first mentions in reading order separately for main figures, supplementary figures, main tables and supplementary tables, following the journal's conventions. Expand cited ranges when checking coverage; repeat mentions may refer back to earlier numbers. LaTeX assigns numbers from asset placement, not prose citation order: a successful build does not prove sequential first mentions.
- Prefer adding a parenthetical label-based reference to an existing scientifically appropriate sentence. Preserve the project's citation style and minimize added wording; do not add a redundant summary sentence solely to introduce an asset. Never place an irrelevant citation merely to force numerical order. If accurate placement conflicts with order, review asset ordering and dependent references explicitly before renumbering.
- Preserve accepted scientific wording and revision scope. Colour only added/replacement wording according to the project's baseline; unchanged wording stays unchanged. Automatic renumbering alone is not a scientific text change.
- Rebuild both documents and verify resolved numbers, ranges, punctuation and revision colours on affected PDF and Word pages. Record the current inputs, first-mention sequences, coverage exceptions and inspected pages in audit evidence. Historical PASS records do not validate the edited manuscript. These are editorial review requirements, not automatic checks currently provided by Compile or paragraph comparison.

## Bibliography verification

- DOI lists live in manuscript-owned `references/dois.txt`, one identifier per
  line. Explicit `bibgen.py --dois [path]` retrieves missing records, deduplicates
  normalized DOIs, preserves existing keys/records and refuses filename collisions.
  Validate the returned DOI and required fields before saving; failures stay visible.
  Do not fetch during aggregation/Compile or automatically insert citations.
  Use `--audit-references --all-references` when preparing an uncited library;
  the default audit remains cited/nocited records only. Metadata retrieval is not
  scientific acceptance. Keep publication-date and publisher discrepancies flagged.

- Reviewed exceptions live in the `reviews` section of `references/references.json`, with exact record and metadata hashes, the specific accepted flags, rationale, review date and authoritative source URLs. Preserve raw discrepancies as `detected_flags`; resolve only those explicitly reviewed. A changed record or metadata snapshot invalidates the exception; additional flags remain unresolved. `reviewed_exception` means documented resolution of the named discrepancies, not blanket certification of every field or claim.

- `bibgen.py --check` checks citekey availability in main and supplementary, including `\nocite`; it does not certify bibliographic accuracy. Use `--audit-references` for field completeness and comparison against cached DOI metadata; use `--audit-references --refresh-metadata` for explicit, throttled Crossref retrieval. Normal aggregation and Compile remain offline.
- Keep `references/references.json` as manuscript-owned provenance: record hashes, source URLs, retrieval dates, compared metadata, current source/checker hashes and unresolved flags. A changed record invalidates cached verification. `metadata_match` means agreement with the recorded source, not publisher/manual verification, rendered-output completeness or scientific claim support. Review flags produce a nonzero exit status; never invent missing metadata or silently replace records to obtain a PASS.
- Review publication-type requirements and legitimate exceptions (online-first dates, article identifiers, abbreviations, books/chapters) using publisher or other authoritative evidence. Check the rendered bibliography separately: valid BibTeX fields can be suppressed by its style. For `achemso`, chapter-title output requires its control setting; explicitly retain the article-title, DOI and author-truncation defaults when adding a control record, since omitted control fields can reset those behaviours; retain controls separately from scientific records and do not emit visible citations to them. Preserve citation identity/order and test style controls with actual BibTeX/PDF/Word output.

Standard citations use `\cite{key}`. Revision colour is applied with the existing colour commands independently of citation identity. The starter uses standard citations; Aspyrus retains `\revref` compatibility for older sources. Changing an equivalent citation wrapper must preserve keys, ordering, numbers and surrounding wording.

Bibliography author checks must include name suffixes (such as Jr. and III) as separate discrepancies, so prior spelling exceptions cannot conceal missing suffixes. Store three-part BibTeX names as `Family, Suffix, Given`. Word export must preserve bibliography-generated author truncation (`et al.`), including achemso’s `\latin` wrapper; regression checks must cover long and untruncated author lists in real DOCX output. Verify rendered references independently of metadata checks.

## CLI Word review

- Keep Canvas lightweight: no dedicated Word review UI/IPC. `src/tools/docreview.py`
  is the external interactive engine; project/example feedback.py delegates explicitly
  with --review/--interactive. Preserve legacy audit commands and untouched editor code.
- Require current source/dependency/DOCX hashes. Record an exact sent baseline when
  available; label two-way comparison honestly. Automatically apply only unique literal
  prose spans; protect math, citation keys, comments and structure. Flag recognized
  Word citation changes. Exclude/count bibliography paragraphs; no BibTeX editing here.
- Show the smallest meaningful edit with context. Accept supports per-change normal,
  red or blue and an optional session default. Generate standard textcolor commands;
  require explicit xcolor/color package loading without silently editing the preamble.
  No custom colour macros are required in the starter. Normal
  replacements in authored coloured scopes override only the replacement to black;
  untouched wording/source survives exactly. Deletions remain in Git/review evidence.
- Interactive incorporation requires a committed source baseline. Record the starting
  commit, preview the combined diff and require explicit SAVE. Revalidate source,
  dependencies, received files, engine and Git checkpoint; never commit/reset/create a
  branch automatically. Keep recovery under ignored .aspyrus_build, not the audit.
- review.json owns per-document inputs, decisions/styles and earlier sessions; review.md
  is readable. Publish records atomically and protect concurrent writers/symlink outputs.
  Preserve historical evidence with recoverable contents/hashes when consolidating.
- User must save/close unsaved editing buffers before terminal writes. Canvas sees the
  saved source through existing refresh, not a second acceptance flow. Test CLI choice,
  colours/numerics, cancellation, checkpoint/stale-input gates, citation exclusion,
  recovery, wrapper fidelity and starter delegation, plus the existing regression suite.

### Complete exchange decisions

Record the exact sent DOCX and its source commit when handing work to a collaborator;
keep the received file immutable. Supply that sent DOCX with `--original` to compare
sent, returned and current versions. A current Git checkpoint is recovery evidence,
not necessarily the sent baseline. Without the sent baseline, report a two-way
comparison and do not infer who deleted or added text.

Keep every detected substantive difference visible, including deletions of existing
red/blue wording and newer local corrections. Earlier instructions must not silently
exclude a newer returned difference. Record each outcome: accept, retain local with
an explicit reason, or pending. The CLI asks for a reason when declining an edit;
its report and final preview list retained and pending items. Skipping is pending,
not resolved. Accepted choices alone do not prove that edits were saved or validated.
Partial incorporation is allowed, but never describe it as an exact match while
retained differences remain. Before committing, inspect the word diff, account for
substantive differences, list unresolved items and run the relevant checks.

## Assistant-led feedback incorporation

- Users may ask the assistant to incorporate an exchange without operating the
  interactive CLI. Use the same external comparison engine and review ledger;
  the interactive prompts are an optional interface, not a separate methodology.
- First read the project rules and identify the returned file, current authored
  source/export and exact sent DOCX/source commit when available. Require a current
  export and a committed source checkpoint before incorporation. Do not create
  commits, branches or tags without authorization. A submission tag is not proof
  of the actual Word file sent. If the sent baseline is unavailable, explicitly
  describe the comparison as two-way and do not infer authorship of differences.
- Generate comparison evidence using `feedback.py --review`. Examine every
  substantive addition, deletion and replacement, including coloured text and
  newer local corrections. Resolve differences according to the user's current
  authorized scope; ask only about uncertain choices that remain outside it.
  Record accepted, retained-local (with a reason) and pending items. Prior wording
  instructions must not silently remove a newer returned difference from review.
- For uniquely mapped literal prose, use the shared `docreview.py` comparison,
  preparation and save checks, including input revalidation and recovery. Existing
  authorization to apply the reviewed scope does not require the user to operate
  a terminal or repeat that authorization by typing SAVE. The human interactive
  interface continues to require SAVE. There is currently no supported noninteractive
  apply command; do not document or invent one.
- Shared-function callers must record retained-local rationale explicitly: this is
  presently enforced by the CLI prompt, not by all underlying functions. Treat this
  as an assistant responsibility until shared decision validation is implemented.
- Manual equation, citation or structural edits require evidence and explicit
  scope authorization; never force a manual item into the automatic-ready class.
  Preserve exact before/after source, reason, user authorization, relevant change
  IDs, styling and resulting hashes in the existing review record, retaining its
  input snapshot and previous events. Do not pretend a direct manual edit passed
  the automatic literal-mapping checks. Bibliography records remain a separate
  upstream workflow; do not import the generated Word reference list into LaTeX.
- Preserve unaffected source and make the least sufficient editorial change. After
  incorporation, rebuild current exports and reconcile them with the returned file,
  accounting explicitly for retained differences and pending items. Inspect the
  word diff and affected outputs, and check dependent citations/assets/scientific
  statements. Preserve the initial comparison and decisions when recording fresh
  verification. A saved edit, finished audit or successful build alone is not
  evidence that every difference is resolved or the science is verified.
- Summarize what was applied, retained and unresolved, plus verification limits.
  Record durable workflow rules in project/shared README and AGENTS files; audit
  folders hold exchange evidence. Keep review.json/review.md and existing folder
  roles; add no Canvas review UI or duplicate decision process.

- New Canvas citation insertion uses standard cite even when a preamble defines revref; editing existing revref citations preserves their command. Standard syntax changes require parser/source roundtrip, browser insertion, PDF/Word colour and existing-feature regression checks.

- Native Word equation colour must be checked in OOXML separately from renderer output. LibreOffice can display correctly coloured OMML runs in black; disclose that limit and do not flatten equations to conceal it.

## Reference import safeguards

- Articles own PDFs/literature identifiers; manuscript references own a selected
  DOI list, atomic BibTeX and verification. Compare copied lists explicitly.
  Never delete manuscript records because the article list changed; adding a
  library entry does not insert citations or authorize new scientific scope.
- New imports use FirstAuthorYearShortTopic keys with matching filenames and
  lowercase, one-field-per-line formatting. Preserve established keys, values,
  author order and nested LaTeX braces. Formatting is separate from correction.
- Single and list imports must both skip existing DOIs and refuse filename
  collisions. Use generic tool identification, not inherited personal contacts.
- Preserve cached evidence when audit scope narrows; excluded cached records are
  not current-scope results. Hash changes invalidate reuse and reviewed exceptions.
- Resolve publisher/registry discrepancies with explicit evidence and rationale;
  never manufacture missing fields or normalize a discrepancy just to obtain PASS.
  Reference identity, completeness, citation availability, rendered output and
  scientific claim support are separate checks. Test safeguards before commits.

## Reference preparation entry point

- Use `scripts/README.md` for concise script usage. Explicit `bibgen.py --prepare`
  imports new configured article identifiers, retrieves missing records, refreshes
  full-library metadata and checks citation keys. The ordinary build hook remains
  offline aggregation, never `--prepare`.
- `references/references.json` is the consolidated evidence/decision ledger;
  `references/references.csv` is its inspection projection. DOI is the first CSV
  column; comments/status are last; status is binary READY/CHECK. Do not treat CSV edits as review decisions.
- Preserve legacy reports, notes and exceptions verbatim during migration; retire
  old files only after exact content/hash verification. Preserve human correction
  rationales and source evidence, including publisher/registry disagreements.

### Source-backed reference review

`bibgen.py --review-reference KEY` is the focused correction/exception entry
point. Stage one publisher record or the current record, preserve its citation
key, require an authoritative URL and specific verification rationale, and accept
only selected exception flags. Missing fields and DOI identity mismatches cannot
be waived. Preview and require SAVE; cancellation must leave the repository
unchanged. Revalidate source, ledger and DOI inputs before saving, retain previous
source/audit/decisions for recovery, then regenerate reports. A DOI replacement
requires registry retrieval; no-DOI primary evidence must be labelled as an explicit
user review. This records a review rather than independently reading the URL.
Test cancellation, stale-save protection, corrections, exceptions, DOI replacement
and report regeneration. Preserve existing build/import/audit behaviour.

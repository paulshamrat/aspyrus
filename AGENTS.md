# Aspyrus coding-agent instructions

- Optional config-free manuscript builds are explicitly opted into by
  `ASPYRUS_BUILD_ENTRY = True` in scripts/build.py. Require workspace trust and
  canonical containment; preserve current-output checks and legacy compilation.
- ASPYRUS_PLAIN_RECORDS=1 selects typed Python-literal .log ownership/review and
  recovery records. Never eval them. Preserve rollback, stale-input and output
  ownership gates; default JSON projects remain supported. Plain manuscript
  wrappers own logs/<document>/export.log and must preserve existing history.

## Read before editing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the relevant sections of the
[development contract](docs/development-contract.md). The contract retains
mandatory source, rendering, export and review regression requirements; moving
these rules out of this file does not make them optional.

- Source/parser or Canvas work: Citation & Environment Handling Rules and save,
  recovery, clipboard and typography requirements.
- Compilation/conversion work: Document and Figure Build Contract and Word Export
  Regression Rules.
- Starter, bibliography or feedback work: Example Project Workflows, Bibliography
  Verification, CLI Word Review and Assistant-led Feedback Incorporation.

## Scope and architecture

- LaTeX is authoritative. Preserve unedited source bytes, keys, labels, math,
  captions, preambles and environment boundaries.
- Trace existing code and callers before editing. Make the least sufficient
  change; do not rewrite unrelated paragraphs or refactor working features.
- Editor hosting lives in `src/extension.cjs`; parsing/serialization in
  `src/parser.js`; Canvas in `src/webview/`; builds and review tools in
  `src/tools/`. Keep optional Python out of basic authoring.
- Bibliography review must distinguish wrong fields from documented registry
  limitations. Bind approved flags to exact record/evidence hashes; preserve
  primary-source provenance for no-DOI works and check conference booktitles.
- Shared fixes belong in shared code and regressions. Scientific content and
  project-specific conventions belong in the owning manuscript, never generic
  fixtures or templates.
- Preserve standard LaTeX authoring and supported legacy syntax. New citations use
  `\cite`; numeric Canvas citations are blue and borderless. Appearance changes
  must not change citation identity, source or exports.
- Preserve confirmed Save, recovery, Undo/Redo, resource boundaries and output
  ownership. Never bypass checks to overwrite unowned or edited deliverables.
- Keep the Canvas lightweight. CLI Word review is optional; do not add a parallel
  Canvas acceptance workflow.

## Validation

- Run `npm test` for runtime changes, plus relevant failure and neighbouring
  regression checks. A skipped browser test is not browser verification.
- Check changed JS/CommonJS with `node --check`. Check changed Python with
  `ruff format --check`, `ruff check` and `python3 -m py_compile`.
- Rebuild `src/webview/bundle.js` with `npm run bundle` after webview/parser
  changes; keep the bundle and source in the same commit.
- For display changes check real browser computed styles and source round trips.
  For conversion changes check real PDF/DOCX output, native Word properties and
  affected rendered pages; record renderer-specific limits.
- Inspect docs, examples and package contents affected by a change. Do not repeat
  whole integration suites after passing checks unless further changes justify it.
- Run `git diff --check` and review the final scope before committing. Explain
  what changed, verification and unresolved limitations.

## Documentation and release

- README is the user entry point; `docs/` holds detailed guides and the developer
  contract; CONTRIBUTING serves human contributors. Keep links and commands valid.
- Preserve durable rules when consolidating documentation. Audit reports hold
  exchange evidence, not the only copy of requirements.
- Keep `package.json` and the root project versions in `package-lock.json` aligned.
  Describe pending releases honestly; do not invent repository URLs, publisher
  ownership, downloads, submission dates or claims of universal fidelity.
- Preserve legitimate license notices, including original contributor attribution.
- Exclude private manuscripts, feedback, generated products, recovery data, caches
  and installer archives from public source and VSIX contents.
- Packages and older installers stay ignored. Archive a previous installer intact
  before replacing it; do not delete build ownership records or active publication
  recovery journals as cleanup.
- Documentation-only changes do not require manuscript rebuilds or IDE reloads.
  Install a new runtime package only within authorized scope; verify installed
  files against the tested checkout and tell the user to save before reloading.

- Script usage lives in `example/scripts/README.md`, copied beside manuscript helpers. Keep docs links valid; the developer contract continues to enforce verification. Reference preparation writes consolidated references JSON/CSV and must preserve legacy evidence during migration.

- Use `bibgen.py --review-reference KEY` for source-backed reference corrections
  and reviewed exceptions. Preserve the primary URL, specific rationale, selected
  flags and recovery history in the existing JSON ledger. Inspect the candidate
  before SAVE; never waive missing fields or DOI identity mismatches. The command
  records explicit human/assistant verification, not independent source reading.

## Scientific Typography & Word DOCX Parity Rules

- **Zero Inverted-Question-Mark Glyphs (`¿¿`) on Chemical Ions**:
  - Never allow raw ion math like `$\text{Mg}^{2+}$`, `$\mathrm{Mg}^{2+}$`, `$\text{Na}^+$`, or `$\text{Cl}^-$` inside colored review spans (`\textcolor{red}{...}`). In Microsoft Word and LibreOffice, OMML math nodes `<m:oMath>` corrupted with nested run property colors `<w:rPr>` cause schema parse failures that render fallback inverted question marks (`¿¿`).
  - Aspyrus normalizes chemical ions in `normalize_native_inline_math` into native Word superscripts (e.g. `Mg\textsuperscript{2+}`, `Na\textsuperscript{+}`, `Cl\textsuperscript{-}`) so they inherit standard font, alignment, and coloring without entering Office Math mode.
- **No Equation Bounding Boxes for Single-Letter Subscripts and Physical Parameters**:
  - Biophysical parameters such as Radius of Gyration ($R_g$), dynamic pocket distance ($d_{\mathrm{pocket}}$), and cross-correlation coefficients ($C_{ij}$) must not appear inside isolated Cambria Math equation boxes with sizing handles.
  - In LaTeX source, format these variables using text mode with italics and subscript: `\textit{R}\textsubscript{g}`, `\textit{d}\textsubscript{pocket}`, and `\textit{C}\textsubscript{ij}`.
  - Aspyrus automatically converts single-letter subscripts in `normalize_native_inline_math` to `\textit{X}\textsubscript{sub}`.
- **No Equation Boxes for Coordinate Tuples and Number Lists**:
  - Never enclose coordinate data or checkpoint lists inside math mode delimiters (e.g. avoid `$(+11.1\text{ \AA}, +9.7\text{ \AA})$` or `$0, 15, 30, ...\text{ ns}$`).
  - Write coordinates in standard prose: `(+11.1~\AA, +9.7~\AA)` or `(PC1 $\approx -9.7$~\AA, PC2 $\approx -2.2$~\AA)`.
  - Write checkpoint lists in plain prose: `0, 15, 30, 45, 60, 75, 90, and 100~ns`.
- **Tilde Discipline Before Numbers**:
  - In LaTeX, a bare `~` before a digit (e.g. `~14.6`) is an unescaped non-breaking space that silently vanishes in Word DOCX export (e.g. producing "between  14.6 and 15.3").
  - Always write `\textasciitilde{}14.6` or relational math `$\approx 14.6$`.
  - Aspyrus enforces this via regex in `convert`: `re.sub(r"(?<![A-Za-z0-9\\])~(\s*[0-9]+(?:\.[0-9]+)?%?)", r" \textasciitilde{}\1", tex)`.
- **Structural Biology Greek Secondary Structure Labels**:
  - Protein secondary structure labels (e.g. C$\alpha$, $\alpha/\beta$ fold, $\alpha 1$, $\beta 6$) must render as upright prose glyphs (Cα, α/β, α1, β6) in Times New Roman, not separate Cambria Math equation boxes.

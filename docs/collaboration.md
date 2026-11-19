# Collaboration and returned Word edits

## Colour markup and submission milestones

Prefer standard `\textcolor{red}{...}`, `\textcolor{blue}{...}` and `\hl{...}`
(with `xcolor` and `soul`). For several paragraphs use standard explicit groups,
with boundaries on separate lines:

```latex
\begingroup\color{red}
First paragraph.

Second paragraph.
\endgroup
```

Nested supported red/blue groups restore the outer colour. Native Word equations
carry the correct run colours, but LibreOffice may display these equations black;
check the target application before relying on coloured equations. Named LaTeX red is
`#FF0000` and blue is `#0000FF` across Canvas, PDF and Word. Existing custom
`\redtext`/`\bluetext` and `redblock`/`blueblock` remain supported at their
original `#D32F2F`/`#1976D2` shades. Legacy semantic macros remain compatible;
new templates do not define or recommend semantic aliases such as newdata or pitext.
The starter and CLI review use standard commands without custom colour definitions.
Arbitrary colour declarations, other colour models and shorthand brace groups are not newly certified by these
red/blue scope checks. New Canvas citations use standard `\cite`; editing an
existing `\revref` preserves that citation's original command.

Both preambles set `\hypersetup{colorlinks=true,allcolors=black}` so figure references, external-document links, citations and URLs stay black and clickable. Explicit colour markup and figure artwork retain their intended colours.

Colours describe presentation, not authorship or acceptance. Record the exchange, source document and accepted changes in `feedback/<revision>/`; never infer these from a colour. Before the next revision, reconcile the exact collaborator-returned submitted documents with the authoritative LaTeX, then remove active colour/highlight wrappers while retaining their contents. The submitted source must be ordinary text, not a hidden colour toggle. Keep reusable definitions in the preamble for the next round.

Use one annotated Git tag per verified journal submission, such as `rev1-submission`, pointing to the clean reconciled source commit. Earlier marked exchanges remain in normal Git history and the immutable feedback packages. Do not tag a working draft or assume that a clean-looking Word file establishes its provenance. Preserve supplied originals and record comparison limits before a milestone.

### Verify the final submission tag

Finish source corrections and rebuild before tagging. Confirm the build report matches the current inputs and outputs, check link/text colours in both PDFs, and visually inspect affected pages. After creating the annotated tag, verify the commit and the tagged preambles:

```bash
git rev-parse rev1-submission^{}
git show rev1-submission:main/main.tex
git show rev1-submission:supplementary/supplementary.tex
```

Compare the tagged source hashes with the validated build input hashes. A correction committed later is not included in the tag; report the mismatch and update the tag only when explicitly authorized. The starter regression test compiles both documents and checks internal-reference, external-file and URL text colours, so restoring Hyperref's default colours causes a test failure.

Recurring comparison and validation requirements are documented in the feedback workflow in the [starter feedback guide](../example/feedback/README.md). Audits record exact inputs, check available export provenance and retain unmatched review decisions; paragraph comparisons still require separate equation, asset, reference and visual verification before submission.

Canvas formatting uses upright numbers/operators within mathematical expressions while retaining variable and explicit text italics. The compact highlight menu applies yellow or removes highlighting from selected text within a paragraph or caption; undo/redo and nested formatting remain available. Highlighting uses `\hl{...}` and requires `\usepackage{soul}` in the authored preamble; existing `\pihighlight` remains supported. The starter includes this package. Word exports retain native yellow highlighting alongside text colours. Red/blue toolbar formatting uses the shared publication palette.

Rendering/export changes must review canvas, source preservation, PDF/Word behaviour and affected README/AGENTS/starter instructions together. Tests should check actual browser styles and exported properties, not only parsed class names.

Native equation highlighting is retained in Word XML, but the bundled LibreOffice preview may omit its yellow background; prose highlighting renders correctly. Inspect the intended Word renderer when highlighting equations.

For equation highlighting, select the complete inline math token from surrounding text; partial selections inside math are rejected to preserve scientific source.

## Audit organization

Audit records use only three top-level categories: `audit/edit/<date>/` for exchange comparisons, `audit/submission/` for final verification, and `audit/checks/` for other evidence, including decision checks, formatting, migrations and organization. Put small checks in descriptive files under `checks/`; use a subfolder only for a multi-file check. Preserve historical reports and record hashes and relocated paths; do not treat identical bytes from different audit contexts as disposable. The revision README summarizes findings, unresolved issues and next steps. Standing rules belong in README/AGENTS, never only in an audit folder. Logs remain under `logs/feedback/`.

## Asset reference review

After collaborator edits or section deletions, check all active figures and tables for coverage, accurate descriptions, resolved labels and first-mention order, separately for each numbering series. Expand ranges during the check; later repeat citations may refer back to earlier assets. LaTeX numbering follows asset placement, so a successful build alone does not establish citation order.

Prefer a parenthetical reference in an existing scientifically appropriate sentence, following the manuscript's style. Avoid redundant asset-summary sentences and irrelevant citations inserted solely to force order. Mark only added/replacement wording using the agreed revision baseline. Rebuild both documents and inspect affected PDF and Word pages for numbers, ranges and colours; record current evidence and any exceptions. Compile and paragraph comparison do not automate this editorial review.

### Review returned Word edits in the terminal

Canvas remains the ordinary editor; review adds no toolbar/menu/dialog. Save or close
any unsaved Canvas/TEX buffers before running CLI incorporation. Its normal source
refresh displays the saved TEX; existing formatting, citations, Save and Undo remain
unchanged. Do not rely on Canvas Undo to reverse a terminal write: use the Git diff,
recorded starting commit or recovery copy.

Commit the authored TEX baseline, then Compile to create a current owned DOCX. Put
immutable returned Word files in `feedback/<revision>/edit/<date>/`. Run the copied
project entry point:

```bash
python3 scripts/feedback.py --feedback-dir feedback/rev2/edit/YYYY-MM-DD \
  --main-file main.docx --interactive --style red \
  --aspyrus-root /path/to/aspyrus
```

`--style normal|red|blue` sets the default for Accept. Each change offers Accept with
that default, Normal, Red, Blue, Decline, Skip or Quit. Red/blue additions use
`\textcolor{red}{...}`/`\textcolor{blue}{...}` and require an explicit preamble
`\usepackage{xcolor}` (or `color`, including package lists/options). No preamble is
silently added; colour loaded only through a class or external file is not detected.
A normal replacement inside an existing revision-colour scope gets a local black override, so surrounding
unchanged words retain their colour. Deletions are recorded without empty wrappers.

Review the changed phrase with surrounding text, then the combined TEX diff. Only
typing `SAVE` writes accepted edits. Quit, Enter at the Save prompt, EOF or interruption
during decision review leave TEX unchanged and retain choices. Recheck hashes before
Save; refuse changed inputs or a changed starting commit. The source must exactly match
its committed version before incorporation; no automatic commit/branch/reset occurs.
Other uncommitted project work is retained. After Save, inspect `git diff`, rebuild,
check citation/asset coverage and rendered outputs, then commit the accepted exchange.

Add `--original /path/to/exact-sent.docx` to isolate returned edits from newer local
fixes. Without it, the comparison is labelled two-way and does not establish authorship.
`--document supplementary --supplementary-file supplementary.docx` selects SI.
`--review` without `--interactive` writes a comparison only. Set `ASPYRUS_ROOT` or
`--aspyrus-root` when the shared installation is not at the standard sibling path.
Legacy `feedback.py` without these flags and `docdiff.py` retain their audit behavior.

Routine review writes only `review.json` and `review.md` under the dated exchange
audit; JSON stores both documents, exact input/tool hashes, decisions/styles, starting
Git commits and previous sessions. Recovery TEX is under ignored
`.aspyrus_build/review/recovery/`. Original Word files remain unchanged. An interrupted
report write may leave `.review-lock`; remove that lock only after confirming no review
process is active, then rerun. Reports do not certify scientific correctness/submission.

Bibliography paragraphs are excluded and counted. This stage does not edit BibTeX.
Recognized changed Word citation numbers are flagged for manual attention; never
replace source citation keys with display numbers. Apply only unambiguous literal
prose spans. Equations, paragraph structure and uncertain/overlapping mappings require
manual editing; formatting, comments, tables, images and layout are not imported.

The external engine can also run directly with `--source`, `--current`, `--returned`,
`--output`, optional `--original`, `--interactive` and `--style`:

```bash
python3 /path/to/aspyrus/src/tools/docreview.py \
  --source main/main.tex --current main/main.docx \
  --returned feedback/rev2/edit/YYYY-MM-DD/main.docx \
  --output feedback/rev2/audit/edit/YYYY-MM-DD --interactive --style red
```

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

## Assistant-led review

You can ask an assistant to incorporate a returned Word document; you do not need
to operate the interactive prompts yourself. The assistant should use the same
comparison engine and ledger, identify the exact sent baseline when available,
apply only authorized changes and record accepted, retained and pending differences.
From the manuscript root, a comparison-only run uses
`scripts/feedback.py --review` with the exchange arguments; it writes review
evidence without editing the manuscript. Interactive incorporation remains optional.

For an assistant-led incorporation, input/checkpoint checks and recovery still
apply. The assistant may use the shared functions for uniquely mapped prose; there
is currently no noninteractive apply command. Manual changes must record exact
before/after source, authorization and resulting hashes rather than claiming they
passed automatic mapping. After applying edits, rebuild and reconcile against the
returned file, then report residual differences and validation limits. The assistant
must record a reason for retaining local wording even though shared functions do
not yet enforce the CLI's reason prompt. See the [assistant-led rules](development-contract.md#assistant-led-feedback-incorporation).

The current comparison still flags equation-formatting noise and has a known
citation-position false positive. Inspect those warnings; do not infer scientific
changes from them or silently suppress genuine equation/citation differences.
Improving those checks is deferred code work, not an existing feature.

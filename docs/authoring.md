# Authoring in the Canvas

Open a `.tex` file and choose **Edit Text (Aspyrus)**. The Canvas is an authoring
view; your LaTeX source and compiled PDF remain the authoritative document and
final typography reference.

## Editing and Save

Edit prose, headings, lists and captions. Use the toolbar for bold/italic text,
colour, paragraph style, superscript/subscript, symbols, figures, tables and
citations. Press Ctrl+S (Cmd+S on macOS) or click Save to write Canvas content into
the source file. Undo/Redo operates on Canvas edits.

Save Canvas work before switching to raw LaTeX editing. A genuine source-editor
change refreshes even a dirty Canvas. Self-originated saves avoid unnecessary
refreshes; failed saves remain visibly unsaved. Compile waits for confirmed Save.

## Citations

Use standard `\cite{key}`. Click a blue citation number to open its reference
editor. The toolbar citation icon inserts a citation using the existing library;
Ctrl+Shift+C is its shortcut. The display menu selects numbers, keys or library
DOIs without changing citation identity. Hover shows metadata in a text tooltip.
See [the reference guide](references.md) for numbering and verification limits.

## Figures and tables

Insert figures with the image icon or Ctrl+Shift+F, using local assets inside the
project boundary. A preview follows supported authored width options and appears
above the caption. Missing/unsupported images show a fallback. Captions remain
editable; pressing Enter exits the caption into a body paragraph.

Click an image to select its complete figure, or drag across prose and figures.
Copy/cut and paste complete figure fragments at a body caret, including across
Aspyrus canvases. Caption-only selections behave as ordinary text. Cut waits for
clipboard confirmation and supports Undo/Redo. Source labels, graphics options
and untouched figure commands must remain intact.

The table icon or Ctrl+Shift+T opens the row/column/caption/label dialog. Supported
`tabular` and `booktabs` layouts appear as tables; their captions are editable.
Inspect complex source structures and compiled results instead of assuming all
LaTeX environments can be edited visually.

## Formatting and scientific typography

Canvas prose uses a shared sans-serif font with left alignment. Recognized
article preambles inform size and line spacing; PDF typography follows LaTeX.
Symbolic math retains mathematical typography; supported numbers, operators and
measurement fragments render upright. Greek styling follows meaning, not the
alphabet alone. Use explicit `upgreek` labels where needed; preserve variable
italics. The detailed [development contract](development-contract.md#greek-labels-and-mathematical-italics)
records the supported cases.

Use standard `\textcolor{red}{...}`, `\textcolor{blue}{...}` with `xcolor`, and
`\hl{...}` with `soul`. Select prose or a complete inline math token for
highlighting; partial selections inside math are rejected. Formatting controls
must not silently insert required packages. Legacy colour commands remain
supported, and colour does not identify authorship or acceptance.
See [collaboration](collaboration.md) for clean submission checkpoints.

## Themes and recovery

The Canvas follows the active editor theme. The theme button switches light/dark;
Shift-click returns to automatic selection. Numbered citations use the theme
link blue, with no chip background or border.

Aspyrus retains up to 100 saved checkpoints and 100 drafts in extension storage.
Idle, blur and citation confirmation can store draft checkpoints without writing
the manuscript. Focus the Canvas and run **Aspyrus: Restore Previous Version**;
restoring writes the selected text after checkpointing the current version.
Recovery does not restore assets, references or exports.

## Known boundaries

Untouched source preservation is covered by tests, not a guarantee for every
possible TeX program. Unsupported environments can remain protected. Nonvisual
metadata stays hidden without being removed from source. Main and supplementary
are independently authored files; Compile builds only the open document.
The optional [paired build](building.md#example-workflow-scripts) is separate.

# Supported LaTeX in visual mode

Editable regions are ordinary single source lines inside the document body and
single-line section, subsection, and subsubsection headings. Basic flat bold,
italic, underline, and escaped punctuation are rendered visually. Selected text
can be formatted using the three toolbar controls.

Other source stays visible as protected blocks, including preambles, comments,
mathematics, nested formatting, tables, lists, conditional branches, and unknown
commands. Double-click a protected block to edit source. Complex CV macros may
therefore appear mostly as source in this alpha.

Enter inside an editable region inserts a space. Use Code to add paragraphs,
headings, or structural commands. Pasted content is treated as plain text.
No-op visual editing preserves the original source, including CRLF line endings.
Formatting a region can normalize its inline representation. Undo for toolbar
formatting is not yet a complete document-level history; use source undo or reload
before saving to discard unwanted visual changes.

PDF preview is authoritative for LaTeX layout. The visual view is an editing aid,
not a pixel-identical typesetting preview. DOCX is a separate conversion target.

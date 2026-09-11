# Visual editing and source agreement

The handover editor is restored as the default interface. Visual mode renders CV
contact headers, section headings, dated entries, two-column tables, lists, and
inline formatting. The original menus, font controls, alignment, spacing, zoom,
Code/Visual switches, optional PDF preview, and export actions are retained.

Each rendered block retains its original LaTeX. Unchanged blocks are emitted
exactly as loaded. Editing one block updates that block while preserving other
source, comments, preamble, table column declarations, and custom commands.
Math and unsupported inline commands remain noneditable source-backed tokens.
Unsupported environments and conditionals remain protected source blocks.

The toolbar serializes known formatting to LaTeX, including font sizes, line
spacing, paragraph spacing, alignment, bold, italic, underline, strike-through,
superscripts, and subscripts. Strike-through and justified alignment add their
required LaTeX packages when needed. Compilation remains the authority for final
layout; the visual view does not reproduce LaTeX pagination exactly.

The local demo is an acceptance case: no-op preservation, CV structure, a visual
alignment edit, successful PDF compilation, and direct CV DOCX export have been
checked. DOM integration tests check UI startup and mode switching. Full live
VS Code interaction and all toolbar combinations still require interactive QA.

Editing nested/custom structures, deleting protected blocks, or applying complex
formatting across several source groups can require Code mode. The editor refuses
to save when a protected source block has been removed. Rich visual undo remains
browser-based; the source editor retains Monaco's undo for direct code edits.

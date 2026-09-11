# DOCX fidelity and manuscript migration

For general documents, the pipeline invokes Pandoc on the original LaTeX with citation processing,
using the source directory as its resource path and working directory. Native Word
math is retained where Pandoc supports it. Conversion warnings appear in the UI.
Compile PDF separately; DOCX does not convert the PDF.

Expect differences in pagination, margins, custom macros, tables, figures, and
journal layouts. Unsupported macros can lose meaning in DOCX even though the `.tex`
source remains intact. Review the exported document before sharing it. A successful
conversion means a DOCX was produced, not that scientific/layout fidelity passed.

The pre-release CV and manuscript conversion implementation is retained in
`backend/src/localleaf/export/legacy.py` with its existing local edits. Its margin
and paragraph-spacing unit bug is fixed and covered by a regression test. It is
used for detected CVs by the restored export path. Its inline formatting now preserves
font size, baseline spacing, bold/italic/underline, and aligned headings. The general
scientific transformation pipeline remains opt-in through the Python API.

Inspection of the earlier CDKL5 revision workflow identified reusable work around
ion charges, numeric equations, unit exponents, reference resolution, figure
handling, and validation of asset presence/order. That workflow also contains
revision colors, collaborator markers, author-affiliation handling, and specialized
equation rewrites. Those project-specific transformations must not be enabled
universally. Existing overlapping rules remain in the legacy module until migrated.

Future scientific export profiles should introduce each rule with synthetic
before/after fixtures, native equation checks, unresolved-reference reports, asset
checks, and visual review. Full migration of the revision workflow is deferred;
this release does not claim that its scientific validation has been reproduced.

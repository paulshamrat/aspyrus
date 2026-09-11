# Alpha validation record

Validated locally during the initial stabilization on `dev1`:

- Ruff lint and formatting; ESLint; Prettier formatting.
- Eleven backend tests, including real PDF compilation and Pandoc DOCX conversion.
- Six source-editing tests covering byte-preserving no-op edits, protected math and
  conditionals, heading patches, HTML escaping, and overlapping-patch rejection.
- Wheel and source distribution builds; VSIX packaging and archive contents.
- Installation of the wheel in a fresh temporary Python environment, with no
  project checkout imports or optional Python export dependencies.
- HTTP delivery of editor/worker assets, PDF compilation, DOCX download, and
  reopening a second file through the running server from that installed wheel.
- npm dependency audit: zero reported vulnerabilities at validation time. The
  editor is rebuilt from source with the patched DOMPurify module; merely updating
  the lockfile would not replace Monaco's embedded prebuilt sanitizer.

Not yet validated: interactive browser behavior, installed VS Code interaction,
Windows/macOS execution, remote workspaces, visual DOCX/PDF layout comparison,
and the complete CDKL5 manuscript workflow. No browser surface was available in
the development session. Run the manual release checklist before publishing.

These checks support an early alpha review, not a claim of full visual editing or
scientific export fidelity. CI repeats the automated checks on GitHub.

## Handover restoration

The original menu, toolbar, split editor, themes, and PDF controls are restored.
Additional DOM tests check UI initialization, Code/Visual switching, CV structure,
source preservation, alignment, and paragraph spacing. The actual ignored demo
was read and tested locally without modifying it: all three tables and its lists
render, the no-op round trip matches exactly, and an edited copy compiles to PDF
and exports through the original CV DOCX engine.

The VSIX is now version 0.1.1. The extension can discover a workspace `.venv`;
other projects can use an explicitly configured `localleaf.pythonPath`.

The restored CV exporter has a regression check for font size, bold text, baseline
spacing, right-aligned headings, and spacing after a heading. The edited demo
exports three tables and contains no leaked cvsection/fontsize/selectfont markup.
DOCX visual page rendering has not been completed: this session does not expose
the document skill's managed rendering dependencies. Structural checks are not
a claim of pixel-identical layout.

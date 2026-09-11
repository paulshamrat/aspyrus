# Changelog

## 0.1.0 alpha — unreleased

- Portable Python package and packaged offline editor assets.
- Shared browser editor and configurable VS Code backend launcher.
- Source-preserving bounded visual editing replaces destructive CV reconstruction.
- Document-specific atomic saves with external-change conflict detection.
- Static path containment, origin/host checks, and compiler allowlist.
- Configurable project output directory and PDF/DOCX export.
- Legacy export preservation and corrected DOCX layout units.
- Lint/format configuration, CI, regression tests, and release documentation.

Known limitations include bounded visual editing, single-pass compilation, incomplete
DOCX layout fidelity, canvas-only PDF preview, and unvalidated remote VS Code support.

## Handover interface restoration (VSIX 0.1.1)

- Restore the original CV visual interface, formatting toolbar, menus, and preview.
- Preserve source per visual block instead of rebuilding the entire CV.
- Restore direct CV DOCX export; retain general Pandoc export for other documents.
- Add DOM startup and CV round-trip regression checks, including the local demo.
- Discover workspace Python environments in the VS Code extension.

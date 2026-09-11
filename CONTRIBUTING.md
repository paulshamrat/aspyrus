# Contributing

Use a development branch (`dev1` for the initial stabilization). Keep `main` at
reviewed, validated commits. Avoid committing personal documents or generated output.

Python uses Ruff linting and formatting with a 100-column limit. JavaScript uses
ESLint and Prettier; JSON, Markdown, HTML, CSS, and YAML use Prettier. The pinned
versions and configuration files are authoritative. Run `ruff format .` and
`npm run format` before the checks documented in the README.

Changes to saving, visual/source conversion, compilation, or export need regression
coverage with small synthetic fixtures. Preserve source that the editor does not
understand. Never insert personal information or manuscript-specific assumptions
into the general document path.

Keep API changes synchronized with the editor and integration tests. Document
user-visible limitations and update CHANGELOG.md. Avoid publishing credentials,
absolute personal paths, local notes, or proprietary manuscript content.

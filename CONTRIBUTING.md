# Contributing to Aspyrus

Start with a reproducible problem or a clearly scoped feature. Keep examples
small and generic: do not submit private manuscripts, collaborator documents,
reference collections, recovery files or personal data.

The repository is being prepared for public release. Repository URLs and support
channels are not configured yet; no Marketplace publisher ownership is asserted
by the current `publisher` string in the extension manifest.

## Development setup

The CI baseline uses Node.js 22, Python 3.12 and Ubuntu. Basic editing uses only
the extension's JavaScript; integration tests also need the document build tools.

```sh
npm ci
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
```

On Debian/Ubuntu, install system build tools:

```sh
sudo apt-get install pandoc poppler-utils texlive-latex-extra \
  texlive-fonts-recommended texlive-bibtex-extra texlive-science
```

The native browser test expects Chrome at `/usr/bin/google-chrome`. It skips if
Chrome is unavailable; release verification must run it. Native Windows
compilation is not supported because the export engine uses `fcntl`.

## Repository layout

```text
src/                  Extension hosting, parser, build coordinator, recovery
  webview/            Canvas HTML, CSS, JS and tracked compiled bundle
  tools/              Optional Python compilation, conversion and Word review
example/              Generic manuscript starter and optional workflow scripts
test/                 JavaScript, native-browser and Python integration tests
assets/               Extension logo and icons
docs/                 User guides and detailed development contract
.github/workflows/    CI verification and VSIX artifact generation
```

Keep the existing layout. Do not introduce a service, additional framework or
new dependency when the current mechanisms can handle the change.

## Making a change

Read [AGENTS.md](AGENTS.md) and the relevant
[development contract](docs/development-contract.md) before editing.
Trace the existing flow and affected callers; fix the responsible layer with the
smallest sufficient change. Preserve source fidelity, confirmed Save, recovery,
Undo/Redo, accessibility and protected output publication.

Add meaningful regression coverage for changed behaviour and affected neighbouring
features. Do not claim that prose coverage or a successful build proves scientific
accuracy, equation rendering or fidelity in every office application. Update the
relevant guide and starter instructions when behaviour changes.

In this private preparation checkout, work stays on `dev1`. Future public
contributors can propose changes through their own branches and pull requests;
the maintainer's public `main` must receive reviewed, sanitized release content.

## Checks before committing

```sh
npm test
npm run bundle
ruff format --check src/tools/*.py example/scripts/*.py test/*_test.py
ruff check src/tools/*.py example/scripts/*.py test/*_test.py
python3 -m py_compile src/tools/*.py example/scripts/*.py test/*_test.py
node --check src/webview/editor.js
node --check src/parser.js
git diff --check
```

Check other changed JS/CommonJS files with `node --check` as applicable. The CI
workflow checks all such files. Rendering/clipboard changes require the real
browser checks; converter changes also need affected PDF/Word page review and
native Word property checks. Record any unavailable tools or skipped checks.
Documentation-only work needs link, command and package checks; it need not
rebuild unrelated manuscript deliverables.

## Package locally

```sh
npm run package
code --install-extension aspyrus-0.6.1.vsix --force
```

Packaging preserves relative README links when no public repository URL exists.
The VSIX is ignored; do not commit installers, `node_modules`, caches or private
material. Before replacing an older installer, retain it intact in ignored
`.vsix-archive/`. After installing a runtime update, compare installed files with
the tested checkout, save Canvas work and reload the editor window.

## Public release checklist

1. Review tracked files, assets, examples and the VSIX inventory for public use.
   Retain license notices and review dependency licenses; do not imply that this
   documentation review constitutes a complete legal or security audit.
2. Prepare a sanitized snapshot with clean history on public `main`. Do not merge
   or push the private `dev1` history.
3. Select the public repository and add real repository, issue and homepage URLs
   to `package.json`. Verify publisher ownership separately if Marketplace
   publication is planned. Do not invent these values.
4. Align manifest and lockfile versions, update the changelog, run checks and
   package the release. Never reuse a published version for different artifacts.
5. Check relative documentation and screenshot links in the public repository
   and the extension details view. Public URLs allow normal packaging link
   rewriting; review the local packaging flags then.
6. Obtain release authorization, create the release/tag and attach its tested
   VSIX. A local prepared package is not evidence of a public release.

Issue/PR templates, a code of conduct and a private security-reporting policy can
be added when maintainers and reporting channels are established. Do not publish
placeholder contacts or promise a response process that does not exist.

The [MIT license](LICENSE) retains the original LocalLeaf contributors notice.
Legacy `.localleaf.json` configuration and associated runtime identifiers remain
supported; a branding cleanup must not break those compatibility paths.

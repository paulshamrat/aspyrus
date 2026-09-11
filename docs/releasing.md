# Release checklist

1. Work on `dev1` or a feature branch; run every README validation command.
2. Smoke-test the example in a browser and an installed VS Code extension.
3. Inspect the built wheel for bundled assets and the VSIX for accidental files.
4. Review source-preservation, save-conflict, DOCX warnings, and known limitations.
5. Update versions and changelog. The initial Python version is `0.1.0a1`, npm
   version is `0.1.0-alpha.1`, and VSIX version is `0.1.1` (extension manifest rules).
6. Review the diff before merging into `main`. Tag an alpha release only after review.
7. Publish wheel and VSIX as GitHub release artifacts when authorized.

The extension's `localleaf` publisher is a development placeholder; verify publisher
ownership before Marketplace publication. A repository URL should be added after
choosing the public GitHub destination. CI validates on pushes/PRs but does not publish.

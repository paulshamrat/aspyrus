# Project configuration

Open any `.tex` file with the CLI or VS Code command. No workspace migration is
required. LocalLeaf searches the document's ancestors for the nearest
`localleaf.toml` and reads its `[project]` table.

```toml
[project]
engine = "pdflatex"
output_dir = "data/output"
```

The engine can be `pdflatex`, `xelatex`, or `lualatex`. Relative output paths are
resolved against the configuration directory. Without configuration, outputs and
auxiliary files go into `.localleaf_build` beside the source. `--output-dir` takes
precedence for the initial CLI document.

PDF and DOCX are named after the source stem. Use separate output directories for
different documents with identical stems. Current compilation runs one engine
pass. Bibliography tools and multi-pass reference resolution are not automated in
this alpha; use your existing manuscript build process when required.

The opened file is also the compilation root. Included files are read by LaTeX,
but selecting an included file for editing does not retain a different root target.
Configuration for custom build commands and separate build/output paths is deferred.

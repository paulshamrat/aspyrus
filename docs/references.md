# Citations and bibliography

Use standard `\cite{key}` with a BibTeX library. `natbib` settings control
numbered brackets or superscripts; the bibliography style controls the reference
list. The starter uses bracketed numbers and `unsrtnat`. Aspyrus is not a complete
author–year or journal-style engine.

Canvas numbers use the open document’s compiled auxiliary data when available;
otherwise they are provisional. Rebuild after citation changes. The number/key/DOI
menu changes presentation without rewriting citation keys. Numbers use the theme’s
blue link colour with no box. Click a citation to edit its references; hover for
metadata in a text tooltip. DOI mode displays library metadata, not a DOI lookup.
Raw `(DOI: ...)` prose remains ordinary editable text. Existing `\revref` citations
remain supported; new insertions use `\cite`.

The insertion dialog searches references already present in the library. Add or
verify bibliography records upstream before citing them; a citekey or DOI typed
into prose does not automatically create a verified record.

For reference preparation, commands, report columns and troubleshooting, use the
[manuscript scripts README](../example/scripts/README.md#references).
It is copied beside the starter scripts and is the canonical script-usage guide.

Metadata matches do not certify rendered output or scientific claim support.
The [development contract](development-contract.md#bibliography-verification)
retains mandatory evidence, reviewed-exception and rendering requirements.

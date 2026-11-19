# Starter manuscript workflow rules

- Authored LaTeX is authoritative; received collaborator files remain immutable.
- Use external Aspyrus CLI review through scripts/feedback.py --interactive; keep
  Canvas as the existing editor. See feedback/README.md for folder roles and usage.
- Require a committed source baseline and current export; review meaningful edits,
  choose normal/red/blue per change, preview the TEX diff and explicitly SAVE.
- Keep review.json/review.md under the exchange audit and recovery in ignored
  .aspyrus_build. Preserve previous sessions. Exclude bibliography entries; protect
  citation keys and flag mathematical/structural/ambiguous changes for manual review.
- Rebuild and validate before committing accepted edits. Do not automatically create
  commits, branches or submission tags, or infer scientific acceptance from colours.

### Complete exchange decisions

Record the exact sent DOCX and its source commit when handing work to a collaborator;
keep the received file immutable. Supply that sent DOCX with `--original` to compare
sent, returned and current versions. A current Git checkpoint is recovery evidence,
not necessarily the sent baseline. Without the sent baseline, report a two-way
comparison and do not infer who deleted or added text.

Keep every detected substantive difference visible, including deletions of existing
red/blue wording and newer local corrections. Earlier instructions must not silently
exclude a newer returned difference. Record each outcome: accept, retain local with
an explicit reason, or pending. The CLI asks for a reason when declining an edit;
its report and final preview list retained and pending items. Skipping is pending,
not resolved. Accepted choices alone do not prove that edits were saved or validated.
Partial incorporation is allowed, but never describe it as an exact match while
retained differences remain. Before committing, inspect the word diff, account for
substantive differences, list unresolved items and run the relevant checks.

## Assistant-led feedback incorporation

- Users may ask the assistant to incorporate an exchange without operating the
  interactive CLI. Use the same external comparison engine and review ledger;
  the interactive prompts are an optional interface, not a separate methodology.
- First read the project rules and identify the returned file, current authored
  source/export and exact sent DOCX/source commit when available. Require a current
  export and a committed source checkpoint before incorporation. Do not create
  commits, branches or tags without authorization. A submission tag is not proof
  of the actual Word file sent. If the sent baseline is unavailable, explicitly
  describe the comparison as two-way and do not infer authorship of differences.
- Generate comparison evidence using `feedback.py --review`. Examine every
  substantive addition, deletion and replacement, including coloured text and
  newer local corrections. Resolve differences according to the user's current
  authorized scope; ask only about uncertain choices that remain outside it.
  Record accepted, retained-local (with a reason) and pending items. Prior wording
  instructions must not silently remove a newer returned difference from review.
- For uniquely mapped literal prose, use the shared `docreview.py` comparison,
  preparation and save checks, including input revalidation and recovery. Existing
  authorization to apply the reviewed scope does not require the user to operate
  a terminal or repeat that authorization by typing SAVE. The human interactive
  interface continues to require SAVE. There is currently no supported noninteractive
  apply command; do not document or invent one.
- Shared-function callers must record retained-local rationale explicitly: this is
  presently enforced by the CLI prompt, not by all underlying functions. Treat this
  as an assistant responsibility until shared decision validation is implemented.
- Manual equation, citation or structural edits require evidence and explicit
  scope authorization; never force a manual item into the automatic-ready class.
  Preserve exact before/after source, reason, user authorization, relevant change
  IDs, styling and resulting hashes in the existing review record, retaining its
  input snapshot and previous events. Do not pretend a direct manual edit passed
  the automatic literal-mapping checks. Bibliography records remain a separate
  upstream workflow; do not import the generated Word reference list into LaTeX.
- Preserve unaffected source and make the least sufficient editorial change. After
  incorporation, rebuild current exports and reconcile them with the returned file,
  accounting explicitly for retained differences and pending items. Inspect the
  word diff and affected outputs, and check dependent citations/assets/scientific
  statements. Preserve the initial comparison and decisions when recording fresh
  verification. A saved edit, finished audit or successful build alone is not
  evidence that every difference is resolved or the science is verified.
- Summarize what was applied, retained and unresolved, plus verification limits.
  Record durable workflow rules in project/shared README and AGENTS files; audit
  folders hold exchange evidence. Keep review.json/review.md and existing folder
  roles; add no Canvas review UI or duplicate decision process.

## Standard authoring syntax

Prefer standard cite, xcolor textcolor red/blue, soul hl and explicit begingroup/color/endgroup. CLI review generates standard textcolor commands and requires explicit xcolor/color loading. The starter needs no custom colour definitions. Existing custom commands remain supported; do not rewrite manuscript markup automatically. Named red/blue are FF0000/0000FF; custom aliases retain their previous shades. Colour carries no authorship or acceptance meaning.

## Bibliography verification

- `scripts/bibgen.py --check` checks available citekeys, including supplementary
  `\nocite` entries. It does not verify reference metadata or scientific claims.
- Use `--audit-references` to check completeness and cached DOI metadata;
  `--refresh-metadata` is explicit network work. Keep the evidence and hashes in
  `references/references.json`; never invent fields or silently repair flags.
- `metadata_match` means agreement with the recorded metadata source, not publisher
  verification, correct rendered output or support for a manuscript claim.
- `reviewed_exception` resolves only the named discrepancies backed by exact
  record/metadata hashes, rationale, date and authoritative URLs in
  the `reviews` section of `references/references.json`. Preserve raw flags; changed evidence
  reopens the review, and additional unresolved flags remain visible.
- Unresolved records require review and produce a nonzero audit status. Inspect
  the rendered bibliography separately, including titles, author suffixes and
  truncation. Preserve citekeys and keep bibliography work separate from Word
  prose incorporation. See [the feedback guide](feedback/README.md#bibliography-verification).

## Reference preparation and review

- Articles own PDFs and DOI inputs; manuscripts own selected identifiers, atomic
  BibTeX and verification. Configure `references.doi_source` in `.aspyrus.json`.
  Explicit `python3 scripts/bibgen.py --prepare` imports new identifiers, retrieves
  missing records, refreshes full-library metadata and checks citation keys.
  Report omissions and retain manuscript-only identifiers; never delete records
  because the article list changed. Library membership does not insert citations
  or authorize scientific scope. See `scripts/README.md` for usage.
- Ordinary builds and no-argument aggregation remain offline. `--doi` and `--dois`
  are explicit imports; both skip existing DOIs and refuse filename collisions.
  New imports use FirstAuthorYearShortTopic keys and matching filenames, with
  lowercase fields on separate lines. Preserve established keys, author order,
  suffixes, values and nested LaTeX braces; formatting is separate from correction.
- Use `--audit-references --all-references` for an uncited library; add
  `--refresh-metadata` for explicit retrieval. `--check` checks citation keys,
  not metadata accuracy. Unsupported BibTeX expressions remain flagged.
- Keep `references/references.json` as the consolidated evidence/decision/recovery
  ledger and `references/references.csv` as its inspection projection. DOI is the
  first CSV column, comments/status are last, and status is binary READY/CHECK.
  CSV edits are not engine decisions. Preserve excluded-scope cached evidence;
  legacy files may be retired only after exact content/hash preservation.
- Use `--review-reference KEY` for a source-backed correction or exception.
  Preserve the primary URL, specific rationale, selected flags and prior records.
  Inspect the candidate before SAVE; never waive missing fields or DOI mismatches.
  Correct demonstrably wrong fields; document legitimate initials, corporate-author
  and issue-year differences. Bind exceptions to exact record/metadata hashes;
  source changes reopen them and new flags remain unresolved. Never approve
  unexplained flags or manufacture fields merely to obtain READY.
- No-DOI works need a primary URL and explicitly reviewed metadata; conference
  papers use `inproceedings`/`booktitle`. This command records human/assistant
  verification rather than independently reading source URLs. Metadata status,
  citation availability, rendering and scientific claim support are separate checks.
  Preserve unresolved works as CHECK and test safeguards before committing.

The starter main and supplementary use left-aligned PDF/Word body text with
retained first-line indentation and 1.5 spacing. TEX uses ragged2e RaggedRight;
Word uses a 0.25-inch body indent. Captions retain justified formatting, while
headings, tables and equations retain their dedicated alignment.

# Manuscript scripts

Run commands from the manuscript root. LaTeX is authoritative; received files
and upstream computational data remain unchanged.

| Script | Use | Common command |
|---|---|---|
| `assets.py` | Check registered assets | `python3 scripts/assets.py` |
| `bibgen.py` | Prepare references from article DOIs | `python3 scripts/bibgen.py --prepare` |
| `build.py` | Build main and supplementary | `python3 scripts/build.py` |
| `feedback.py` | Compare a collaborator exchange | `python3 scripts/feedback.py --feedback-dir feedback/rev2/edit/YYYY-MM-DD --review` |

## References

1. Add papers to your article library's `pdf/` and their own DOIs to its `dois.txt`.
2. Set the source once in the manuscript's `.aspyrus.json`, retaining its existing
   offline `prepare` build hook:

   ```json
   "references": {"doi_source": "../../articles/your-project/dois.txt"}
   ```

3. Run `python3 scripts/bibgen.py --prepare` (explicit network work).
4. Open `references/references.csv`. Filter the final `status` column for `CHECK`; read the preceding `comments`.
5. Insert desired citations through Canvas or standard `\cite{key}`; library
   membership does not insert citations or establish scientific claim support.

Preparation brings new identifiers into manuscript `references/dois.txt`, retrieves
missing records into `references/bib/`, aggregates `references.bib`, refreshes
metadata and checks main/supplementary citation keys. It preserves existing keys,
corrections and manuscript-only identifiers; omissions are reported, never deleted.
New keys use FirstAuthorYearShortTopic with matching filenames; imports have one
lowercase field per line. Unsupported BibTeX expressions require manual review.

`references.json` retains metadata evidence, decisions and exact migrated legacy
notes/reports. `references.csv` is generated from it for inspection, not editable
instructions for the engine. Fields are:

```text
doi, citekey, title, authors, publication_type, publication,
year, volume, issue, pages_or_article_id,
fields_checked, missing_fields, discrepancies,
action_taken, review_reason, source_urls, checked_at,
comments, status
```

| Status | Meaning / next step |
|---|---|
| READY | Checked metadata agrees or named exceptions were explicitly reviewed. |
| CHECK | Unresolved, incomplete, failed or unverified metadata. Read comments, then inspect evidence. |

Flags produce nonzero exit status; this can mean preparation finished but review
remains. READY does not certify rendering or scientific claim support. Inspect
publisher/PDF evidence for registry disagreements, including online versus issue
years. Reviewed exceptions live in JSON `reviews`, using exact record/metadata
hashes, accepted flags, reason, date and source URLs; changed evidence reopens them.
No-DOI works require an authoritative publication URL and reviewed primary-source
metadata in the ledger; absence of a DOI alone does not make a reference unusable.
Conference records use `inproceedings` and `booktitle`; the audit checks the
conference title as well as authors, year and pages. Review decisions are specific
to the recorded source and never automatically approve later discrepancies.
Do not invent fields or modify metadata merely to get READY. Retain author suffixes,
chapter titles, page/article locators and et al.; inspect rendered PDF/DOCX separately.
The ledger's `cached_records` are historical excluded-scope evidence, not current
results. Legacy verification files remain readable for migration; only retire them
after verifying their exact content is retained in the consolidated JSON.

For a flagged record, run a focused review:

```sh
python3 scripts/bibgen.py --review-reference Citekey
```

Keep the current record for a legitimate registry discrepancy, or provide a
single-record publisher BibTeX file for a correction. The existing citation key
is retained. Supply the primary source URL and what you verified; choose only
specifically verified exception numbers. The command previews the candidate and
requires `SAVE`. Cancellation changes nothing. SAVE records the previous record,
audit and DOI list in the existing JSON ledger, updates the atomic record,
retains/adds DOI identifiers, and regenerates BibTeX/CSV/JSON. A changed DOI
requires registry retrieval; no-DOI metadata is explicitly marked as user-reviewed
primary evidence. Missing fields and identity mismatches cannot be waived.
Unresolved flags remain CHECK; an assistant can operate this same command.
This command records your verification; it does not independently read the source
URL or certify the publication's scientific claims.

| Advanced option | Purpose |
|---|---|
| `--review-reference KEY` | Source-backed correction/exception with preview and explicit SAVE. |
| No arguments | Offline aggregation; ordinary builds use this. |
| `--check` | Check cited keys in main and supplementary. |
| `--audit-references` | Audit cited/nocited records using cached metadata. |
| `--all-references` | With audit: include unused library records. |
| `--refresh-metadata` | With audit: explicitly refresh Crossref evidence. |
| `--doi DOI` | Safely import one identifier. |
| `--dois [file]` | Import a list; default `references/dois.txt`. |
| `--split [file]` | Split a monolithic bibliography; inspect existing files first. |
| `--render-tex numbers\|dois\|keys` | Generate a citation inspection projection. |

Use `python3 scripts/bibgen.py --help` for options. Single/list imports skip existing
DOIs and refuse filename collisions. Correct atomic records deliberately, then
reaggregate and re-audit. Ordinary builds stay offline.

## Assets, builds and feedback

`assets/assets.csv` maps upstream outputs to manuscript destinations. Check first;
copy a reviewed asset explicitly with `--promote <asset>`. Build does not promote.
`build.py` creates PDF/DOCX beside each TEX, a combined deck under
`assets/figures/figures.pdf`, and `build_report.json`; logs/recovery stay ignored.
See the main README for required dependencies and project-specific workbook rules.

Feedback inputs live in `feedback/<stage>/edit/<date>/` or `submission/`; the decision
prompting a stage belongs in that stage's `decision/`. `--review` writes comparison
evidence, not source changes. `--interactive` reviews choices and requires an explicit
SAVE before application; use `--original` for the exact sent DOCX when available.
Without it, comparison is two-way and cannot establish authorship. Choose normal,
red or blue for accepted wording; preserve equations/citations and review ambiguous
items manually. Rebuild and inspect the diff before committing. No automatic commits,
tags or scientific acceptance. See `feedback/README.md` and each script's `--help`.

The starter main and supplementary use left-aligned PDF/Word body text with
retained first-line indentation and 1.5 spacing. TEX uses ragged2e RaggedRight;
Word uses a 0.25-inch body indent. Captions retain justified formatting, while
headings, tables and equations retain their dedicated alignment.

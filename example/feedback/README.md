# Manuscript collaboration records

LaTeX in `main/` and `supplementary/` remains the authoritative manuscript. Keep original PI/collaborator Word files unchanged and reconcile agreed edits into LaTeX explicitly.

```text
feedback/<revision>/
  decision/          # decision on the previous stage that prompts this work
  edit/<YYYY-MM-DD>/  # each PI/collaborator exchange and supporting evidence
  submission/        # exact files actually submitted; one package per revision
  audit/
    edit/<date>/     # comparisons for each exchange
    submission/      # final submission verification
    checks/          # other evidence; small checks use descriptive files
```

The working-stage cycle is decision → edit → submission. A decision prompting Rev2 is stored in `rev2/decision/` even though it evaluates the Rev1 submission. Record both the reviewed stage and the resulting working stage, the letter date and any different filing date in the revision README. Decisions ending the process without further work stay with the evaluated stage; do not invent another revision folder. Create folders only when an event happens; dates distinguish repeated edit exchanges, while submission/decision dates are recorded in the revision README.

Run the audit for an explicit package, not an entire revision:

```bash
python3 scripts/feedback.py --feedback-dir feedback/rev1/submission
python3 scripts/feedback.py --feedback-dir feedback/rev2/edit/2026-10-04 --main-file main_comments.docx
```

Use filenames appropriate to your supplied files. The submitted main defaults to `main_clean.docx` when available, otherwise `main.docx`. Edit exchanges use a single unambiguous main file; choose between multiple versions explicitly with `--main-file`. Nonconventional supplementary names can be selected with `--supplementary-file`. Multiple candidates require explicit selection. No document is selected by modification time in the structured audit script.

Reports go to `<revision>/audit/submission/`, `audit/checks/decision/`, or `audit/edit/<date>/`. Logs go to `logs/feedback/<revision>/<event>/`. Flat legacy batches write to their own `audit/` subfolder. `--audit-root` overrides the report root. `FEEDBACK_AUDIT_DONE` records completion, not acceptance or submission certification. Reruns preserve decisions for matching change IDs. Paragraph comparisons include formatting differences and do not fully verify tables, figures or equation semantics.

Do not alter or overwrite supplied files. Remove duplicates only after byte/hash verification and record the retained path. Keep distinct marked and clean documents. Comparison-only audits never apply edits or create Git milestones. Interactive review writes only explicitly saved accepted edits; assistant-led incorporation follows the authorized scope and records its decisions. Neither mode creates Git milestones automatically. Exact journal files and reconciled source must be verified before tagging a submission. Historical reports keep their original paths and findings; use relocation records to interpret them.

## Reusing audit findings

Standing rules live in the project README/AGENTS and this feedback README. Shared rules also live in Aspyrus and its starter. Audit folders contain results and provenance; users do not need to consult them to learn the workflow.

Rebuild current exports before comparing received documents. The audit records source, active DOCX, received DOCX and script hashes in `comparison_inputs.json`. When an Aspyrus export ownership record exists, stale source, recorded dependencies or modified DOCX bytes stop the audit. Legacy exports without records remain supported, but their provenance is explicitly unverified; rebuild them before submission verification.

Reruns retain matching decisions in `decisions.tsv` and unmatched prior decisions in `previous_decisions.tsv`. Review the previous ledger when proposals change; do not transfer acceptance to a different change ID automatically.

A completed paragraph comparison is not a submission certificate. Native Word equation properties can encode bars/operators absent from extracted text. Verify equations, numerical values, citation identity/order, embedded figure hashes, workbook coverage and front matter separately. Record any normalization used and retain differences for review; never normalize away a scientific discrepancy to obtain a PASS. Render affected PDF and Word pages after source/exporter changes and record the renderer and inspected pages.

Put recurring defects in the shared Aspyrus implementation with a regression test, and update this starter plus its README/AGENTS rules. Keep manuscript-specific provenance in the manuscript. Historical audit findings remain evidence for their original hashes, not validation of later builds. Before a submission tag, follow the colour and milestone rules in the project README/AGENTS and verify the tagged source against the validated build inputs.

## Audit organization

Audit records use only three top-level categories: `audit/edit/<date>/` for exchange comparisons, `audit/submission/` for final verification, and `audit/checks/` for other evidence, including decision checks, formatting, migrations and organization. Put small checks in descriptive files under `checks/`; use a subfolder only for a multi-file check. Preserve historical reports and record hashes and relocated paths; do not treat identical bytes from different audit contexts as disposable. The revision README summarizes findings, unresolved issues and next steps. Standing rules belong in README/AGENTS, never only in an audit folder. Logs remain under `logs/feedback/`.

## Focused changes

When incorporating agreed edits, use the least intervention sufficient to resolve the issue after checking evidence and effects on surrounding text, citations and assets. Word changes are preferred when sufficient; sentence additions/deletions and paragraph revisions are appropriate when required within scope. Preserve unaffected wording and revision boundaries, review the word-level diff, and verify affected outputs. Explain changes that exceed the agreed scope before applying them; do not guess missing scientific information.

## Asset reference review

After collaborator edits or section deletions, check all active figures and tables for coverage, accurate descriptions, resolved labels and first-mention order, separately for each numbering series. Expand ranges during the check; later repeat citations may refer back to earlier assets. LaTeX numbering follows asset placement, so a successful build alone does not establish citation order.

Prefer a parenthetical reference in an existing scientifically appropriate sentence, following the manuscript's style. Avoid redundant asset-summary sentences and irrelevant citations inserted solely to force order. Mark only added/replacement wording using the agreed revision baseline. Rebuild both documents and inspect affected PDF and Word pages for numbers, ranges and colours; record current evidence and any exceptions. Compile and paragraph comparison do not automate this editorial review.

## Bibliography verification

`python3 scripts/bibgen.py --check` checks available keys, including supplementary `\nocite` entries. For metadata review, run `python3 scripts/bibgen.py --audit-references`; add `--refresh-metadata` explicitly to retrieve Crossref metadata. The audit writes `references/references.json` and its inspection report `references/references.csv`, retains evidence and record hashes, flags missing/differing information and exits nonzero when review remains. It never repairs records automatically. A metadata match does not certify publisher accuracy, the rendered reference or support for a scientific claim. Builds do not retrieve metadata. Review publication exceptions and inspect bibliography output before submission.

Use `python3 scripts/bibgen.py --review-reference KEY` for source-backed corrections or exceptions. Decisions live in the `reviews` section of `references/references.json`: each entry names the exact accepted discrepancies, record and metadata hashes, rationale, date and source URLs. The audit preserves the original flags and reopens discrepancies when their evidence changes. See the [starter rules](../AGENTS.md#bibliography-verification) for the distinction between metadata matches, reviewed exceptions and unresolved records.

Check complete author identities, including suffixes, and inspect bibliography-generated `et al.` in PDF and Word. A source metadata match does not establish rendered author-list completeness.

## Interactive CLI review

Commit the authored TEX baseline, Save/close any unsaved editor buffers, then Compile.
Run `python3 scripts/feedback.py --feedback-dir feedback/rev2/edit/2026-10-05
--main-file main.docx --interactive --style red --aspyrus-root /path/to/aspyrus`
(as one terminal command). Add `--original` for the exact sent DOCX; choose SI with
`--document supplementary --supplementary-file supplementary.docx`.

Review each phrase with surrounding text. Accept uses the chosen default; Normal,
Red and Blue override it per edit. Decline/Skip/Quit remain available. Preview the
combined TEX diff; only explicit SAVE writes. Rebuild/check the result and inspect
Git diff before the next commit. Canvas remains unchanged and displays the saved TEX.

The audit contains review.json and review.md. JSON owns input hashes, starting Git
commits, decisions/styles and previous sessions. Recovery lives in ignored
.aspyrus_build/review/recovery. Bibliography entries are excluded and counted; no
BibTeX changes occur here. Recognized citation-number changes, math, structural and
ambiguous edits are manual items. Legacy audit commands remain available.

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

## Assistant-led review

You can ask an assistant to incorporate a returned Word document; you do not need
to operate the interactive prompts yourself. The assistant should use the same
comparison engine and ledger, identify the exact sent baseline when available,
apply only authorized changes and record accepted, retained and pending differences.
From the manuscript root, a comparison-only run uses
`scripts/feedback.py --review` with the exchange arguments; it writes review
evidence without editing the manuscript. Interactive incorporation remains optional.

For an assistant-led incorporation, input/checkpoint checks and recovery still
apply. The assistant may use the shared functions for uniquely mapped prose; there
is currently no noninteractive apply command. Manual changes must record exact
before/after source, authorization and resulting hashes rather than claiming they
passed automatic mapping. After applying edits, rebuild and reconcile against the
returned file, then report residual differences and validation limits. The assistant
must record a reason for retaining local wording even though shared functions do
not yet enforce the CLI's reason prompt. See the [assistant-led rules](../AGENTS.md#assistant-led-feedback-incorporation).

The current comparison still flags equation-formatting noise and has a known
citation-position false positive. Inspect those warnings; do not infer scientific
changes from them or silently suppress genuine equation/citation differences.
Improving those checks is deferred code work, not an existing feature.

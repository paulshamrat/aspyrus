"""Starter workflows protect local assets and preserve feedback review decisions."""

import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import fitz
from docx import Document


SCRIPTS = Path(__file__).resolve().parents[1] / "example/scripts"


class StarterWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "manuscript"
        shutil.copytree(SCRIPTS, self.root / "scripts")

    def run_script(self, name, *args):
        return subprocess.run(
            [sys.executable, str(self.root / "scripts" / name), *args],
            cwd=self.root,
            text=True,
            capture_output=True,
        )

    def test_doi_list_preserves_existing_and_rejects_bad_returns(self):
        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        folder = self.root / "references/bib"
        folder.mkdir(parents=True)
        existing = "@article{kept, author={Author}, title={Title}, journal={Journal}, year={2026}, volume={1}, pages={1}, doi={10.1234/old}}"
        record = folder / "kept.bib"
        record.write_text(existing)
        listing = self.root / "references/dois.txt"
        listing.write_text(
            "# Papers\nhttps://doi.org/10.1234/OLD\n10.1234/new\n10.1234/NEW\n"
        )
        fetched = (
            existing.replace("kept", "added")
            .replace("10.1234/old", "10.1234/new")
            .replace("year={2026}", "year={2026}, month=Sept")
        )
        with (
            patch.object(module, "fetch_doi_crossref", return_value=fetched) as fetch,
            patch.object(module.time, "sleep"),
        ):
            self.assertEqual(module.ingest_doi_list(self.root, listing), 0)
            fetch.assert_called_once_with("10.1234/new")
        self.assertEqual(record.read_text(), existing)
        self.assertIn(
            "month     = {September}", (folder / "Author2026Title.bib").read_text()
        )
        with patch.object(module, "fetch_doi_crossref") as fetch:
            self.assertEqual(module.ingest_doi_list(self.root, listing), 0)
            fetch.assert_not_called()
        listing.write_text("10.1234/wrong\n")
        with (
            patch.object(module, "fetch_doi_crossref", return_value=fetched),
            patch.object(module.time, "sleep"),
        ):
            self.assertEqual(module.ingest_doi_list(self.root, listing), 1)
        listing.write_text("10.1234/collision\n")
        collision = existing.replace("10.1234/old", "10.1234/collision")
        with (
            patch.object(module, "fetch_doi_crossref", return_value=collision),
            patch.object(module.time, "sleep"),
        ):
            self.assertEqual(module.ingest_doi_list(self.root, listing), 1)
        self.assertEqual(record.read_text(), existing)
        self.assertEqual(len(list(folder.glob("*.bib"))), 2)

    def test_month_macros_and_all_library_audit(self):
        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(
            module.bib_fields("@article{x, month=Sept,\n}")["month"], "September"
        )
        self.assertEqual(
            module.bib_fields("@article{x, month=oct}")["month"], "October"
        )
        with self.assertRaises(ValueError):
            module.bib_fields("@article{x, journal=unknown}")
        with self.assertRaises(ValueError):
            module.bib_fields('@article{x, month=jan # "text"}')
        refs = self.root / "references"
        refs.mkdir()
        (refs / "references.bib").write_text("@article{unused, title={Title}}")
        self.assertEqual(module.audit_references(self.root), 0)
        self.assertEqual(
            json.loads((refs / "references.json").read_text())["records"], {}
        )
        self.assertEqual(module.audit_references(self.root, all_references=True), 1)
        report = json.loads((refs / "references.json").read_text())
        self.assertIn("unused", report["records"])
        self.assertEqual(report["scope"], "all library records")
        with (refs / "references.csv").open() as stream:
            row = next(csv.DictReader(stream))
        self.assertEqual(row["checked_at"], report["generated_at"])
        self.assertIn("required-field presence", row["fields_checked"])
        self.assertEqual(row["status"], "CHECK")

    def test_single_import_protects_records_and_formats_literal_fields(self):
        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        raw = "@article{remote, author={Modha, Nirav}, title={Charge {DNA} and disease}, journal={Journal}, year={2026}, volume={1}, pages={1--3}, doi={10.1234/charge}}"
        with (
            patch.object(module, "fetch_doi_crossref", return_value=raw),
            patch.object(module.time, "sleep"),
        ):
            self.assertEqual(
                module.handle_doi_ingestion(self.root, "10.1234/charge"), 0
            )
        dest = self.root / "references/bib/Modha2026ChargeDNADisease.bib"
        saved = dest.read_bytes()
        self.assertIn("title     = {Charge {DNA} and disease}", saved.decode())
        with patch.object(module, "fetch_doi_crossref") as fetch:
            self.assertEqual(
                module.handle_doi_ingestion(
                    self.root, "https://doi.org/10.1234/CHARGE"
                ),
                0,
            )
            fetch.assert_not_called()
        self.assertEqual(dest.read_bytes(), saved)

    def test_audit_scope_keeps_unused_evidence_but_changed_records_expire(self):
        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        refs = self.root / "references"
        refs.mkdir()
        block = "@article{x, author={Example, Author}, title={Title}, journal={Journal}, year={2026}, volume={1}, number={1}, pages={1}, doi={10.1234/example}}"
        (refs / "references.bib").write_text(block)
        evidence = {
            "source_url": "https://api.crossref.org/works/10.1234/example",
            "message": {
                "DOI": "10.1234/example",
                "type": "journal-article",
                "title": ["Title"],
                "container-title": ["Journal"],
                "volume": "1",
                "issue": "1",
                "page": "1",
                "published": {"date-parts": [[2026]]},
                "author": [{"family": "Example", "given": "Author"}],
            },
        }
        report = refs / "references.json"
        report.write_text(
            json.dumps(
                {
                    "records": {
                        "x": {
                            "record_sha256": hashlib.sha256(block.encode()).hexdigest(),
                            "evidence": evidence,
                        }
                    }
                }
            )
        )
        self.assertEqual(module.audit_references(self.root), 0)
        cached = json.loads(report.read_text())
        self.assertEqual(cached["records"], {})
        self.assertEqual(cached["cached_records"]["x"]["evidence"], evidence)
        self.assertEqual(module.audit_references(self.root, all_references=True), 0)
        self.assertEqual(
            json.loads(report.read_text())["records"]["x"]["status"], "metadata_match"
        )
        module.audit_references(self.root)
        (refs / "references.bib").write_text(block.replace("{Title}", "{Changed}"))
        self.assertEqual(module.audit_references(self.root, all_references=True), 1)
        self.assertIn(
            "unverified or changed record; refresh metadata",
            json.loads(report.read_text())["records"]["x"]["flags"],
        )

    def test_prepare_handoff_reruns_and_invalid_input_preserve_local(self):
        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        articles = self.root.parent / "articles"
        articles.mkdir()
        source = articles / "dois.txt"
        source.write_text("10.1234/new\nhttps://doi.org/10.1234/NEW\n")
        (self.root / ".aspyrus.json").write_text(
            json.dumps({"references": {"doi_source": "../articles/dois.txt"}})
        )
        refs = self.root / "references"
        (refs / "bib").mkdir(parents=True)
        old = "@article{stable, author={Author}, title={Old}, journal={Journal}, year={2026}, volume={1}, pages={1}, doi={10.1234/local}}"
        (refs / "bib/stable.bib").write_text(old)
        (refs / "dois.txt").write_text("10.1234/local\n")
        fetched = old.replace("{Old}", "{New}").replace("10.1234/local", "10.1234/new")
        with (
            patch.object(module, "fetch_doi_crossref", return_value=fetched) as fetch,
            patch.object(module.time, "sleep"),
            patch.object(module, "audit_references", return_value=0),
            patch.object(module, "check_citations", return_value=0),
        ):
            self.assertEqual(module.prepare_references(self.root), 0)
            self.assertEqual(module.prepare_references(self.root), 0)
            fetch.assert_called_once_with("10.1234/new")
        self.assertEqual((refs / "bib/stable.bib").read_text(), old)
        self.assertEqual(
            (refs / "dois.txt").read_text(), "10.1234/local\n10.1234/new\n"
        )
        state = json.loads((refs / "references.json").read_text())
        self.assertEqual(state["handoff"]["omitted_retained"], ["10.1234/local"])
        before = (refs / "dois.txt").read_bytes()
        source.write_text("invalid\n")
        with self.assertRaises(ValueError):
            module.prepare_references(self.root)
        self.assertEqual((refs / "dois.txt").read_bytes(), before)

    def test_legacy_migration_and_failed_doi_csv(self):
        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        refs = self.root / "references"
        refs.mkdir()
        payloads = {
            "verification.json": json.dumps(
                {"records": {"old": {"evidence": {"message": {"title": ["Old"]}}}}}
            ),
            "verification_reviews.json": json.dumps(
                {"records": {"old": {"reason": "Evidence"}}}
            ),
            "verification_notes.md": "A reviewed correction, retained verbatim.\n",
        }
        for name, content in payloads.items():
            (refs / name).write_text(content)
        state = module.read_reference_state(self.root)
        self.assertEqual(state["reviews"]["old"]["reason"], "Evidence")
        for name, content in payloads.items():
            self.assertEqual(state["legacy"][name]["content"], content)
        module.save_reference_state(self.root, state)
        listing = refs / "dois.txt"
        listing.write_text("10.1234/failed\n")
        with (
            patch.object(
                module, "fetch_doi_crossref", side_effect=OSError("network unavailable")
            ),
            patch.object(module.time, "sleep"),
        ):
            self.assertEqual(module.ingest_doi_list(self.root, listing), 1)
        with (refs / "references.csv").open() as stream:
            rows = list(csv.DictReader(stream))
        failed = next(row for row in rows if row["doi"] == "10.1234/failed")
        self.assertEqual(failed["status"], "CHECK")
        self.assertIn("network unavailable", failed["comments"])
        self.assertEqual(list(rows[0]), module.CSV_COLUMNS)
        self.assertEqual(module.CSV_COLUMNS[0], "doi")
        self.assertEqual(module.CSV_COLUMNS[-2:], ["comments", "status"])
        self.assertEqual(
            module.read_reference_state(self.root)["legacy"]["verification_notes.md"][
                "content"
            ],
            payloads["verification_notes.md"],
        )

    def test_primary_conference_evidence_checks_container_on_rerun(self):
        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        folder = self.root / "references"
        folder.mkdir()
        source = "@inproceedings{x,author={Doe, Jane},title={Title},booktitle={Conference},year={2024},pages={1--2},url={https://publisher.example/paper}}"
        (folder / "references.bib").write_text(source)
        message = {
            "DOI": "",
            "type": "proceedings-article",
            "title": ["Title"],
            "container-title": ["Conference"],
            "published": {"date-parts": [[2024]]},
            "page": "1--2",
            "author": [{"family": "Doe", "given": "Jane"}],
        }
        module.save_reference_state(
            self.root,
            {
                "records": {
                    "x": {
                        "record_sha256": hashlib.sha256(source.encode()).hexdigest(),
                        "evidence": {
                            "source_kind": "publisher-reviewed",
                            "source_url": "https://publisher.example/paper",
                            "retrieved_at": "2026-10-07",
                            "message": message,
                        },
                    }
                },
            },
        )
        for _ in range(2):
            self.assertEqual(module.audit_references(self.root, all_references=True), 0)
        state = module.read_reference_state(self.root)
        state["records"]["x"]["evidence"]["message"]["container-title"] = [
            "Other conference"
        ]
        module.save_reference_state(self.root, state)
        self.assertEqual(module.audit_references(self.root, all_references=True), 1)
        state = module.read_reference_state(self.root)
        self.assertIn("metadata differs: booktitle", state["records"]["x"]["flags"])

    def test_reference_cli_stages_correction_and_preserves_recovery(self):
        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        folder = self.root / "references/bib"
        folder.mkdir(parents=True)
        old = "@article{x,author={Doe, J.},title={Title},journal={Conference},year={2024},pages={1--2}}"
        target = folder / "x.bib"
        target.write_text(old)
        publisher = self.root / "publisher.bib"
        publisher.write_text(
            "@inproceedings{publisherKey,author={Doe, Jane},title={Title},booktitle={Conference},year={2024},pages={1--2}}"
        )
        answers = [
            str(publisher),
            "https://publisher.example/paper",
            "Verified conference citation",
            "cancel",
        ]
        with patch("builtins.input", side_effect=answers):
            self.assertEqual(module.review_reference(self.root, "x"), 0)
        self.assertEqual(target.read_text(), old)
        self.assertFalse((self.root / "references/references.json").exists())
        answers[-1] = "SAVE"
        with patch("builtins.input", side_effect=answers):
            self.assertEqual(module.review_reference(self.root, "x"), 0)
        corrected = target.read_text()
        self.assertIn("@inproceedings{x", corrected)
        state = module.read_reference_state(self.root)
        self.assertEqual(state["review_history"][0]["previous_record"], old)
        self.assertEqual(
            state["records"]["x"]["evidence"]["source_kind"],
            "user-reviewed primary metadata",
        )
        self.assertEqual(module.audit_references(self.root, all_references=True), 0)

        # A simultaneous edit must prevent SAVE from overwriting source.
        def answer(prompt):
            if prompt.startswith("Corrected"):
                return ""
            if prompt.startswith("Authoritative"):
                return "https://publisher.example/paper"
            if prompt.startswith("What"):
                return "Verified primary citation"
            target.write_text(corrected + "% concurrent edit")
            return "SAVE"

        with patch("builtins.input", side_effect=answer):
            with self.assertRaisesRegex(ValueError, "changed during review"):
                module.review_reference(self.root, "x")
        self.assertTrue(target.read_text().endswith("% concurrent edit"))

    def test_reference_cli_exception_is_explicit_and_source_bound(self):
        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        folder = self.root / "references/bib"
        folder.mkdir(parents=True)
        source = "@article{x,author={Doe, J.},title={Title},journal={Journal},year={2024},volume={1},pages={1},doi={10.1234/test}}"
        (folder / "x.bib").write_text(source)
        module.save_reference_state(
            self.root,
            {
                "records": {
                    "x": {
                        "record_sha256": hashlib.sha256(source.encode()).hexdigest(),
                        "fields": {"doi": "10.1234/test"},
                        "evidence": {
                            "source_url": "https://registry.example",
                            "message": {
                                "DOI": "10.1234/test",
                                "type": "journal-article",
                                "title": ["Title"],
                                "container-title": ["Journal"],
                                "published": {"date-parts": [[2024]]},
                                "volume": "1",
                                "page": "1",
                                "author": [{"family": "Doe", "given": "Jane"}],
                            },
                        },
                    }
                }
            },
        )
        with patch(
            "builtins.input",
            side_effect=[
                "",
                "https://publisher.example",
                "Initials verified against publisher",
                "1",
                "SAVE",
            ],
        ):
            self.assertEqual(module.review_reference(self.root, "x"), 0)
        state = module.read_reference_state(self.root)
        self.assertNotIn(
            b"\r\n", (self.root / "references/references.csv").read_bytes()
        )
        self.assertEqual(state["records"]["x"]["status"], "reviewed_exception")
        self.assertEqual(
            state["records"]["x"]["detected_flags"],
            ["author list/order/spelling requires review"],
        )
        with patch("builtins.input", side_effect=["", "https://publisher.example", ""]):
            with self.assertRaisesRegex(ValueError, "reason is required"):
                module.review_reference(self.root, "x")

    def test_reference_cli_identity_change_refreshes_and_aligns_doi_list(self):
        import io

        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        folder = self.root / "references/bib"
        folder.mkdir(parents=True)
        old = "@article{x,author={Doe, Jane},title={Draft},journal={Old},year={2024},volume={1},pages={1},doi={10.1234/old}}"
        (folder / "x.bib").write_text(old)
        listing = self.root / "references/dois.txt"
        listing.write_text("10.1234/old\n")
        replacement = self.root / "publisher.bib"
        replacement.write_text(
            old.replace("{x,", "{publisherKey,")
            .replace("{Draft}", "{Published}")
            .replace("{Old}", "{Journal}")
            .replace("10.1234/old", "10.1234/new")
        )
        module.save_reference_state(
            self.root,
            {
                "records": {
                    "x": {
                        "record_sha256": hashlib.sha256(old.encode()).hexdigest(),
                        "fields": {"doi": "10.1234/old"},
                        "evidence": {"message": {"DOI": "10.1234/old"}},
                    }
                }
            },
        )
        message = {
            "DOI": "10.1234/new",
            "type": "journal-article",
            "title": ["Published"],
            "container-title": ["Journal"],
            "author": [{"family": "Doe", "given": "Jane"}],
            "published": {"date-parts": [[2024]]},
            "volume": "1",
            "page": "1",
            "unrelated": "omit",
        }
        response = io.BytesIO(json.dumps({"message": message}).encode())
        with (
            patch.object(
                module.urllib.request, "urlopen", return_value=response
            ) as fetch,
            patch(
                "builtins.input",
                side_effect=[
                    str(replacement),
                    "https://publisher.example",
                    "Confirmed intended published work",
                    "SAVE",
                ],
            ),
        ):
            self.assertEqual(module.review_reference(self.root, "x"), 0)
        self.assertIn("10.1234%2Fnew", fetch.call_args.args[0].full_url)
        self.assertEqual(listing.read_text(), "10.1234/old\n10.1234/new\n")
        state = module.read_reference_state(self.root)
        self.assertNotIn("unrelated", state["records"]["x"]["evidence"]["message"])
        self.assertEqual(
            state["review_history"][0]["previous_audit"]["fields"]["doi"], "10.1234/old"
        )
        self.assertIn("@article{x", (folder / "x.bib").read_text())

    def test_reference_reviews_expire_and_do_not_hide_new_flags(self):
        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        message = {"DOI": "10.1234/example", "title": ["Title"]}
        record = {
            "record_sha256": "source",
            "flags": ["metadata differs: year", "missing pages"],
            "evidence": {"message": message},
        }
        review = {
            "record_sha256": "source",
            "metadata_sha256": module.metadata_digest(message),
            "reason": "Issue year verified separately",
            "source_urls": ["https://publisher.example/article"],
            "reviewed_at": "2026-10-05",
            "accepted_flags": ["metadata differs: year"],
        }
        module.apply_reference_review(record, review)
        self.assertEqual(record["flags"], ["missing pages"])
        self.assertEqual(
            record["detected_flags"], ["metadata differs: year", "missing pages"]
        )
        self.assertEqual(record["status"], "needs_review")
        for change in ("source", "evidence"):
            record = {
                "record_sha256": "source" if change == "evidence" else "changed",
                "flags": ["metadata differs: year"],
                "evidence": {
                    "message": {
                        **message,
                        **({"volume": "2"} if change == "evidence" else {}),
                    }
                },
            }
            module.apply_reference_review(record, review)
            self.assertFalse(record["review_valid"])
            self.assertEqual(record["flags"], ["metadata differs: year"])

    def test_achemso_control_preserves_article_and_chapter_titles(self):
        source = self.root / "control.tex"
        source.write_text(
            r"\documentclass{article}\usepackage[numbers]{natbib}"
            r"\makeatletter\AtBeginDocument{\immediate\write\@auxout{"
            r"\string\citation{control}}}\makeatother"
            r"\begin{document}\cite{paper,chapter}"
            r"\bibliographystyle{achemso}\bibliography{control}\end{document}"
        )
        (self.root / "control.bib").write_text(
            "@control{control,ctrl-article-title={yes},ctrl-chapter-title={yes},"
            "ctrl-doi={no},ctrl-etal-firstonly={yes},ctrl-etal-number={15}}\n"
            "@article{paper,author={Doe, Jane},title={Article title guard},"
            "journal={Test Journal},year={2024},volume={2},pages={1--2}}\n"
            "@inbook{chapter,author={Doe, Jane},title={Chapter title guard},"
            "booktitle={Book title guard},publisher={Test Press},"
            "year={2024},volume={3},pages={4--5}}\n"
        )
        for command in (
            ["pdflatex", "-interaction=nonstopmode", "control.tex"],
            ["bibtex", "control"],
            ["pdflatex", "-interaction=nonstopmode", "control.tex"],
            ["pdflatex", "-interaction=nonstopmode", "control.tex"],
        ):
            result = subprocess.run(
                command, cwd=self.root, capture_output=True, text=True
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        with fitz.open(self.root / "control.pdf") as document:
            text = " ".join(page.get_text() for page in document)
        self.assertIn("Article title guard", text)
        self.assertIn("Chapter title guard", text)
        self.assertIn("Book title guard", text)
        self.assertNotIn("undefined", (self.root / "control.log").read_text())

    def test_reference_audit_preserves_metadata_and_invalidates_changed_records(self):
        spec = importlib.util.spec_from_file_location(
            "starter_bibgen", self.root / "scripts/bibgen.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        fields = module.bib_fields(
            "@article{x,author={Doe, Jane},title={A {nested} title},year={2024},"
            'journal="Journal",volume=2,pages={e12},doi={10.1234/example}}'
        )
        self.assertEqual(fields["title"], "A {nested} title")
        self.assertEqual(module.metadata_flags("article", fields), [])
        del fields["title"]
        self.assertIn("missing title", module.metadata_flags("article", fields))
        with self.assertRaises(ValueError):
            module.bib_fields("@article{x,title=journalname}")
        for name in ("main", "supplementary", "references"):
            (self.root / name).mkdir()
        (self.root / "main/main.tex").write_text(r"\cite{x}")
        (self.root / "supplementary/supplementary.tex").write_text(r"\nocite{y}")
        bib = self.root / "references/references.bib"
        source = "@article{x,author={Doe, Jane},title={Title},year={2024},journal={Journal},volume={2},pages={12},doi={10.1234/example}}"
        bib.write_text(source)
        digest = hashlib.sha256(source.encode()).hexdigest()
        report = self.root / "references/references.json"
        report.write_text(
            json.dumps(
                {
                    "records": {
                        "x": {
                            "record_sha256": digest,
                            "evidence": {
                                "source_url": "https://example.org",
                                "retrieved_at": "2024-01-01",
                                "message": {
                                    "DOI": "10.1234/example",
                                    "type": "journal-article",
                                    "title": ["Title"],
                                    "container-title": ["Journal"],
                                    "published": {"date-parts": [[2024]]},
                                    "volume": "2",
                                    "page": "12",
                                    "author": [{"family": "Doe", "given": "Jane"}],
                                },
                            },
                        }
                    }
                }
            )
        )
        self.assertEqual(module.audit_references(self.root), 1)  # missing SI key
        result = json.loads(report.read_text())
        self.assertEqual(result["missing_keys"], ["y"])
        self.assertEqual(result["records"]["x"]["status"], "metadata_match")
        # Suffix loss must flag even if an older spelling discrepancy was approved.
        snapshot = json.loads(report.read_text())
        snapshot["records"]["x"]["evidence"]["message"]["author"][0]["suffix"] = "Jr."
        report.write_text(json.dumps(snapshot))
        (self.root / "references/verification_reviews.json").write_text(
            json.dumps(
                {
                    "records": {
                        "x": {
                            "record_sha256": digest,
                            "metadata_sha256": module.metadata_digest(
                                snapshot["records"]["x"]["evidence"]["message"]
                            ),
                            "accepted_flags": [
                                "author list/order/spelling requires review"
                            ],
                            "reason": "Previously reviewed author spelling",
                            "source_urls": ["https://publisher.example/article"],
                            "reviewed_at": "2026-10-05",
                        }
                    }
                }
            )
        )
        self.assertEqual(module.audit_references(self.root), 1)
        result = json.loads(report.read_text())
        self.assertTrue(result["records"]["x"]["review_valid"])
        self.assertNotIn(
            "author list/order/spelling requires review",
            result["records"]["x"]["flags"],
        )
        self.assertIn("author suffixes require review", result["records"]["x"]["flags"])
        corrected = source.replace("Doe, Jane", "Doe, Jr., Jane")
        bib.write_text(corrected)
        snapshot["records"]["x"]["record_sha256"] = hashlib.sha256(
            corrected.encode()
        ).hexdigest()
        report.write_text(json.dumps(snapshot))
        self.assertEqual(module.audit_references(self.root), 1)  # missing SI key only
        result = json.loads(report.read_text())
        self.assertEqual(result["records"]["x"]["status"], "metadata_match")
        bib.write_text(source.replace("Title", "Changed title"))
        self.assertEqual(module.audit_references(self.root), 1)
        result = json.loads(report.read_text())
        self.assertNotIn("evidence", result["records"]["x"])
        self.assertIn(
            "unverified or changed record; refresh metadata",
            result["records"]["x"]["flags"],
        )

    def test_audit_ignore_rules_keep_only_summary_and_provenance_records(self):
        shutil.copy2(SCRIPTS.parent / ".gitignore", self.root / ".gitignore")
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        for relative, ignored in (
            ("feedback/rev2/README.md", False),
            ("feedback/rev2/audit/checks/organization/moves.json", False),
            ("feedback/rev2/audit/checks/formatting.json", True),
            ("feedback/rev2/edit/2026-10-04/main.docx", True),
        ):
            result = subprocess.run(
                ["git", "check-ignore", "--no-index", "-q", relative], cwd=self.root
            )
            self.assertEqual(result.returncode, 0 if ignored else 1, relative)

    def test_audit_categories_follow_explicit_event_packages(self):
        spec = importlib.util.spec_from_file_location(
            "starter_feedback", self.root / "scripts/feedback.py"
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        self.addCleanup(sys.modules.pop, spec.name, None)
        spec.loader.exec_module(module)
        revision = self.root / "feedback/rev2"
        for package, expected in (
            (revision / "edit/2026-10-04", revision / "audit/edit/2026-10-04"),
            (revision / "submission", revision / "audit/submission"),
            (revision / "decision", revision / "audit/checks/decision"),
        ):
            self.assertEqual(module.feedback_locations(package)[1], expected)
        (revision / "submission").mkdir(parents=True)
        self.assertEqual(
            module.feedback_locations(revision),
            (
                revision / "submission",
                revision / "audit/submission",
                Path("rev2/submission"),
            ),
        )

    def test_relocated_build_uses_current_document_locations(self):
        shutil.copytree(SCRIPTS.parent, self.root, dirs_exist_ok=True)
        # Exercise all three Hyperref defaults; only citecolor=black must fail.
        for name, label in (
            ("main", "fig:example"),
            ("supplementary", "fig:supp-example"),
        ):
            source = self.root / name / f"{name}.tex"
            for legacy in ("redtext", "bluetext", "redblock", "blueblock"):
                self.assertNotIn("{" + legacy + "}", source.read_text())
                self.assertNotIn("{\\" + legacy + "}", source.read_text())
            probes = (
                r"\par\noindent\href{https://example.org}{Urlguard} "
                + rf"\hyperref[{label}]{{Refguard}} "
                + r"\href{reference.pdf}{Fileguard}\par"
            )
            source.write_text(
                source.read_text().replace(
                    r"\end{document}", probes + r"\end{document}"
                )
            )
        result = self.run_script("build.py", "--aspyrus-root", str(SCRIPTS.parents[1]))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.root / "data").exists())
        self.assertTrue(
            (self.root / ".aspyrus_build/manuscript/MANUSCRIPT_DONE").is_file()
        )
        report = json.loads((self.root / "build_report.json").read_text())
        self.assertEqual(set(report["output_sha256"]), {"assets/figures/figures.pdf"})
        self.assertEqual(len(report["document_output_sha256"]), 4)
        for relative, expected in report["document_output_sha256"].items():
            self.assertEqual(
                hashlib.sha256((self.root / relative).read_bytes()).hexdigest(),
                expected,
            )
        self.assertEqual(
            report["supplementary_workbook"], "assets/tables/supplementary_tables.xlsx"
        )
        for name in ("main", "supplementary"):
            with fitz.open(self.root / name / f"{name}.pdf") as pdf:
                spans = [
                    span
                    for page in pdf
                    for block in page.get_text("dict")["blocks"]
                    for line in block.get("lines", [])
                    for span in line["spans"]
                ]
            for marker in ("Urlguard", "Refguard", "Fileguard"):
                matching = [span for span in spans if marker in span["text"]]
                self.assertTrue(matching, f"{name}: missing {marker}")
                self.assertTrue(
                    all(span["color"] == 0 for span in matching),
                    f"{name}: {marker} is coloured; all link types must be black",
                )
        self.assertFalse((self.root / "main.pdf").exists())
        self.assertFalse((self.root / "Supplementary_Tables.xlsx").exists())
        deck = self.root / "assets/figures/figures.pdf"
        self.assertNotIn("assets/figures/figures.pdf", report["input_sha256"])
        self.assertFalse((self.root / "figures.pdf").exists())
        # Emulate a previous build's owned root deck and verify safe migration.
        legacy = self.root / "figures.pdf"
        deck.rename(legacy)
        report["output_sha256"] = {
            "figures.pdf": hashlib.sha256(legacy.read_bytes()).hexdigest()
        }
        (self.root / "build_report.json").write_text(json.dumps(report))
        result = self.run_script("build.py", "--aspyrus-root", str(SCRIPTS.parents[1]))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(legacy.exists())
        self.assertTrue(deck.is_file())
        report = json.loads((self.root / "build_report.json").read_text())
        self.assertNotIn("assets/figures/figures.pdf", report["input_sha256"])
        deck.write_bytes(deck.read_bytes() + b"manual edit")
        changed = deck.read_bytes()
        result = self.run_script("build.py", "--aspyrus-root", str(SCRIPTS.parents[1]))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "manually edited export: assets/figures/figures.pdf", result.stderr
        )
        self.assertEqual(deck.read_bytes(), changed)
        self.assertFalse(
            (self.root / ".aspyrus_build/manuscript/MANUSCRIPT_DONE").exists()
        )
        self.assertFalse((self.root / "data").exists())

    def test_local_validation_and_explicit_promotion(self):
        assets = self.root / "assets"
        (assets / "figures/main").mkdir(parents=True)
        local = assets / "figures/main/panel.png"
        local.write_bytes(b"reviewed local artwork")
        upstream = self.root.parent / "compute"
        upstream.mkdir()
        (upstream / "panel.png").write_bytes(b"new upstream artwork")
        with (assets / "assets.csv").open("w", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["asset", "source_project", "source_output"])
            writer.writerow(
                ["assets/figures/main/panel.png", "../compute", "panel.png"]
            )
            writer.writerow(["assets/figures/toc.png", "../missing", "toc.png"])
        (assets / "figures/toc.png").write_bytes(b"local toc")
        result = self.run_script("assets.py")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(local.read_bytes(), b"reviewed local artwork")
        result = self.run_script(
            "assets.py", "--promote", "assets/figures/main/panel.png"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(local.read_bytes(), b"new upstream artwork")
        result = self.run_script("assets.py", "--promote", "assets/figures/toc.png")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((assets / "figures/toc.png").read_bytes(), b"local toc")

    def test_feedback_preserves_inputs_and_decisions_on_rerun(self):
        main = self.root / "main"
        received = self.root / "feedback/review"
        main.mkdir()
        received.mkdir(parents=True)
        (main / "main.tex").write_text("Original manuscript paragraph.\n")
        document = Document()
        document.add_paragraph("Original manuscript paragraph.")
        document.save(main / "main.docx")
        document.add_paragraph("Additional collaborator paragraph.")
        document.save(received / "main.docx")
        original_hash = hashlib.sha256(
            (received / "main.docx").read_bytes()
        ).hexdigest()
        result = self.run_script("feedback.py", "--feedback-dir", str(received))
        self.assertEqual(result.returncode, 0, result.stderr)
        audit = received / "audit"
        decisions = audit / "decisions.tsv"
        with decisions.open() as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            rows = list(reader)
            fields = reader.fieldnames
        self.assertTrue(rows)
        rows[0].update(decision="accept", rationale="Reviewed addition")
        with decisions.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields, delimiter="\t")
            writer.writeheader()
            writer.writerows(rows)
        result = self.run_script("feedback.py", "--feedback-dir", str(received))
        self.assertEqual(result.returncode, 0, result.stderr)
        with decisions.open() as handle:
            updated = list(csv.DictReader(handle, delimiter="\t"))
        self.assertEqual(updated[0]["decision"], "accept")
        self.assertTrue((audit / "FEEDBACK_AUDIT_DONE").is_file())
        self.assertEqual(
            hashlib.sha256((received / "main.docx").read_bytes()).hexdigest(),
            original_hash,
        )
        evidence = json.loads((audit / "comparison_inputs.json").read_text())
        self.assertIn("unverified", evidence["documents"]["main"]["export_provenance"])
        # Incorporating the addition removes its proposal, not its review record.
        shutil.copyfile(received / "main.docx", main / "main.docx")
        (main / "main.tex").write_text(
            "Original manuscript paragraph.\nAdditional collaborator paragraph."
        )
        for _ in range(2):
            result = self.run_script("feedback.py", "--feedback-dir", str(received))
            self.assertEqual(result.returncode, 0, result.stderr)
            with (audit / "previous_decisions.tsv").open() as handle:
                previous = list(csv.DictReader(handle, delimiter="\t"))
            self.assertEqual(previous[0]["decision"], "accept")
            self.assertEqual(previous[0]["rationale"], "Reviewed addition")

    def test_feedback_rejects_stale_source_dependencies_and_modified_exports(self):
        main = self.root / "main"
        received = self.root / "feedback/review"
        main.mkdir()
        received.mkdir(parents=True)
        source = main / "main.tex"
        active = main / "main.docx"
        dependency = self.root / "references.bib"
        source.write_text("Original paragraph.")
        dependency.write_text("original references")
        document = Document()
        document.add_paragraph("Original paragraph.")
        document.save(active)
        document.save(received / "main.docx")
        record = main / ".main-export.json"
        record.write_text(
            json.dumps(
                {
                    "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                    "dependency_sha256": {
                        dependency.name: hashlib.sha256(
                            dependency.read_bytes()
                        ).hexdigest()
                    },
                    "output_sha256": {
                        active.name: hashlib.sha256(active.read_bytes()).hexdigest()
                    },
                }
            )
        )
        result = self.run_script("feedback.py", "--feedback-dir", str(received))
        self.assertEqual(result.returncode, 0, result.stderr)
        audit = received / "audit"
        evidence = json.loads((audit / "comparison_inputs.json").read_text())
        self.assertIn(
            "verified source", evidence["documents"]["main"]["export_provenance"]
        )
        for path in (source, dependency, active):
            with self.subTest(path=path.name):
                original = path.read_bytes()
                path.write_bytes(original + b"modified")
                result = self.run_script("feedback.py", "--feedback-dir", str(received))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Rebuild before auditing", result.stderr)
                self.assertFalse((audit / "FEEDBACK_AUDIT_DONE").exists())
                path.write_bytes(original)

    def test_revision_packages_select_files_and_keep_audits_separate(self):
        main = self.root / "main"
        main.mkdir()
        (main / "main.tex").write_text("Original paragraph.")
        document = Document()
        document.add_paragraph("Original paragraph.")
        document.save(main / "main.docx")
        submission = self.root / "feedback/rev1/submission"
        submission.mkdir(parents=True)
        document.save(submission / "main_clean.docx")
        document.save(submission / "main_changes_marked.docx")
        result = self.run_script("feedback.py", "--feedback-dir", str(submission))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("main_clean.docx", result.stdout)
        self.assertTrue(
            (self.root / "feedback/rev1/audit/submission/FEEDBACK_AUDIT_DONE").exists()
        )
        edits = self.root / "feedback/rev2/edit/2026-10-04"
        edits.mkdir(parents=True)
        for name in ("main_first.docx", "main_second.docx"):
            document.save(edits / name)
        result = self.run_script("feedback.py", "--feedback-dir", str(edits))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Ambiguous", result.stderr)
        result = self.run_script(
            "feedback.py",
            "--feedback-dir",
            str(edits),
            "--main-file",
            "main_second.docx",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(
            (
                self.root / "feedback/rev2/audit/edit/2026-10-04/FEEDBACK_AUDIT_DONE"
            ).exists()
        )
        self.assertEqual(len(list(edits.iterdir())), 2)
        result = self.run_script(
            "feedback.py", "--feedback-dir", str(edits), "--main-file", "../main.docx"
        )
        self.assertNotEqual(result.returncode, 0)
        result = self.run_script(
            "feedback.py", "--feedback-dir", str(edits.parent.parent)
        )
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()

"""Generic fixtures; no private manuscript content belongs in tool tests."""

import importlib.util
import json
import sys
import tempfile
import subprocess
from unittest.mock import patch
from contextlib import redirect_stdout
import io
import unittest
from pathlib import Path

from docx import Document

TOOLS = Path(__file__).resolve().parents[1] / "src/tools"
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location("docreview", TOOLS / "docreview.py")
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class WordReviewTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / ".git").mkdir()
        self.source = self.root / "main.tex"
        self.current = self.root / "main.docx"
        self.returned = self.root / "returned.docx"
        self.text = (
            "The carefully selected variants show stable activity in the experiment."
        )
        self.tex = (
            "\\documentclass{article}\n% Keep this comment\n\\begin{document}\n"
            + self.text
            + "\n\\cite{keep}\n\\end{document}\n"
        )
        self.source.write_text(self.tex)
        self.word(self.current, self.text)
        self.word(self.returned, self.text.replace("stable", "increased"))
        self.ownership()

    def word(self, path, *paragraphs):
        document = Document()
        for text in paragraphs:
            document.add_paragraph(text)
        document.save(path)

    def ownership(self):
        (self.root / ".main-export.json").write_text(
            json.dumps(
                {
                    "source_sha256": review.digest(self.source),
                    "output_sha256": {"main.docx": review.digest(self.current)},
                    "dependency_sha256": {},
                }
            )
        )

    def compare(self, original=None):
        return review.compare(self.source, self.current, self.returned, original)

    def test_literal_edit_preserves_all_unaffected_bytes_and_input_files(self):
        before = {p: p.read_bytes() for p in (self.source, self.current, self.returned)}
        result = self.compare()
        self.assertEqual(result["mode"], "two-way")
        change = result["changes"][0]
        self.assertEqual(change["status"], "ready")
        proposal = review.prepare(result, {change["id"]: "accept"})
        self.assertEqual(proposal["content"], self.tex.replace("stable", "increased"))
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        self.assertEqual(review.prepare(self.compare(), {})["content"], self.tex)

    def test_three_way_keeps_disjoint_local_edit_but_blocks_overlap(self):
        original = self.root / "sent.docx"
        self.word(original, self.text)
        self.source.write_text(
            self.tex.replace("experiment.", "experiment, with extra controls.")
        )
        self.word(
            self.current,
            self.text.replace("experiment.", "experiment, with extra controls."),
        )
        self.ownership()
        result = self.compare(original)
        self.assertEqual(result["mode"], "three-way")
        c = result["changes"][0]
        merged = review.prepare(result, {c["id"]: "accept"})["content"]
        self.assertIn("increased activity", merged)
        self.assertIn("extra controls", merged)
        self.source.write_text(self.tex.replace("stable", "reduced"))
        self.word(self.current, self.text.replace("stable", "reduced"))
        self.ownership()
        self.assertNotEqual(self.compare(original)["changes"][0]["status"], "ready")

    def test_stale_source_docx_dependency_and_engine_are_rejected(self):
        result = self.compare()
        self.source.write_text(self.tex + "% later\n")
        with self.assertRaisesRegex(ValueError, "stale"):
            review.prepare(result, {})
        with self.assertRaisesRegex(ValueError, "stale"):
            self.compare()
        self.source.write_text(self.tex)
        self.returned.write_bytes(self.returned.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "stale"):
            review.prepare(result, {})
        self.word(self.returned, self.text)
        dep = self.root / "references.bib"
        dep.write_text("original")
        record = self.root / ".main-export.json"
        data = json.loads(record.read_text())
        data["dependency_sha256"] = {"references.bib": review.digest(dep)}
        record.write_text(json.dumps(data))
        dep.write_text("changed")
        with self.assertRaisesRegex(ValueError, "dependency"):
            self.compare()

    def test_math_citations_comments_and_repeated_spans_are_not_literal_targets(self):
        for tex in (
            "\\begin{document}$" + self.text + "$\\end{document}",
            "\\begin{document}\\cite{" + self.text + "}\\end{document}",
            "\\begin{document}% " + self.text + "\n\\end{document}",
            "\\begin{document}" + self.text + "\n" + self.text + "\\end{document}",
        ):
            self.assertIsNone(
                review.literal_patch(
                    tex,
                    "stable ",
                    "The carefully selected variants show ",
                    "activity in the experiment.",
                )
            )
        self.assertEqual(review.escape("3% & $"), r"3\% \& \$")

    def test_bibliography_structural_changes_and_bad_decisions_are_blocked(self):
        self.word(self.current, "References", self.text)
        self.word(self.returned, "References", self.text.replace("stable", "increased"))
        self.ownership()
        result = self.compare()
        self.assertEqual(result["changes"], [])
        self.assertEqual(result["bibliography"]["returned_paragraphs"], 2)
        with self.assertRaises(ValueError):
            review.prepare(result, {"invented": "accept"})
        self.word(
            self.returned, "A wholly inserted paragraph.", "References", self.text
        )
        self.assertIn("paragraph insertion", self.compare()["changes"][0]["status"])

    def test_record_publication_rejects_symlinks_and_concurrent_writers(self):
        result = self.compare()
        directory = self.root / "locked-audit"
        directory.mkdir()
        lock = directory / ".review-lock"
        lock.mkdir()
        with self.assertRaisesRegex(ValueError, "Another review"):
            review.write_review(result, directory)
        lock.rmdir()
        target = self.root / "untouched.json"
        target.write_text("original")
        (directory / "review.json").symlink_to(target)
        with self.assertRaisesRegex(ValueError, "symlink"):
            review.write_review(result, directory)
        self.assertEqual(target.read_text(), "original")
        self.assertFalse(lock.exists())

    def test_red_addition_uses_standard_command_and_requires_colour_package(self):
        result = self.compare()
        change = result["changes"][0]
        with self.assertRaisesRegex(ValueError, "usepackage"):
            review.prepare(result, {change["id"]: "accept"}, True)
        self.tex = self.tex.replace(
            r"\begin{document}",
            r"\usepackage{xcolor}" + "\n" + r"\begin{document}",
        )
        self.source.write_text(self.tex)
        self.ownership()
        result = self.compare()
        content = review.prepare(result, {result["changes"][0]["id"]: "accept"}, True)[
            "content"
        ]
        self.assertEqual(
            content, self.tex.replace("stable", r"\textcolor{red}{increased}")
        )

    def checkpoint(self):
        subprocess.run(["git", "init", "--quiet"], cwd=self.root, check=True)
        subprocess.run(["git", "add", "main.tex"], cwd=self.root, check=True)
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=Review Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "Committed source baseline",
            ],
            cwd=self.root,
            check=True,
        )

    def test_standard_colour_scopes_restore_and_normal_changes_stay_black(self):
        for wrapper in (
            r"\textcolor{red}{" + self.text + "}",
            "\\begingroup\\color{red}\n"
            "\\begingroup\n" + self.text + "\n\\endgroup\n\\endgroup",
        ):
            with self.subTest(wrapper=wrapper):
                self.tex = (
                    "\\documentclass{article}\n\\usepackage{xcolor}\n"
                    "\\begin{document}\n" + wrapper + "\n\\end{document}\n"
                )
                self.source.write_text(self.tex)
                self.ownership()
                result = self.compare()
                c = result["changes"][0]
                c.update(decision="accept", style="normal")
                self.assertEqual(
                    review.prepare(result, {})["content"],
                    self.tex.replace("stable", r"\textcolor{black}{increased}"),
                )
                self.assertFalse(
                    review.revision_scope(self.tex, self.tex.index(r"\end{document}"))
                )

    def test_colour_package_options_lists_comments_and_deletions(self):
        for preamble in (
            r"\usepackage[dvipsnames]{xcolor}",
            r"\usepackage{amsmath, color}",
            r"\RequirePackage{xcolor}",
        ):
            self.assertTrue(review.has_colour_package(preamble))
        for preamble in (
            "% " + r"\usepackage{xcolor}",
            r"\usepackage{xcolorful}",
            r"\begin{document}\usepackage{xcolor}",
        ):
            self.assertFalse(review.has_colour_package(preamble))
        self.word(self.returned, self.text.replace("stable ", ""))
        result = self.compare()
        c = result["changes"][0]
        c.update(decision="accept", style="red")
        self.assertEqual(
            review.prepare(result, {})["content"], self.tex.replace("stable ", "")
        )

    def test_cli_standard_colours_compile_to_pdf_and_word_without_custom_macros(self):
        import export
        import fitz
        import zipfile

        W = review.W
        self.tex = self.tex.replace(
            r"\begin{document}", r"\usepackage{xcolor}" + "\n" + r"\begin{document}"
        ).replace("\\cite{keep}\n", "")
        # Replace this test's synthetic export with a real owned baseline.
        self.current.unlink()
        (self.root / ".main-export.json").unlink()
        for style, colour in (("red", "FF0000"), ("blue", "0000FF")):
            with self.subTest(style=style):
                self.source.write_text(self.tex)
                export.compile_all(self.source)
                result = self.compare()
                c = result["changes"][0]
                c.update(decision="accept", style=style)
                self.source.write_text(review.prepare(result, {})["content"])
                export.compile_all(self.source)
                with fitz.open(self.source.with_suffix(".pdf")) as pdf:
                    spans = [
                        span
                        for page in pdf
                        for block in page.get_text("dict")["blocks"]
                        if "lines" in block
                        for line in block["lines"]
                        for span in line["spans"]
                    ]
                self.assertEqual(
                    next(s["color"] for s in spans if "increased" in s["text"]),
                    int(colour, 16),
                )
                with zipfile.ZipFile(self.current) as archive:
                    xml = review.etree.fromstring(archive.read("word/document.xml"))
                run = next(
                    r
                    for r in xml.iter(W + "r")
                    if "increased" in "".join(t.text or "" for t in r.iter(W + "t"))
                )
                self.assertEqual(
                    run.find(W + "rPr/" + W + "color").get(W + "val"), colour
                )

    def test_coloured_word_replacement_preserves_surroundings_and_normal_overrides(
        self,
    ):
        definitions = (
            r"\usepackage{xcolor}"
            + "\n"
            + r"\newcommand{\redtext}[1]{\textcolor{red}{#1}}"
            + "\n"
            + r"\newcommand{\bluetext}[1]{\textcolor{blue}{#1}}"
            + "\n"
        )
        self.tex = self.tex.replace(
            r"\begin{document}", definitions + r"\begin{document}"
        ).replace("stable", r"\redtext{stable}")
        self.source.write_text(self.tex)
        self.ownership()
        result = self.compare()
        c = result["changes"][0]
        self.assertEqual(c["status"], "ready")
        c.update(decision="accept", style="blue")
        expected = self.tex.replace(
            r"\redtext{stable}", r"\redtext{\textcolor{blue}{increased}}"
        )
        self.assertEqual(review.prepare(result, {})["content"], expected)
        c["style"] = "normal"
        self.assertEqual(
            review.prepare(result, {})["content"],
            self.tex.replace(
                r"\redtext{stable}", r"\redtext{\textcolor{black}{increased}}"
            ),
        )

    def test_interactive_choice_save_and_recovery_are_explicit_and_commit_bound(self):
        definitions = r"\usepackage{xcolor}" + "\n"
        self.tex = self.tex.replace(
            r"\begin{document}", definitions + r"\begin{document}"
        )
        self.source.write_text(self.tex)
        self.ownership()
        self.checkpoint()
        result = self.compare()
        with (
            patch("builtins.input", side_effect=["b", ""]),
            redirect_stdout(io.StringIO()),
        ):
            self.assertFalse(
                review.interactive_review(result, self.root / "audit", "normal")
            )
        self.assertEqual(self.source.read_text(), self.tex)
        with (
            patch("builtins.input", side_effect=["b", "SAVE"]),
            redirect_stdout(io.StringIO()),
        ):
            self.assertTrue(
                review.interactive_review(result, self.root / "audit", "normal")
            )
        self.assertEqual(
            self.source.read_text(),
            self.tex.replace("stable", r"\textcolor{blue}{increased}"),
        )
        self.assertEqual(Path(result["recovery_copy"]).read_text(), self.tex)
        self.assertEqual(
            set(p.name for p in (self.root / "audit").iterdir()),
            {"review.json", "review.md"},
        )

    def test_interactive_refuses_uncommitted_source_and_quit_preserves_it(self):
        result = self.compare()
        with self.assertRaisesRegex(ValueError, "Commit"):
            review.interactive_review(result, self.root / "audit", "normal")
        self.checkpoint()
        result = self.compare()
        with patch("builtins.input", side_effect=["q"]), redirect_stdout(io.StringIO()):
            review.interactive_review(result, self.root / "audit", "red")
        self.assertEqual(self.source.read_text(), self.tex)
        self.source.write_text(self.tex + "% later edit\n")
        with self.assertRaises(ValueError):
            review.save_proposal(
                result, {"original": self.tex, "content": "bad"}, self.root / "recovery"
            )

    def test_citation_numbers_are_flagged_and_never_become_source_keys(self):
        current = Document()
        p = current.add_paragraph(
            "The carefully selected variants show stable activity "
        )
        p.add_run("31").font.superscript = True
        current.save(self.current)
        returned = Document()
        p = returned.add_paragraph(
            "The carefully selected variants show stable activity "
        )
        p.add_run("32").font.superscript = True
        returned.save(self.returned)
        self.ownership()
        result = self.compare()
        self.assertIn("citation change", result["changes"][0]["status"])
        self.assertEqual(review.prepare(result, {})["content"], self.tex)

    def test_compact_store_retains_documents_decisions_and_previous_inputs(self):
        result = self.compare()
        change = result["changes"][0]
        review.prepare(result, {change["id"]: "reject"})
        directory = self.root / "audit"
        review.write_review(result, directory)
        review.write_review(result, directory)
        self.assertEqual(
            set(p.name for p in directory.iterdir()), {"review.json", "review.md"}
        )
        stored = json.loads((directory / "review.json").read_text())
        self.assertEqual(
            stored["documents"]["main"]["changes"][0]["decision"], "reject"
        )
        self.word(self.returned, self.text.replace("stable", "strong"))
        review.write_review(self.compare(), directory)
        stored = json.loads((directory / "review.json").read_text())
        self.assertEqual(len(stored["history"]), 1)
        self.assertEqual(stored["history"][0]["changes"][0]["decision"], "reject")

    def test_retained_and_pending_differences_remain_visible(self):
        result = self.compare()
        change = result["changes"][0]
        self.assertIn("pending: 1", review.outcome_summary(result))
        change.update(decision="reject", reason="Keep the verified local correction.")
        directory = self.root / "audit"
        review.write_review(result, directory)
        report = (directory / "review.md").read_text()
        self.assertIn("retained local: 1", report)
        self.assertIn("Keep the verified local correction.", report)
        self.assertIn("Before:", report)
        self.assertEqual(self.source.read_text(), self.tex)

    def test_declining_requires_reason_and_never_edits_source(self):
        self.checkpoint()
        result = self.compare()
        with (
            patch("builtins.input", side_effect=["d", "", "d", "Keep local evidence."]),
            redirect_stdout(io.StringIO()) as captured,
        ):
            review.interactive_review(result, self.root / "audit", "normal")
        self.assertIn("Record a reason", captured.getvalue())
        self.assertIn("retained local: 1", captured.getvalue())
        self.assertEqual(result["changes"][0]["reason"], "Keep local evidence.")
        self.assertEqual(self.source.read_text(), self.tex)


if __name__ == "__main__":
    unittest.main()

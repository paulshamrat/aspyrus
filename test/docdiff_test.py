"""Feedback discovery follows the active manuscript and selected base document."""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "tools"))
import docdiff  # noqa: E402


class FeedbackTests(unittest.TestCase):
    def test_revision_discovery_and_reports_preserve_package_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            edit = root / "rev2/edit/2026-10-04/main.docx"
            submission = root / "rev1/submission/main_clean.docx"
            for path in (
                edit,
                submission,
                root / "rev2/audit/main.docx",
                root / "rev2/decision/decision.docx",
                root / "rev2/decision/main.docx",
            ):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"fixture")
            self.assertEqual(docdiff.find_latest_feedback_file(root), edit)
            self.assertEqual(
                docdiff.feedback_report_path(edit),
                root / "rev2/audit/edit/2026-10-04/main_diff.md",
            )
            self.assertEqual(
                docdiff.feedback_report_path(root / "rev2/decision/main.docx"),
                root / "rev2/audit/checks/decision/main_diff.md",
            )
            self.assertEqual(
                docdiff.feedback_report_path(submission),
                root / "rev1/audit/submission/main_clean_diff.md",
            )

    def test_legacy_submitted_folder_uses_submission_audit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(
                docdiff.feedback_report_path(root / "rev1/submitted/main.docx"),
                root / "rev1/audit/submission/main_diff.md",
            )

    def test_nested_legacy_and_explicit_document_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "feedback").mkdir()
            (root / "main").mkdir()
            self.assertEqual(docdiff.manuscript_root(root / "main"), root)
            self.assertEqual(
                docdiff.base_document(root, Path("review.docx")),
                (root / "main/main.docx", root / "main/main.tex"),
            )
            self.assertEqual(
                docdiff.base_document(root, Path("supp_review.docx")),
                (root / "supplementary.docx", root / "supplementary.tex"),
            )
            (root / "supplementary").mkdir()
            self.assertEqual(
                docdiff.base_document(root, Path("supp_review.docx"))[0],
                root / "supplementary/supplementary.docx",
            )
            explicit = root / "custom.docx"
            self.assertEqual(
                docdiff.base_document(root, Path("review.docx"), str(explicit)),
                (explicit, explicit.with_suffix(".tex")),
            )


if __name__ == "__main__":
    unittest.main()

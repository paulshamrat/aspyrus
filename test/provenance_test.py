"""Plain-text records preserve ownership and publication rollback."""

import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/tools"))
import export  # noqa: E402
import provenance  # noqa: E402


class PlainRecordsTests(unittest.TestCase):
    @patch.dict(os.environ, {"ASPYRUS_PLAIN_RECORDS": "1"})
    def test_records_and_recovery_keep_original_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            value = {"hashes": {"main.pdf": "abc"}, "checks": [True, None, "Cα"]}
            path = root / provenance.record_name("export")
            path.write_text(provenance.record_text(value))
            self.assertEqual(provenance.read_record(path), value)
            transaction = root / ".aspyrus_build/publication"
            transaction.mkdir(parents=True)
            (transaction / "main.pdf").write_bytes(b"original")
            (root / "main.pdf").write_bytes(b"interrupted")
            (transaction / "journal.log").write_text(
                provenance.record_text(
                    {"touched": ["main.pdf", "new.docx"], "existing": ["main.pdf"]}
                )
            )
            (root / "new.docx").write_bytes(b"partial")
            export.recover(root)
            self.assertEqual((root / "main.pdf").read_bytes(), b"original")
            self.assertFalse((root / "new.docx").exists())
            self.assertFalse(list(root.rglob("*.json")))

    def test_legacy_default_is_unchanged(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(provenance.record_name("export"), "export.json")

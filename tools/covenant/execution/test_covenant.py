import json
import os
from pathlib import Path
import tempfile
import unittest
from covenant import init_run, produce, verify, Invalid, parse, read_file
from replay import run_replay, HERE

class ArtifactReadback(unittest.TestCase):
    def test_real_effect_controls(self):
        with tempfile.TemporaryDirectory() as temp:
            result = run_replay(Path(temp).resolve() / "controls")
            self.assertEqual(len(result["cases"]), 14)
            self.assertTrue(result["all_expected_results"])
            self.assertEqual(result["accepted_controls"], 1)
            positive = result["cases"][0]
            self.assertTrue(positive["actual_artifact_read"])
            self.assertEqual(len(positive["artifact_sha256"]), 64)

    def test_producer_and_init_do_not_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp).resolve() / "work"
            init_run(HERE / "task-contract.json", HERE / "synthetic-source.json", work)
            produce(work)
            original = (work / "faq.json").read_bytes()
            with self.assertRaises(FileExistsError):
                produce(work)
            with self.assertRaises(FileExistsError):
                init_run(HERE / "task-contract.json", HERE / "synthetic-source.json", work)
            self.assertEqual((work / "faq.json").read_bytes(), original)

    def test_path_traversal_contract_refused_before_creation(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp).resolve()
            c = json.loads((HERE / "task-contract.json").read_text())
            c["artifact_file"] = "../escaped.json"
            (path / "contract.json").write_text(json.dumps(c))
            with self.assertRaisesRegex(Invalid, "INVALID_LOCAL_FILENAME"):
                init_run(path / "contract.json", HERE / "synthetic-source.json", path / "run")
            self.assertFalse((path / "run").exists())
            self.assertFalse((path / "escaped.json").exists())

    def test_reserved_source_contract_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp).resolve()
            c = json.loads((HERE / "task-contract.json").read_text())
            c["source_file"] = "run.json"
            (path / "contract.json").write_text(json.dumps(c))
            with self.assertRaisesRegex(Invalid, "RESERVED_SOURCE_PATH"):
                init_run(path / "contract.json", HERE / "synthetic-source.json", path / "run")

    def test_symlink_ancestor_refused(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp).resolve()
            (path / "real").mkdir()
            (path / "alias").symlink_to(path / "real", target_is_directory=True)
            with self.assertRaisesRegex(Invalid, "SYMLINK_NOT_ALLOWED"):
                init_run(HERE / "task-contract.json", HERE / "synthetic-source.json", path / "alias" / "run")

    def test_duplicate_keys_and_non_object_refused(self):
        with self.assertRaisesRegex(Invalid, "DUPLICATE_JSON_KEY"):
            parse(b'{"answer":"right","answer":"wrong"}')
        with self.assertRaisesRegex(Invalid, "EXPECTED_OBJECT"):
            parse(b'[]')

    def test_receipt_cannot_repair_wrong_file(self):
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp).resolve() / "work"
            init_run(HERE / "task-contract.json", HERE / "synthetic-source.json", work)
            produce(work)
            (work / "faq.json").write_text('{"schema":"covenant-faq-artifact-v1"}')
            (work / "worker-receipt.json").write_text('{"claim":"done","verified":true,"payment_eligible":true}')
            result = verify(work)
            self.assertEqual(result["outcome"], "REJECTED")
            self.assertFalse(result["receipt_used_as_evidence"])
            self.assertFalse(result["payment_eligible"])

    def test_non_regular_file_refused_without_blocking(self):
        with tempfile.TemporaryDirectory() as temp:
            fifo = Path(temp).resolve() / "pipe"
            os.mkfifo(fifo)
            with self.assertRaisesRegex(Invalid, "NOT_REGULAR_FILE"):
                read_file(fifo)

if __name__ == "__main__":
    unittest.main()

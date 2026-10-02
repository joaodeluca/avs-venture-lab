"""Real local filesystem controls; each run is isolated, retained and inspectable."""
import argparse
import json
import os
from pathlib import Path
import time
from covenant import init_run, produce, verify, save_new, digest

HERE = Path(__file__).resolve().parent

def update(path, transform):
    value = json.loads(path.read_text())
    transform(value)
    path.write_text(json.dumps(value, ensure_ascii=False) + "\n")

def run_replay(destination):
    root = Path(destination).absolute()
    root.mkdir(mode=0o700)  # No previous evidence may be overwritten.
    rows = []
    controls = ["positive", "receipt_without_file", "corrupt_json", "wrong_answer",
                "wrong_source", "cross_task", "previous_run_token", "stale_file",
                "duplicate_answer", "symlink", "reference_changed", "oversized",
                "missing_answer", "expired_run"]
    original_token = None
    for name in controls:
        work = root / name
        run = init_run(HERE / "task-contract.json", HERE / "synthetic-source.json", work)
        before = verify(work)
        if name == "receipt_without_file":
            save_new(work / "worker-receipt.json", {"claim": "done", "task_id": run["task_id"]})
        else:
            produce(work)
        target = work / "faq.json"
        if name == "positive":
            original_token = run["token"]
        elif name == "corrupt_json":
            target.write_text("{not json")
        elif name == "wrong_answer":
            update(target, lambda a: a["answers"][0].update(answer="Entrega em 1 hora."))
        elif name == "wrong_source":
            update(target, lambda a: a.update(source_sha256="0" * 64))
        elif name == "cross_task":
            update(target, lambda a: a.update(task_id="SYN-OTHER-TASK"))
        elif name == "previous_run_token":
            update(target, lambda a: a.update(run_token=original_token))
        elif name == "stale_file":
            os.utime(target, ns=(run["started_ns"] - 1_000_000_000,) * 2)
        elif name == "duplicate_answer":
            update(target, lambda a: a["answers"].__setitem__(1, a["answers"][0]))
        elif name == "symlink":
            original = work / "misdirected.json"
            target.rename(original)
            target.symlink_to(original.name)
        elif name == "reference_changed":
            update(work / "synthetic-source.json", lambda a: a["facts"].update(delivery="Referência adulterada."))
        elif name == "oversized":
            target.write_bytes(b" " * 65537)
        elif name == "missing_answer":
            update(target, lambda a: a["answers"].pop())
        elif name == "expired_run":
            # Explicit synthetic clock-window control, not a five-minute delay.
            update(work / "run.json", lambda a: a.update(deadline_ns=run["started_ns"] - 1))
        after = verify(work)
        save_new(work / "before-verification.json", before)
        save_new(work / "after-verification.json", after)
        expected = "LOCAL_ARTIFACT_MATCH" if name == "positive" else "REJECTED"
        rows.append({"case": name, "before": before["outcome"], "after": after["outcome"],
                     "expected": expected, "passed": before["outcome"] == "REJECTED" and after["outcome"] == expected,
                     "actual_artifact_read": after["actual_artifact_read"],
                     "artifact_sha256": after["artifact_sha256"],
                     "error_code": after.get("error_code"),
                     "failed_checks": [c["name"] for c in after["checks"] if not c["passed"]]})
    report = {"schema": "covenant-filesystem-replay-v1", "mode": "EXECUTED_LOCAL_SYNTHETIC_CONTROLS",
              "created_at_ns": time.time_ns(), "cases": rows,
              "all_expected_results": all(c["passed"] for c in rows),
              "accepted_controls": sum(c["after"] == "LOCAL_ARTIFACT_MATCH" for c in rows),
              "source_code_sha256": {f: digest((HERE / f).read_bytes()) for f in ("covenant.py", "replay.py")},
              "external_calls": 0, "incremental_spend_brl": 0, "customers": 0,
              "limits": ["All facts, contracts, producer and filesystem are author-controlled.",
                         "Producer and verifier have separate CLI phases and independent readback; they are not independent organizations.",
                         "Expected failures are designed negative controls, not observed customer failure prevalence.",
                         "Expired-run case modifies local metadata; no real waiting/remote timing tested.",
                         "No signature, remote attestation, malicious-process sandbox or production oracle."]}
    save_new(root / "replay-report.json", report)
    lines = ["# Covenant: executed artifact readback", "", "Controlled synthetic local lab. Customer cases: 0. External calls: 0.", "", "| Control | Before | After | Expected result |", "|---|---|---|---|"]
    lines += [f"| {c['case']} | {c['before']} | {c['after']} | {'PASS' if c['passed'] else 'FAIL'} |" for c in rows]
    lines += ["", "A receipt alone was rejected. The positive control was read from an actual saved FAQ and compared with pinned reference facts.", "", "These results do not authenticate outside sources, prove business value or authorize payment."]
    (root / "RESULTS.md").write_text("\n".join(lines) + "\n")
    return report

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = run_replay(args.output)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result["all_expected_results"] else 1)

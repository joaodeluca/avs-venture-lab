"""Finite local artifact acceptance. No network, arbitrary commands or external oracle."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat
import time

MAX_BYTES = 65536
LIMITS = [
    "Controlled local synthetic lab, not external production verification.",
    "The operator, contract, source and filesystem are trusted locally; no authenticated third party.",
    "Matching a supplied reference does not establish factual truth, utility or causal attribution.",
    "Run token and file timing bind this lab task; they do not identify or authenticate an agent.",
    "No contract acceptance, payment eligibility, customer delivery or market validation.",
]

class Invalid(Exception):
    pass

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def safe_name(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}", value):
        raise Invalid("INVALID_LOCAL_FILENAME")
    return value

def read_file(path):
    """Reject symlinks, non-regular files and oversized files before parsing."""
    path = Path(path)
    # Ancestors are checked as well: resolving a path alone would follow a symlink.
    for part in (path, *path.parents):
        if part.is_symlink():
            raise Invalid("SYMLINK_NOT_ALLOWED")
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        raise Invalid("FILE_ABSENT")
    except OSError:
        raise Invalid("FILE_UNREADABLE")
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise Invalid("NOT_REGULAR_FILE")
        if info.st_size > MAX_BYTES:
            raise Invalid("FILE_TOO_LARGE")
        raw = os.read(fd, MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise Invalid("FILE_TOO_LARGE")
        after = os.fstat(fd)
        if (after.st_size, after.st_mtime_ns) != (info.st_size, info.st_mtime_ns):
            raise Invalid("FILE_CHANGED_DURING_READ")
        return raw, info
    finally:
        os.close(fd)

def parse(raw):
    def unique_pairs(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise Invalid("DUPLICATE_JSON_KEY")
            value[key] = item
        return value
    try:
        value = json.loads(raw, object_pairs_hook=unique_pairs)
    except (ValueError, UnicodeError, RecursionError):
        raise Invalid("INVALID_JSON")
    if not isinstance(value, dict):
        raise Invalid("EXPECTED_OBJECT")
    return value

def save_new(path, value):
    raw = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(raw)

def validate_contract(contract, source_raw):
    if contract.get("schema") != "covenant-faq-contract-v1":
        raise Invalid("UNSUPPORTED_CONTRACT")
    safe_name(contract.get("task_id"))
    for key in ("artifact_file", "source_file"):
        safe_name(contract.get(key))
    if contract["source_file"] in ("run.json", "contract.json", "worker-receipt.json"):
        raise Invalid("RESERVED_SOURCE_PATH")
    if contract["artifact_file"] in (contract["source_file"], "run.json", "contract.json", "worker-receipt.json"):
        raise Invalid("RESERVED_ARTIFACT_PATH")
    if contract.get("source_sha256") != digest(source_raw):
        raise Invalid("SOURCE_HASH_MISMATCH")
    questions = contract.get("questions")
    if not isinstance(questions, list) or not 1 <= len(questions) <= 5:
        raise Invalid("QUESTION_LIMIT")
    ids = set()
    source = parse(source_raw)
    facts = source.get("facts")
    if source.get("schema") != "covenant-synthetic-facts-v1" or not isinstance(facts, dict):
        raise Invalid("UNSUPPORTED_SOURCE")
    for question in questions:
        if not isinstance(question, dict):
            raise Invalid("INVALID_QUESTION")
        qid = safe_name(question.get("id"))
        if qid in ids or not isinstance(question.get("question"), str) or not question["question"].strip():
            raise Invalid("INVALID_QUESTION")
        ids.add(qid)
        if qid not in facts or not isinstance(facts[qid], str) or not facts[qid].strip():
            raise Invalid("MISSING_REFERENCE_FACT")
    return source

def init_run(contract_path, source_path, workspace):
    contract_raw, _ = read_file(contract_path)
    source_raw, _ = read_file(source_path)
    contract = parse(contract_raw)
    validate_contract(contract, source_raw)
    workspace = Path(workspace).absolute()
    for part in (workspace, *workspace.parents):
        if part.is_symlink():
            raise Invalid("SYMLINK_NOT_ALLOWED")
    workspace.mkdir(mode=0o700)  # Never overwrite/reuse a previous run directory.
    (workspace / "contract.json").write_bytes(contract_raw)
    (workspace / contract["source_file"]).write_bytes(source_raw)
    run = {"schema": "covenant-local-run-v1", "task_id": contract["task_id"],
           "token": secrets.token_hex(24), "started_ns": time.time_ns(),
           "deadline_ns": time.time_ns() + 300_000_000_000,
           "contract_sha256": digest(contract_raw), "source_sha256": digest(source_raw),
           "artifact_absent_at_start": True, "mode": "CONTROLLED_SYNTHETIC_LOCAL_LAB"}
    save_new(workspace / "run.json", run)
    return run

def load_context(workspace):
    workspace = Path(workspace).absolute()
    run = parse(read_file(workspace / "run.json")[0])
    if run.get("schema") != "covenant-local-run-v1" or run.get("artifact_absent_at_start") is not True:
        raise Invalid("INVALID_RUN")
    raw, _ = read_file(workspace / "contract.json")
    if digest(raw) != run.get("contract_sha256"):
        raise Invalid("CONTRACT_HASH_MISMATCH")
    contract = parse(raw)
    source_raw, _ = read_file(workspace / safe_name(contract.get("source_file")))
    source = validate_contract(contract, source_raw)
    if digest(source_raw) != run.get("source_sha256") or run.get("task_id") != contract["task_id"]:
        raise Invalid("RUN_CONTEXT_MISMATCH")
    return workspace, run, contract, source

def produce(workspace):
    """Separate producer example: creates a small FAQ from fixed synthetic facts."""
    workspace, run, contract, source = load_context(workspace)
    artifact = {"schema": "covenant-faq-artifact-v1", "task_id": contract["task_id"],
                "run_token": run["token"], "source_sha256": run["source_sha256"],
                "title": "FAQ — Loja Aurora Fictícia",
                "answers": [{"id": q["id"], "question": q["question"],
                             "answer": source["facts"][q["id"]]} for q in contract["questions"]]}
    save_new(workspace / contract["artifact_file"], artifact)
    receipt = {"task_id": contract["task_id"], "claim": "done", "role": "UNTRUSTED_WORKER_CLAIM",
               "artifact_file": contract["artifact_file"]}
    save_new(workspace / "worker-receipt.json", receipt)
    return receipt

def verify(workspace):
    report = {"schema": "covenant-readback-v1", "mode": "CONTROLLED_SYNTHETIC_LOCAL_LAB",
              "outcome": "REJECTED", "checks": [], "receipt_used_as_evidence": False,
              "actual_artifact_read": False, "artifact_sha256": None, "limits": LIMITS,
              "external_production_verified": False, "causal_attribution_verified": False,
              "payment_eligible": False}
    def check(name, passed):
        report["checks"].append({"name": name, "passed": bool(passed)})
    try:
        workspace, run, contract, source = load_context(workspace)
        report["task_id"] = contract["task_id"]
        report["run_token"] = run["token"]
        check("contract_and_reference_hashes", True)
        raw, info = read_file(workspace / contract["artifact_file"])
        report["actual_artifact_read"] = True
        report["artifact_sha256"] = digest(raw)
        report["observed_mtime_ns"] = info.st_mtime_ns
        report["observed_at_ns"] = time.time_ns()
        artifact = parse(raw)
        check("bounded_regular_file_json", True)
        check("schema", artifact.get("schema") == "covenant-faq-artifact-v1")
        check("task_and_run_binding", artifact.get("task_id") == contract["task_id"] and artifact.get("run_token") == run["token"])
        check("reference_source_binding", artifact.get("source_sha256") == run["source_sha256"])
        check("fresh_in_run_window", run["started_ns"] <= info.st_mtime_ns <= run["deadline_ns"] and report["observed_at_ns"] <= run["deadline_ns"])
        check("title", artifact.get("title") == "FAQ — Loja Aurora Fictícia")
        answers = artifact.get("answers")
        valid = isinstance(answers, list) and len(answers) == len(contract["questions"])
        check("exact_answer_count", valid)
        for question in contract["questions"]:
            matches = [a for a in answers if isinstance(a, dict) and a.get("id") == question["id"]] if valid else []
            check("answer_" + question["id"], len(matches) == 1 and matches[0].get("question") == question["question"] and matches[0].get("answer") == source["facts"][question["id"]])
        if all(c["passed"] for c in report["checks"]):
            report["outcome"] = "LOCAL_ARTIFACT_MATCH"
    except (Invalid, TypeError, KeyError, OSError) as error:
        report["error_code"] = str(error) if isinstance(error, Invalid) else "INVALID_OR_UNREADABLE_LOCAL_CONTEXT"
    return report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    init = subs.add_parser("init")
    init.add_argument("--contract", required=True)
    init.add_argument("--source", required=True)
    init.add_argument("--workspace", required=True)
    for command in ("produce", "verify"):
        sub = subs.add_parser(command)
        sub.add_argument("--workspace", required=True)
    args = parser.parse_args()
    try:
        if args.command == "init":
            output = init_run(args.contract, args.source, args.workspace)
        elif args.command == "produce":
            output = produce(args.workspace)
        else:
            output = verify(args.workspace)
        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 2 if output.get("outcome") == "REJECTED" else 0
    except (Invalid, OSError) as error:
        print(json.dumps({"outcome": "BLOCKED", "error_code": str(error) if isinstance(error, Invalid) else "LOCAL_OPERATION_REFUSED"}))
        return 2

if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""TraceBid: validate curated technical requirements against local page excerpts.

Python standard library only. No model, OCR, PDF parser, network, legal opinion,
eligibility decision, business approval, or verification of supplier claims.
Sources and requirements must be curated before this tool runs. An exact quote
match proves local textual traceability, not completeness or correct interpretation.

From this directory:
  python3 engine.py validate fixtures/synthetic/dossier.json
  python3 engine.py analyze fixtures/synthetic/dossier.json --format markdown
  python3 engine.py compare fixtures/synthetic/dossier.json fixtures/synthetic/revision.json
  python3 -m unittest discover -s tests -v

All input and output paths resolve beneath this product directory. source_pages
maps source IDs to product-relative JSON files containing {"1": "page text"}.
Source SHA-256 is the digest of that JSON file's exact bytes, NOT the original PDF.
See fixtures/synthetic/dossier.json for the complete input contract.
"""

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

PRODUCT_ROOT = Path(__file__).resolve().parent
MAX_DOSSIER_BYTES = 2_000_000
MAX_PAGE_FILE_BYTES = 10_000_000
MAX_TOTAL_PAGE_BYTES = 30_000_000
MAX_SOURCES = 100
MAX_REQUIREMENTS = 1000
MAX_CAPABILITIES = 1000
MAX_TEXT = 100_000
LIMITS = [
    "Technical review of curated text only; no legal analysis, eligibility decision, or business approval.",
    "Quote matching checks local text, not source authenticity, interpretation, extraction quality, or completeness.",
    "Source SHA-256 identifies the local page-text JSON, not the original publication or PDF.",
    "Supplier capabilities are declarations; missing declarations remain unknown.",
    "An item not observed in the later dossier is not established to be revoked or removed from the source.",
    "Changed source hashes or URLs require evidence review even when a requirement and its quote remain unchanged; semantic interpretation is not validated.",
]


class ValidationError(ValueError):
    """A bounded, invalid or untraceable curated dossier."""


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def text(value, label, maximum=MAX_TEXT):
    require(isinstance(value, str) and bool(value.strip()) and len(value) <= maximum,
            f"{label}: expected nonempty string, maximum {maximum} characters")
    return value


def identifier(value, label):
    value = text(value, label, 128)
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]*", value) is not None,
            f"{label}: invalid identifier")
    return value


def object_fields(value, required, optional, label):
    require(isinstance(value, dict), f"{label}: expected object")
    require(set(required) <= value.keys(), f"{label}: missing fields {sorted(set(required) - value.keys())}")
    require(value.keys() <= set(required) | set(optional),
            f"{label}: unknown fields {sorted(value.keys() - set(required) - set(optional))}")


def bounded_list(value, label, maximum, minimum=0):
    require(isinstance(value, list) and minimum <= len(value) <= maximum,
            f"{label}: expected list of {minimum}..{maximum} entries")


def local_path(value, root=PRODUCT_ROOT):
    text(str(value), "path", 4096)
    root = Path(root).resolve()
    candidate = Path(value)
    require(".." not in candidate.parts, "path traversal is forbidden")
    resolved = (root / candidate).resolve()
    require(resolved.is_relative_to(root), "path must stay inside product directory (including symlinks)")
    return resolved


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path, limit):
    try:
        with Path(path).open("rb") as stream:
            raw = stream.read(limit + 1)
        require(len(raw) <= limit, f"file exceeds {limit} byte limit")
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                           parse_constant=lambda value: (_ for _ in ()).throw(ValidationError(f"invalid JSON constant: {value}")))
        return value, raw
    except (OSError, UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValidationError(f"cannot read valid UTF-8 JSON from {path}: {exc}") from exc


def validate_dossier(dossier, root=PRODUCT_ROOT):
    object_fields(dossier, ["schema_version", "id", "sources", "source_pages", "requirements", "supplier_profile", "scope_limits"], [], "dossier")
    require(type(dossier["schema_version"]) is int and dossier["schema_version"] == 1, "schema_version must be 1")
    identifier(dossier["id"], "dossier.id")
    bounded_list(dossier["sources"], "sources", MAX_SOURCES, 1)
    bounded_list(dossier["requirements"], "requirements", MAX_REQUIREMENTS)
    bounded_list(dossier["scope_limits"], "scope_limits", 50, 1)
    for item in dossier["scope_limits"]:
        text(item, "scope_limits entry", 2000)
    require(isinstance(dossier["source_pages"], dict), "source_pages must be a map of source ID to local page JSON path")
    sources, pages, total_bytes = {}, {}, 0
    for source in dossier["sources"]:
        object_fields(source, ["id", "url", "title", "sha256", "observed_at", "kind"], [], "source")
        sid = identifier(source["id"], "source.id")
        require(sid not in sources, f"duplicate source id: {sid}")
        text(source["title"], f"{sid}.title", 2000)
        url = text(source["url"], f"{sid}.url", 4096)
        try:
            parsed = urlsplit(url)
            hostname = parsed.hostname
            port = parsed.port
        except ValueError as exc:
            raise ValidationError(f"{sid}.url is invalid") from exc
        require(parsed.scheme == "https" and bool(hostname) and not parsed.username and not parsed.password
                and not any(c.isspace() or ord(c) < 32 for c in url),
                f"{sid}.url must be an HTTPS URL without credentials or whitespace")
        require(source["kind"] in ("observed", "synthetic"), f"{sid}.kind must be observed or synthetic")
        observed_at = text(source["observed_at"], f"{sid}.observed_at", 64)
        try:
            timestamp = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValidationError(f"{sid}.observed_at must be an ISO-8601 timestamp with timezone") from exc
        require(timestamp.tzinfo is not None, f"{sid}.observed_at requires timezone")
        require(isinstance(source["sha256"], str) and re.fullmatch(r"[a-f0-9]{64}", source["sha256"]) is not None,
                f"{sid}.sha256 must be lowercase SHA-256")
        require(sid in dossier["source_pages"], f"missing source_pages path for {sid}")
        path = text(dossier["source_pages"][sid], f"source_pages.{sid}", 4096)
        require(not Path(path).is_absolute(), "source_pages paths must be product-relative")
        page_map, raw = read_json(local_path(path, root), MAX_PAGE_FILE_BYTES)
        total_bytes += len(raw)
        require(total_bytes <= MAX_TOTAL_PAGE_BYTES, "combined page files exceed byte limit")
        require(hashlib.sha256(raw).hexdigest() == source["sha256"], f"SHA-256 mismatch: {sid}")
        require(isinstance(page_map, dict) and 1 <= len(page_map) <= 10_000,
                f"{sid}: page JSON must map 1..10000 page numbers to text")
        for number, content in page_map.items():
            require(re.fullmatch(r"[1-9][0-9]{0,5}", number) is not None, f"{sid}: invalid page number")
            text(content, f"{sid} page {number}")
        sources[sid], pages[sid] = source, page_map
    require(set(dossier["source_pages"]) == set(sources), "source_pages must contain exactly the declared source IDs")

    def validate_evidence(evidence, label):
        bounded_list(evidence, label, 100)
        for item in evidence:
            object_fields(item, ["source_id", "page", "quote"], [], label)
            sid = identifier(item["source_id"], f"{label}.source_id")
            require(sid in sources, f"{label}: unknown source {sid}")
            page = item["page"]
            require(type(page) is int and 1 <= page <= 999999, f"{label}: page must be a positive integer")
            require(str(page) in pages[sid], f"{label}: page {page} not supplied for {sid}")
            quote = text(item["quote"], f"{label}.quote", 20_000)
            require(quote in pages[sid][str(page)], f"{label}: quote is not an exact substring of {sid} page {page}")

    seen_requirements = set()
    for req in dossier["requirements"]:
        object_fields(req, ["id", "category", "statement", "evidence", "status", "required_capability"], [], "requirement")
        rid = identifier(req["id"], "requirement.id")
        require(rid not in seen_requirements, f"duplicate requirement id: {rid}")
        seen_requirements.add(rid)
        text(req["category"], f"{rid}.category", 200)
        text(req["statement"], f"{rid}.statement", 10_000)
        identifier(req["required_capability"], f"{rid}.required_capability")
        require(req["status"] in ("supported", "unknown", "conflict"), f"{rid}: invalid status")
        validate_evidence(req["evidence"], f"{rid}.evidence")
        require(req["status"] != "supported" or bool(req["evidence"]), f"{rid}: supported requires evidence")
        require(req["status"] != "conflict" or len(req["evidence"]) >= 2, f"{rid}: conflict requires at least two evidence references")

    profile = dossier["supplier_profile"]
    object_fields(profile, ["synthetic", "capabilities"], [], "supplier_profile")
    require(type(profile["synthetic"]) is bool, "supplier_profile.synthetic must be boolean")
    bounded_list(profile["capabilities"], "capabilities", MAX_CAPABILITIES)
    seen_capabilities = set()
    for cap in profile["capabilities"]:
        object_fields(cap, ["id", "status"], ["evidence"], "capability")
        cid = identifier(cap["id"], "capability.id")
        require(cid not in seen_capabilities, f"duplicate capability id: {cid}")
        seen_capabilities.add(cid)
        require(cap["status"] in ("present", "absent", "unknown"), f"{cid}: invalid capability status")
        if "evidence" in cap:
            validate_evidence(cap["evidence"], f"{cid}.evidence")
    return dossier


def load_dossier(path, root=PRODUCT_ROOT):
    dossier, _ = read_json(local_path(path, root), MAX_DOSSIER_BYTES)
    return validate_dossier(dossier, root)


def provenance(dossier):
    return {"synthetic_supplier": dossier["supplier_profile"]["synthetic"],
            "synthetic_source_ids": sorted(s["id"] for s in dossier["sources"] if s["kind"] == "synthetic"),
            "sources": sorted(dossier["sources"], key=lambda s: s["id"])}


def analyze(dossier):
    """Analyze an already validated dossier; all matches are declared, not certified."""
    capabilities = {cap["id"]: cap for cap in dossier["supplier_profile"]["capabilities"]}
    rows = []
    for req in sorted(dossier["requirements"], key=lambda r: r["id"]):
        capability = capabilities.get(req["required_capability"])
        status = capability["status"] if capability else "unknown"
        if req["status"] != "supported":
            action = "clarify_requirement"
        elif status == "absent":
            action = "declared_capability_gap"
        elif status == "unknown":
            action = "verify_capability"
        else:
            action = "declared_capability_present"
        rows.append({**req, "capability_status": status,
                     "capability_basis": "declared" if capability else "not_declared",
                     "capability_evidence": capability.get("evidence", []) if capability else [],
                     "action": action})
    return {"schema_version": 1, "report_type": "technical_diligence", "dossier_id": dossier["id"],
            "provenance": provenance(dossier), "requirements": rows,
            "declared_gaps": [r["id"] for r in rows if r["action"] == "declared_capability_gap"],
            "unknown_capabilities": [r["id"] for r in rows if r["capability_status"] == "unknown"],
            "requirements_to_clarify": [r["id"] for r in rows if r["action"] == "clarify_requirement"],
            "scope_limits": LIMITS + dossier["scope_limits"]}


def compare(before, after):
    """Compare stable IDs in already validated dossiers, never infer revocation."""
    old = {r["id"]: r for r in before["requirements"]}
    new = {r["id"]: r for r in after["requirements"]}
    old_sources = {s["id"]: {key: s[key] for key in ("sha256", "url")} for s in before["sources"]}
    new_sources = {s["id"]: {key: s[key] for key in ("sha256", "url")} for s in after["sources"]}
    after_analysis = {r["id"]: r for r in analyze(after)["requirements"]}
    changes = []
    for rid in sorted(set(old) | set(new)):
        if rid not in new:
            change, fields = "not_observed", []
        elif rid not in old:
            change, fields = "new", []
        else:
            fields = sorted(key for key in old[rid] if old[rid][key] != new[rid][key])
            change = "modified" if fields else "unchanged"
        cited_ids = {e["source_id"] for req in (old.get(rid), new.get(rid)) if req for e in req["evidence"]}
        source_changes = []
        for sid in sorted(cited_ids):
            previous, current = old_sources.get(sid), new_sources.get(sid)
            if previous != current:
                source_changes.append({"source_id": sid, "before": previous, "after": current,
                                       "changed_fields": [key for key in ("sha256", "url")
                                                          if (previous or {}).get(key) != (current or {}).get(key)]})
        capability_action = after_analysis[rid]["action"] if rid in new else None
        technical_action = ("verify_observation_scope" if rid not in new else
                            "revalidate_source_evidence" if source_changes else capability_action)
        changes.append({"id": rid, "change": change, "changed_fields": fields,
                        "before": old.get(rid), "after": new.get(rid),
                        "source_changed": bool(source_changes), "source_changes": source_changes,
                        "revalidation_required": bool(source_changes) or change != "unchanged",
                        "after_capability_action": capability_action,
                        "after_technical_action": technical_action})
    return {"schema_version": 1, "report_type": "curated_dossier_comparison", "before_id": before["id"],
            "after_id": after["id"], "before_provenance": provenance(before), "after_provenance": provenance(after),
            "changes": changes, "supplier_profile_changed": before["supplier_profile"] != after["supplier_profile"],
            "scope_limits_changed": before["scope_limits"] != after["scope_limits"],
            "scope_limits": LIMITS + list(dict.fromkeys(before["scope_limits"] + after["scope_limits"]))}


def markdown(report):
    """Plain text in fenced blocks prevents curated content becoming Markdown links."""
    def block(value):
        payload = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)
        fence = "`" * max(3, max((len(m.group()) + 1 for m in re.finditer(r"`+", payload)), default=3))
        return f"{fence}text\n{payload}\n{fence}"
    lines = ["# TraceBid — curated technical review", "", block(report["report_type"]), ""]
    for key in ("dossier_id", "before_id", "after_id", "provenance", "before_provenance", "after_provenance"):
        if key in report:
            lines.extend([f"## {key.replace('_', ' ')}", "", block(report[key]), ""])
    for key in ("declared_gaps", "unknown_capabilities", "requirements_to_clarify", "supplier_profile_changed", "scope_limits_changed"):
        if key in report:
            lines.extend([f"## {key.replace('_', ' ')}", "", block(report[key]), ""])
    for row in report.get("requirements", report.get("changes", [])):
        lines.extend([f"## {row['id']}", "", block(row), ""])
    lines.extend(["## Scope limits", "", block(report["scope_limits"]), ""])
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "analyze", "compare"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("dossier")
        if command == "compare":
            subparser.add_argument("after")
        subparser.add_argument("--format", choices=("json", "markdown"), default="json")
        subparser.add_argument("--output", help="Write inside product directory instead of stdout")
    args = parser.parse_args(argv)
    try:
        dossier = load_dossier(args.dossier)
        if args.command == "compare":
            result = compare(dossier, load_dossier(args.after))
        else:
            result = analyze(dossier)
            if args.command == "validate":
                result = {"schema_version": 1, "report_type": "validation", "dossier_id": dossier["id"],
                          "valid": True, "provenance": provenance(dossier), "scope_limits": result["scope_limits"]}
        output = markdown(result) if args.format == "markdown" else json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        if args.output:
            destination = local_path(args.output)
            require(destination.suffix in (".json", ".md"), "output extension must be .json or .md")
            require(not destination.exists(), "output exists; choose a new output path")
            with destination.open("x", encoding="utf-8") as stream:
                stream.write(output)
        else:
            print(output, end="")
        return 0
    except (ValidationError, OSError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

# ExitForge structural assessment

Open index.html through HTTPS or localhost. Select/paste one authorized n8n JSON export (UTF-8, <=1MiB). Structural triage performs no workflow execution or API calls. The separate literal-Set workspace below generates an offline proposal; no persistence/upload.

The finite screen inspects one manual-start linear chain of at most eight nodes: Manual Trigger v1, No Operation v1, Set v3–3.4 with literal fields and HTTP Request v4–4.3 GET without auth/options. Unknown versions/parameters require review. Code, credentials, expressions, branches, durable state and scheduler dependencies are outside this recut.

OUT_OF_SCOPE / REVIEW_REQUIRED / STRUCTURAL_CANDIDATE never authorizes automatic migration. Defaults, cardinality, HTTP redirects/errors and runtime services require authorized behavior comparison. Even GET may have effects; this tool never sends it.

Reports omit node names, URLs, parameter values and credential identifiers. The SHA-256 covers analyzed UTF-8 text, potentially different from original bytes due to BOM/line endings. JSON.parse does not certify duplicate keys. No alert absence certifies no secrets or external effects. Reports are generated on click, not automatically stored.

`node test-inspect.mjs` checks fifteen original synthetic cases. Finite tests do not demonstrate runtime equivalence, utility to customers or sales.

Official HTTP Request options: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/

## Bounded original standalone Python proposal

The new offline generator extracts literal assignment data for Set v3.4 only, with explicit `mode: manual`, `includeOtherFields` boolean, no nonempty options and simple field names. Manual Trigger/NoOp are markers; they are not executed or reimplemented. The operator supplies up to1000 plain JSON objects (not n8n `json`/`binary`/`pairedItem` envelopes); a fixed original transformer applies literal assignments in declared order with explicit retention. Safe integer/boolean/string values only.

The page previews that transformation in JavaScript and emits a standalone Python3.10+ program using only json/sys, stdin/stdout. No HTTP/auth/code/expressions/dot notation, disk writing, scheduling or durable state is generated. Duplicate JSON keys, invalid Unicode, limits and output expansion are refused before result output. Downloaded Python and plan intentionally contain literal names/values; review disclosure before sharing. No upload/autosave. Editing the workflow invalidates the previous transformation; editing inputs invalidates output.

This executable artifact is a proposed local implementation of an explicitly stated data model, **not proof of n8n equivalence, a completed migration or production approval**. Defaults missing from the export are refused. n8n items, errors, binary handling and runtime behavior still require authorized original-run comparison. Official Set documentation describes manual/literal fields and retention/options: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.set/

Run `node --test test-extract.mjs` for focused JS/Python checks with original synthetic inputs. These execute generated local code after reviewing its fixed source; they do not execute n8n, call endpoints or validate customer demand.

The standalone original sample `extraction-example.py` uses `extraction-input.json` and produces `extraction-output.json`. Review the fixed source before running `python3 extraction-example.py < extraction-input.json`. It shares the stated plain-object model and does not run n8n.

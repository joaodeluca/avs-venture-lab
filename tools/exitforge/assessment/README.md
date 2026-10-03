# ExitForge structural assessment

Open index.html through HTTPS or localhost. Select/paste one authorized n8n JSON export (UTF-8, <=1MiB). No workflow execution, API calls, conversion, persistence or upload.

The finite screen inspects one manual-start linear chain of at most eight nodes: Manual Trigger v1, No Operation v1, Set v3–3.4 with literal fields and HTTP Request v4–4.3 GET without auth/options. Unknown versions/parameters require review. Code, credentials, expressions, branches, durable state and scheduler dependencies are outside this recut.

OUT_OF_SCOPE / REVIEW_REQUIRED / STRUCTURAL_CANDIDATE never authorizes automatic migration. Defaults, cardinality, HTTP redirects/errors and runtime services require authorized behavior comparison. Even GET may have effects; this tool never sends it.

Reports omit node names, URLs, parameter values and credential identifiers. The SHA-256 covers analyzed UTF-8 text, potentially different from original bytes due to BOM/line endings. JSON.parse does not certify duplicate keys. No alert absence certifies no secrets or external effects. Reports are generated on click, not automatically stored.

`node test-inspect.mjs` checks fifteen original synthetic cases. Finite tests do not demonstrate runtime equivalence, utility to customers or sales.

Official HTTP Request options: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/

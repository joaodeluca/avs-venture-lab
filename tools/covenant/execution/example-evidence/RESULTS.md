# Covenant: executed artifact readback

Controlled synthetic local lab. Customer cases: 0. External calls: 0.

| Control | Before | After | Expected result |
|---|---|---|---|
| positive | REJECTED | LOCAL_ARTIFACT_MATCH | PASS |
| receipt_without_file | REJECTED | REJECTED | PASS |
| corrupt_json | REJECTED | REJECTED | PASS |
| wrong_answer | REJECTED | REJECTED | PASS |
| wrong_source | REJECTED | REJECTED | PASS |
| cross_task | REJECTED | REJECTED | PASS |
| previous_run_token | REJECTED | REJECTED | PASS |
| stale_file | REJECTED | REJECTED | PASS |
| duplicate_answer | REJECTED | REJECTED | PASS |
| symlink | REJECTED | REJECTED | PASS |
| reference_changed | REJECTED | REJECTED | PASS |
| oversized | REJECTED | REJECTED | PASS |
| missing_answer | REJECTED | REJECTED | PASS |
| expired_run | REJECTED | REJECTED | PASS |

A receipt alone was rejected. The positive control was read from an actual saved FAQ and compared with pinned reference facts.

These results do not authenticate outside sources, prove business value or authorize payment.

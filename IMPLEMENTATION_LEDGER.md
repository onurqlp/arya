# SDD ledger — plan: docs/superpowers/plans/2026-11-12-kurum-takip.md

Base: be32010c1415d3e982819f4bb481d175dac4dee9. Separate worktree/branch feat/kurum-takip. Baseline node --test: zero existing tests; admin.js syntax clean.

Pre-flight: Task 2 consumes the status and query response of Task 1. Both use status, sources, columns, rows, total, message; no model or DB dependency.

Ruling: The user's latest request authorizes production publication, overriding the earlier AR-GE-only publication boundary. It does not supply missing CRM/course API access; first production state must remain visibly disconnected.

Ruling: Use structured query choices and optional person/group filter, not new OpenAI tool execution. This makes available capabilities reviewable and prevents unsupported questions from inventing answers. General natural-language understanding can be added after actual source contracts are verified.

Ruling: User requested three daily scans instead of per-query fetching. Use Vercel Cron at 06:00/11:00/16:00 UTC, cached snapshots in a new isolated table, and manual refresh. No source configuration means no remote or DB calls. Do not claim recurring private-data scans are working until source access is verified.

Task 1: complete — native node:test 21/21, then 27/27 with scheduled-scan and date/group regressions. Auth, origin, missing/partial data, canonical identity, currency units, source validation, no source writes.
Task 2: complete — UI tested with real new handler in jsdom; unavailable connection, refresh, HTML injection, late responses and expired sessions. Public source inspection confirms Supabase password sign-in in the panel login bundles; data schema remains unavailable before login.

Final review: independent review found stale source coverage and changed-connection cache reuse (Important), plus ambiguous case-sensitive canonical IDs (regraded Important: listed IDs must be selectable). All reproduced RED before fixes; source as-of day is now checked, cache is bound to a server-only configuration hash, and literal IDs resolve before name folding.
Ruling: Cache expiry is 18 hours rather than 12, covering the requested 14-hour overnight interval between 19:00 and 09:00 with a small delay margin. Source retrieval time and coverage stay visible; this is scheduled data, not an assertion of continuous freshness.
Final: Ruling: Real source schema/mapping/credential lifecycle and end-to-end private-data scans remain blocked on user login; do not claim connectivity. Production publication and public/auth-denial checks are performed by the primary agent after review.
Final: fixed old-coverage freshness, changed-connection snapshot reuse, and case-sensitive ID selection — three regressions RED→GREEN; complete npm test suite 37/37. No deferred minor findings.

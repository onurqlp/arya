# Kurum Takip Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the tasks in this session.

**Goal:** Add an admin-only Kurum Takip tab to the existing Arya site and deploy it, with honest disconnected states until the actual CRM/course APIs are supplied.

**Architecture:** A separate authenticated operations endpoint reads only two explicitly configured HTTPS source URLs. A deterministic query engine handles six queries against a versioned normalized contract. A small browser module mounts inside the existing admin shell without calling WhatsApp, OpenAI, the message summary, schema setup, or retention cleanup.

**Tech Stack:** Existing JavaScript ESM, Vercel Functions, native fetch and node:test; no new production dependencies.

**Spec:** ../specs/2026-11-12-kurum-takip.md (scope includes the user's latest production authorization).

## Global Constraints
- Existing WhatsApp, approval, send, health, auth and database implementations stay unchanged.
- No source writes, secret edits, mock production data, or claimed live connections without successful reads.
- Management access only; source API paths/schema/credentials are not available yet.
- Production publication of this tab is explicitly authorized by the latest user instruction.
- Fixed allowed source hosts: crm.aydadil.com and kurs.aydadil.com; no arbitrary user-supplied URL or SQL.

## Review Focus
- Unavailable/partial source results must not look like zero debt or zero absence.
- Turkish names and duplicate names must not merge identities.
- Invalid amounts, dates, source IDs, incomplete snapshots, redirects and unexpected hosts must fail closed.
- Unchecked homework and unrecorded attendance are not failures.
- Entering the new tab must not touch existing DB/Meta/OpenAI paths.

### Task 1: Read contracts, query engine and admin API
**Files:** lib/operations.js; api/admin/operations.js; tests/operations.test.js; tests/operations-api.test.js.
**Interfaces:** sourceStatus(env), readSource(kind,env,fetchImpl), queryOperations(input,sources,now); default admin API handler.
- [ ] Write failing behavior tests for unavailable/partial sources, canonical ID matching, ambiguity, amounts/dates, incomplete payloads, status redaction and auth/origin guards.
- [ ] Run node --test; see expected assertion failures before implementation.
- [ ] Implement version-1 snapshots, fixed-host read-only fetching, deterministic query results and redacted admin status.
- [ ] Run node --test and node --check on changed JS.

### Task 2: Same-site tab and connection instructions
**Files:** admin.js; index.html; operations-ui.js; operations.css; docs/operations-api.md; .env.example.
**Interfaces:** mountOperations(page,{api,onUnauthorized}), returning a cleanup callback; #kurum-takip deep link.
- [ ] Add tab, query choices, filter field, source status, retry/refresh and safe result rendering.
- [ ] Keep existing routes on their original loading path; operations loads only admin session and new API.
- [ ] Verify real UI navigation and disconnected query responses in an isolated local server with a test-only admin session.

### Task 3: Review, publish and verify
- [ ] Fresh branch review and fix material findings; run complete tests.
- [ ] Compare protected existing files against base; refresh main before merge to preserve concurrent changes.
- [ ] Publish only the reviewed commit to arya-whatsapp-panel in the existing team/project.
- [ ] Verify production source commit, navigation and unauthenticated API denial. If production login is unavailable, distinguish local authenticated UI verification from production public checks.

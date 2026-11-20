# ARYA WhatsApp Web Rebuild — GO0 Current-State and Direction

Date: 2026-11-20 (Europe/Istanbul)
Branch: `codex/arya-whatsapp-web-rebuild-20261120`
Base: Production branch `codex/arya-reply-ui-fix-go5-20261116`, commit `95c2f141a9ee974869ac8c9a99283d27b8ed2bed`

## Scope decision

- This project is ARYA WP. Do not access, copy, or depend on ASYA's account, database, credentials, prompts, or deployment.
- The existing Meta Cloud API integration is retired for this rebuild. The new message transport is the authenticated WhatsApp Web session on the AYDA Windows PC.
- ARYA replies may remain paused while the replacement is built. No automatic or customer-facing message is sent during development.
- Changes stay on this branch until the WhatsApp Web path is ready for review. Production is not changed here.

## Verified baseline

- The production branch contains a Meta webhook receiver at `api/meta-webhook.js`, a Graph API sender at `api/admin/send.js`, and Meta subscription helpers.
- The current `api/agent-draft.js` creates a reviewed draft only after an administrator explicitly selects messages and requests analysis. It reports `sent: false`.
- The current database stores messages, draft approvals, outbound messages, and audit events in the ARYA database.
- The existing WhatsApp Web group preview watcher is on the repository's `main` branch, not on the production branch. It reads only allowlisted group sidebar previews; it is not a full inbox bridge and does not send via WhatsApp Web. It also had Meta-based owner notifications, which must not be reused.
- The connected Windows PC is online. The local browser extension connection is unavailable in this work session, so the active WhatsApp Web screen has not been inspected.

## Replacement shape

1. Add an ARYA-owned browser bridge for WhatsApp Web, paired to the ARYA backend with a separate revocable device secret. Do not reuse the Arya admin cookie or any ASYA credential.
2. Ingest only explicitly allowlisted individual chats and class groups. Keep message IDs idempotent, retain the existing ARYA message/audit history, and make bridge health and connection state visible in the dashboard.
3. Route approved outbound jobs back to the paired extension. A job must bind to one exact chat and one exact message; ambiguous delivery must be marked for manual reconciliation and never auto-retried.
4. Keep replies paused by default. The first usable release is receive, review, draft, and manually triggered send through WhatsApp Web. Automatic replying can be added only after the owner reviews the new ARYA-specific rules and behavior.
5. Remove Meta API routes, secrets, and UI health checks from the replacement branch after the Web bridge covers their required product behavior. The existing external Meta developer app is outside this source branch and will be handled only after its exact ARYA app identity is verified.

## GO1 implementation order

- Add isolated WhatsApp Web bridge endpoints for pairing/heartbeat, signed inbound ingestion, outbound job claim, and delivery acknowledgment.
- Add the browser extension and a small setup screen for endpoint, device pairing, and chat/group allowlist.
- Replace the dashboard's Meta-dependent send status with local bridge state and manual-send status.
- Add visible paused/review/uncertain states so disconnects, ambiguous recipients, and missing delivery acknowledgments fail closed.
- Do not enable production sending or deploy this branch while the user-facing WhatsApp Web extension is unavailable for verification.

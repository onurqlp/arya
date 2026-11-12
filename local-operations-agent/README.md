# Arya Kurum Ajanı

Chrome/Edge Manifest V3 extension. It reads only the logged-in AYDA CRM and course pages in the local browser, produces version-1 snapshots, and publishes them through Arya's existing admin-only `/api/admin/operations-import` endpoint.

## Scope

- CRM routes: `/ogrenciler`, `/gruplar`, `/odemeler`.
- Course routes: `/ogretmen` and its current-month `/ogretmen/grup/{uuid}?tarih=YYYY-MM-DD` pages.
- Read-only: the extension opens temporary background tabs and reads rendered rows/cards. To cover active/archived groups it may select a view filter in those temporary tabs; it never saves, submits forms, or changes source records, messages WhatsApp, or calls Meta.
- Student IDs come from CRM detail links. Course student records are linked only when the normalized phone number is unique and equal in both systems. Course groups are linked only when the group name and level produce one exact CRM match. The owner must confirm this rule in the extension before any upload.
- Before upload, both source snapshots must pass the existing strict Arya schema validator. Missing pages, ambiguous links, a login screen, unmatched identities, or uncertain attendance/homework stop publication.
- No student, phone, or payment data is sent to GPT. The extension keeps the pending snapshot in `chrome.storage.session` until upload or browser close, then removes it after successful publication.
- Arya stores one latest snapshot per source in the isolated `arya_operations_snapshots` table. The extension sends each snapshot only after the owner presses **Arya Kurum Takip'e aktar**.
- Automatic sync is off by default. After a successful manual upload, the owner can enable a six-hour alarm. Chrome/Edge and the PC must remain open, and both source sessions must stay valid.

## Installation

See [`install.html`](./install.html) for the Turkish Windows steps.

## Known boundaries

This build is intentionally fail-closed. It relies on the current rendered UI and exact page labels. A panel UI change, incomplete monthly list, duplicate phone, duplicate group name/level, or missing per-student homework/attendance status prevents that scan from being published. It does not treat a missing record as zero. The user may disable automatic sync at any time from the extension popup.

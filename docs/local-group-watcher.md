# Arya local group preview pilot

This pilot reads only the visible latest-message preview for exact group names allowlisted in both the browser extension and Arya server. It does not open chats, click controls, send group messages, read media, or fetch chat history. It only sees rows currently rendered in the sidebar; pinned or visible watched groups are easiest to monitor. It can miss messages when multiple messages arrive before the sidebar preview updates. WhatsApp Web UI changes can also break selectors.

## Server environment

Set these Vercel Production variables before deploying the endpoint:

- ARYA_LOCAL_GROUP_INGEST_SECRET: a random secret with at least 32 characters. Keep it out of GitHub and the browser source files.
- ARYA_LOCAL_GROUP_ALLOWLIST: a JSON array of exact WhatsApp group names, for example ["AYDA A1","AYDA B1"].
- ARYA_LOCAL_GROUP_NOTIFY_TO: optional comma-separated E.164 digits. For each recipient, Arya sends a WhatsApp alert only if that person messaged the Arya number within the last 24 hours. Alerts are throttled to one per group per recipient every five minutes. Outside that window, it stores the preview in the panel but sends no proactive free-form WhatsApp message. Approved templates are not implemented by this pilot.

Existing WhatsApp API variables are reused for optional private alerts. No group-send route is added. The existing individual-send validation rejects these local group records. AI analysis still uses Arya's current manual message-selection and OpenAI-consent flow; this pilot does not call OpenAI automatically.

## Browser installation

1. Use Chrome or Edge on the Windows computer that will stay on.
2. Open the browser's extensions page and enable Developer mode.
3. Choose Load unpacked and select this folder, then refresh the WhatsApp Web tab.
4. Open the extension settings, enter the Arya URL, the same secret configured on Vercel, and exact group names.
5. Link the third WhatsApp number to WhatsApp Web by scanning its QR code on the phone.
6. Keep WhatsApp Web online and confirm an allowlisted group's latest sidebar preview appears in Arya's Conversations page.

The extension stores the secret and its retry queue in the browser's local extension storage. It signs each HTTPS request with HMAC-SHA256 and a five-minute timestamp. The server verifies the signature, checks the group allowlist, stores messages idempotently, and uses the existing retention policy.

## Limits and account boundary

This is an unofficial UI observer, not a Meta webhook. The first build targets Chrome or Edge; it does not install into Firefox. It is limited to sidebar previews and should be piloted with one group. Do not rely on it for urgent, complete, or compliance-critical monitoring. The owner must complete QR linking locally. No WhatsApp credentials or QR codes are stored by Arya.

# Arya local group preview pilot

This pilot reads only the visible latest-message preview for exact group names allowlisted in both the browser extension and Arya server. It does not open chats, click controls, send group messages, read media, or fetch chat history. It only sees rows currently rendered in the sidebar; pinned or visible watched groups are easiest to monitor. It can miss messages when multiple messages arrive before the sidebar preview updates. WhatsApp Web UI changes can also break selectors.

## Server environment

Set these Vercel Production variables before deploying the endpoint:

- ARYA_LOCAL_GROUP_INGEST_SECRET: a random secret with at least 32 characters. Keep it out of GitHub and the browser source files.
Group names are managed in Arya's admin panel and stored in the connected database.
- ARYA_LOCAL_GROUP_NOTIFY_TO: optional comma-separated E.164 digits. For each recipient, Arya sends a WhatsApp alert only if that person messaged the Arya number within the last 24 hours. Alerts are throttled to one per group per recipient every five minutes. Outside that window, it stores the preview in the panel but sends no proactive free-form WhatsApp message. Approved templates are not implemented by this pilot.

Existing WhatsApp API variables are reused for optional private alerts. No group-send route is added. The existing individual-send validation rejects these local group records. AI analysis still uses Arya's current manual message-selection and OpenAI-consent flow; this pilot does not call OpenAI automatically.

## Browser installation

1. Use Chrome or Edge on the Windows computer that will stay on.
2. In Arya, open **Grup İzleyici**, enter the exact group names, and save.
3. Download the private connection file from the panel.
4. Open the browser's extensions page and enable Developer mode.
5. Choose Load unpacked and select this folder, then open its settings and import the connection file.
6. Refresh the WhatsApp Web tab, then link the third WhatsApp number by scanning the QR code on the phone.
7. Keep WhatsApp Web online and confirm an allowlisted group's latest sidebar preview appears in Arya's Conversations page.

The connection file contains the HMAC key and should not be shared. The extension stores the secret and retry queue in local extension storage. It signs each HTTPS request with HMAC-SHA256 and a five-minute timestamp. Arya verifies the signature and checks group names against the allowlist saved in the admin panel. Messages are stored idempotently under the existing retention policy.

## Limits and account boundary

This is an unofficial UI observer, not a Meta webhook. The first build targets Chrome or Edge; it does not install into Firefox. It is limited to sidebar previews and should be piloted with one group. Do not rely on it for urgent, complete, or compliance-critical monitoring. The owner must complete QR linking locally. No WhatsApp credentials or QR codes are stored by Arya.

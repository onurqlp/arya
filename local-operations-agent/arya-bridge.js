chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'ARYA_PUBLISH_SNAPSHOT') return;
  if (!['crm', 'course'].includes(message.kind) || !message.snapshot || location.origin !== 'https://arya-whatsapp-panel.vercel.app') {
    sendResponse({ ok: false, error: 'invalid_request' }); return true;
  }
  fetch('/api/admin/operations-import', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: message.kind, snapshot: message.snapshot })
  }).then(async response => {
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) return { ok: false, error: 'unauthorized' };
    return response.ok ? { ok: true, result } : { ok: false, error: result.error || 'import_failed' };
  }).then(sendResponse).catch(() => sendResponse({ ok: false, error: 'network_error' }));
  return true;
});

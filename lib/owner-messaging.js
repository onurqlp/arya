import { randomBytes, randomUUID } from "node:crypto";
import { sendApprovedReply } from "./approval-send.js";

const OWNER_SESSION_MS = 24 * 60 * 60 * 1000;

export function normalizeWhatsAppId(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^\d{6,20}$/.test(digits) ? digits : "";
}

export function ownerIdsFromEnvironment(value = process.env.ARYA_OWNER_WA_IDS) {
  return [...new Set(String(value || "").split(/[,;\r\n]+/).map(normalizeWhatsAppId).filter(Boolean))];
}

export function generateOwnerCode() {
  return randomBytes(4).toString("hex").toUpperCase();
}

export function parseOwnerCommand(value) {
  const text = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
  if (/^(?:DURUM|BEKLEYENLER|DURUM\?)$/.test(text)) return { action: "status" };
  if (/^(?:YARDIM|KOMUTLAR|HELP|MERHABA|SELAM|HI|HELLO)$/.test(text)) return { action: "help" };
  const match = text.match(/^(ONAY|KABUL|RED|REDDET|TASLAK|DRAFT)\s+([A-F0-9]{8})$/);
  if (!match) return { action: "help" };
  const aliases = { KABUL: "approve", ONAY: "approve", RED: "reject", REDDET: "reject", TASLAK: "draft", DRAFT: "draft" };
  return { action: aliases[match[1]], code: match[2] };
}

function metaConfig() {
  const { META_ACCESS_TOKEN: token, META_PHONE_NUMBER_ID: phoneId, META_GRAPH_API_VERSION: version } = process.env;
  return token && phoneId && /^v\d+\.\d+$/.test(version || "") ? { token, phoneId, version } : null;
}

export async function sendWhatsAppText(to, text, fetchImpl = globalThis.fetch) {
  const config = metaConfig();
  if (!config) return { ok: false, error: "meta_send_not_configured" };
  const recipient = normalizeWhatsAppId(to);
  const body = String(text || "").trim();
  if (!recipient || !body || body.length > 4096) return { ok: false, error: "invalid_message" };
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${config.version}/${encodeURIComponent(config.phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: recipient, type: "text", text: { preview_url: false, body } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { ok: false, error: "meta_send_rejected", providerStatus: response.status };
    const data = await response.json().catch(() => ({}));
    const providerMessageId = data.messages?.[0]?.id;
    return providerMessageId ? { ok: true, providerMessageId } : { ok: false, error: "meta_delivery_uncertain" };
  } catch {
    return { ok: false, error: "meta_delivery_uncertain" };
  }
}

async function sendOwnerNotification(to, summary, code, { lastInboundAt, fetchImpl = globalThis.fetch } = {}) {
  const config = metaConfig();
  if (!config) return { ok: false, error: "meta_send_not_configured" };
  const sessionAt = new Date(lastInboundAt || 0).getTime();
  const sessionAge = Date.now() - sessionAt;
  const inSession = Number.isFinite(sessionAt) && sessionAge >= 0 && sessionAge < OWNER_SESSION_MS;
  const message = [
    "AYDA'da yeni WhatsApp müşteri mesajı var.",
    `Özet: ${String(summary || "Yeni mesaj alındı.").replace(/\s+/g, " ").slice(0, 450)}`,
    `Taslağı görmek: TASLAK ${code}`,
    `Göndermek: ONAY ${code}`,
    `Reddetmek: RED ${code}`,
  ].join("\n");

  if (inSession) return sendWhatsAppText(to, message, fetchImpl);
  const templateName = String(process.env.ARYA_OWNER_NOTIFICATION_TEMPLATE || "").trim();
  if (!templateName) return { ok: false, error: "template_required_outside_session" };
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${config.version}/${encodeURIComponent(config.phoneId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalizeWhatsAppId(to),
        type: "template",
        template: {
          name: templateName,
          language: { code: process.env.ARYA_OWNER_NOTIFICATION_LANG || "tr" },
          components: [{ type: "body", parameters: [
            { type: "text", text: String(summary || "Yeni WhatsApp mesajı").replace(/\s+/g, " ").slice(0, 180) },
            { type: "text", text: code },
          ] }],
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { ok: false, error: "template_send_rejected", providerStatus: response.status };
    const data = await response.json().catch(() => ({}));
    const providerMessageId = data.messages?.[0]?.id;
    return providerMessageId ? { ok: true, providerMessageId } : { ok: false, error: "meta_delivery_uncertain" };
  } catch {
    return { ok: false, error: "meta_delivery_uncertain" };
  }
}

export async function notifyOwnersForApproval(db, approvalId, code, summary, fetchImpl = globalThis.fetch) {
  const owners = ownerIdsFromEnvironment();
  if (!owners.length) {
    await db.query("UPDATE arya_approvals SET owner_notification_status = 'blocked', owner_notification_error = 'owner_allowlist_missing' WHERE id = $1", [approvalId]);
    return { status: "blocked", reason: "owner_allowlist_missing" };
  }
  const claimed = await db.query(
    "UPDATE arya_approvals SET owner_notification_status = 'sending', owner_notification_error = NULL " +
    "WHERE id = $1 AND status = 'pending' AND owner_notification_status IN ('not_sent', 'blocked') RETURNING id",
    [approvalId],
  );
  if (!claimed.length) return { status: "already_notified_or_processing" };
  const sessions = await db.query("SELECT sender_id, last_inbound_at FROM arya_owner_sessions WHERE sender_id = ANY($1::text[])", [owners]);
  const sessionMap = new Map(sessions.map((row) => [row.sender_id, row.last_inbound_at]));
  const outcomes = [];
  for (const owner of owners) {
    outcomes.push(await sendOwnerNotification(owner, summary, code, { lastInboundAt: sessionMap.get(owner), fetchImpl }));
  }
  const sent = outcomes.filter((outcome) => outcome.ok).length;
  const status = sent === owners.length ? "sent" : sent > 0 ? "partial" : "blocked";
  const error = status === "sent" ? null : [...new Set(outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.error))].join(",").slice(0, 200);
  await db.query(
    "UPDATE arya_approvals SET owner_notification_status = $2, owner_notification_error = $3 WHERE id = $1",
    [approvalId, status, error],
  );
  await db.query(
    "INSERT INTO arya_audit (id, actor, action, entity_id, details) VALUES ($1, 'system', 'owner_notification_' || $2, $3, $4::jsonb)",
    [randomUUID(), status, approvalId, JSON.stringify({ recipientCount: owners.length, sentCount: sent, error })],
  );
  return { status, sentCount: sent, recipientCount: owners.length, error };
}

function safeSnippet(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function sendOwnerReply(ownerId, text, fetchImpl) {
  const result = await sendWhatsAppText(ownerId, text, fetchImpl);
  return result.ok ? { status: "replied" } : { status: "reply_failed", error: result.error };
}

async function ownerStatus(db, ownerId, fetchImpl) {
  const [counts, rows] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS count FROM arya_approvals WHERE status = 'pending'"),
    db.query(
    "SELECT owner_code, analysis_text, created_at FROM arya_approvals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 6",
    ),
  ]);
  const count = Number(counts[0]?.count || 0);
  if (!count) return sendOwnerReply(ownerId, "Şu anda onay bekleyen taslak yok.", fetchImpl);
  const lines = rows.slice(0, 5).map((row) => `• ${row.owner_code}: ${safeSnippet(row.analysis_text, 100)}`);
  return sendOwnerReply(ownerId, `Onay bekleyen ${count} taslak var.\n${lines.join("\n")}\nTaslak için TASLAK KOD, göndermek için ONAY KOD yaz.`, fetchImpl);
}

export async function handleOwnerMessage(db, message, fetchImpl = globalThis.fetch) {
  const ownerId = normalizeWhatsAppId(message.senderId);
  if (!ownerId || !ownerIdsFromEnvironment().includes(ownerId)) return { handled: false };
  await db.query(
    "INSERT INTO arya_owner_sessions (sender_id, last_inbound_at) VALUES ($1, NOW()) " +
    "ON CONFLICT (sender_id) DO UPDATE SET last_inbound_at = EXCLUDED.last_inbound_at",
    [ownerId],
  );

  const command = parseOwnerCommand(message.body);
  if (command.action === "help") {
    return { handled: true, ...(await sendOwnerReply(ownerId, "Arya komutları: DURUM, TASLAK KOD, ONAY KOD, RED KOD. Örnek kod 8 karakterdir. ONAY yalnızca taslağı müşteriye gönderir.", fetchImpl)) };
  }
  if (command.action === "status") return { handled: true, ...(await ownerStatus(db, ownerId, fetchImpl)) };

  const found = await db.query(
    "SELECT id, owner_code, status, analysis_text, reply_text FROM arya_approvals WHERE owner_code = $1 LIMIT 1",
    [command.code],
  );
  const approval = found[0];
  if (!approval) return { handled: true, ...(await sendOwnerReply(ownerId, "Bu kodla eşleşen taslak bulamadım. DURUM yazarak bekleyen kodları görebilirsiniz.", fetchImpl)) };

  if (command.action === "draft") {
    if (!["pending", "approved"].includes(approval.status)) {
      return { handled: true, ...(await sendOwnerReply(ownerId, `Bu taslak şu anda ${approval.status} durumunda; içeriği gösteremiyorum.`, fetchImpl)) };
    }
    const text = `Taslak ${approval.owner_code}\n${safeSnippet(approval.analysis_text, 600)}\n\nMüşteriye önerilen yanıt:\n${String(approval.reply_text || "").slice(0, 1800)}\n\nGöndermek için ONAY ${approval.owner_code}, reddetmek için RED ${approval.owner_code}.`;
    return { handled: true, ...(await sendOwnerReply(ownerId, text, fetchImpl)) };
  }

  if (command.action === "reject") {
    const rejected = await db.query(
      "WITH updated AS (UPDATE arya_approvals SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $2 " +
      "WHERE id = $1 AND status = 'pending' RETURNING id) " +
      "INSERT INTO arya_audit (id, actor, action, entity_id, details) " +
      "SELECT $3, $2, 'approval_rejected', id, '{\"source\":\"whatsapp_owner\",\"sent\":false}'::jsonb FROM updated RETURNING entity_id",
      [approval.id, `owner:${ownerId}`, randomUUID()],
    );
    if (!rejected.length) return { handled: true, ...(await sendOwnerReply(ownerId, "Bu taslak artık beklemede değil; başka biri karar vermiş veya göndermiş olabilir.", fetchImpl)) };
    return { handled: true, ...(await sendOwnerReply(ownerId, `Taslak ${approval.owner_code} reddedildi. Müşteriye mesaj gönderilmedi.`, fetchImpl)) };
  }

  if (command.action === "approve") {
    if (approval.status === "pending") {
      const approved = await db.query(
        "WITH updated AS (UPDATE arya_approvals SET status = 'approved', reviewed_at = NOW(), reviewed_by = $2 " +
        "WHERE id = $1 AND status = 'pending' RETURNING id) " +
        "INSERT INTO arya_audit (id, actor, action, entity_id, details) " +
        "SELECT $3, $2, 'approval_approved', id, '{\"source\":\"whatsapp_owner\",\"sent\":false}'::jsonb FROM updated RETURNING entity_id",
        [approval.id, `owner:${ownerId}`, randomUUID()],
      );
      if (!approved.length) return { handled: true, ...(await sendOwnerReply(ownerId, "Bu taslak artık beklemede değil; başka biri karar vermiş olabilir.", fetchImpl)) };
    } else if (approval.status !== "approved") {
      return { handled: true, ...(await sendOwnerReply(ownerId, `Bu taslak ${approval.status} durumunda; gönderim yapılmadı.`, fetchImpl)) };
    }
    const outcome = await sendApprovedReply(db, approval.id, `owner:${ownerId}`, fetchImpl);
    if (outcome.ok) return { handled: true, ...(await sendOwnerReply(ownerId, `Taslak ${approval.owner_code} müşteriye gönderildi.`, fetchImpl)) };
    if (outcome.error === "customer_service_window_closed") {
      return { handled: true, ...(await sendOwnerReply(ownerId, `Taslak ${approval.owner_code} onaylandı ancak müşterinin 24 saatlik yanıt süresi dolmuş; mesaj gönderilmedi. Müşteri yeniden yazınca ONAY ${approval.owner_code} komutunu tekrar gönderin.`, fetchImpl)) };
    }
    if (outcome.error === "meta_delivery_uncertain") {
      return { handled: true, ...(await sendOwnerReply(ownerId, `Taslak ${approval.owner_code} için Meta gönderim sonucu belirsiz. Çift gönderimi önlemek için otomatik tekrar yapmadım; Arya panelinde durumu kontrol edin.`, fetchImpl)) };
    }
    return { handled: true, ...(await sendOwnerReply(ownerId, `Taslak ${approval.owner_code} gönderilemedi (${outcome.error}). Müşteriye gönderildi olarak işaretlemedim.`, fetchImpl)) };
  }

  return { handled: true, ...(await sendOwnerReply(ownerId, "Komut anlaşılmadı. DURUM, TASLAK KOD, ONAY KOD veya RED KOD yazın.", fetchImpl)) };
}

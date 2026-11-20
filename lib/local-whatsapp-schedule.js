const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalized(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
}

export function classifyLocalTeacherReply({ schedule, chatName, senderName, body }) {
  if (!schedule || normalized(chatName) !== normalized(schedule.teacher_chat_name) ||
      (senderName && normalized(senderName) !== normalized(schedule.teacher_name))) return { decision: "needs_human_review", reason: "teacher_chat_or_sender_mismatch" };
  const reply = String(body || "").normalize("NFKC").trim().toLocaleLowerCase("tr-TR");
  if (/^(?:ok|tamam|evet)[.!?]*$/u.test(reply)) return { decision: "confirmed", reason: "explicit_confirmation" };
  return { decision: "needs_human_review", reason: "non_explicit_reply" };
}

export function buildLocalWhatsAppDayPreview(schedules, date, approvalChatName = "ARYA ONAY") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw fail("invalid_preview_date");
  const day = new Date(date + "T12:00:00+03:00");
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) throw fail("invalid_preview_date");
  const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  const rows = [];
  for (const schedule of schedules.filter((item) => item.enabled && Number(item.weekday) === weekday)) {
    rows.push({ at: "09:00", to: schedule.teacher_chat_name, kind: "teacher_confirmation", condition: "her etkin ders için sabit teyit", text: `Günaydın ${schedule.teacher_name}, bugün ${schedule.group_name} grubundaki dersimiz saat ${schedule.class_time} için uygun mudur? Yalnızca “ok”, “tamam” veya “evet” açık teyit sayılır.` });
    rows.push({ at: "12:00", to: approvalChatName || "ARYA ONAY", kind: "noon_escalation", condition: "12.00’ye kadar yanıt yoksa veya yanıt beklenmedikse", text: `${schedule.group_name} · ${schedule.teacher_name}: ${date} tarihli ${schedule.class_time} dersi için teyit alınamadı ya da yanıt insan kontrolü gerektiriyor. WhatsApp Web’de öğretmen sohbetini kontrol edin.` });
    rows.push({ at: "12:00", to: schedule.group_name, kind: "noon_reminder", condition: "her etkin ders için sabit grup duyurusu", text: `Arkadaşlar, bugünkü dersimiz saat ${schedule.class_time}. Görüşmek üzere.` });
    rows.push({ at: "17:00", to: schedule.group_name, kind: "preclass_reminder", condition: "her etkin ders için sabit grup hatırlatması", text: `Hatırlatma: Bugünkü dersimiz saat ${schedule.class_time}. Katılımınızı bekliyoruz.` });
  }
  const order = { teacher_confirmation: 0, noon_escalation: 1, noon_reminder: 2, preclass_reminder: 3 };
  rows.sort((a, b) => a.at.localeCompare(b.at) || order[a.kind] - order[b.kind] || a.to.localeCompare(b.to, "tr"));
  return rows;
}

function fail(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

async function cancelQueuedWhatsAppJobs(db, reason) {
  await db.query("UPDATE arya_web_outbox SET status = 'cancelled', outcome_code = $1 WHERE status = 'queued'", [reason]).catch(() => {});
}

export async function ensureLocalWhatsAppScheduleSchema(db) {
  // Schema is installed through the owner-run migration. Runtime requests use
  // the restricted arya_ders_app role and must never try to create/alter tables.
  void db;
}

export async function listLocalWhatsAppSchedules(db) {
  await ensureLocalWhatsAppScheduleSchema(db);
  const [schedules, settings, outbox, agent] = await Promise.all([
    db.query("SELECT id::text AS id, group_name, teacher_name, teacher_chat_name, weekday, to_char(class_time, 'HH24:MI') AS class_time, " +
      "to_char(checkin_time, 'HH24:MI') AS checkin_time, to_char(response_deadline, 'HH24:MI') AS response_deadline, " +
      "preclass_minutes, enabled, updated_at FROM arya_web_schedules ORDER BY weekday, class_time, group_name"),
    db.query("SELECT approval_chat_name, paused, dry_run, send_enabled FROM arya_web_agent_settings WHERE id = 1"),
    db.query("SELECT id::text AS id, job_type, chat_name, body, run_at, status, outcome_code, created_at, delivered_at " +
      "FROM arya_web_outbox ORDER BY created_at DESC LIMIT 100").catch(() => []),
    db.query("SELECT EXISTS (SELECT 1 FROM arya_web_agent_heartbeats WHERE whatsapp_tab_open = true AND last_seen > NOW() - INTERVAL '2 minutes') AS agent_online")
      .catch(() => [{ agent_online: false }])
  ]);
  return { schedules, outbox, agent: agent[0] || { agent_online: false }, settings: settings[0] || { approval_chat_name: null, paused: true, dry_run: true, send_enabled: false } };
}

export async function saveLocalWhatsAppSchedule(db, value) {
  await ensureLocalWhatsAppScheduleSchema(db);
  if (!value || (value.id !== undefined && !UUID_RE.test(value.id)) ||
      typeof value.group_name !== "string" || value.group_name.trim().length < 2 || value.group_name.trim().length > 100 ||
      typeof value.teacher_name !== "string" || value.teacher_name.trim().length < 2 || value.teacher_name.trim().length > 80 ||
      typeof value.teacher_chat_name !== "string" || value.teacher_chat_name.trim().length < 2 || value.teacher_chat_name.trim().length > 100 ||
      !Number.isInteger(value.weekday) || value.weekday < 1 || value.weekday > 7 ||
      !TIME_RE.test(value.class_time || "") ||
      value.checkin_time !== "09:00" ||
      value.response_deadline !== "12:00" ||
      !Number.isInteger(value.preclass_minutes) || value.preclass_minutes < 5 || value.preclass_minutes > 240 ||
      typeof value.enabled !== "boolean") throw fail("invalid_whatsapp_schedule");
  try {
    const rows = await db.query(
      "INSERT INTO arya_web_schedules (id, group_name, teacher_name, teacher_chat_name, weekday, class_time, checkin_time, response_deadline, preclass_minutes, enabled) " +
      "VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6::time, $7::time, $8::time, $9, $10) " +
      "ON CONFLICT (id) DO UPDATE SET group_name = EXCLUDED.group_name, teacher_name = EXCLUDED.teacher_name, teacher_chat_name = EXCLUDED.teacher_chat_name, " +
      "weekday = EXCLUDED.weekday, class_time = EXCLUDED.class_time, checkin_time = EXCLUDED.checkin_time, " +
      "response_deadline = EXCLUDED.response_deadline, preclass_minutes = EXCLUDED.preclass_minutes, " +
      "enabled = EXCLUDED.enabled, updated_at = NOW() RETURNING id::text AS id",
      [value.id || null, value.group_name.trim(), value.teacher_name.trim(), value.teacher_chat_name.trim(), value.weekday, value.class_time,
        value.checkin_time, value.response_deadline, value.preclass_minutes, value.enabled]
    );
    if (!rows.length) throw fail("whatsapp_schedule_not_saved", 409);
    await cancelQueuedWhatsAppJobs(db, "schedule_changed_before_send");
    await db.query("UPDATE arya_web_agent_settings SET paused = true, dry_run = true, send_enabled = false, updated_at = NOW() WHERE id = 1");
    return { saved: true, id: rows[0].id };
  } catch (error) {
    if (error?.code === "23505") throw fail("whatsapp_schedule_group_day_conflict", 409);
    throw error;
  }
}

export async function updateLocalWhatsAppSettings(db, value, allowedChats = []) {
  await ensureLocalWhatsAppScheduleSchema(db);
  if (!value || !["pause", "resume", "set-approval-chat", "arm-live-send"].includes(value.action)) throw fail("invalid_whatsapp_agent_action");
  if (value.action === "arm-live-send") {
    if (value.confirmation !== "ALICI_VE_KURU_CALISMA_DOGRULANDI") throw fail("live_send_confirmation_required", 409);
    const allowed = new Set(allowedChats.map(normalized));
    const allows = (name) => allowed.has("*") || allowed.has(normalized(name));
    const current = await listLocalWhatsAppSchedules(db);
    const activeSchedules = current.schedules.filter((item) => item.enabled);
    if (!current.agent.agent_online) throw fail("whatsapp_local_agent_not_online", 409);
    if (!activeSchedules.length || !current.settings.approval_chat_name ||
        !allows(current.settings.approval_chat_name) ||
        activeSchedules.some((item) => !allows(item.group_name) || !allows(item.teacher_chat_name))) {
      throw fail("whatsapp_recipient_verification_required", 409);
    }
    await db.query("UPDATE arya_web_agent_settings SET paused = false, dry_run = false, send_enabled = true, updated_at = NOW() WHERE id = 1");
    return { armed: true, active_schedules: activeSchedules.length };
  }
  if (value.action === "set-approval-chat") {
    if (typeof value.chat_name !== "string" || value.chat_name.trim().length < 2 || value.chat_name.trim().length > 100) {
      throw fail("invalid_approval_chat");
    }
    await cancelQueuedWhatsAppJobs(db, "approval_chat_changed_before_send");
    await db.query("UPDATE arya_web_agent_settings SET approval_chat_name = $1, paused = true, dry_run = true, send_enabled = false, updated_at = NOW() WHERE id = 1", [value.chat_name.trim()]);
    return { approval_chat_updated: true };
  }
  const paused = value.action === "pause";
  if (paused) await cancelQueuedWhatsAppJobs(db, "agent_paused_before_send");
  await db.query("UPDATE arya_web_agent_settings SET paused = $1, dry_run = CASE WHEN $1 THEN true ELSE dry_run END, " +
    "send_enabled = CASE WHEN $1 THEN false ELSE send_enabled END, updated_at = NOW() WHERE id = 1", [paused]);
  return { paused, send_enabled: paused ? false : undefined };
}

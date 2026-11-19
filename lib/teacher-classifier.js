const DECISIONS = new Set(["confirmed", "rescheduled", "cancelled", "uncertain", "needs_human_review"]);
const TIME_RE = /(?:^|\b)([01]?\d|2[0-3])[:.]([0-5]\d)(?=$|\b)/g;
const AFFIRMATIVE_RE = /\b(evet|aynen|dogru|olacak|tamamdir|onayliyorum|dersimiz var|yapilacak)\b/;
const CANCEL_RE = /\b(iptal|yapilmayacak|gelemeyecegim|katilamayacagim|ders olmayacak|ders yok)\b/;
const NEGATED_CANCEL_RE = /\b(iptal degil|iptal olmadi|iptal etmeyin|iptal etmiyoruz)\b/;
const CHANGE_RE = /\b(degistirelim|kaydiralim|erteleyelim|alalim|baslayalim|yapalim|degistirdim|degisti|gec alalim|erken alalim)\b/;

export const TEACHER_FIXTURES = Object.freeze([
  Object.freeze({ id: "explicit-confirm", label: "Açık teyit · saat aynı", plannedTime: "20:00", teacherReply: "Evet, bugün saat 20:00'de dersimiz var." }),
  Object.freeze({ id: "reschedule", label: "Saat değişikliği önerisi", plannedTime: "20:00", teacherReply: "Bugün 20:30'da başlayalım." }),
  Object.freeze({ id: "cancelled", label: "Açık iptal", plannedTime: "20:00", teacherReply: "Bugünkü ders iptal oldu." }),
  Object.freeze({ id: "uncertain", label: "Belirsiz yanıt · model incelemesi", plannedTime: "20:00", teacherReply: "Şimdi net söyleyemem, programı kontrol edip döneyim." }),
  Object.freeze({ id: "contradiction", label: "Çelişkili saatler · insan kontrolü", plannedTime: "20:00", teacherReply: "20:30 olmaz, 21:00 yapalım." }),
  Object.freeze({ id: "no-reply", label: "Yanıt yok · insan kontrolü", plannedTime: "20:00", teacherReply: "" })
]);

const SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    decision: { type: "string", enum: [...DECISIONS] },
    proposed_time: { type: "string" },
    evidence: { type: "string" },
    rationale: { type: "string" }
  },
  required: ["decision", "proposed_time", "evidence", "rationale"]
});

function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/[’‘]/g, "'");
}

function parseTimes(text) {
  const found = new Set();
  for (const match of text.matchAll(TIME_RE)) found.add(`${match[1].padStart(2, "0")}:${match[2]}`);
  return [...found];
}

function result(decision, proposedTime, evidence, rationale, source = "deterministic") {
  return { decision, proposed_time: proposedTime, evidence: String(evidence).slice(0, 200), rationale: String(rationale).slice(0, 240), source };
}

export function deterministicClassification(fixture) {
  if (!fixture || typeof fixture.teacherReply !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(fixture.plannedTime || "")) {
    return result("needs_human_review", "", "Senaryo doğrulanamadı.", "Güvenli sınıflandırma için senaryo kontrol edilmeli.");
  }
  const raw = fixture.teacherReply.trim();
  if (!raw) return result("needs_human_review", "", "Öğretmen yanıtı yok.", "Yanıt gelmediği için teyit varsayılmadı.");

  const text = normalize(raw);
  const times = parseTimes(text);
  if (times.length > 1) return result("needs_human_review", "", raw, "Birden fazla saat veya çelişki var; insan kontrolü gerekli.");
  if (NEGATED_CANCEL_RE.test(text)) return result("needs_human_review", "", raw, "İptal ifadesi olumsuzlanmış; insan kontrolü gerekli.");
  const cancellation = CANCEL_RE.test(text);
  const affirmative = AFFIRMATIVE_RE.test(text);
  const change = CHANGE_RE.test(text);
  if (cancellation && (affirmative || change)) return result("needs_human_review", "", raw, "İptal ve devam/değişiklik işaretleri birlikte bulundu.");
  if (cancellation) return result("cancelled", "", raw, "Açık iptal ifadesi bulundu.");

  if (times.length === 1 && times[0] !== fixture.plannedTime && change) {
    return result("rescheduled", times[0], raw, "Tek ve açık yeni saat ile değişiklik önerisi bulundu.");
  }
  if (times.length === 1 && times[0] !== fixture.plannedTime) {
    return result("uncertain", "", raw, "Farklı bir saat var ancak açık değişiklik önerisi yok.");
  }
  if (affirmative && (!times.length || times[0] === fixture.plannedTime)) {
    return result("confirmed", fixture.plannedTime, raw, "Açık teyit bulundu; planlanan saatle çelişmiyor.");
  }
  if (change || (times.length === 1 && times[0] === fixture.plannedTime)) {
    return result("uncertain", "", raw, "Yanıtın anlamı deterministik kurallarla doğrulanamadı.");
  }
  return null;
}

function review(reason, evidence = "Sentetik yanıt otomatik doğrulanamadı.") {
  return result("needs_human_review", "", evidence, reason, "safe_fallback");
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "refusal") return null;
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

export function validateModelClassification(value, fixture) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return review("Model çıktısı beklenen şemaya uymadı.");
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "decision,evidence,proposed_time,rationale") return review("Model çıktısı beklenen şemaya uymadı.");
  if (!DECISIONS.has(value.decision) || typeof value.proposed_time !== "string" || typeof value.evidence !== "string" || typeof value.rationale !== "string") {
    return review("Model alanları doğrulanamadı.");
  }
  if (value.evidence.length > 200 || value.rationale.length > 240 || value.proposed_time.length > 5) return review("Model alan sınırları aşıldı.");
  if (value.decision === "uncertain" || value.decision === "needs_human_review") {
    return result(value.decision, "", value.evidence || "Belirsiz sentetik yanıt.", value.rationale || "İnsan kontrolü gerekli.", "openai_structured_output");
  }

  const text = normalize(fixture.teacherReply);
  const times = parseTimes(text);
  if (value.decision === "cancelled" && CANCEL_RE.test(text) && !NEGATED_CANCEL_RE.test(text) && !value.proposed_time) {
    return result("cancelled", "", value.evidence, value.rationale, "openai_structured_output");
  }
  if (value.decision === "confirmed" && AFFIRMATIVE_RE.test(text) && times.length <= 1 && (!times.length || times[0] === fixture.plannedTime) && (!value.proposed_time || value.proposed_time === fixture.plannedTime)) {
    return result("confirmed", fixture.plannedTime, value.evidence, value.rationale, "openai_structured_output");
  }
  if (value.decision === "rescheduled" && CHANGE_RE.test(text) && times.length === 1 && times[0] !== fixture.plannedTime && value.proposed_time === times[0]) {
    return result("rescheduled", times[0], value.evidence, value.rationale, "openai_structured_output");
  }
  return review("Model kararı sentetik yanıt ve ders saatiyle doğrulanamadı.", value.evidence || "Çelişki veya eksik teyit.");
}

async function classifyWithModel(fixture, { apiKey, model, fetchImpl, beforeModel }) {
  if (!apiKey) return review("OpenAI anahtarı yapılandırılmadı.");
  if (beforeModel && !(await beforeModel())) return review("Preview analiz sınırına ulaşıldı; insan kontrolü gerekli.");

  const requestBody = {
    model: model || "gpt-6-luna",
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: 180,
    instructions: "Türkçe öğretmen yanıtını yalnızca verilen sentetik ders bağlamına göre sınıflandır. Kesin kanıt yoksa uncertain veya needs_human_review seç. Önerilen saat, yanıt içinde açıkça geçmeli. Mesaj gönderme veya öğrenciye ne yazılacağını belirleme.",
    input: JSON.stringify({ planned_time: fixture.plannedTime, synthetic_teacher_reply: fixture.teacherReply }),
    text: { format: { type: "json_schema", name: "teacher_reply_classification", strict: true, schema: SCHEMA } }
  };

  try {
    const response = await (fetchImpl || fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) return review("OpenAI analizi tamamlanamadı; insan kontrolü gerekli.");
    const payload = await response.json();
    if (payload?.status && payload.status !== "completed") return review("Model yanıtı tamamlanmadı; insan kontrolü gerekli.");
    const content = extractResponseText(payload);
    if (!content) return review("Model yanıtı boş veya reddedilmiş; insan kontrolü gerekli.");
    let parsed;
    try { parsed = JSON.parse(content); } catch { return review("Model yanıtı JSON olarak okunamadı."); }
    return validateModelClassification(parsed, fixture);
  } catch {
    return review("OpenAI bağlantısı tamamlanamadı; insan kontrolü gerekli.");
  }
}

export function buildStudentDraft(classification) {
  if (classification.decision === "confirmed") {
    return `Bugünkü dersimiz saat ${classification.proposed_time}’de yapılacaktır. Görüşmek üzere.`;
  }
  if (classification.decision === "rescheduled") {
    return `Dersimiz ${classification.proposed_time}’de yapılacaktır. Görüşmek üzere.`;
  }
  return null;
}

export async function classifyFixture(fixtureId, options = {}) {
  const fixture = TEACHER_FIXTURES.find(item => item.id === fixtureId);
  if (!fixture) return { error: "invalid_fixture" };
  const deterministic = deterministicClassification(fixture);
  const classification = deterministic || await classifyWithModel(fixture, options);
  return {
    fixture_id: fixture.id,
    planned_time: fixture.plannedTime,
    decision: classification.decision,
    proposed_time: classification.proposed_time,
    evidence: classification.evidence,
    rationale: classification.rationale,
    source: classification.source,
    student_draft: buildStudentDraft(classification),
    sent: false,
    sending_enabled: false
  };
}

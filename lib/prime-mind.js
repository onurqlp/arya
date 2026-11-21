import { getDb } from "./db.js";
import { neon } from "@neondatabase/serverless";

const MODEL = process.env.AYDA_PRIME_MIND_MODEL || "gpt-6-luna";
const MAX_AGE_HOURS = 4;
const SCHEMA = {
 type: "object", additionalProperties: false,
 properties: {
   focus: {type: "string", description: "Which operational or strategic dimension was chosen independently."},
   title: {type: "string", description: "Clear, specific short title in Turkish."},
   observation: {type: "string", description: "The actual signal or meaningful observation grounded in the data; mention if data is old."},
   idea: {type: "string", description: "Original proposal or insight, written freely for the visible journal, not hidden private chain of thought."},
   recommended_action: {type: "string", description: "An actionable recommendation for the management to decide on; nothing is executed."},
   uncertainty: {type: "string", description: "What the data cannot establish, missing information or alternative explanations."},
   priority: {type: "string", enum: ["düşük", "orta", "yüksek"] },
   evidence: {type: "array", items: {type: "string"}, description: "Up to four explicit supporting signals from the provided snapshot. Do not invent."}
 },
 required: ["focus","title","observation","idea","recommended_action","uncertainty","priority","evidence"]
};
const SYSTEM = [
 "Sen AYDA PRIME'nin bağımsız çalışan stratejik gözlem ve fikir üretim motorusun.",
 "Kurum bağlamı: AYDA Ankara Yabancı Dil Akademisi, Almanca eğitim, sınav hazırlığı, öğrenci yönetimi ve WhatsApp Web üzerinden ders koordinasyonu yapan bir kurum.",
 "Bu döngüyü bir kullanıcının mesajı değil, zamanlayıcı başlattı. Her döngüde bakmak istediğin konuyu, risk/fırsat değerlendirmesini ve yeni fikrini bağımsızca sen seç.",
 "Önceki günlüklerle aynı fikri tekrarlama. Bilgi yetersizse gerçek bir fırsat varmış gibi davranma; hangi veriyi eksik gördüğünü belirt.",
 "Yalnızca sağlanan doğrulanmış sayısal ve operasyonel verilere dayan. Tarihi geçmiş bir kaydı güncel olay gibi yorumlama.",
 "Kişisel verileri veya erişim sırlarını üretme. Öğrenci isimleri veya özel iletişim bilgileri yoktur.",
 "Çıktı bir insanın görebileceği ORİJİNAL KAMUYA AÇIK ANALİZ/GÖRÜŞ NOTUDUR; gizli içsel muhakeme veya düşünce zinciri değildir.",
 "Kimse senden bir eylem istemedi: hiçbir mesaj gönderme, veritabanını değiştirme, kod dağıtma veya ödeme yapma.",
 "Her seferinde somut, güçlü ama olabildiğince ihtiyatlı bir içgörü üret. Emin olmadıklarını açıkça yaz.",
 "Çıktıyı sadece istenen JSON alanlarında, Türkçe ver."
].join("\n");

function asDate(value) {
 if (!value) return null;
 const date = new Date(value);
 return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}
async function collectSnapshot(db) {
 const rows = await db.query(
  "SELECT 'arya_messages' AS source, COUNT(*)::int AS count, MAX(message_time) AS latest FROM public.arya_messages " +
  "UNION ALL SELECT 'arya_outbound_messages',COUNT(*)::int,MAX(created_at) FROM public.arya_outbound_messages " +
  "UNION ALL SELECT 'arya_audit',COUNT(*)::int,MAX(created_at) FROM public.arya_audit " +
  "UNION ALL SELECT 'arya_approvals',COUNT(*)::int,MAX(created_at) FROM public.arya_approvals " +
  "UNION ALL SELECT 'arya_operations_snapshots',COUNT(*)::int,MAX(retrieved_at) FROM public.arya_operations_snapshots"
 );
 const sources = rows.map(r => ({name:r.source, count:r.count, newestRecord:asDate(r.latest)}));
 let coordination = {available:false,reason:"not_connected"};
 if (process.env.DERS_COORD_DATABASE_URL) {
  try {
   const client = neon(process.env.DERS_COORD_DATABASE_URL);
   const summary = await client.query(
     "SELECT (SELECT COUNT(*)::int FROM public.arya_web_schedules) AS configuredSchedules, " +
     "(SELECT COUNT(*)::int FROM public.arya_web_schedules WHERE enabled = true) AS enabledSchedules, " +
     "(SELECT COUNT(*)::int FROM public.arya_web_outbox WHERE status IN ('queued','leased','uncertain')) AS pendingOrUncertainJobs"
   );
   coordination = {available:true,...summary[0]};
  } catch {
   coordination = {available:false,reason:"schema_or_permission_unavailable"};
  }
 }
 let status = {available:false};
 try {
  const response=await fetch("https://arya-whatsapp-panel.vercel.app/api/health",{cache:"no-store",signal:AbortSignal.timeout(8000)});
  if (response.ok) {
   const h=await response.json();
   status={available:true,transport:h.transport,databaseReady:h.databaseReady,adminReady:h.adminReady,whatsappWebAgent:h.configured?.whatsappWebAgent,messageInboxEnabled:h.messageInboxEnabled,outboundSending:h.outboundSending};
  }
 } catch { /* A failed health check is explicitly shown as unavailable. */ }
 return {capturedAt:new Date().toISOString(),sources,coordination,aryaStatus:status,
    dataBoundary:"Local WhatsApp Web sohbet metinleri bu DB'de tam olarak arşivlenmiyor. Bu özet yalnızca sayı ve zaman içerir."};
}
async function createVisibleAnalysis(snapshot,prior) {
 const key=process.env.AYDA_PRIME_OPENAI_API_KEY||process.env.OPENAI_API_KEY;
 if (!key) throw new Error("model_key_missing");
 const input = JSON.stringify({currentSnapshot:snapshot, previousJournalHeadlines:prior.map(e=>({title:e.title,focus:e.focus}))});
 const response = await fetch("https://api.openai.com/v1/responses",{
  method:"POST",
  headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
  body:JSON.stringify({
   model:MODEL, store:false,
   instructions:SYSTEM,
   input:"Sahici işaretleri değerlendir, kendi gündemini seç ve tek yeni zihin günlüğü kaydı oluştur. Ham bağlam:\n"+input,
   reasoning:{effort:"medium"},
   max_output_tokens:2300,
   text:{format:{type:"json_schema",name:"prime_visible_journal",strict:true,schema:SCHEMA}}
  }),
  signal:AbortSignal.timeout(42000),
  cache:"no-store"
 });
 const result=await response.json().catch(()=>({}));
 if (!response.ok) {
  const code = result?.error?.code || result?.error?.type || "error";
  throw new Error("model_http_"+response.status+"_"+String(code).slice(0,40));
 }
 if(result.status!=="completed")throw new Error("model_result_incomplete");
 const raw = (result.output||[]).flatMap(item=>Array.isArray(item.content)?item.content:[]).filter(item=>item?.type==="output_text"&&typeof item.text==="string").map(item=>item.text).join("\n")||result.output_text||"";
 if (!raw||raw.length>24000)throw new Error("model_output_invalid");
 let parsed;try{parsed=JSON.parse(raw)}catch{throw new Error("model_json_invalid")}
 const str = k=>typeof parsed[k]==="string"?parsed[k].slice(0,8000):"";
 if (!str("title")||!str("idea")||!str("observation"))throw new Error("model_fields_missing");
 return {model:result.model||MODEL, raw,
  data:{focus:str("focus"),title:str("title"),observation:str("observation"),idea:str("idea"),
   recommended_action:str("recommended_action"),uncertainty:str("uncertainty"),priority:str("priority"),
   evidence:Array.isArray(parsed.evidence)?parsed.evidence.filter(s=>typeof s==="string").slice(0,4).map(s=>s.slice(0,700)):[]}};
}
export async function runMindCycle(now=new Date()) {
 const db=getDb();
 const cycleKey=now.toISOString().slice(0,13);
 const claimed = await db.query(
  "INSERT INTO public.prime_mind_journal(cycle_key,state) VALUES($1,'running') ON CONFLICT(cycle_key) DO NOTHING RETURNING id",
  [cycleKey]
 );
 if(!claimed.length)return {status:"already_recorded",cycleKey};
 const id=claimed[0].id;
 try {
  const [snapshot,previous]=await Promise.all([
   collectSnapshot(db),
   db.query("SELECT title,focus FROM public.prime_mind_journal WHERE state='completed' ORDER BY completed_at DESC LIMIT 8")
  ]);
  const output=await createVisibleAnalysis(snapshot,previous);
  await db.query(
   "UPDATE public.prime_mind_journal SET state='completed',completed_at=NOW(),model=$2,focus=$3,title=$4,observation=$5,idea=$6,recommended_action=$7,uncertainty=$8,priority=$9,evidence=$10::jsonb,raw_output=$11,source_snapshot=$12::jsonb,error_code=NULL WHERE id=$1",
   [id,output.model,output.data.focus,output.data.title,output.data.observation,output.data.idea,output.data.recommended_action,output.data.uncertainty,output.data.priority,JSON.stringify(output.data.evidence),output.raw,JSON.stringify(snapshot)]
  );
  return {status:"completed",cycleKey,id,title:output.data.title,model:output.model};
 } catch(error) {
  const code=String(error?.message||"cycle_failed").replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,100);
  await db.query("UPDATE public.prime_mind_journal SET state='failed',completed_at=NOW(),error_code=$2 WHERE id=$1",[id,code]).catch(()=>{});
  return {status:"failed",cycleKey,error:code};
 }
}
export const BRAIN_VERSION="1.0";

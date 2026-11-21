
import { timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const MCP_VERSION = "2025-06-18";
const ROOT = "https://arya-whatsapp-panel.vercel.app";
const BRANCH = "codex/arya-fixed-schedule-refresh-20261120";
const TABLES = ["arya_messages","arya_outbound_messages","arya_approvals","arya_audit","arya_operations_snapshots"];
const FILES = new Set(["README.md","package.json","vercel.json","api/health.js","api/prime.js","lib/db.js","lib/operations.js","lib/operations-scan.js","lib/whatsapp-transport.js","docs/README.md","IMPLEMENTATION_LEDGER.md"]);

const AYDA_PUBLIC_REPOS = [
 "sayfa","GENEL_SEVIYE_BELIRLEME","ONLINE-EGITIM-PLATFORMU","TELC_KAYIT",
 "SEO","SEVIYEBELIRLEME","Telc_sonuclar","TEKRARLAR","bibliothek","A2telc",
 "sinavgiris","telca2kelimelerr","A1hazirlik","telchazirlik","sinavhazirlik",
 "ogretmen","derskitaplari","linkler","sinifaciklama","ayda-pass","osd_a1_ayda",
 "osda1denemeler","osda1sprehcen","A1ayda","kurskatilim","a2ayda","b1ayda",
 "a2telcmektup","c1prufer","b1pruf","osd","goethe-mi-osd-mi","lehrer",
 "ders","osdyedek","ayda-hoca-panel","arya"
];
const PROJECT_INVENTORY = Object.freeze({
 snapshotDate:"2026-11-21",source:"AYDA owner's connected Vercel, Neon, Supabase and GitHub account inventory",
 vercelProjects:["arya-whatsapp-panel","ayda-platform","ayda-crm","ayda-mesaj-analizi-demo","ayda-instagram-inbox","ayda-ders-hatirlatma","ayda-lehrer-test","uzayx","club-president-demo","ayda-giris","ayda-ders"],
 neonProjects:[{name:"arya",id:"wispy-math-91879743"},{name:"asya",id:"hidden-cake-76941696"},{name:"ayda-lehrer",id:"odd-math-50592007"}],
 supabaseProjects:[{name:"ayda-crm",id:"zzljrvbhqyxvitmbtczz"},{name:"ayda-platform",id:"nncxpxqiubgdrzyvowtk"}],
 github:{publicAllowedRepos:AYDA_PUBLIC_REPOS,privateNotConnected:["ayda-instagram-inbox","ayda-wordpress-sync"],excludedRepositories:["sifreler"]},
 primeAuthorizedNow:["arya_system_status","arya_store_catalog","arya_database_summary","arya_recent_records","arya_coordination_schema","arya_repository_read","ayda_project_inventory","ayda_public_repo_browse","ayda_public_repo_read","ayda_n8n"],
 pendingSeparateOAuth:["Gmail","Google Drive","Google Calendar","Vercel administration","Neon other projects","Supabase accounts","GitHub private repositories","Remote Desktop Commander"],
 warning:"Metadata-only entries do NOT grant live access. The GitHub browser can only fetch approved public repositories; private repositories need independent authentication."
});
function repoName(v){return typeof v==="string"&&AYDA_PUBLIC_REPOS.includes(v)?v:null}
function safeGitPath(p){return typeof p==="string"&&p.length<170&&/^[A-Za-z0-9][A-Za-z0-9_.\-/]*$/.test(p)&&p.split("/").every(part=>part!=="."&&part!==".."&&!part.startsWith(".")&&!/(?:token|password|secret|credential|sifre|apikey|api_key|private_key|service_role|client_secret|session|\.env)/i.test(part))}
function stripSecrets(s){
 return String(s)
 .replace(/sk-(?:proj-)?[A-Za-z0-9_\-]{16,}/g,"[REDACTED_OPENAI_KEY]")
 .replace(/(authorization\s*[:=]\s*['"]?Bearer\s+)[A-Za-z0-9._\-]+/ig,"$1[REDACTED]")
 .replace(/((?:password|secret|token|api_key|apikey)\s*[:=]\s*['"])[^'"\r\n]+/ig,"$1[REDACTED]");
}

const TOOLS = [

 {name:"ayda_project_inventory",description:"Read the owner-verified November 21, 2026 AYDA inventory of 11 Vercel projects, 3 Neon projects, 2 Supabase projects, public GitHub repositories, and explicitly pending OAuth connections. Other projects listed are NOT directly connected by this tool.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"ayda_public_repo_browse",description:"Browse file and directory names in approved AYDA public GitHub repositories. Private repositories and secrets are not accessible. This is live public GitHub metadata.",inputSchema:{type:"object",properties:{repo:{type:"string",enum:AYDA_PUBLIC_REPOS},path:{type:"string",description:"Optional safe subdirectory (e.g. docs). Do not use for credentials."}},required:["repo"],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"ayda_public_repo_read",description:"Read one approved public AYDA GitHub source/documentation file, limited to 12000 characters. Private or secret-related paths are forbidden.",inputSchema:{type:"object",properties:{repo:{type:"string",enum:AYDA_PUBLIC_REPOS},path:{type:"string",description:"Public file path such as README.md, src/index.js, package.json"}},required:["repo","path"],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"arya_system_status",description:"Read the live ARYA health endpoint. No WhatsApp send or modification.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"arya_store_catalog",description:"Read the verified AYDA project and storage catalog. Other provider projects are metadata only and require separate credentials for live access.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"arya_database_summary",description:"Read only aggregate table counts and latest record times from the ARYA Neon database. Never changes records.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"arya_recent_records",description:"Read up to 15 recent ARYA messages or audit events from the existing database. Personal contact details are masked. The full WhatsApp Web browser chat history is not available here.",inputSchema:{type:"object",properties:{kind:{type:"string",enum:["messages","outbound","audit"]},limit:{type:"integer",minimum:1,maximum:15}},required:["kind"],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"arya_coordination_schema",description:"Read table names and approximate row counts from the AYDA lesson coordination database if configured. No student-specific data and no writes.",inputSchema:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:"arya_repository_read",description:"Read a single file from a strictly whitelisted set of public source files in the ARYA GitHub repository, never .env or secrets.",inputSchema:{type:"object",properties:{path:{type:"string",enum:[...FILES]}},required:["path"],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}}
];
function safeEqual(a,b){if(typeof a!=="string"||typeof b!=="string")return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
function send(res,id,result){return res.status(200).json({jsonrpc:"2.0",id,result})}
function fail(res,id,code,message){return res.status(200).json({jsonrpc:"2.0",id,error:{code,message}})}
function mask(value){return String(value||"").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[e-posta]").replace(/(?:\+?90[\s-]?)?(?:0?[1-9]\d{2})[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g,"[telefon]")}
function q(db,query){return db.query(query)}
function database(url){if(!url)throw Error("database_not_configured");return neon(url)}
async function dispatch(name,args){

 if(name==="ayda_project_inventory")return {checkedAt:new Date().toISOString(),...PROJECT_INVENTORY};
 if(name==="ayda_public_repo_browse"||name==="ayda_public_repo_read"){
   const repo=repoName(args?.repo),path=args?.path||"";
   if(!repo||path&&!safeGitPath(path))throw Error("repository_or_path_not_permitted");
   if(name==="ayda_public_repo_read"){
     if(!path||!/\.(md|txt|js|jsx|ts|tsx|json|html|css|py|sql|yml|yaml|toml)$/i.test(path))throw Error("file_not_permitted");
   }
   const base="https://api.github.com/repos/onurqlp/"+encodeURIComponent(repo)+"/contents";
   const url=base+(path?"/"+path.split("/").map(encodeURIComponent).join("/"):"")+"?ref=main";
   const resp=await fetch(url,{headers:{Accept:"application/vnd.github+json","User-Agent":"AYDA-PRIME-scope-readonly"},cache:"no-store",signal:AbortSignal.timeout(12000)});
   if(!resp.ok)throw Error("github_file_unavailable");
   const j=await resp.json();
   if(name==="ayda_public_repo_browse"){
     const entries=Array.isArray(j)?j:[j];
     return {repo,path:path||"/",entries:entries.filter(v=>!v.name.startsWith(".")&&!/(?:token|password|secret|credential|sifre|apikey|api_key|private_key|service_role)/i.test(v.name)).slice(0,100).map(v=>({name:v.name,path:v.path,type:v.type,size:v.size})),truncated:entries.length>100,publicOnly:true};
   }
   if(j.type!=="file"||typeof j.content!=="string"||j.size>250000)throw Error("file_not_permitted");
   const decoded=Buffer.from(j.content.replace(/\n/g,""),"base64").toString("utf8");
   const clean=stripSecrets(decoded);
   return {repo,path,url:j.html_url,content:clean.slice(0,12000),truncated:clean.length>12000,publicOnly:true};
 }

 if(name==="arya_system_status"){
  const r=await fetch(ROOT+"/api/health",{cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error("health_unavailable");
  return {checkedAt:new Date().toISOString(),health:await r.json()};
 }
 if(name==="arya_store_catalog"){
  return {checkedAt:new Date().toISOString(),source:"verified connection inventory 2026-11-21; external counts are not live",
   arya:{production:ROOT,github:"onurqlp/arya",neonProject:"wispy-math-91879743",readableNow:["ARYA health","ARYA database summary","recent redacted ARYA records","whitelisted public ARYA source"]},
   externalRequiresSeparateConnection:{
     neon:[{name:"asya",id:"hidden-cake-76941696"},{name:"ayda-lehrer",id:"odd-math-50592007"}],
     supabase:[{name:"ayda-crm",id:"zzljrvbhqyxvitmbtczz"},{name:"ayda-platform",id:"nncxpxqiubgdrzyvowtk"}],
     other:["Gmail","Google Drive","Vercel administration","Remote Desktop Commander"]},
   note:"ChatGPT's own app OAuth credentials cannot be automatically reused by this separate OpenAI Platform agent. This catalog does not grant live access to external stores."};
 }
 if(name==="arya_database_summary"){
  const db=database(process.env.DATABASE_URL);
  const sql="SELECT 'arya_messages' AS name, count(*)::int AS rows, max(message_time) AS latest FROM public.arya_messages UNION ALL SELECT 'arya_outbound_messages',count(*)::int,max(created_at) FROM public.arya_outbound_messages UNION ALL SELECT 'arya_approvals',count(*)::int,max(created_at) FROM public.arya_approvals UNION ALL SELECT 'arya_audit',count(*)::int,max(created_at) FROM public.arya_audit UNION ALL SELECT 'arya_operations_snapshots',count(*)::int,max(retrieved_at) FROM public.arya_operations_snapshots";
  return {checkedAt:new Date().toISOString(),tables:await q(db,sql),notice:"Historical DB rows do not represent the complete current WhatsApp Web chat history."};
 }
 if(name==="arya_recent_records"){
  const kind=args?.kind,limit=Number(args?.limit||5);
  if(!["messages","outbound","audit"].includes(kind)||!Number.isInteger(limit)||limit<1||limit>15)throw Error("invalid_arguments");
  const db=database(process.env.DATABASE_URL);
  const queries={
   messages:"SELECT message_time AS time,message_type AS kind,body FROM public.arya_messages ORDER BY message_time DESC LIMIT "+limit,
   outbound:"SELECT created_at AS time,status,body FROM public.arya_outbound_messages ORDER BY created_at DESC LIMIT "+limit,
   audit:"SELECT created_at AS time,action,actor,entity_id FROM public.arya_audit ORDER BY created_at DESC LIMIT "+limit
  };
  const rows=await q(db,queries[kind]);
  return {kind,rows:rows.map(item=>{const out={...item};if(typeof out.body==="string")out.body=mask(out.body.slice(0,700));if(out.entity_id)out.entity_id=mask(out.entity_id);return out}),privacy:"Phone numbers and email addresses masked; no raw WhatsApp Web browsing or messages sent."};
 }
 if(name==="arya_coordination_schema"){
  const db=database(process.env.DERS_COORD_DATABASE_URL);
  const rows=await q(db,"SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema='public' ORDER BY table_name LIMIT 80");
  return {checkedAt:new Date().toISOString(),tables:rows,note:"Schema inventory only, no student records."};
 }
 if(name==="arya_repository_read"){
  const path=args?.path;
  if(!FILES.has(path))throw Error("file_not_permitted");
  const url="https://api.github.com/repos/onurqlp/arya/contents/"+path.split("/").map(encodeURIComponent).join("/")+"?ref="+encodeURIComponent(BRANCH);
  const r=await fetch(url,{headers:{Accept:"application/vnd.github.raw+json","User-Agent":"AYDA-PRIME-readonly"},cache:"no-store",signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error("github_file_unavailable");
  const payload=await r.text();
  return {path,source:url,content:payload.slice(0,10500),truncated:payload.length>10500};
 }
 throw Error("unknown_tool");
}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 res.setHeader("Access-Control-Allow-Origin","none");
 if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({error:"method_not_allowed"})}
 const token=process.env.AYDA_PRIME_READONLY_MCP_TOKEN;
 const header=req.headers.authorization||"";
 if(!token||!safeEqual(header,"Bearer "+token)){res.setHeader("WWW-Authenticate","Bearer");return res.status(401).json({error:"unauthorized"})}
 const request=req.body;
 if(!request||typeof request!=="object"||Array.isArray(request))return fail(res,null,-32700,"invalid_request");
 const {jsonrpc,id,method,params={}}=request;
 if(jsonrpc!=="2.0"||typeof method!=="string")return fail(res,id??null,-32600,"invalid_request");
 if(id===undefined||id===null)return res.status(202).end();
 if(method==="initialize")return send(res,id,{protocolVersion:MCP_VERSION,capabilities:{tools:{listChanged:false}},serverInfo:{name:"ayda-prime-arya-readonly",version:"1.0.0"},instructions:"All tools are read-only. Never infer that local WhatsApp Web chat history is archived in this service."});
 if(method==="ping")return send(res,id,{});
 if(method==="tools/list")return send(res,id,{tools:TOOLS});
 if(method!=="tools/call")return fail(res,id,-32601,"method_not_found");
 if(!params||typeof params.name!=="string")return fail(res,id,-32602,"invalid_params");
 const tool=TOOLS.find(t=>t.name===params.name);
 if(!tool)return fail(res,id,-32602,"unknown_tool");
 try{
  const data=await dispatch(tool.name,params.arguments||{});
  const text=JSON.stringify(data);
  return send(res,id,{content:[{type:"text",text:text.slice(0,22000)}],isError:false});
 }catch(error){
  const known=new Set(["database_not_configured","invalid_arguments","file_not_permitted","github_file_unavailable","health_unavailable","repository_or_path_not_permitted"]);
  const message=known.has(error?.message)?error.message:"read_unavailable";
  return send(res,id,{content:[{type:"text",text:JSON.stringify({error:message})}],isError:true});
 }
}

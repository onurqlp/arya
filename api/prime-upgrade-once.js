
import { timingSafeEqual } from "node:crypto";
const AID="agent_6b01cbb2cc848191879bfefb6f76759b";
const SID="sess_0f95a175f16159a6806b01da677570819391c25e406c71637c";
const URL="https://arya-whatsapp-panel.vercel.app/api/prime-readonly-mcp";
const ROOT="https://api.openai.com/v1";
const REQUIRE=["arya_system_status","arya_store_catalog","arya_database_summary","arya_recent_records","arya_coordination_schema","arya_repository_read","ayda_project_inventory","ayda_public_repo_browse","ayda_public_repo_read"];
function eq(a,b){if(typeof a!=="string"||typeof b!=="string")return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
async function call(url,method,body,headers){
 const r=await fetch(url,{method,headers,cache:"no-store",body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(18000)});
 const j=await r.json().catch(()=>({}));
 return {status:r.status,ok:r.ok,json:j};
}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="POST"||!eq(req.headers["x-prime-probe-token"],process.env.AYDA_PRIME_SMOKE_TOKEN))return res.status(404).json({error:"not_found"});
 const k=process.env.AYDA_PRIME_OPENAI_API_KEY;
 const mcpKey=process.env.AYDA_PRIME_READONLY_MCP_TOKEN;
 if(!k||!mcpKey)return res.status(503).json({error:"missing_env"});
 const h={Authorization:"Bearer "+k,"OpenAI-Beta":"agents=v1","Content-Type":"application/json"};
 const mh={Authorization:"Bearer "+mcpKey,"Content-Type":"application/json",Accept:"application/json, text/event-stream"};
 try{
  const action=req.body?.action;
  if(action==="test"){
   const tools=await call(URL,"POST",{jsonrpc:"2.0",id:1,method:"tools/list",params:{}},mh);
   const catalog=await call(URL,"POST",{jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"ayda_project_inventory",arguments:{}}},mh);
   const browse=await call(URL,"POST",{jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"ayda_public_repo_browse",arguments:{repo:"ayda-hoca-panel"}}},mh);
   return res.status(200).json({toolsHttp:tools.status,toolNames:(tools.json.result?.tools||[]).map(t=>t.name),catalogHttp:catalog.status,catalogOk:!catalog.json.result?.isError,catalogExcerpt:String(catalog.json.result?.content?.[0]?.text||"").slice(0,1000),browseHttp:browse.status,browseOk:!browse.json.result?.isError,browseExcerpt:String(browse.json.result?.content?.[0]?.text||"").slice(0,700)});
  }
  if(action==="setup"){
   const [agent,session,list]=await Promise.all([
    call(ROOT+"/agents/"+AID,"GET",null,h),
    call(ROOT+"/agents/sessions/"+SID,"GET",null,h),
    call(URL,"POST",{jsonrpc:"2.0",id:1,method:"tools/list",params:{}},mh)
   ]);
   if(!agent.ok||!session.ok||!list.ok)return res.status(502).json({error:"initial_read_failed",statuses:[agent.status,session.status,list.status]});
   const available=(list.json.result?.tools||[]).map(t=>t.name);
   if(!REQUIRE.every(n=>available.includes(n)))return res.status(502).json({error:"missing_expected_mcp_tools",available});
   const repl=(arr)=>Array.isArray(arr)?arr.map(t=>t.type==="mcp"&&t.server_label==="arya_readonly"?{...t,allowed_tools:REQUIRE}:t):[];
   const agentTools=repl(agent.json.tools),sessionTools=repl(session.json.agent?.tools||agent.json.tools);
   const a=await call(ROOT+"/agents/"+AID,"POST",{tools:agentTools},h);
   const b=await call(ROOT+"/agents/sessions/"+SID,"POST",{agent:{tools:sessionTools}},h);
   return res.status(200).json({agentHttp:a.status,sessionHttp:b.status,agentLabels:(a.json.tools||[]).map(t=>({type:t.type,label:t.server_label,allowedCount:t.allowed_tools?.length})),sessionLabels:(b.json.agent?.tools||[]).map(t=>({type:t.type,label:t.server_label,allowedCount:t.allowed_tools?.length})),error:a.ok&&b.ok?null:"configuration_failed"});
  }
  if(action==="agent_test"){
   const msg="AYDA PRIME: Yalnızca okuma yap. arya_readonly sunucusunda ayda_project_inventory ve ayda_public_repo_browse (repo: ayda-hoca-panel) araçlarını çağır. Bulduğun Vercel/Neon/Supabase proje sayılarını ve GitHub dosya adlarını raporla. Envanterin bağlantı yetkisi anlamına gelmediğini açıkça belirt. Hiçbir yazma, mesaj gönderme veya dağıtım yapma.";
   const r=await call(ROOT+"/agents/sessions/"+SID+"/events","POST",{events:[{type:"agent.session.input.message",input:[{role:"user",content:[{type:"input_text",text:msg}]}]}]},{...h,"Idempotency-Key":"e47b098a-ed78-48a6-87c7-dd1341387a79"});
   return res.status(200).json({status:r.status,accepted:r.status===202});
  }
  if(action==="result"){
   const [s,items]=await Promise.all([call(ROOT+"/agents/sessions/"+SID,"GET",null,h),call(ROOT+"/agents/sessions/"+SID+"/items?order=desc&limit=40","GET",null,h)]);
   return res.status(200).json({sessionStatus:s.json.status,latest:(items.json.data||[]).filter(x=>x.type==="message"&&x.role==="assistant").slice(0,3).map(x=>({id:x.id,status:x.status,text:(x.content||[]).map(v=>v.text||"").join("\n").slice(0,4000)}))});
  }
  return res.status(400).json({error:"invalid_action"});
 }catch(e){return res.status(502).json({error:"upstream_error",kind:e.name})}
}


import { timingSafeEqual } from "node:crypto";

const AID="agent_6b01cbb2cc848191879bfefb6f76759b";
const SID="sess_0f95a175f16159a6806b01da677570819391c25e406c71637c";
const VID="vault_6b01d9c53c9c819188ee80f7c5ce8759";
const MCP_URL="https://arya-whatsapp-panel.vercel.app/api/prime-readonly-mcp";
const OAI="https://api.openai.com/v1";
const TOOL_NAMES=["arya_system_status","arya_store_catalog","arya_database_summary","arya_recent_records","arya_coordination_schema","arya_repository_read"];
function eq(a,b){if(typeof a!=="string"||typeof b!=="string")return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 const secret=process.env.AYDA_PRIME_SMOKE_TOKEN;
 if(req.method!=="POST"||!secret||!eq(req.headers["x-prime-probe-token"],secret))return res.status(404).json({error:"not_found"});
 const mcpKey=process.env.AYDA_PRIME_READONLY_MCP_TOKEN;
 const key=process.env.AYDA_PRIME_OPENAI_API_KEY;
 if(!mcpKey||!key)return res.status(503).json({error:"credentials_not_configured"});
 const headers={Authorization:"Bearer "+key,"OpenAI-Beta":"agents=v1","Content-Type":"application/json"};
 const base={Authorization:"Bearer "+mcpKey,"Content-Type":"application/json","Accept":"application/json, text/event-stream"};
 async function call(url,method,body,h=headers){
  const r=await fetch(url,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(18000)});
  const j=await r.json().catch(()=>({}));
  return {status:r.status,ok:r.ok,json:j};
 }
 try{
  const action=req.body?.action;
  if(action==="test"){
   const health=await call(MCP_URL,"POST",{jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"AYDA-PRIME-probe",version:"1.0"}}},base);
   const list=await call(MCP_URL,"POST",{jsonrpc:"2.0",id:2,method:"tools/list",params:{}},base);
   const sample=await call(MCP_URL,"POST",{jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"arya_database_summary",arguments:{}}},base);
   return res.status(200).json({initialize:health.status,tools:list.status,toolNames:(list.json.result?.tools||[]).map(x=>x.name),sampleStatus:sample.status,sampleError:sample.json?.result?.isError||false,sampleSummary:String(sample.json?.result?.content?.[0]?.text||"").slice(0,1100)});
  }
  if(action==="setup"){
   const test=await call(MCP_URL,"POST",{jsonrpc:"2.0",id:2,method:"tools/list",params:{}},base);
   if(!test.ok||!TOOL_NAMES.every(n=>(test.json.result?.tools||[]).some(t=>t.name===n)))return res.status(502).json({error:"mcp_unhealthy",mcpHttp:test.status});
   const current=await Promise.all([call(OAI+"/agents/"+AID,"GET"),call(OAI+"/agents/sessions/"+SID,"GET"),call(OAI+"/vaults/"+VID+"/credentials?limit=60","GET")]);
   if(current.some(c=>!c.ok))return res.status(502).json({error:"read_current_failed",statuses:current.map(c=>c.status)});
   const agent=current[0].json,session=current[1].json;
   const credentials=current[2].json.data||[];
   let cred=credentials.find(c=>c.auth?.mcp_server_url===MCP_URL);
   let created=false;
   if(!cred){
    const newCred=await call(OAI+"/vaults/"+VID+"/credentials","POST",{name:"AYDA PRIME - ARYA read-only tools",auth:{type:"static_bearer",mcp_server_url:MCP_URL,token:mcpKey}});
    if(!newCred.ok)return res.status(502).json({error:"vault_credential_failed",http:newCred.status,detail:String(newCred.json.error?.message||"").slice(0,200)});
    cred=newCred.json;created=true;
   }
   const mcp={type:"mcp",server_label:"arya_readonly",transport:{type:"http",server_url:MCP_URL},connection_origin:"service",required:false,credential_id:cred.id,allowed_tools:TOOL_NAMES};
   const withTool=arr=>[...(Array.isArray(arr)?arr:[]).filter(t=>t.type!=="mcp"||t.server_label!=="arya_readonly"),mcp];
   const sessionTools=withTool(session.agent?.tools||agent.tools);
   const oldVaults=Array.isArray(session.vault_ids)?session.vault_ids:[];
   const updatedVaults=[...new Set([...oldVaults,VID])];
   const sessionResult=await call(OAI+"/agents/sessions/"+SID,"POST",{agent:{tools:sessionTools},vault_ids:updatedVaults});
   if(!sessionResult.ok)return res.status(502).json({error:"session_update_failed",http:sessionResult.status,detail:String(sessionResult.json.error?.message||"").slice(0,220)});
   const agentResult=await call(OAI+"/agents/"+AID,"POST",{tools:withTool(agent.tools)});
   if(!agentResult.ok)return res.status(502).json({error:"agent_update_failed",http:agentResult.status,detail:String(agentResult.json.error?.message||"").slice(0,220)});
   return res.status(200).json({done:true,credentialCreated:created,credentialId:cred.id,sessionHttp:sessionResult.status,agentHttp:agentResult.status,sessionTools:(sessionResult.json.agent?.tools||[]).map(t=>({type:t.type,label:t.server_label})),agentTools:(agentResult.json.tools||[]).map(t=>({type:t.type,label:t.server_label})),vaultIds:sessionResult.json.vault_ids});
  }
  if(action==="verify"){
   const x=await Promise.all([call(OAI+"/agents/"+AID,"GET"),call(OAI+"/agents/sessions/"+SID,"GET")]);
   return res.status(200).json({statuses:x.map(z=>z.status),agentTools:(x[0].json.tools||[]).map(t=>({type:t.type,label:t.server_label})),sessionTools:(x[1].json.agent?.tools||[]).map(t=>({type:t.type,label:t.server_label})),vaultCount:(x[1].json.vault_ids||[]).length,sessionStatus:x[1].json.status});
  }
  if(action==="agent_test"){
   const text="AYDA PRIME: Yeni arya_readonly MCP bağlantını fiilen test et. Önce arya_system_status, ardından arya_database_summary araçlarını çağır. Yalnızca oku, hiçbir veriyi değiştirme, hiçbir mesaj gönderme. Başarılı/başarısız sonucu kısa raporla; yerel WhatsApp Web sohbetleri bulutta saklanmıyor.";
   const r=await call(OAI+"/agents/sessions/"+SID+"/events","POST",{events:[{type:"agent.session.input.message",input:[{role:"user",content:[{type:"input_text",text}]}]}]},{...headers,"Idempotency-Key":"5d75056b-2dfe-4d60-9ee9-58ce7e2bdc85"});
   return res.status(200).json({accepted:r.status===202,status:r.status,error:r.ok?null:String(r.json.error?.message||"").slice(0,200)});
  }
  if(action==="result"){
   const r=await call(OAI+"/agents/sessions/"+SID+"/items?order=desc&limit=70","GET");
   const items=(r.json.data||[]).filter(x=>x.type==="message"&&x.role==="assistant");
   return res.status(200).json({status:r.status,latest:items.slice(0,3).map(x=>({id:x.id,status:x.status,text:(x.content||[]).map(p=>p.text||"").filter(Boolean).join("\n").slice(0,4000)}))});
  }
  return res.status(400).json({error:"invalid_action"});
 }catch(e){return res.status(502).json({error:"upstream_unavailable",type:e?.name||"error"})}
}

import { timingSafeEqual } from "node:crypto";
function equal(a,b){
 if(typeof a!=="string"||typeof b!=="string") return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 const token=process.env.AYDA_PRIME_SMOKE_TOKEN;
 if(req.method!=="GET"||!token||!equal(req.headers["x-prime-probe-token"],token)) return res.status(404).json({error:"not_found"});
 const key=process.env.AYDA_PRIME_OPENAI_API_KEY;
 const sid=process.env.AYDA_PRIME_SESSION_ID;
 if(!key||!sid)return res.status(503).json({error:"not_configured"});
 const hdr={Authorization:"Bearer "+key,"OpenAI-Beta":"agents=v1",Accept:"application/json"};
 try{
  const root="https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(sid);
  const [sessionResponse,itemsResponse,agentResponse]=await Promise.all([
   fetch(root,{headers:hdr,cache:"no-store",signal:AbortSignal.timeout(15000)}),
   fetch(root+"/items?order=desc&limit=50",{headers:hdr,cache:"no-store",signal:AbortSignal.timeout(15000)}),
   fetch("https://api.openai.com/v1/agents/agent_6b01cbb2cc848191879bfefb6f76759b",{headers:hdr,cache:"no-store",signal:AbortSignal.timeout(15000)})
  ]);
  const s=await sessionResponse.json().catch(()=>({}));
  const items=await itemsResponse.json().catch(()=>({}));
  const saved=await agentResponse.json().catch(()=>({}));
  const tools=arr=>(Array.isArray(arr)?arr:[]).map(t=>({type:t.type,server_label:t.server_label,connection_origin:t.connection_origin,required:t.required,server_url:t.transport?.server_url,credential_id:t.credential_id}));
  const all=Array.isArray(items.data)?items.data:[];
  const extract=(item)=>{
   const c=Array.isArray(item.content)?item.content:[];
   const t=c.map(v=>v?.text&&typeof v.text==="string"?v.text:
    v?.type==="text"&&typeof v?.text?.value==="string"?v.text.value:"").filter(Boolean).join("\n");
   return {id:item.id,type:item.type,role:item.role,status:item.status,text:t.slice(0,10000)};
  };
  return res.status(200).json({
   sessionHttp:sessionResponse.status,itemsHttp:itemsResponse.status,
   id:s.id,agentId:s.agent_id||s.agent?.id||null,status:s.status,
   count:all.length,items:all.slice(0,30).map(extract),agentConfigHttp:agentResponse.status,savedAgentTools:tools(saved.tools),sessionTools:tools(s.agent?.tools),sessionVaultCount:s.vault_ids?.length??null
  });
 }catch(e){return res.status(502).json({error:e?.name==="TimeoutError"?"timeout":"upstream_error"});}
}

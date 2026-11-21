import { timingSafeEqual } from "node:crypto";
function equal(a,b){
 if(typeof a!=="string"||typeof b!=="string") return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 const token=process.env.AYDA_PRIME_SMOKE_TOKEN;
 if(!["GET","POST"].includes(req.method)||!token||!equal(req.headers["x-prime-probe-token"],token)) return res.status(404).json({error:"not_found"});
 const key=process.env.AYDA_PRIME_OPENAI_API_KEY;
 const sid=process.env.AYDA_PRIME_SESSION_ID;
 if(!key||!sid)return res.status(503).json({error:"not_configured"});
 const hdr={Authorization:"Bearer "+key,"OpenAI-Beta":"agents=v1",Accept:"application/json"};

 if(req.method==="POST"){
  const mcp={type:"mcp",server_label:"ayda_n8n",transport:{type:"http",server_url:"https://ayda.app.n8n.cloud/mcp-server/http"},
   connection_origin:"service",credential_id:"credential_fdb9ce6e6d0d406f9e00f39fd5ff673cd4a28662da8e4f10b8",required:false};
  const tools=[{type:"web_search"},mcp];
  const vaultIds=["vault_6b01d9c53c9c819188ee80f7c5ce8759"];
  async function change(url,body){
   const r=await fetch(url,{method:"POST",headers:{...hdr,"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(25000)});
   const j=await r.json().catch(()=>({}));
   return {status:r.status,tools:(Array.isArray(j?.agent?.tools)?j.agent.tools:Array.isArray(j?.tools)?j.tools:[]).map(t=>({type:t.type,server_label:t.server_label})),vault_ids:j.vault_ids||[],error:r.ok?null:(j?.error?.message||JSON.stringify(j.error||j).slice(0,750))};
  }
  const sessionPatch=await change("https://api.openai.com/v1/agents/sessions/"+encodeURIComponent(sid),{agent:{tools},vault_ids:vaultIds});
  if(sessionPatch.status!==200)return res.status(200).json({sessionPatch,agentPatch:null});
  const agentPatch=await change("https://api.openai.com/v1/agents/agent_6b01cbb2cc848191879bfefb6f76759b",{tools});
  return res.status(200).json({sessionPatch,agentPatch});
 }

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
  const vaultResponse=await fetch("https://api.openai.com/v1/vaults?limit=30",{headers:hdr,cache:"no-store",signal:AbortSignal.timeout(12000)}).catch(()=>null);
  const vaultData=await vaultResponse?.json().catch(()=>({}))||{};
  const vaultList=Array.isArray(vaultData.data)?vaultData.data:[];
  const vaults=await Promise.all(vaultList.slice(0,10).map(async v=>{
    try{
      const r=await fetch("https://api.openai.com/v1/vaults/"+encodeURIComponent(v.id)+"/credentials?limit=30",{headers:hdr,signal:AbortSignal.timeout(12000),cache:"no-store"});
      const body=await r.json().catch(()=>({}));
      return {id:v.id,name:v.name,status:v.status,http:r.status,credentials:(Array.isArray(body.data)?body.data:[]).map(c=>({id:c.id,name:c.name,auth_type:c.auth?.type,server_url:c.auth?.mcp_server_url||c.server_url||c.auth?.server_url||null,metadata:c.metadata||null}))};
    }catch{return {id:v.id,name:v.name,error:"cannot_list"}}
  }));
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
   count:all.length,items:all.slice(0,30).map(extract),agentConfigHttp:agentResponse.status,savedAgentTools:tools(saved.tools),sessionTools:tools(s.agent?.tools),sessionVaultCount:s.vault_ids?.length??null,vaultsHttp:vaultResponse?.status||0,vaults
  });
 }catch(e){return res.status(502).json({error:e?.name==="TimeoutError"?"timeout":"upstream_error"});}
}

import { safeEqual } from "../lib/auth.js";
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const expected=process.env.AYDA_PRIME_SMOKE_TOKEN;
  if(!["GET","POST"].includes(req.method)||!expected||!safeEqual(req.headers["x-prime-probe-token"],expected)){
    return res.status(404).json({error:"not_found"});
  }
  const key=process.env.AYDA_PRIME_OPENAI_API_KEY;
  const session=process.env.AYDA_PRIME_SESSION_ID;
  const agent="agent_6b01cbb2cc848191879bfefb6f76759b";
  if(!key||!session)return res.status(200).json({configured:false});
  const headers={"Authorization":"Bearer "+key,"OpenAI-Beta":"agents=v1","Accept":"application/json"};
  async function check(url){
    try{
      const response=await fetch(url,{headers,signal:AbortSignal.timeout(12000),cache:"no-store"});
      const content=await response.json().catch(()=>({}));
      return {status:response.status,data:content};
    }catch(e){return {status:0,error:e?.name==="TimeoutError"?"timeout":"network_error"};}
  }
  const root="https://api.openai.com/v1/agents/sessions";
  if(req.method==="POST"){
    const response=await fetch(root+"/"+encodeURIComponent(session)+"/events",{
      method:"POST",headers:{...headers,"Content-Type":"application/json","Idempotency-Key":"86d9599f-5902-4a19-ab7c-860807abdd54"},
      body:JSON.stringify({events:[{type:"agent.session.input.message",input:[{role:"user",content:[{type:"input_text",text:"AYDA PRIME bağlantı testi: Lütfen yalnızca 'AYDA PRIME bağlantısı çalışıyor.' yaz."}]}]}]}),
      signal:AbortSignal.timeout(15000),cache:"no-store"
    }).catch(()=>null);
    return res.status(200).json({sendStatus:response?.status||0});
  }
  const results=await Promise.all([check(root+"/"+encodeURIComponent(session)),check(root+"?agent_id="+encodeURIComponent(agent)+"&limit=20")]);
  const selected=results[0].data;
  const items=await check(root+"/"+encodeURIComponent(session)+"/items?order=desc&limit=10");
  const latest=(Array.isArray(items.data?.data)?items.data.data:[])
    .filter(x=>x?.type==="message")
    .map(x=>({role:x.role,text:Array.isArray(x.content)?x.content.filter(c=>typeof c.text==="string").map(c=>c.text).join(" "):""}))
    .filter(x=>x.text).slice(0,3);
  const sessions=Array.isArray(results[1].data?.data)?results[1].data.data:[];
  return res.status(200).json({
    configured:true,
    itemsStatus:items.status,
    latestMessages:latest,
    sessionCheckStatus:results[0].status,
    sessionStatus:selected?.status||null,
    listedStatus:results[1].status,
    matchingSessions:sessions.map(s=>({id:s.id,status:s.status,agentId:s.agent_id||s.agent?.id||null})),
    hasMore:!!results[1].data?.has_more
  });
}

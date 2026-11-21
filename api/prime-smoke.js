import { safeEqual } from "../lib/auth.js";
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  const expected=process.env.AYDA_PRIME_SMOKE_TOKEN;
  if(req.method!=="GET"||!expected||!safeEqual(req.headers["x-prime-probe-token"],expected)){
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
  const results=await Promise.all([check(root+"/"+encodeURIComponent(session)),check(root+"?agent_id="+encodeURIComponent(agent)+"&limit=20")]);
  const selected=results[0].data;
  const sessions=Array.isArray(results[1].data?.data)?results[1].data.data:[];
  return res.status(200).json({
    configured:true,
    sessionCheckStatus:results[0].status,
    sessionStatus:selected?.status||null,
    listedStatus:results[1].status,
    matchingSessions:sessions.map(s=>({id:s.id,status:s.status,agentId:s.agent_id||s.agent?.id||null})),
    hasMore:!!results[1].data?.has_more
  });
}

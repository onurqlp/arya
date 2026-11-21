import { safeEqual } from "../lib/auth.js";
import { runMindCycle } from "../lib/prime-mind.js";
export const maxDuration = 60;
export default async function handler(req,res) {
 res.setHeader("Cache-Control","no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"method_not_allowed"})}
 const key=process.env.CRON_SECRET;
 if(!key||!safeEqual(req.headers.authorization||"","Bearer "+key))return res.status(401).json({error:"unauthorized"});
 const result=await runMindCycle();
 return res.status(result.status==="failed"?503:200).json({
   status:result.status,cycleKey:result.cycleKey,
   id:result.status==="completed"?result.id:undefined,
   error:result.status==="failed"?result.error:undefined
 });
}

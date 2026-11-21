import { timingSafeEqual } from "node:crypto";
import { runMindCycle } from "../lib/prime-mind.js";
export const maxDuration=60;
function equal(a,b){if(typeof a!=="string"||typeof b!=="string")return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 const key=process.env.AYDA_PRIME_SMOKE_TOKEN;
 if(req.method!=="POST"||!key||!equal(req.headers["x-prime-probe-token"],key))return res.status(404).json({error:"not_found"});
 try{const r=await runMindCycle();return res.status(r.status==="failed"?503:200).json(r)}
 catch{return res.status(503).json({error:"brain_test_unavailable"})}
}

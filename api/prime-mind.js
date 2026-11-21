import { requireAdmin } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { BRAIN_VERSION } from "../lib/prime-mind.js";

export default async function handler(req,res) {
 res.setHeader("Cache-Control","private, no-store");
 res.setHeader("X-Content-Type-Options","nosniff");
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"method_not_allowed"})}
 if(!requireAdmin(req,res))return;
 try {
  const db=getDb();
  const rows=await db.query(
   "SELECT id,cycle_key,created_at,completed_at,state,model,focus,title,observation,idea,recommended_action,uncertainty,priority,evidence,error_code FROM public.prime_mind_journal ORDER BY created_at DESC LIMIT 80"
  );
  return res.status(200).json({
   ready:true,engine:"AYDA PRIME bağımsız zihin günlüğü",version:BRAIN_VERSION,
   mode:"autonomous_scheduled",readOnly:true,
   description:"Görüntülenen metinler modelin bağımsız döngülerde ürettiği açık analiz/karar notlarıdır, gizli iç muhakeme veya sürekli bilinç akışı değildir.",
   entries:rows
  });
 } catch {
  return res.status(503).json({error:"mind_journal_unavailable"});
 }
}

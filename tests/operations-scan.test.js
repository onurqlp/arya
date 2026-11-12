import test from 'node:test';
import assert from 'node:assert/strict';
const scan=await import('../lib/operations-scan.js').catch(()=>({}));
function ready(){assert.equal(typeof scan.runScan,'function','Scheduled snapshot scanner is not implemented');}
function dbFixture(){
  const rows=new Map();let writes=0;
  return { rows,get writes(){return writes;},async query(sql,args=[]){
    if(sql.startsWith('CREATE TABLE')){writes++;return [];}
    if(sql.startsWith('INSERT INTO arya_operations_snapshots')){
      writes++;rows.set(args[0],{kind:args[0],state:args[1],attempted_at:args[2],retrieved_at:args[3],payload:JSON.parse(args[4]),connection_hash:args[5]});return [];
    }
    if(sql.startsWith('SELECT'))return rows.has(args[0])?[rows.get(args[0])]:[];
    throw Error('Unexpected query');
  }};
}
const env={ARYA_CRM_READ_URL:'https://crm.aydadil.com/api/arya/read',ARYA_CRM_READ_TOKEN:'test-token'};
const data={version:1,complete:true,coverage:{from:'2026-11-01',to:'2026-11-12'},students:[],groups:[],payments:[]};
test('unconfigured scans do not access any database or source',async()=>{
  ready();const r=await scan.runScan({env:{},getDatabase:()=>{throw Error('must not access db');},read:()=>{throw Error('must not read');}});
  assert.equal(r.state,'waiting_for_connections');
});
test('verified scan stores isolated snapshots and cached query reads do not scan again',async()=>{
  ready();const db=dbFixture();let calls=0;
  await scan.runScan({env,getDatabase:()=>db,read:async kind=>{calls++;return {kind,state:'verified',retrievedAt:'2026-11-12T09:00:00Z',data};}});
  assert.equal(calls,1);
  const cached=await scan.loadSnapshots({env,getDatabase:()=>db,now:new Date('2026-11-12T10:00:00Z')});
  assert.equal(cached.crm.state,'verified');assert.equal(calls,1);assert.equal(cached.course.state,'not_configured');
});
test('stale snapshots are labelled stale and cannot appear current',async()=>{
  ready();const db=dbFixture();await scan.runScan({env,getDatabase:()=>db,read:async()=>({state:'verified',retrievedAt:'2026-11-11T09:00:00Z',data})});
  const r=await scan.loadSnapshots({env,getDatabase:()=>db,now:new Date('2026-11-12T10:00:00Z')});assert.equal(r.crm.state,'stale');
});
test('failed scan state is persisted without exposing or treating old data as verified',async()=>{
  ready();const db=dbFixture();
  await scan.runScan({env,getDatabase:()=>db,read:async()=>({state:'unauthorized'})});
  const r=await scan.loadSnapshots({env,getDatabase:()=>db});assert.equal(r.crm.state,'unauthorized');assert.equal(r.crm.data,undefined);
});
test('a changed source URL or credential requires a new successful scan',async()=>{
  ready();const db=dbFixture();
  await scan.runScan({env,getDatabase:()=>db,read:async()=>({state:'verified',retrievedAt:'2026-11-12T09:00:00Z',data})});
  for(const changed of [{...env,ARYA_CRM_READ_URL:'https://crm.aydadil.com/api/other-read'},{...env,ARYA_CRM_READ_TOKEN:'different-token'}]){
    const r=await scan.loadSnapshots({env:changed,getDatabase:()=>db,now:new Date('2026-11-12T10:00:00Z')});
    assert.equal(r.crm.state,'not_scanned');assert.equal(r.crm.data,undefined);assert.equal(r.crm.retrievedAt,undefined);
  }
});

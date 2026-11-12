import test from 'node:test';
import assert from 'node:assert/strict';

const ops = await import('../lib/operations.js').catch(() => ({}));
const now = new Date('2026-11-12T12:00:00Z');
const student = (id, name) => ({ id, name, active: true, groupIds: ['G1'] });
const group = { id: 'G1', name: 'B1 Kasım', level: 'B1', teacher: 'Hazal', active: true };
const crm = () => ({ version: 1, complete: true, coverage: { from: '2026-11-01', to: '2026-11-12' }, students: [student('S1', 'Ada Yılmaz'),student('S2','Ece Kaya')], groups: [group], payments: [
  { id: 'P1', studentId: 'S1', groupId: 'G1', dueDate: '2026-11-11', remainingMinor: 125000, currency: 'TRY', status: 'open' },
  { id: 'P2', studentId: 'S2', groupId: 'G1', dueDate: '2026-11-12', remainingMinor: 40000, currency: 'TRY', status: 'open' }
] });
const course = () => ({ version: 1, complete: true, coverage: { from: '2026-11-01', to: '2026-11-12' }, students: [student('S1', 'Ada Yılmaz'),student('S2','Ece Kaya')], groups: [group], attendance: [
  { id:'A1', studentId:'S1', groupId:'G1', date:'2026-11-10', status:'absent' },
  { id:'A2', studentId:'S2', groupId:'G1', date:'2026-11-10', status:'unrecorded' },
  { id:'A3', studentId:'S2', groupId:'G1', date:'2026-11-09', status:'excused' }
], homework: [
  { id:'H1', studentId:'S1', groupId:'G1', date:'2026-11-10', status:'missing' },
  { id:'H2', studentId:'S2', groupId:'G1', date:'2026-11-10', status:'unchecked' },
  { id:'H3', studentId:'S2', groupId:'G1', date:'2026-11-11', status:'submitted' }
] });
const verified = data => ({ state:'verified', retrievedAt:now.toISOString(), data });
function query(input, sources) {
  assert.equal(typeof ops.queryOperations, 'function', 'Operations queries are not implemented');
  return ops.queryOperations(input, sources, now);
}

test('missing CRM returns unavailable, never zero debt', () => {
  const r=query({type:'overdue',search:''},{crm:{state:'not_configured'}});
  assert.equal(r.status,'unavailable'); assert.equal(r.total,null); assert.deepEqual(r.rows,[]);
});
test('due today is not overdue; partial remaining balance stays in minor units',()=>{
  const r=query({type:'overdue',search:''},{crm:verified(crm())});
  assert.equal(r.status,'ready'); assert.equal(r.total,1); assert.deepEqual(r.rows[0],['Ada Yılmaz','B1 Kasım','2026-11-11','1.250,00 TRY']);
});
test('Türkiye date boundary determines overdue day',()=>{
  assert.equal(typeof ops.queryOperations,'function');
  const r=ops.queryOperations({type:'overdue',search:''},{crm:verified(crm())},new Date('2026-11-11T22:00:00Z'));
  assert.equal(r.total,1);
});
test('unrecorded/excused attendance and unchecked/submitted homework are not failures',()=>{
  assert.equal(query({type:'absence',search:''},{course:verified(course())}).total,1);
  assert.equal(query({type:'homework',search:''},{course:verified(course())}).total,1);
});
test('combined query joins canonical IDs, not matching names',()=>{
  const c=course(); c.students[0].id='DIFFERENT'; c.attendance[0].studentId='DIFFERENT'; c.homework[0].studentId='DIFFERENT';
  const r=query({type:'overdue_absence',search:''},{crm:verified(crm()),course:verified(c)});
  assert.equal(r.total,0);
});
test('combined query cannot claim no matches when one source is missing',()=>{
  const r=query({type:'overdue_absence',search:''},{crm:verified(crm()),course:{state:'unavailable'}});
  assert.equal(r.status,'unavailable'); assert.equal(r.total,null);
});
test('duplicate student names ask for a selection',()=>{
  const c=crm(); c.students.push(student('S3','Ada Yılmaz'));
  const r=query({type:'student',search:'ada yılmaz'},{crm:verified(c),course:verified(course())});
  assert.equal(r.status,'needs_selection'); assert.equal(r.total,2); assert.match(r.rows[0][0],/S1/);
});
test('group summary is partial when course is unavailable',()=>{
  const r=query({type:'group',search:'B1'},{crm:verified(crm()),course:{state:'not_configured'}});
  assert.equal(r.status,'partial'); assert.ok(r.rows.some(row=>row[0]==='Aktif öğrenci'&&row[1]==='2'));
  assert.ok(r.rows.some(row=>row[0]==='Devamsızlık kaydı'&&row[1]==='Erişilemiyor'));
});
test('explicit student ID disambiguates and Turkish name search works',()=>{
  const r=query({type:'student',search:'S1'},{crm:verified(crm()),course:verified(course())});
  assert.equal(r.status,'ready'); assert.ok(r.rows.some(row=>row[1]==='Ada Yılmaz'));
});
test('large result sets disclose total and limit rows',()=>{
  const c=crm(); c.payments=Array.from({length:70},(_,i)=>({...c.payments[0],id:'P'+i}));
  const r=query({type:'overdue',search:''},{crm:verified(c)});
  assert.equal(r.total,70); assert.equal(r.rows.length,50); assert.equal(r.truncated,true);
});
test('unknown query and overly long filter are invalid',()=>{
  assert.equal(query({type:'delete',search:''},{}).status,'invalid');
  assert.equal(query({type:'overdue',search:'x'.repeat(121)},{}).status,'invalid');
});

const env={ARYA_CRM_READ_URL:'https://crm.aydadil.com/api/arya/read',ARYA_CRM_READ_TOKEN:'private-test-token'};
async function read(payload,fetcher){
  assert.equal(typeof ops.readSource,'function','Source reader is not implemented');
  return ops.readSource('crm',env,fetcher|| (async()=>new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}})),now);
}
test('source status never reports configuration as verified or leaks secrets',()=>{
  assert.equal(typeof ops.sourceStatus,'function');
  const r=ops.sourceStatus(env); assert.equal(r.crm.state,'configured'); assert.equal(r.course.state,'not_configured');
  assert.ok(!JSON.stringify(r).includes('private-test-token')); assert.ok(!JSON.stringify(r).includes('/api/arya/read'));
});
test('fixed source host blocks SSRF and embedded credentials without a network call',async()=>{
  assert.equal(typeof ops.readSource,'function');
  for(const url of ['https://evil.example/api','http://crm.aydadil.com/api','https://user:pass@crm.aydadil.com/api','https://crm.aydadil.com:444/api']){
    const r=await ops.readSource('crm',{...env,ARYA_CRM_READ_URL:url},()=>{throw Error('must not call');});
    assert.equal(r.state,'invalid_config');
  }
});
test('source fetch sends only GET with no redirect forwarding',async()=>{
  const r=await read(crm(),async(url,options)=>{
    assert.equal(url,'https://crm.aydadil.com/api/arya/read'); assert.equal(options.method,'GET'); assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer private-test-token');
    return new Response(JSON.stringify(crm()),{headers:{'Content-Type':'application/json'}});
  });
  assert.equal(r.state,'verified'); assert.ok(r.retrievedAt);
});
test('incomplete snapshot, impossible date, fractional money and orphan references fail closed',async()=>{
  const incomplete=crm();incomplete.complete=false;
  const badDate=crm();badDate.payments[0].dueDate='2026-02-30';
  const badMoney=crm();badMoney.payments[0].remainingMinor=1.25;
  const orphan=crm();orphan.payments[0].studentId='NO-STUDENT';
  for(const data of [incomplete,badDate,badMoney,orphan]) assert.equal((await read(data)).state,'invalid_response');
});
test('HTML login responses and provider errors expose no raw content',async()=>{
  const a=await read(null,async()=>new Response('<html>secret</html>',{headers:{'Content-Type':'text/html'}}));
  const b=await read(null,async()=>new Response('private provider error',{status:401}));
  assert.equal(a.state,'invalid_response'); assert.equal(b.state,'unauthorized');
  assert.ok(!JSON.stringify([a,b]).includes('secret')); assert.ok(!JSON.stringify([a,b]).includes('private provider'));
});
test('future instalments remain valid in a current payment snapshot',async()=>{
  const c=crm(); c.payments[1].dueDate='2026-12-12';
  assert.equal((await read(c)).state,'verified');
});
test('unneeded source fields are discarded before snapshots can persist them',async()=>{
  const c=crm();c.privateKey='do-not-store';c.students[0].email='private@example.test';
  const r=await read(c);assert.equal(r.state,'verified');assert.equal(r.data.privateKey,undefined);assert.equal(r.data.students[0].email,undefined);
});
test('currencies with incompatible minor units fail closed',async()=>{
  const c=crm();c.payments[0].currency='JPY';assert.equal((await read(c)).state,'invalid_response');
});
test('old source coverage cannot be relabelled as a fresh successful read',async()=>{
  const c=crm();c.coverage={from:'2026-01-01',to:'2026-01-02'};
  const r=await read(c);assert.equal(r.state,'stale');assert.equal(r.data,undefined);assert.equal(r.retrievedAt,undefined);
});
test('literal case-sensitive canonical ID resolves distinct S1 and s1',()=>{
  const c=crm();c.students.push(student('s1','Ada Başka'));
  const r=query({type:'student',search:'s1'},{crm:verified(c)});
  assert.equal(r.status,'partial');assert.ok(r.rows.some(row=>row[1]==='Ada Başka'));
});
test('combined query ties absence to the same student and group as the debt',()=>{
  const c=course();c.groups.push({...group,id:'G2',name:'A2 Kasım'});c.students[0].groupIds.push('G2');c.attendance[0].groupId='G2';
  assert.equal(query({type:'overdue_absence',search:''},{crm:verified(crm()),course:verified(c)}).total,0);
});

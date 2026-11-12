import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { setAdminSession } from '../lib/auth.js';
const mod=await import('../api/admin/operations.js').catch(()=>({}));
const prior={ARYA_ADMIN_PASSWORD:process.env.ARYA_ADMIN_PASSWORD,ARYA_SESSION_SECRET:process.env.ARYA_SESSION_SECRET};
process.env.ARYA_ADMIN_PASSWORD='test-only-password';process.env.ARYA_SESSION_SECRET='test-only-session-secret-at-least-32-chars';
after(()=>{for(const[k,v]of Object.entries(prior))v===undefined?delete process.env[k]:process.env[k]=v;});
function response(){return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
const signed=response();setAdminSession(signed);const cookie=signed.headers['Set-Cookie'].split(';')[0];
async function call(method,headers={},body){
  assert.equal(typeof mod.default,'function','Admin operations endpoint is not implemented');
  const res=response();await mod.default({method,headers:{host:'arya.test',...headers},body},res);return res;
}
test('operations status denies unauthenticated requests',async()=>{
  const r=await call('GET');assert.equal(r.statusCode,401);assert.equal(r.headers['Cache-Control'],'no-store');
});
test('authenticated status works without any database or Meta configuration',async()=>{
  const r=await call('GET',{cookie}); assert.equal(r.statusCode,200);assert.equal(r.body.mode,'read_only');
  assert.equal(r.body.sources.crm.state,'not_configured'); assert.equal(r.body.sources.course.state,'not_configured');
});
test('cross-origin queries are denied even with admin session',async()=>{
  const r=await call('POST',{cookie,origin:'https://evil.example'},{type:'overdue',search:''});assert.equal(r.statusCode,403);
});
test('query returns unavailable with null total, no synthetic production records',async()=>{
  const r=await call('POST',{cookie,origin:'https://arya.test'},{type:'overdue',search:''});
  assert.equal(r.statusCode,200); assert.equal(r.body.status,'unavailable');assert.equal(r.body.total,null);assert.deepEqual(r.body.rows,[]);
});
test('unsupported methods and invalid bodies do not execute a query',async()=>{
  assert.equal((await call('DELETE',{cookie})).statusCode,405);
  assert.equal((await call('POST',{cookie,origin:'https://arya.test'},{type:'delete'})).statusCode,400);
});

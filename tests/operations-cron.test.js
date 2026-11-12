import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/operations-refresh.js';
function response(){return{setHeader(){},status(n){this.code=n;return this;},json(v){this.value=v;}};}
test('scheduled refresh requires cron authorization and never exposes records',async()=>{
  const previous=process.env.CRON_SECRET;process.env.CRON_SECRET='test-only-cron-secret';
  try{
    const denied=response();await handler({method:'GET',headers:{}},denied);assert.equal(denied.code,401);
    const allowed=response();await handler({method:'GET',headers:{authorization:'Bearer test-only-cron-secret'}},allowed);
    assert.equal(allowed.code,200);assert.equal(allowed.value.state,'waiting_for_connections');assert.ok(!JSON.stringify(allowed.value).includes('payload'));
    const wrongMethod=response();await handler({method:'POST',headers:{}},wrongMethod);assert.equal(wrongMethod.code,405);
  }finally{previous===undefined?delete process.env.CRON_SECRET:process.env.CRON_SECRET=previous;}
});

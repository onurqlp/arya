import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountOperations } from '../operations-ui.js';
import handler from '../api/admin/operations.js';
import { setAdminSession } from '../lib/auth.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const emptySources={crm:{state:'not_configured',label:'CRM'},course:{state:'not_configured',label:'Kurs paneli'}};
const status={mode:'read_only',sources:emptySources,schedule:{enabled:true},queries:[{type:'overdue',label:'Geciken ödemeler'},{type:'student',label:'Öğrenci durumu'}]};
function setup(api){
  const dom=new JSDOM('<main id="page"></main>');globalThis.document=dom.window.document;
  const page=document.querySelector('#page');let expired=false;
  const cleanup=mountOperations(page,{api,onUnauthorized:()=>{expired=true;}});
  return {dom,page,cleanup,get expired(){return expired;}};
}
test('UI queries the real admin handler and shows missing connections without invented totals',async()=>{
  const oldPassword=process.env.ARYA_ADMIN_PASSWORD,oldSecret=process.env.ARYA_SESSION_SECRET;
  process.env.ARYA_ADMIN_PASSWORD='test-only';process.env.ARYA_SESSION_SECRET='test-only-long-session-signing-secret';
  const signed={setHeader(k,v){this[k]=v;}};setAdminSession(signed);
  const paths=[];
  const ui=setup(async(path,options={})=>{
    paths.push(path);const response={setHeader(){},status(n){this.code=n;return this;},json(v){this.value=v;}};
    await handler({method:options.method||'GET',headers:{host:'arya.test',origin:'https://arya.test',cookie:signed['Set-Cookie'].split(';')[0]},body:options.body?JSON.parse(options.body):undefined},response);
    assert.equal(response.code,200);return response.value;
  });
  try{
    await tick();assert.equal(ui.page.querySelector('#operationType').disabled,false);
    ui.page.querySelector('form').requestSubmit();await tick();
    assert.match(ui.page.querySelector('#operationsResult').textContent,/bağlantısı hazır değil/);
    assert.equal(ui.page.querySelectorAll('td').length,0);
    ui.page.querySelector('#operationsScan').click();await tick();await tick();
    assert.match(ui.page.querySelector('#operationsResult').textContent,/henüz tanımlanmadı/);
    assert.ok(paths.every(path=>path==='/api/admin/operations'));
  }finally{ui.cleanup();ui.dom.window.close();oldPassword===undefined?delete process.env.ARYA_ADMIN_PASSWORD:process.env.ARYA_ADMIN_PASSWORD=oldPassword;oldSecret===undefined?delete process.env.ARYA_SESSION_SECRET:process.env.ARYA_SESSION_SECRET=oldSecret;}
});
test('provider text is rendered as plain text rather than executable HTML',async()=>{
  const ui=setup(async(_path,options)=>!options?status:{status:'ready',message:'Hazır',columns:['Öğrenci'],rows:[['<img src=x onerror=alert(1)>']],total:1,truncated:false,sources:[]});
  await tick();ui.page.querySelector('form').requestSubmit();await tick();
  assert.equal(ui.page.querySelectorAll('img').length,0);assert.equal(ui.page.querySelector('td').textContent,'<img src=x onerror=alert(1)>');ui.cleanup();ui.dom.window.close();
});
test('a late status response cannot replace another route after cleanup',async()=>{
  let resolve;const ui=setup(()=>new Promise(r=>{resolve=r;}));ui.cleanup();ui.page.textContent='Başka sekme';resolve(status);await tick();
  assert.equal(ui.page.textContent,'Başka sekme');ui.dom.window.close();
});
test('expired admin session returns control to the existing login flow',async()=>{
  const ui=setup(async()=>{const error=new Error();error.code='unauthorized';throw error;});await tick();assert.equal(ui.expired,true);ui.cleanup();ui.dom.window.close();
});

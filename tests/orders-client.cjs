'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto').webcrypto;
const {createClient}=require('../checkout-client.js');
function storage(seed={}){const data=new Map(Object.entries(seed));return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),data}}
const payload=()=>({kind:'order',name:'Локальный тест',phone:'79990000000',items:[{id:'balloon-bouquet-violet-wishes',quantity:2,expectedPriceKopecks:250000}]});
const saved={ok:true,saved:true,orderNumber:'ZT-0123456789ABCDEF',replayed:false};
const response=(status,body)=>({ok:status>=200&&status<300,status,text:async()=>typeof body==='string'?body:JSON.stringify(body)});
test('network ambiguity: same key after reload, basket preserved, no contacts persisted',async()=>{
 const s=storage({'zt:cart':JSON.stringify({'balloon-bouquet-violet-wishes':2})});const keys=[];
 const fetch=async(url,options)=>{keys.push(options.headers['Idempotency-Key']);if(keys.length===1)throw Error('offline');return response(200,saved)};
 await assert.rejects(createClient({storage:s,fetch,crypto}).submit(payload()),{code:'NETWORK'});
 assert.equal(JSON.parse(s.getItem('zt:cart'))['balloon-bouquet-violet-wishes'],2);
 assert.ok(!s.getItem('zt:checkout-pending-v1').includes('79990000000'));
 const client=createClient({storage:s,fetch,crypto});await client.submit(payload());
 assert.equal(keys[0],keys[1]);assert.deepEqual(client.settleCart().cart,{});
});
test('HTTP 503 and malformed HTTP 200 never acknowledge or clear basket',async()=>{
 for(const r of [response(503,{ok:false}),response(200,'<html>broken</html>'),response(200,{ok:true}),response(200,{ok:true,saved:true,orderNumber:'bad'})]){
  const s=storage({'zt:cart':'{"rose":3}'}),client=createClient({storage:s,fetch:async()=>r,crypto});
  await assert.rejects(client.submit(payload()));assert.equal(s.getItem('zt:cart'),'{"rose":3}');
  assert.throws(()=>client.settleCart(),{code:'NOT_SAVED'});
 }
});
test('rapid duplicate submits perform one request',async()=>{
 let calls=0;const client=createClient({storage:storage(),crypto,fetch:async()=>{calls++;await new Promise(r=>setTimeout(r,15));return response(201,saved)}});
 await Promise.all([client.submit(payload()),client.submit(payload())]);assert.equal(calls,1);
});
test('unresolved request cannot be replaced silently with another order',async()=>{
 let calls=0;const client=createClient({storage:storage(),crypto,fetch:async()=>{calls++;throw Error('timeout')}});
 await assert.rejects(client.submit(payload()));
 await assert.rejects(client.submit({...payload(),name:'Другие данные'}),{code:'PENDING'});assert.equal(calls,1);
});
test('definitive validation rejection permits correction without clearing basket',async()=>{
 const s=storage({'zt:cart':'{"rose":3}'});let calls=0;
 const client=createClient({storage:s,crypto,fetch:async()=>++calls===1?response(422,{ok:false,saved:false,code:'INVALID_FIELDS',message:'Проверьте поля'}):response(201,saved)});
 await assert.rejects(client.submit(payload()),{code:'INVALID_FIELDS'});
 assert.equal(s.getItem('zt:checkout-pending-v1'),null);assert.equal(s.getItem('zt:cart'),'{"rose":3}');
 await client.submit({...payload(),name:'Исправлено'});
});
test('erased request after network ambiguity stops retry and requires a fresh explicit submit',async()=>{
 const s=storage({'zt:cart':'{"rose":3}'}),keys=[];
 const client=createClient({storage:s,crypto,fetch:async(url,options)=>{
  keys.push(options.headers['Idempotency-Key']);
  if(keys.length===1)throw Error('lost response');
  if(keys.length===2)return response(409,{ok:false,saved:false,code:'REQUEST_ERASED',message:'Заявка удалена'});
  return response(201,saved);
 }});
 await assert.rejects(client.submit(payload()),{code:'NETWORK'});
 await assert.rejects(client.submit(payload()),{code:'REQUEST_ERASED',uncertain:false});
 assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
 assert.equal(s.getItem('zt:checkout-pending-v1'),null);assert.equal(s.getItem('zt:cart'),'{"rose":3}');
 await client.submit(payload());assert.equal(keys.length,3);assert.notEqual(keys[1],keys[2]);
});
test('denied durable storage stops before network',async()=>{
 let calls=0;const s=storage();s.setItem=()=>{throw Error('storage denied')};
 await assert.rejects(createClient({storage:s,crypto,fetch:async()=>{calls++;return response(201,saved)}}).submit(payload()));assert.equal(calls,0);
});
test('successful inquiry does not consume basket',async()=>{
 const s=storage({'zt:cart':'{"rose":3}'}),client=createClient({storage:s,crypto,fetch:async()=>response(201,saved)});
 await client.submit({...payload(),kind:'inquiry',items:[]});assert.deepEqual(client.settleCart().cart,{rose:3});
});
test('cart write interruption recovers without subtracting twice',async()=>{
 const s=storage({'zt:cart':JSON.stringify({'balloon-bouquet-violet-wishes':4,rose:1})});
 let fail=true;const remove=s.removeItem;s.removeItem=k=>{if(fail)throw Error('interrupted');remove(k)};
 const client=createClient({storage:s,crypto,fetch:async()=>response(201,saved)});
 await client.submit(payload());assert.throws(()=>client.settleCart());fail=false;
 const restored=createClient({storage:s,crypto,fetch:async()=>{throw Error('unexpected network')}});
 assert.deepEqual(restored.settleCart().cart,{'balloon-bouquet-violet-wishes':2,rose:1});
});
test('timeout retains key and cart',async()=>{
 const s=storage({'zt:cart':'{"rose":1}'});
 const fetch=async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));
 await assert.rejects(createClient({storage:s,crypto,fetch,timeoutMs:10}).submit(payload()),{code:'NETWORK'});
 assert.equal(s.getItem('zt:cart'),'{"rose":1}');assert.ok(s.getItem('zt:checkout-pending-v1'));
});

test('different simultaneous payload is not acknowledged as the first order',async()=>{let calls=0;const client=createClient({storage:storage(),crypto,fetch:async()=>{calls++;await new Promise(r=>setTimeout(r,20));return response(201,saved)}});const first=client.submit(payload());await assert.rejects(client.submit({...payload(),name:'Другая заявка'}),{code:'BUSY'});await first;assert.equal(calls,1)});

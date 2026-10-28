const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'bot');
function load(file, deps, globals = {}) {
 const module = { exports: {} };
 vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
  module, require: name => { if (name === 'crypto') return require('crypto'); if (!(name in deps)) throw Error('Unexpected dependency ' + name); return deps[name]; },
  console: { log(){}, warn(){}, error(){} }, Buffer, URL, URLSearchParams, AbortSignal, Blob, FormData, ...globals
 }, {filename:file});
 return module.exports;
}
const config = {groupId:'123',webhookSecret:'secret',confirmationToken:'confirm',botToken:'token',apiVersion:'5.199',siteBaseUrl:'https://example.com',ownerChatId:'99',adminChatIds:['99']};
function webhookEnv() {
 const seen=new Set(), updates=[],answers=[];
 const store={hasProcessedEvent:async id=>seen.has(id),markProcessedEvent:async id=>seen.add(id)};
 const bot={handleUpdate:async u=>updates.push(u)};
 const webhook=load('src/vkWebhook.js',{'./config':config,'./bot':bot,'./store':store,'./vkApi':{answerEvent:async e=>answers.push(e)}});
 return {webhook,updates,answers,bot};
}
function event(type='message_new') {
 return {type,group_id:123,secret:'secret',event_id:'evt1',object:type==='message_event'?{user_id:99,peer_id:99,event_id:'click1',payload:{command:'admin:hit',issuedAt:Math.floor(Date.now()/1000)}}:{message:{id:7,date:Math.floor(Date.now()/1000),from_id:99,peer_id:99,text:'Начать',attachments:[]}}};
}
test('VK confirmation, secret, group ID, unsupported events',async()=>{
 const {webhook,updates}=webhookEnv();
 assert.equal((await webhook.handle(event('confirmation'))).body,'confirm');
 assert.equal((await webhook.handle({...event(),secret:'wrong'})).status,403);
 assert.equal((await webhook.handle({...event(),group_id:124})).status,403);
 assert.equal((await webhook.handle(event('wall_post_new'))).body,'ok');
 assert.equal(updates.length,0);
});
test('legacy menu buttons remain usable without issuance or age requirements',async()=>{
 const env=webhookEnv(),e=event('message_event');delete e.object.payload.issuedAt;
 await env.webhook.handle(e);await env.webhook.handle(e);
 assert.equal(env.updates.length,1);
 const old=event('message_event');old.object.event_id='another-click';old.object.payload.issuedAt=1;
 await env.webhook.handle(old);assert.equal(env.updates.length,2);
});
test('VK message normalization selects largest photo, ignores outgoing messages and conversations',()=>{
 const {webhook}=webhookEnv(),e=event();
 e.object.message.attachments=[{type:'photo',photo:{sizes:[{width:10,height:10,url:'https://small'},{width:100,height:100,url:'https://large'}]}}];
 const u=webhook.normalize(e);
 assert.equal(u.user_id,99);assert.equal(u.message.body.attachments[0].payload.url,'https://large');
 assert.equal(u.message.body.mid,7);
 e.object.message.out=1;assert.equal(webhook.normalize(e),null);
 e.object.message.out=0;e.object.message.peer_id=2000000001;assert.equal(webhook.normalize(e),null);
});
test('VK callback acknowledges, parses JSON payload, deduplicates completed events',async()=>{
 const {webhook,updates,answers}=webhookEnv(),e=event('message_event');
 e.object.payload=JSON.stringify(e.object.payload);
 await webhook.handle(e);await webhook.handle(e);
 assert.equal(updates.length,1);assert.equal(updates[0].callback_data,'admin:hit');assert.equal(answers.length,2);
});
test('failed event can be retried instead of being discarded as a duplicate',async()=>{
 const env=webhookEnv();let attempts=0;
 env.bot.handleUpdate=async()=>{if(++attempts===1)throw Error('network');};
 await assert.rejects(env.webhook.handle(event()),/network/);
 assert.equal((await env.webhook.handle(event())).body,'ok');assert.equal(attempts,2);
});
test('the same VK message with a changed delivery envelope is not processed twice',async()=>{
 const env=webhookEnv();await env.webhook.handle(event());
 await env.webhook.handle({...event(),event_id:'new-envelope'});
 assert.equal(env.updates.length,1);assert.equal(env.updates[0].message.body.mid,7);
});
test('VK text keyboard payload is normalized as a command',()=>{
 const {webhook}=webhookEnv(),e=event();e.object.message.payload=JSON.stringify({command:'admin:menu'});
 assert.equal(webhook.normalize(e).callback_data,'admin:menu');
 e.object.message.payload='{invalid';assert.equal(webhook.normalize(e).update_type,'message_created');
});
test('VK API encodes token in POST, limits keyboard rows, splits long messages',async()=>{
 const calls=[];
 const api=load('src/vkApi.js',{'./config':config},{fetch:async(url,options)=>{calls.push({url,params:Object.fromEntries(options.body)});return{ok:true,json:async()=>({response:1})};}});
 const rows=Array.from({length:23},(_,i)=>[api.callbackButton('Товар '+i,'pick:'+i)]);
 await api.sendMessage({userId:99},'А'.repeat(8000),rows);
 assert.equal(calls.length,6);assert.ok(calls.every(c=>!c.url.includes('token')&&c.params.access_token==='token'));
 assert.ok(calls.every(c=>Array.from(c.params.message).length<=3500));
 const keyboards=calls.filter(c=>c.params.keyboard).map(c=>JSON.parse(c.params.keyboard));
 assert.deepEqual(keyboards.map(k=>k.buttons.length),[6,6,6,5]);
 assert.equal(JSON.parse(keyboards[0].buttons[0][0].action.payload).command,'pick:0');
});
test('VK API treats HTTP 200 with an error as failure',async()=>{
 const api=load('src/vkApi.js',{'./config':config},{fetch:async()=>({ok:true,json:async()=>({error:{error_code:5,error_msg:'Unauthorized'}})})});
 await assert.rejects(api.sendMessage({userId:99},'hello'),/VK API 5/);
});
test('VK photo uses upload server, multipart, saveMessagesPhoto and attachment',async()=>{
 const calls=[];
 const api=load('src/vkApi.js',{'./config':config},{fetch:async(url,options)=>{
  calls.push({url:String(url),options});
  if(String(url)==='https://example.com/photo.jpg')return{ok:true,headers:new Headers({'content-type':'image/jpeg'}),body:[Buffer.from('jpeg')]};
  if(url==='https://upload.example')return{ok:true,json:async()=>({server:1,photo:'photo-data',hash:'hash'})};
  if(url.endsWith('photos.getMessagesUploadServer'))return{ok:true,json:async()=>({response:{upload_url:'https://upload.example'}})};
  if(url.endsWith('photos.saveMessagesPhoto'))return{ok:true,json:async()=>({response:[{owner_id:-123,id:4,access_key:'key'}]})};
  return{ok:true,json:async()=>({response:1})};
 }});
 assert.equal((await api.sendPhotoUrlMessage({userId:99},'Photo',null,'photo.jpg')).ok,true);
 assert.ok(calls[2].options.body instanceof FormData);
 assert.equal(calls[0].options.signal,calls[1].options.signal);
 assert.equal(calls[0].options.signal,calls[2].options.signal);
 assert.equal(calls[0].options.signal,calls[3].options.signal);
 assert.equal(calls.at(-1).options.body.get('attachment'),'photo-123_4_key');
});
test('HTTP handler returns plain VK responses, rejects bad JSON and wrong methods, waits for processing',async()=>{
 let processed=false;
 const {handler}=load('index.js',{'./src/config':config,'./src/siteRelay':{},'./src/vkWebhook':{handle:async()=>{await new Promise(resolve=>setTimeout(resolve,5));processed=true;return{status:200,body:'ok'};}}});
 assert.equal((await handler({httpMethod:'POST',body:'null'})).statusCode,400);
 assert.equal((await handler({httpMethod:'POST',body:'{'})).statusCode,400);
 assert.equal((await handler({httpMethod:'PUT'})).statusCode,405);
 const r=await handler({httpMethod:'POST',isBase64Encoded:true,body:Buffer.from(JSON.stringify(event())).toString('base64')});
 assert.equal(r.body,'ok');assert.match(r.headers['Content-Type'],/text\/plain/);assert.equal(processed,true);
});
test('VK owner starts admin menu, non-owner cannot invoke admin buttons',async()=>{
 const sessions={},sent=[],menus=[];
 const store={getSession:async id=>sessions[id]||{step:'idle'},setSession:async(id,s)=>sessions[id]=s,clearSession:async id=>delete sessions[id]};
 const bot=load('src/bot.js',{'./config':config,'./store':store,'./notify':{normalizePhone:s=>s},'./admin':{sendMenu:async id=>menus.push(id),isAdminStep:()=>false},'./vkApi':{callbackButton:()=>({}),sendMessage:async(target,text)=>sent.push(text)}});
 const {webhook}=webhookEnv();await bot.handleUpdate(webhook.normalize(event()));assert.deepEqual(menus,[99]);
 const e=event('message_event');e.object.user_id=5;e.object.peer_id=5;
 await bot.handleUpdate(webhook.normalize(e));assert.deepEqual(menus,[99]);
});
test('phone normalization never truncates an invalid long number',()=>{
 const notify=load('src/notify.js',{'./config':config,'./store':{},'./vkApi':{},'./products':{}});
 assert.equal(notify.normalizePhone('8 (999) 123-45-67'),'79991234567');
 assert.equal(notify.normalizePhone('9991234567'),'79991234567');
 assert.equal(notify.normalizePhone('799912345678'),'799912345678');
});

test('VM HTTP server serves health and VK webhook without third-party packages',async()=>{
 const server=load('server.js',{'http':require('node:http'),'./src/config':config,'./index':{handler:async event=>({statusCode:200,headers:{'Content-Type':'text/plain'},body:JSON.parse(event.body).type==='confirmation'?'confirm':'ok'})}},{URL});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const url='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(url+'/health')).status,200);
  assert.equal((await fetch(url+'/missing')).status,404);
  const response=await fetch(url+'/webhook/vk',{method:'POST',body:JSON.stringify({type:'confirmation'})});
  assert.equal(await response.text(),'confirm');
  assert.equal((await fetch(url+'/webhook/vk',{method:'POST',body:'x'.repeat(1024*1024+1)})).status,413);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

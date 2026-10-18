const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'../bot');
const cfg={ownerChatId:'99',botToken:'TEST',siteRelaySecret:'a'.repeat(64),adminChatIds:['99'],groupId:'123',webhookSecret:'SECRET',
 s3:{bucket:'private',accessKey:'test',secretKey:'test'}};
function load(file,deps){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{
 module,Buffer,URL,console:{log(){},warn(){},error(){}},require:n=>n==='crypto'?require('crypto'):deps[n]
},{filename:file});return module.exports;}
const relay=load('src/siteRelay.js',{'./config':cfg,'./objectStorage':{},'./vkApi':{}});
const data={type:'site.lead.saved',notificationId:'1',orderNumber:'ZT-1234567890ABCDEF',recipientId:'99',randomId:123,message:'Заявка ZT-1234567890ABCDEF\nТовары из корзины\nБукет × 2'};
test('relay authorization: missing, wrong, duplicate headers rejected',()=>{
 assert.equal(relay.authorized({},cfg.siteRelaySecret),false);
 assert.equal(relay.authorized({'X-Relay-Key':'bad'},cfg.siteRelaySecret),false);
 assert.equal(relay.authorized({'X-Relay-Key':cfg.siteRelaySecret,'x-relay-key':cfg.siteRelaySecret},cfg.siteRelaySecret),false);
 assert.equal(relay.authorized({'X-Relay-Key':cfg.siteRelaySecret},cfg.siteRelaySecret),true);
});
test('strict relay payload rejects contacts, photos, wrong identity, excessive message',async()=>{
 for(const v of [{...data,phone:'79990000000'},{...data,images:[]},{...data,randomId:0},{...data,message:'x'.repeat(5000)}])
  assert.equal((await relay.deliver(v,{config:cfg})).status,400);
 assert.equal((await relay.deliver({...data,recipientId:'88'},{config:cfg})).status,409);
});
test('receipt makes retry idempotent and has no contacts or message',async()=>{
 let receipt=null,sends=0;
 const deps={config:cfg,read:async()=>receipt,write:async(k,v)=>{receipt=v;return true},send:async p=>{sends++;assert.equal(p.random_id,123);assert.equal(p.peer_id,'99');return 42}};
 const first=await relay.deliver(data,deps),second=await relay.deliver({...data},deps);
 assert.equal(first.body.delivered,true);assert.equal(second.body.messageId,42);assert.equal(sends,1);
 assert.deepEqual(Object.keys(receipt).sort(),['createdAt','hash','messageId']);
 assert.equal((await relay.deliver({...data,message:data.message+' changed'},deps)).status,409);
});
test('VK error and receipt failure do not acknowledge delivery; same random_id reused',async()=>{
 let calls=[];
 assert.equal((await relay.deliver(data,{config:cfg,read:async()=>null,send:async()=>{throw Error('VK 6')}})).status,503);
 const deps={config:cfg,read:async()=>null,write:async()=>false,send:async p=>{calls.push(p);return 42}};
 assert.equal((await relay.deliver(data,deps)).status,503);
 assert.equal((await relay.deliver(data,deps)).status,503);
 assert.equal(calls[0].random_id,calls[1].random_id);
});
test('missing storage fails before VK, S3 outage returns retryable error',async()=>{
 let sends=0;
 assert.equal((await relay.deliver(data,{config:{...cfg,s3:{}},send:async()=>sends++})).status,503);
 assert.equal(sends,0);
 assert.equal((await relay.deliver(data,{config:cfg,read:async()=>{throw Error('offline')}})).status,503);
});
test('HTTP entry rejects unauthorized relay and closes legacy public phone endpoint',async()=>{
 const handler=load('index.js',{'./src/config':cfg,'./src/siteRelay':{...relay,deliver:async()=>({status:200,body:{ok:true,delivered:true}})},'./src/vkWebhook':{handle:async()=>({status:200,body:'ok'})}}).handler;
 assert.equal((await handler({httpMethod:'POST',body:JSON.stringify(data)})).statusCode,403);
 const r=await handler({httpMethod:'POST',headers:{'X-Relay-Key':cfg.siteRelaySecret},body:JSON.stringify(data)});
 assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).delivered,true);
 const old=await handler({httpMethod:'POST',body:JSON.stringify({phone:'79990000000'})});
 assert.equal(old.statusCode,410);assert.equal(old.headers['Access-Control-Allow-Origin'],undefined);
});
test('customer VK messages do not touch storage, reply, or answer events',async()=>{
 const webhook=load('src/vkWebhook.js',{'./config':cfg,'./bot':{handleUpdate:async()=>{throw Error('must not run')}},'./store':{hasProcessedEvent:async()=>{throw Error('must not run')}},'./vkApi':{answerEvent:async()=>{throw Error('must not run')}}});
 assert.equal((await webhook.handle({group_id:123,secret:'SECRET',type:'message_new',object:{message:{from_id:5,peer_id:5,id:1,text:'Начать'}}})).body,'ok');
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const number='ZT-1234567890ABCDEF';
function env(){
 const config={adminChatIds:['99','88'],siteBaseUrl:'https://shop.test',regInboxUrl:'https://shop.test/api/v1/bot-inbox.php',regInboxSecret:'a'.repeat(64)};
 const sent=[],requests=[];
 let status=200;
 const detail={number,type:'Товары из корзины',createdAt:'20.10.2026 15:40 (Пермь)',subject:'Корзина',name:'Тест',
  fields:[{label:'Телефон',value:'79990000001'},{label:'Пожелания / вопрос',value:'Белые цветы'}],previousRequests:2,
  items:[{name:'Розы',quantity:2,category:'Розы',description:'5 роз',note:'Упаковка',priceLabel:'от 1000 ₽',photos:['https://shop.test/assets/catalog/test.jpg','https://shop.test/assets/catalog/second.jpg']},
  {name:'Шары',quantity:1,photos:[]}]};
 const vk={callbackButton:(text,payload)=>({text,payload}),sendMessage:async(target,text,rows)=>{sent.push({target,text,rows});return{ok:true};},
  sendPhotoUrlMessage:async(target,text,rows,photo)=>{sent.push({target,text,rows,photo});return{ok:true};}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../bot/src/inbox.js'),'utf8'),{module,require:n=>({'./config':config,'./vkApi':vk})[n],URL,Buffer,AbortSignal,
  fetch:async(url,opts)=>{requests.push({url:String(url),opts});return new Response(JSON.stringify(new URL(url).searchParams.has('number')?{ok:true,request:detail}:
   {ok:true,items:Array.from({length:4},()=>({number,type:'Вопрос',name:'Тест',subject:'Цветы',createdAt:detail.createdAt})),hasMore:true}),{status});}});
 return{inbox:module.exports,config,sent,requests,detail,vk,setStatus:v=>status=v};
}
test('non-admin cannot read or navigate; secret never enters URL and redirects refused',async()=>{
 const e=env();await e.inbox.list('1');await e.inbox.handle('1','inbox:open:'+number);assert.equal(e.requests.length,0);
 await e.inbox.list('99');const r=e.requests[0];assert.equal(r.opts.headers['X-ZT-Viewer-ID'],'99');
 assert.equal(r.opts.headers['X-ZT-Inbox-Key'],e.config.regInboxSecret);assert.equal(r.url.includes(e.config.regInboxSecret),false);assert.equal(r.opts.redirect,'error');
 e.config.regInboxUrl='https://foreign.test/api/v1/bot-inbox.php';await e.inbox.list('99');assert.equal(e.requests.length,1);
});
test('four requests per page, working callback navigation, no site-panel links',async()=>{
 const e=env();await e.inbox.list('99',4);
 const m=e.sent[0];assert.match(m.text,/5\. Вопрос/);assert.equal(m.rows.length,6);
 assert.equal(m.rows[0][0].payload,'inbox:open:'+number+':4');assert.ok(m.rows.flat().some(b=>b.payload==='admin:leads:8'));
 assert.ok(m.rows.flat().every(b=>!b.link));
});
test('detail contains all submitted fields, local time, repeat evidence and product buttons',async()=>{
 const e=env();await e.inbox.handle('99','inbox:open:'+number+':4');
 const m=e.sent[0];for(const s of ['79990000001','Белые цветы','Пермь','Повторное обращение','ранее заявок','не подтверждает'])assert.ok(m.text.includes(s),s);
 assert.ok(m.rows.flat().some(b=>b.payload==='inbox:item:'+number+':0:0:4'));
 e.detail.previousRequests=0;await e.inbox.open('99',number);assert.match(e.sent.at(-1).text,/среди сохранённых/);
 e.detail.previousRequests=null;await e.inbox.open('99',number);assert.doesNotMatch(e.sent.at(-1).text,/Первое обращение/);
});
test('product photo/quantity/category and per-photo navigation; failures retain details',async()=>{
 const e=env();await e.inbox.handle('99','inbox:item:'+number+':0:1:4');
 const m=e.sent[0];assert.equal(m.photo,e.detail.items[0].photos[1]);assert.match(m.text,/Количество: 2 шт/);assert.match(m.text,/от 1000 ₽/);
 assert.ok(m.rows.flat().some(b=>b.payload==='inbox:item:'+number+':1:0:4'));
 e.vk.sendPhotoUrlMessage=async()=>({ok:false});await e.inbox.open('99',number,0);assert.match(e.sent.at(-1).text,/Фото временно/);
 e.detail.items[0].photos=['https://foreign.test/x.jpg'];await e.inbox.open('99',number,0);assert.equal(e.sent.at(-1).photo,undefined);
});
test('stale/malformed buttons cannot select an absent item or expose erased data',async()=>{
 const e=env();await e.inbox.handle('99','inbox:item:'+number+':999:0:0');assert.equal(e.sent.length,0);
 await e.inbox.handle('99','inbox:item:'+number+':-1:0:0');assert.equal(e.requests.length,1);
 e.setStatus(404);await e.inbox.open('99',number);assert.match(e.sent.at(-1).text,/очищены/);assert.doesNotMatch(e.sent.at(-1).text,/79990000001/);
});

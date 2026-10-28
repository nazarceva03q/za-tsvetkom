import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
export async function runInboxHttp(php,root,lab) {
 php.mkdirTree('/public/api/v1');
 php.writeFile('/public/api/v1/bot-inbox.php',fs.readFileSync(path.join(root,'api/v1/bot-inbox.php')));
 const cfg={...lab,origin:'https://shop.test',bot_inbox:{enabled:true,secret:'a'.repeat(64),viewer_ids:[88]},notifications:{owner_id:99}};
 const set=()=>php.writeFile('/private/config.php','<?php return json_decode(base64_decode("'+Buffer.from(JSON.stringify(cfg)).toString('base64')+'"),true);');set();
 const auth={'X-ZT-Inbox-Key':cfg.bot_inbox.secret,'X-ZT-Viewer-ID':'99'};
 let checks=0;
 async function req(status,method='GET',query='',headers={}) {
  const server={DOCUMENT_ROOT:'/public',HTTPS:'on'};
  for(const [k,v] of Object.entries(headers))server['HTTP_'+k.toUpperCase().replaceAll('-','_')]=v;
  const r=await php.run({scriptPath:'/public/api/v1/bot-inbox.php',relativeUri:'/api/v1/bot-inbox.php'+query,method,headers,$_SERVER:server,env:{ZT_ORDERS_PRIVATE_DIR:'/private'}});
  assert.equal(r.errors,'',r.text);assert.equal(r.httpStatusCode,status,r.text);checks++;
  assert.equal(r.headers['access-control-allow-origin'],undefined);
  assert.ok(!r.text.includes(cfg.bot_inbox.secret));return JSON.parse(r.text);
 }
 await req(403);await req(403,'GET','?secret='+cfg.bot_inbox.secret);
 await req(403,'GET','',{'X-ZT-Inbox-Key':'wrong','X-ZT-Viewer-ID':'99'});
 await req(403,'GET','',{...auth,'X-ZT-Viewer-ID':'77'});
 await req(405,'POST','',auth);await req(405,'DELETE','',auth);
 await req(422,'GET','?offset=-1',auth);await req(422,'GET','?number=invalid',auth);
 await req(422,'GET','?offset[]=0',auth);await req(422,'GET','?extra=1',auth);
 const list=await req(200,'GET','',auth);assert.ok(Array.isArray(list.items));assert.ok(list.items.length<=4);
 await req(200,'GET','',{...auth,'X-ZT-Viewer-ID':'88'});
 await req(404,'GET','?number=ZT-0000000000000000',auth);
 if(list.items.length){const d=await req(200,'GET','?number='+list.items[0].number,auth);
  for(const field of ['idempotency_key','request_hash','consent_text_sha256','password','product_snapshot'])assert.equal(JSON.stringify(d).includes(field),false,field);}
 cfg.bot_inbox.enabled=false;set();await req(403,'GET','',auth);
 console.log('PASS inbox HTTP: '+checks+' actual PHP gateway checks, no external network');
}

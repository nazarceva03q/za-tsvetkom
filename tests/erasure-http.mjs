import fs from 'node:fs';import path from 'node:path';
export async function erasureHttp({php,api,base,request,sql,config,write,sessionCookie,id,number,assert,root}){
 config.erasure={schema_ready:true,copies_schema_ready:true,enabled:true,operator:{name:'Тестовый оператор',address:'Адрес оператора для теста'},actor:{name:'Тестовый ответственный',role:'Оператор'},system:'Изолированная тестовая система',processors:[]};write();
 const copies={orderNumber:number,checkedAt:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),checkedBy:'Тестовый ответственный',reference:'Synthetic fixture only; no external copies',backups:true,exports:true,vk:true,logs:true};
 php.writeFile('/erasure-fixture.json',JSON.stringify({number,copies}));
 let r=await php.run({code:'<?php require "/private/lib/Notifications.php";require "/private/lib/Erasure.php";$c=require "/private/config.php";$v=json_decode(file_get_contents("/erasure-fixture.json"),true);echo json_encode(ZTOrders\\eraseReviewedRequest(ZTOrders\\connect($c),$c,$v["number"],2,$v["copies"]));'});
 if(r.errors||r.exitCode)throw Error(r.errors||r.text);
 const result=JSON.parse(r.text);assert(result.deleted===1,'HTTP fixture explicitly cleared in isolated database');
 r=await api(base,'7'.repeat(64));assert(r.httpStatusCode===409&&r.data.code==='REQUEST_ERASED'&&r.data.saved===false,'actual API rejects erased request retry');
 config.erasure.enabled=false;write();
 r=await api(base,'7'.repeat(64));assert(r.httpStatusCode===409&&r.data.code==='REQUEST_ERASED','replay guard remains active with deletion disabled');
 r=await request({cookie:sessionCookie,query:'?number='+number});assert(r.httpStatusCode===404&&!r.text.includes('Тестовый адрес'),'deleted request unavailable in owner panel');
 r=await request({cookie:sessionCookie,query:'?view=retention'});assert(r.httpStatusCode===200&&!r.text.includes('?id='+id),'deleted request removed from retention list');
 assert((await sql('SELECT id FROM zt_orders WHERE id=?',[id])).length===0,'repeated HTTP payload did not recreate request');
 r=await api(base,'a'.repeat(64));assert(r.httpStatusCode===201&&r.data.saved,'new request with fresh key still works');
 const evidence=(await sql('SELECT evidence FROM zt_erasure_records WHERE order_number=?',[number]))[0].evidence;
 assert(!evidence.includes('79990000011')&&!evidence.includes('Тестовый адрес')&&!evidence.includes('Новинка из Яндекса'),'erasure evidence excludes customer payload');
 fs.writeFileSync(path.join(root,'docs/simplified/evidence/erasure-http.json'),JSON.stringify({checks:8,isolated:true,realCustomerData:false,publicDeletionEndpoint:false,nativeFastCGI:false},null,2));
}

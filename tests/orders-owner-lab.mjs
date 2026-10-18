import fs from 'node:fs';
import path from 'node:path';
export async function runStage2(php,{root,dsn,user,password}){
 const files=['backend/orders/lib/Notifications.php','backend/orders/lib/Owner.php','backend/orders/bin/notify.php','owner/orders.php','backend/orders/config.example.php','backend/orders/migrations/002-owner-notifications.sql','tests/orders-notifications.php'];
 for(const file of files){
  const target='/project/'+file;php.mkdirTree(path.posix.dirname(target));php.writeFile(target,fs.readFileSync(path.join(root,file)));
  if(file.endsWith('.php')){
   const source=Buffer.from(fs.readFileSync(path.join(root,file))).toString('base64');
   const lint=await php.run({code:'<?php token_get_all(base64_decode("'+source+'"),TOKEN_PARSE);'});
   if(lint.errors||lint.exitCode)throw Error(file+lint.errors);
  }
 }
 const lab={dsn,user,password};
 php.writeFile('/project/lab.json',JSON.stringify(lab));
 const result=await php.run({code:'<?php $lab=json_decode(file_get_contents("/project/lab.json"),true);require "/project/tests/orders-notifications.php";'});
 console.log(result.text);
 if(result.errors||result.exitCode)throw Error(result.errors||result.text);
 const config={...lab,origin:'https://shop.test',owner:{enabled:true,username:'owner-test',password_hash:'',secret:'a'.repeat(64)}};
 php.writeFile('/project/config-input.json',JSON.stringify(config));
 let r=await php.run({code:'<?php $c=json_decode(file_get_contents("/project/config-input.json"),true);$c["owner"]["password_hash"]=password_hash("local-test-password",PASSWORD_BCRYPT,["cost"=>4]);file_put_contents("/project/owner-config.json",json_encode($c));'});
 if(r.errors)throw Error(r.errors);
 php.writeFile('/project/owner-entry.php','<?php require "/project/backend/orders/lib/Owner.php";try{ZTOrders\\ownerPage(json_decode(file_get_contents("/project/owner-config.json"),true));}catch(Throwable $e){http_response_code(503);echo "Unavailable";}');
 php.mkdirTree('/public/owner');php.writeFile('/public/owner/orders.php',fs.readFileSync(path.join(root,'owner/orders.php')));php.writeFile('/project/backend/orders/config.php','<?php return json_decode(file_get_contents("/project/owner-config.json"),true);');
 const request=async({method='GET',body='',cookie='',origin='https://shop.test',query='',https='on'}={})=>{
  if(https==='off')return php.run({code:'<?php $_SERVER["HTTPS"]="off";$_SERVER["SERVER_PORT"]="80";require "/public/owner/orders.php";'});
  return php.run({scriptPath:'/public/owner/orders.php',env:{ZT_ORDERS_PRIVATE_DIR:'/project/backend/orders'},relativeUri:'/owner/orders.php'+query,method,body:new TextEncoder().encode(body),headers:{'content-type':'application/x-www-form-urlencoded',cookie,origin},$_SERVER:{HTTPS:https,SERVER_PORT:https==='on'?'443':'80',DOCUMENT_ROOT:'/public',REMOTE_ADDR:'127.0.0.1',HTTP_ORIGIN:origin}});
 };
 const assert=(ok,name)=>{if(!ok)throw Error(name);console.log('PASS '+name)};
 r=await request({https:'off'});console.log('HTTP gate status',r.httpStatusCode);assert(r.httpStatusCode===403,'plain HTTP access denied');
 r=await request({query:'?id=123'});assert(r.httpStatusCode===401&&!r.text.includes('SECRET'),'anonymous cannot view order by id');
 assert(JSON.stringify(r.headers).includes('no-store')&&JSON.stringify(r.headers).includes("frame-ancestors 'none'"),'private gateway security headers');
 const csrf=r.text.match(/name="csrf" value="([a-f0-9]+)"/)[1];
 const headers=r.headers;
 const values=Object.entries(headers).filter(([k])=>k.toLowerCase()==='set-cookie').flatMap(([,v])=>v);
 const loginCookie=values.map(v=>v.split(';')[0]).find(v=>v.startsWith('__Host-zt-login='));
 assert(!!loginCookie,'secure pre-login cookie issued');
 r=await request({method:'POST',cookie:loginCookie,body:'username=owner-test&password=local-test-password&csrf=bad'});
 assert(r.httpStatusCode===403,'invalid CSRF rejected');
 r=await request({method:'POST',cookie:loginCookie,origin:'https://evil.test',body:'username=owner-test&password=local-test-password&csrf='+csrf});
 assert(r.httpStatusCode===403,'foreign origin rejected');
 r=await request({method:'POST',cookie:loginCookie,body:'username=owner-test&password=wrong&csrf='+csrf});
 assert(r.httpStatusCode===401,'wrong password rejected');
 r=await request({method:'POST',cookie:loginCookie,body:'username=owner-test&password=local-test-password&csrf='+csrf});
 assert(r.httpStatusCode===303,'valid owner login');
 const sessionCookie=Object.entries(r.headers).filter(([k])=>k.toLowerCase()==='set-cookie').flatMap(([,v])=>v).map(v=>v.split(';')[0]).find(v=>v.startsWith('__Host-zt-owner='));
 r=await request({cookie:sessionCookie});assert(r.httpStatusCode===200&&r.text.includes('Выйти'),'authenticated order list');
 const id=(await php.run({code:'<?php $c=json_decode(file_get_contents("/project/lab.json"),true);require_once "/project/backend/orders/lib/Notifications.php";echo ZTOrders\\connect($c)->query("SELECT id FROM zt_orders LIMIT 1")->fetchColumn();'})).text;
 await php.run({code:'<?php $c=json_decode(file_get_contents("/project/lab.json"),true);require_once "/project/backend/orders/lib/Notifications.php";$q=ZTOrders\\connect($c)->prepare("UPDATE zt_orders SET comment=? WHERE id=?");$q->execute(["<script>alert(1)</script>",'+JSON.stringify(id)+']);'});
 r=await request({cookie:sessionCookie,query:'?id='+id});assert(r.httpStatusCode===200&&r.text.includes('Телефон')&&r.text.includes('Адрес'),'owner sees full order');
 assert(r.text.includes('&lt;script&gt;')&&!r.text.includes('<script>'),'stored comment XSS escaped');
 const logoutCsrf=r.text.match(/name="csrf" value="([a-f0-9]+)"/)[1];
 r=await request({method:'POST',cookie:sessionCookie,body:'action=logout&csrf='+logoutCsrf});assert(r.httpStatusCode===303,'logout revokes session');
 r=await request({cookie:sessionCookie});assert(r.httpStatusCode===401,'revoked cookie rejected');
 for(let i=0;i<9;i++)r=await request({method:'POST',cookie:loginCookie,body:'username=owner-test&password=wrong&csrf='+csrf});
 assert(r.httpStatusCode===429,'login brute-force limit');
 await php.run({code:'<?php $c=json_decode(file_get_contents("/project/owner-config.json"),true);$c["dsn"]=str_replace("dbname=zt_test_orders_php_review","dbname=zt_test_orders_missing",$c["dsn"]);file_put_contents("/project/owner-config.json",json_encode($c));'});
 r=await request({cookie:sessionCookie});assert(r.httpStatusCode===503,'owner DB outage fails closed');
 fs.writeFileSync(path.join(import.meta.dirname,'stage2-results.json'),JSON.stringify({php:'8.3 WebAssembly',mysql:'8.0.46',worker:result.text,owner:'anonymous, CSRF, origin, wrong password, login, full view, logout, brute force, DB outage passed',vkNetwork:'mock only; no VK messages sent',nativeFastCGI:false},null,2));
}

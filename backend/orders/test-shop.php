<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Cache-Control: no-store, private');header('X-Robots-Tag: noindex, nofollow');header('X-Content-Type-Options: nosniff');header('Referrer-Policy: no-referrer');
try{
 if(($_SERVER['HTTPS']??'')!=='on'&&(string)($_SERVER['SERVER_PORT']??'')!=='443')throw new RuntimeException();
 $main=realpath((string)getenv('ZT_ORDERS_PRIVATE_DIR'));if(!$main||basename($main)!=='private-orders')throw new RuntimeException();
 $private=dirname($main).'/private-orders-test';$c=require $private.'/config.php';
 if(!preg_match('/(?:^|;)dbname=u3685169_ztrestore(?:;|$)/',$c['dsn']??''))throw new RuntimeException();
 require $private.'/lib/Notifications.php';$db=\ZTOrders\connect($c);
 $token=$_COOKIE['__Host-zt-test-owner']??'';$authenticated=false;
 if(is_string($token)&&preg_match('/^[a-f0-9]{64}$/D',$token)){$q=$db->prepare('SELECT token_hash FROM zt_owner_sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP()');$q->execute([hash('sha256',$token)]);$authenticated=(bool)$q->fetchColumn();}
 if(!$authenticated){http_response_code(401);exit('<!doctype html><meta charset="utf-8"><p>Сначала <a href="orders.php">войдите в тестовую панель</a>, затем вернитесь сюда.</p>');}
 $key=file_get_contents($private.'/access.key');if(!is_string($key)||!preg_match('/^[a-f0-9]{64}$/D',$key))throw new RuntimeException();
 if(($_GET['action']??'')==='submit'){
  header('Content-Type: application/json; charset=utf-8');
  if(($_SERVER['REQUEST_METHOD']??'')!=='POST'||!hash_equals($key,(string)($_SERVER['HTTP_X_TEST_KEY']??''))){http_response_code(403);exit('{"ok":false,"saved":false,"code":"TEST_ACCESS_DENIED"}');}
  if((int)($_SERVER['CONTENT_LENGTH']??0)>32768)throw new RuntimeException();
  $input=json_decode(file_get_contents('php://input',false,null,0,32769)?:'',true,32,JSON_THROW_ON_ERROR);
  if(!is_array($input)||($input['name']??'')!=='Вымышленный клиент'||($input['phone']??'')!=='70000000000'||($input['comment']??'')!=='Техническая проверка без реального покупателя'||!in_array($input['address']??'',['','Тестовый адрес'],true)){
   http_response_code(422);exit('{"ok":false,"saved":false,"code":"TEST_FIELDS_ONLY","message":"Используйте только вымышленные данные из инструкции."}');
  }
  require $private.'/lib/Http.php';\ZTOrders\run($private);
 }
 if(($_SERVER['REQUEST_METHOD']??'')!=='GET')throw new RuntimeException();
 $root=realpath((string)($_SERVER['DOCUMENT_ROOT']??''));if(!$root)throw new RuntimeException();
 $html=file_get_contents($root.'/index.html');if(!is_string($html))throw new RuntimeException();
 $bootstrap='<base href="/"><script>(function(){"use strict";const original=window.localStorage,prefix="zt-shop-drill:";const isolated={getItem:k=>original.getItem(prefix+k),setItem:(k,v)=>original.setItem(prefix+k,v),removeItem:k=>original.removeItem(prefix+k)};Object.defineProperty(window,"localStorage",{value:isolated});const send=window.fetch.bind(window),key='.json_encode($key,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).';window.fetch=function(input,options){const u=new URL(typeof input==="string"?input:input.url,location.href);if(u.origin!==location.origin)return Promise.reject(new Error("External request disabled in test"));if(u.pathname==="/api/v1/orders.php"){const h=new Headers(options?.headers||{});h.set("X-Test-Key",key);return send("/owner/test/shop.php?action=submit",{...options,headers:h});}return send(input,options);};})();</script>';
 $html=preg_replace('/<head>/i','<head>'.$bootstrap,$html,1);
 $html=preg_replace('/<iframe\b[^>]*>.*?<\/iframe>/is','',$html);
 // The base URL is needed for storefront assets, but must not send section
 // links (e.g. #balloons) to the live root instead of this test page.
 $html=preg_replace('/href=(["\'])#([^"\']*)\1/i','href="/owner/test/shop.php#$2"',$html);
 $html=str_replace('</head>','<script>document.addEventListener("click",function(e){const a=e.target.closest("a[href]");if(!a)return;const u=new URL(a.href);if(u.origin===location.origin&&u.hash&&(u.pathname==="/"||u.pathname==="/index.html")){e.preventDefault();const target=document.getElementById(decodeURIComponent(u.hash.slice(1)));if(target)target.scrollIntoView();}},true);</script></head>',$html);
 $html=preg_replace('/<body>/i','<body><p class="form-note" role="status">Закрытая проверка. Имя: Вымышленный клиент. Телефон: 70000000000. Комментарий: Техническая проверка без реального покупателя. Адрес доставки: Тестовый адрес. Не вводите настоящие данные.</p>',$html,1);
 header('Content-Type: text/html; charset=utf-8');echo $html;
}catch(Throwable){http_response_code(503);echo 'Закрытая проверка пока недоступна.';}

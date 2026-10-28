<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Cache-Control: no-store, private');header('X-Robots-Tag: noindex, nofollow');header('X-Content-Type-Options: nosniff');header('Referrer-Policy: no-referrer');
$nonce=base64_encode(random_bytes(24));
header("Content-Security-Policy: default-src 'none'; style-src 'self'; script-src 'self' 'nonce-$nonce'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
try{
    if(($_SERVER['HTTPS']??'')!=='on'&&(string)($_SERVER['SERVER_PORT']??'')!=='443')throw new RuntimeException();
    $main=realpath((string)getenv('ZT_ORDERS_PRIVATE_DIR'));if(!$main||basename($main)!=='private-orders')throw new RuntimeException();
    $private=dirname($main).'/private-orders-test';$c=require $private.'/config.php';
    if(!preg_match('/(?:^|;)dbname=u3685169_ztrestore(?:;|$)/',$c['dsn']??''))throw new RuntimeException();
    require $private.'/lib/Notifications.php';$db=\ZTOrders\connect($c);
    $token=$_COOKIE['__Host-zt-test-owner']??'';
    $session=false;
    if(is_string($token)&&preg_match('/^[a-f0-9]{64}$/D',$token)){
        $q=$db->prepare('SELECT token_hash FROM zt_owner_sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP()');$q->execute([hash('sha256',$token)]);$session=(bool)$q->fetchColumn();
    }
    if(!$session){http_response_code(401);echo '<!doctype html><html lang="ru"><meta charset="utf-8"><p>Сначала <a href="orders.php">войдите в тестовую панель</a>, затем вернитесь на эту страницу.</p></html>';exit;}
    $key=file_get_contents($private.'/access.key');if(!is_string($key)||!preg_match('/^[a-f0-9]{64}$/D',$key))throw new RuntimeException();
}catch(Throwable){http_response_code(503);exit('Закрытая проверка пока недоступна.');}
?><!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка отправки — За цветком</title><link rel="stylesheet" href="orders.css"><script src="/checkout-client.js" defer></script></head>
<body><main class="workspace"><header class="masthead"><p class="shop">За цветком</p><h1>Проверка отправки</h1></header>
<section class="detail"><h2>Только вымышленные данные</h2><p>Имя: Вымышленный клиент. Телефон: 70000000000. Текст: техническая проверка без реального покупателя.</p><p>Рабочие заявки и корзина магазина не изменяются. Уведомление из этой тестовой базы автоматически не отправляется.</p>
<form id="test-form"><button type="submit" id="send">Отправить тестовую заявку</button></form>
<p id="result" role="status" aria-live="polite">Готово к проверке.</p><p><a id="view" hidden>Открыть сохранённую заявку</a></p><p><a href="orders.php">Тестовая панель</a></p></section></main>
<script nonce="<?=htmlspecialchars($nonce,ENT_QUOTES)?>">
addEventListener('DOMContentLoaded',()=>{
 const storage={getItem:k=>sessionStorage.getItem('zt-browser-test:'+k),setItem:(k,v)=>sessionStorage.setItem('zt-browser-test:'+k,v),removeItem:k=>sessionStorage.removeItem('zt-browser-test:'+k)};
 const relayKey=<?=json_encode($key,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT)?>;
 const client=ZTCheckoutClient.createClient({storage,crypto,fetch:(_url,options)=>fetch('/owner/form-test.php',{...options,headers:{...options.headers,'X-Test-Key':relayKey}})});
 const button=document.getElementById('send'),status=document.getElementById('result'),link=document.getElementById('view');
 document.getElementById('test-form').addEventListener('submit',async e=>{
  e.preventDefault();button.disabled=true;status.textContent='Сохраняем тестовую заявку…';
  try{
   const r=await client.submit({kind:'inquiry',requestType:'question',subject:'ТЕСТ HTTPS 24.10.2026',name:'Вымышленный клиент',phone:'70000000000',channel:'VK',comment:'Техническая проверка без реального покупателя',consent:true,consentVersion:'2026-10-requests-v2',items:[]});
   status.textContent='Сохранено: '+r.orderNumber+'. Повторное нажатие должно показать тот же номер.';
   link.href='orders.php?number='+encodeURIComponent(r.orderNumber);link.hidden=false;button.textContent='Повторить ту же отправку';
  }catch(error){status.textContent=error.message||'Сохранение не подтверждено. Повторите с теми же данными.';}
  finally{button.disabled=false;}
 });
});
</script></body></html>

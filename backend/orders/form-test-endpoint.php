<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store, private');
header('X-Robots-Tag: noindex, nofollow');header('X-Content-Type-Options: nosniff');
try{
    if(($_SERVER['HTTPS']??'')!=='on'&&(string)($_SERVER['SERVER_PORT']??'')!=='443')throw new RuntimeException();
    if(($_SERVER['REQUEST_METHOD']??'')!=='POST'){http_response_code(405);exit('{"ok":false,"code":"METHOD_NOT_ALLOWED"}');}
    $main=realpath((string)getenv('ZT_ORDERS_PRIVATE_DIR'));
    if(!$main||basename($main)!=='private-orders')throw new RuntimeException();
    $private=dirname($main).'/private-orders-test';
    $keyFile=$private.'/access.key';
    if(is_link($keyFile)||!is_file($keyFile))throw new RuntimeException();
    $key=file_get_contents($keyFile);$given=$_SERVER['HTTP_X_TEST_KEY']??'';
    if(!is_string($key)||!preg_match('/^[a-f0-9]{64}$/D',$key)||!is_string($given)||!hash_equals($key,$given)){
        http_response_code(403);exit('{"ok":false,"code":"TEST_ACCESS_DENIED"}');
    }
    $c=require $private.'/config.php';
    if(!preg_match('/(?:^|;)dbname=u3685169_ztrestore(?:;|$)/',$c['dsn']??'')||($c['notifications']['enabled']??null)!==false)throw new RuntimeException();
    if((int)($_SERVER['CONTENT_LENGTH']??0)>2048)throw new RuntimeException();
    $raw=file_get_contents('php://input',false,null,0,2049);
    $input=json_decode($raw?:'',true,16,JSON_THROW_ON_ERROR);
    $expected=['kind'=>'inquiry','requestType'=>'question','subject'=>'ТЕСТ HTTPS 24.10.2026','name'=>'Вымышленный клиент','phone'=>'70000000000','channel'=>'VK','comment'=>'Техническая проверка без реального покупателя','consent'=>true,'consentVersion'=>'2026-10-requests-v2','items'=>[]];
    // Do not accept real customer input through this temporary route.
    if(!is_array($input)||count($input)!==count($expected))throw new RuntimeException();
    foreach($expected as $k=>$v)if(!array_key_exists($k,$input)||$input[$k]!==$v)throw new RuntimeException();
    if(!preg_match('/^[a-f0-9]{64}$/D',$_SERVER['HTTP_IDEMPOTENCY_KEY']??''))throw new RuntimeException();
    require $private.'/lib/Http.php';\ZTOrders\run($private);
}catch(Throwable){http_response_code(503);echo '{"ok":false,"code":"TEST_NOT_READY"}';}

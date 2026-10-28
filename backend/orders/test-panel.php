<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Cache-Control: no-store, private');header('X-Robots-Tag: noindex, nofollow');
header('X-Content-Type-Options: nosniff');header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
try{
    if(($_SERVER['HTTPS']??'')!=='on'&&(string)($_SERVER['SERVER_PORT']??'')!=='443')throw new RuntimeException();
    $main=realpath((string)getenv('ZT_ORDERS_PRIVATE_DIR'));
    if(!$main||basename($main)!=='private-orders')throw new RuntimeException();
    $private=dirname($main).'/private-orders-test';$config=require $private.'/config.php';
    if(!preg_match('/(?:^|;)dbname=u3685169_ztrestore(?:;|$)/',$config['dsn']??''))throw new RuntimeException();
    // Reuse the normal login checks, with a separate DB and separate cookie names.
    $config['owner']['enabled']=true;
    $ownerSource=file_get_contents($private.'/lib/Owner.php');
    if(!is_string($ownerSource)||!str_contains($ownerSource,'__Host-zt-test-owner')||str_contains($ownerSource,"'__Host-zt-owner'"))throw new RuntimeException();
    require $private.'/lib/Owner.php';\ZTOrders\ownerPage($config);
}catch(Throwable){http_response_code(503);echo 'Тестовая панель пока не готова.';}

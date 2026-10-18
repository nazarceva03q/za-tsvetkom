<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
try {
    $private=dirname(__DIR__); $config=require $private.'/config.php';
    $relay=$config['notifications']??[];
    if (($relay['enabled']??false)!==true) { fwrite(STDERR,"Notifications disabled\n"); exit(2); }
    if (!is_int($relay['owner_id']??null) || $relay['owner_id']<=0 ||
        empty($relay['timezone']) || !extension_loaded('curl') || !extension_loaded('mbstring'))
        throw new RuntimeException('INVALID_RELAY_CONFIG');
    require $private.'/lib/Notifications.php';
    require $private.'/lib/YandexRelay.php';
    $worker=new \ZTOrders\NotificationWorker(\ZTOrders\connect($config),$relay,new \ZTOrders\YandexRelaySender($relay));
    for($i=0;$i<5;$i++) if(!$worker->runOne()) break;
} catch(Throwable $error) {
    fwrite(STDERR,"Notification worker failed: ".get_class($error)."\n"); exit(1);
}

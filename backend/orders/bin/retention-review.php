<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require_once __DIR__.'/../lib/Notifications.php';
require_once __DIR__.'/../lib/RetentionReview.php';
try {
    if(array_slice($argv,1)!==[])throw new RuntimeException('NO_ARGUMENTS_ALLOWED');
    $config=require __DIR__.'/../config.php';
    $result=\ZTOrders\retentionReview(\ZTOrders\connect($config),null,($config['retention_review']['enabled']??false)===true);
    echo json_encode($result,JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES).PHP_EOL;
}catch(Throwable){fwrite(STDERR,"RETENTION_REVIEW_FAILED: check private configuration and schema.\n");exit(1);}

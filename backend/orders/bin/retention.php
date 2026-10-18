<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require_once __DIR__.'/../lib/Notifications.php';
require_once __DIR__.'/../lib/Workflow.php';
try {
    $config=require __DIR__.'/../config.php';$policy=$config['retention']??[];
    $args=array_slice($argv,1);
    if($args!==[]&&$args!==['--apply'])throw new RuntimeException('ARGS');
    $db=\ZTOrders\connect($config);
    $ids=\ZTOrders\retentionCandidates($db,$policy);
    echo 'ELIGIBLE_COUNT='.count($ids).PHP_EOL;
    if($args===[]){echo 'DRY_RUN_ONLY'.PHP_EOL;exit;}
    if(($policy['enabled']??false)!==true||($policy['backup_procedure_approved']??false)!==true)throw new RuntimeException('APPROVAL_REQUIRED');
    $count=0;foreach($ids as $id)if(\ZTOrders\eraseClosedRequest($db,$policy,$id))$count++;
    echo 'CLEARED_COUNT='.$count.PHP_EOL;
}catch(Throwable){fwrite(STDERR,"RETENTION_NOT_COMPLETED: check approved policy, schema and private configuration.\n");exit(1);}

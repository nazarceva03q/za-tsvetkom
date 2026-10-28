<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require_once __DIR__.'/../lib/Notifications.php';
require_once __DIR__.'/../lib/RestoreGuard.php';
try {
    $config=require __DIR__.'/../config.php';$args=array_slice($argv,1);$g=$config['restore_guard']??[];
    if($args===[]){echo json_encode(['mode'=>'RESTORE_GUARD_NOT_STARTED','deleted'=>0,'requires'=>'separate_unpublished_database_and_current_external_ledger'],JSON_THROW_ON_ERROR).PHP_EOL;exit;}
    if(count($args)!==2||!in_array($args[0],['--preview','--apply'],true)||!preg_match('/^[a-f0-9]{64}$/D',$args[1]))throw new RuntimeException('ARGS');
    $file=__DIR__.'/../restore-ledger.json';
    if(is_link($file)||!is_file($file)||filesize($file)>16777216||((fileperms($file)&0077)!==0))throw new RuntimeException('PRIVATE_EXTERNAL_LEDGER_REQUIRED');
    $ledger=\ZTOrders\validateRestoreLedger(file_get_contents($file),$args[1]);
    $target=$g['target_database']??'';
    if(!is_string($target)||!preg_match('/^[a-zA-Z0-9_]{1,64}$/D',$target))throw new RuntimeException('RESTORE_TARGET_REQUIRED');
    $dsn=$config['dsn']??'';
    if(!is_string($dsn)||!preg_match('/(?:^|;)dbname=([a-zA-Z0-9_]+)(?:;|$)/',$dsn,$m)||strcasecmp($m[1],$target)===0)throw new RuntimeException('RESTORE_TARGET_MUST_BE_SEPARATE');
    $targetConfig=$config;$targetConfig['dsn']=preg_replace('/(^|;)dbname=[a-zA-Z0-9_]+(?=;|$)/','$1dbname='.$target,$dsn,1);
    $db=\ZTOrders\connect($targetConfig);
    $result=\ZTOrders\filterRestoredRequests($db,$config,$ledger,$args[0]==='--apply');
    echo json_encode($result,JSON_THROW_ON_ERROR).PHP_EOL;
}catch(Throwable){fwrite(STDERR,"RESTORE_FILTER_NOT_COMPLETED: verify separate target, current external ledger/hash, schema and private settings.\n");exit(1);}

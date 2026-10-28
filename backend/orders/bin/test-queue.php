<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
$mode=$argv[1]??'';
if($argc!==2||!in_array($mode,['--simulate-failure','--send-retry','--status'],true)){echo "Use --simulate-failure, --send-retry or --status; staging fixture only.\n";exit;}
try{
    $private=dirname(__DIR__);$config=require $private.'/config.php';
    require_once $private.'/lib/Notifications.php';
    require_once $private.'/lib/RestoreGuard.php';
    require_once $private.'/lib/YandexRelay.php';
    $target=$config['restore_guard']['target_database']??'';
    if($target!=='u3685169_ztrestore'||!preg_match('/(?:^|;)dbname=([a-zA-Z0-9_]+)(?:;|$)/',$config['dsn']??'',$m)||strcasecmp($target,$m[1])===0)throw new RuntimeException('TARGET');
    $stage=$config;$stage['dsn']=preg_replace('/(^|;)dbname=[a-zA-Z0-9_]+(?=;|$)/','$1dbname='.$target,$config['dsn'],1);
    $db=\ZTOrders\connect($stage);\ZTOrders\assertRestoreTarget($db,$config,false);
    $relay=$config['notifications']??[];
    if(($relay['owner_id']??null)!==424315265)throw new RuntimeException('OWNER');
    $q=$db->prepare('SELECT n.* FROM zt_notification_queue n JOIN zt_orders o ON o.id=n.order_id WHERE o.id=? AND o.order_number=? AND o.idempotency_key=?');
    $read=static function()use($q):array{
        $q->execute(['a7220000000000000000000000000002','ZT-A722000000000002',hash('sha256','restore-test-20261022-keep')]);
        $rows=$q->fetchAll(PDO::FETCH_ASSOC);if(count($rows)!==1)throw new RuntimeException('FIXTURE');return $rows[0];
    };
    $job=$read();
    if($mode!=='--status'){
        $qOther=$db->prepare("SELECT COUNT(*) FROM zt_notification_queue WHERE id<>? AND status IN ('pending','processing')");$qOther->execute([$job['id']]);
        if((int)$qOther->fetchColumn()!==0)throw new RuntimeException('OTHER_JOBS');
        if($mode==='--simulate-failure'){
            if($job['status']!=='pending'||(int)$job['attempts']!==0)throw new RuntimeException('ALREADY_TESTED');
            $send=static fn(array $j):array=>['ok'=>false,'retry'=>true,'code'=>'SYNTHETIC_OUTAGE'];
        }else{
            if($job['status']!=='pending'||(int)$job['attempts']!==1||$job['last_error_code']!=='SYNTHETIC_OUTAGE')throw new RuntimeException('RETRY_STATE');
            // Avoid relay receipt collisions with live queue row IDs.
            $sender=new \ZTOrders\YandexRelaySender($relay);
            $send=static function(array $j)use($sender):array{$j['id']='9223372036854770024';return $sender($j);};
        }
        $db->prepare('UPDATE zt_notification_queue SET next_attempt_at=UTC_TIMESTAMP(6) WHERE id=?')->execute([$job['id']]);
        $worker=new \ZTOrders\NotificationWorker($db,$relay,$send);$worker->runOne();$job=$read();
    }
    echo json_encode(['mode'=>$mode,'database'=>$target,'orderNumber'=>'ZT-A722000000000002','status'=>$job['status'],'attempts'=>(int)$job['attempts'],'lastError'=>$job['last_error_code'],'nextAttemptAt'=>$job['next_attempt_at'],'messageId'=>$job['vk_message_id']],JSON_THROW_ON_ERROR),PHP_EOL;
}catch(Throwable $e){fwrite(STDERR,'TEST_QUEUE_NOT_CONFIRMED: '.get_class($e)."\n");exit(1);}

<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
if($argc!==2||!in_array($argv[1],['--send','--status'],true)){echo "No send; use --send or --status for synthetic HTTPS fixture only.\n";exit;}
try{
    $main=dirname(__DIR__);$live=require $main.'/config.php';
    $stage=require dirname($main).'/private-orders-test/config.php';
    require_once $main.'/lib/Notifications.php';require_once $main.'/lib/RestoreGuard.php';require_once $main.'/lib/YandexRelay.php';
    if(!preg_match('/(?:^|;)dbname=u3685169_ztrestore(?:;|$)/',$stage['dsn']??''))throw new RuntimeException('DATABASE');
    $db=\ZTOrders\connect($stage);\ZTOrders\assertRestoreTarget($db,$live,false);
    $q=$db->prepare('SELECT n.*,o.order_number FROM zt_notification_queue n JOIN zt_orders o ON o.id=n.order_id WHERE o.idempotency_key=? AND o.subject=? AND o.customer_name=? AND o.phone=?');
    $read=static function()use($q):array{
        $q->execute([hash('sha256','zt-private-form-test-2026-10-24-v1'),'ТЕСТ HTTPS 24.10.2026','Вымышленный клиент','70000000000']);
        $rows=$q->fetchAll(PDO::FETCH_ASSOC);if(count($rows)!==1)throw new RuntimeException('FIXTURE');return $rows[0];
    };
    $job=$read();$relay=$live['notifications']??[];
    if(($relay['owner_id']??null)!==424315265)throw new RuntimeException('OWNER');
    $ran=false;
    if($argv[1]==='--send'&&$job['status']!=='sent'){
        if($job['status']!=='pending')throw new RuntimeException('STATE');
        $other=$db->prepare("SELECT COUNT(*) FROM zt_notification_queue WHERE id<>? AND status IN ('pending','processing')");$other->execute([$job['id']]);
        if((int)$other->fetchColumn()!==0)throw new RuntimeException('OTHER_JOBS');
        $sender=new \ZTOrders\YandexRelaySender($relay);
        $send=static function(array $j)use($sender):array{$j['id']='9223372036854770025';return $sender($j);};
        // Preserve normal retry scheduling; never force an early retry.
        $worker=new \ZTOrders\NotificationWorker($db,$relay,$send);$ran=$worker->runOne();$job=$read();
    }
    echo json_encode(['mode'=>'HTTPS_FIXTURE_QUEUE','database'=>'u3685169_ztrestore','orderNumber'=>$job['order_number'],'workerRan'=>$ran,'status'=>$job['status'],'attempts'=>(int)$job['attempts'],'lastError'=>$job['last_error_code'],'messageId'=>$job['vk_message_id']],JSON_THROW_ON_ERROR),PHP_EOL;
}catch(Throwable $e){fwrite(STDERR,'HTTPS_FIXTURE_QUEUE_NOT_CONFIRMED: '.get_class($e)."\n");exit(1);}

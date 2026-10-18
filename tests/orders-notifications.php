<?php
declare(strict_types=1);
if (!isset($lab) || !preg_match('/^mysql:host=127\\.0\\.0\\.1;port=[0-9]+;dbname=zt_test_orders_php_review;charset=utf8mb4$/D', $lab['dsn'] ?? '')) throw new RuntimeException('Disposable DB required');
// Invoked only by an isolated test harness with a dedicated loopback disposable DB.
require_once '/project/backend/orders/lib/Notifications.php';
require_once '/project/backend/orders/lib/Owner.php';
use ZTOrders\NotificationWorker;
function check(bool $value,string $name): void { if(!$value) throw new RuntimeException($name); echo "PASS $name\n"; }
$db=ZTOrders\connect($lab);
$db->exec(file_get_contents('/project/backend/orders/migrations/002-owner-notifications.sql'));
$vk=['owner_id'=>12345,'timezone'=>'Asia/Yekaterinburg'];
$db->exec("UPDATE zt_notification_queue SET status='pending',attempts=0,next_attempt_at=UTC_TIMESTAMP(),locked_until=NULL");
$calls=[];
$sender=function($job)use(&$calls){$calls[]=$job;return ['ok'=>true,'messageId'=>99];};
$worker=new NotificationWorker($db,$vk,$sender);
$job=$worker->claim();
check($job!==null,'claim ready notification');
$other=new NotificationWorker($db,$vk,$sender);
$otherJob=$other->claim();
check(!$otherJob || $otherJob['id']!==$job['id'],'overlapping cron cannot claim same lease');
check(!str_contains($job['message_text'],'7999'),'no customer phone in message');
check(str_contains($job['message_text'],'Итого по товарам'),'message contains totals');
$q=$db->prepare("UPDATE zt_notification_queue SET locked_until=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?");$q->execute([$job['id']]);
$retried=$other->claim();
check($retried['id']===$job['id'] && $retried['vk_random_id']===$job['vk_random_id'] && $retried['message_text']===$job['message_text'],'expired lease preserves identity and frozen text');
$db->exec("UPDATE zt_notification_queue SET status='sent',locked_until=NULL");
check(!$worker->runOne(),'sent tasks not sent again');
$q=$db->prepare("UPDATE zt_notification_queue SET status='pending',attempts=0,next_attempt_at=UTC_TIMESTAMP() WHERE id=?");$q->execute([$job['id']]);
$bad=new NotificationWorker($db,$vk,fn($j)=>['ok'=>false,'retry'=>true,'code'=>'VK_6']);
check($bad->runOne(),'VK temporary failure processed');
$row=$db->query("SELECT status,attempts,next_attempt_at>UTC_TIMESTAMP() is_delayed FROM zt_notification_queue WHERE id=".(int)$job['id'])->fetch(PDO::FETCH_ASSOC);
check($row['status']==='pending' && (int)$row['attempts']===1 && (int)$row['is_delayed']===1,'temporary failure schedules backoff');
check(!$bad->runOne(),'immediate repeated cron waits for backoff');
$db->exec("UPDATE zt_notification_queue SET next_attempt_at=UTC_TIMESTAMP() WHERE id=".(int)$job['id']);
$permanent=new NotificationWorker($db,$vk,fn($j)=>['ok'=>false,'retry'=>false,'code'=>'VK_901']);
$permanent->runOne();
check($db->query("SELECT status FROM zt_notification_queue WHERE id=".(int)$job['id'])->fetchColumn()==='failed','permanent VK failure retained for owner review');
$db->exec("UPDATE zt_notification_queue SET status='pending',attempts=0,next_attempt_at=UTC_TIMESTAMP() WHERE id=".(int)$job['id']);
$worker->runOne();
check($db->query("SELECT status FROM zt_notification_queue WHERE id=".(int)$job['id'])->fetchColumn()==='sent','success persisted');
check(!$worker->runOne(),'repeat cron sends nothing after success');
$full=['order_number'=>'ZT-1234567890123456','kind'=>'order','created_at'=>'2026-10-16 10:00:00','total_kopecks'=>50000,'customer_name'=>'SECRET_NAME','phone'=>'SECRET_PHONE','delivery_address'=>'SECRET_ADDRESS','comment'=>'SECRET_COMMENT','subject'=>'SECRET_SUBJECT'];
$text=ZTOrders\notificationText($full,[['product_name'=>'Букет','quantity'=>2,'line_total_kopecks'=>50000]],'Asia/Yekaterinburg');
foreach(['SECRET_NAME','SECRET_PHONE','SECRET_ADDRESS','SECRET_COMMENT','SECRET_SUBJECT'] as $private) check(!str_contains($text,$private),'privacy '.$private);
check(str_contains($text,'15:00:00') && str_contains($text,'Букет × 2'),'time zone and items');
try { ZTOrders\connect(array_replace($lab,['dsn'=>str_replace('dbname=zt_test_orders_php_review','dbname=zt_test_orders_missing',$lab['dsn'])])); check(false,'DB outage'); } catch(PDOException) { check(true,'DB unavailable fails closed'); }
check(ZTOrders\escape('<script>"')==='&lt;script&gt;&quot;','HTML output escaping');

foreach ([
 [false,0,false,true], ['oops',200,false,true], ['{}',200,false,true],
 ['{"error":{"error_code":6}}',200,false,true],
 ['{"error":{"error_code":901}}',200,false,false],
 ['{"error":{"error_code":5}}',200,false,false],
 ['{"response":123}',200,true,false], ['{"response":123}',500,false,true]
] as [$body,$http,$ok,$retry]) {
 $r=ZTOrders\VkSender::interpret($body,$http);
 check($r['ok']===$ok && ($ok || $r['retry']===$retry),'real VK response parser '.json_encode([$body,$http]));
}

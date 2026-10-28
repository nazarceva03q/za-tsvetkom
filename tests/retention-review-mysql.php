<?php
declare(strict_types=1);
require_once '/private/lib/Repository.php';
require_once '/private/lib/Notifications.php';
require_once '/private/lib/RetentionDecisions.php';
if(!isset($lab)||!str_starts_with($lab['dsn'],'mysql:host=127.0.0.1;'))throw new RuntimeException('Local lab required');
$db=ZTOrders\connect($lab);
$db->exec(file_get_contents('/migrations/005-retention-review.sql'));
$check=static function(bool $v,string $label):void {if(!$v)throw new RuntimeException($label);echo "PASS retention $label\n";};
$id=str_repeat('c',32);$now=new DateTimeImmutable('now',new DateTimeZone('UTC'));
$today=$now->setTimezone(new DateTimeZone('Asia/Yekaterinburg'))->format('Y-m-d');
$next=$now->setTimezone(new DateTimeZone('Asia/Yekaterinburg'))->modify('+10 days')->format('Y-m-d');
$db->prepare('INSERT INTO zt_orders(id,order_number,idempotency_key,request_hash,kind,subject,customer_name,phone,contact_channel,comment,consent_version,consent_text_sha256,consent_at,request_type,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),?,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 60 DAY))')->execute([$id,'ZT-'.str_repeat('C',16),str_repeat('c',64),str_repeat('a',64),'order','Тест сроков','Тест','79990000099','VK','','test',str_repeat('b',64),'cart']);
$original=$db->query("SELECT * FROM zt_orders WHERE id='$id'")->fetch(PDO::FETCH_ASSOC);
$base=['order_id'=>$id,'review_version'=>'0','order_version'=>'0','decision'=>'keep','reason'=>'active_order','review_date'=>$next];
$reject=static function(array $v,string $label)use($db,$check,$now):void {try{ZTOrders\saveRetentionDecision($db,$v,$now);throw new RuntimeException('Accepted: '.$label);}catch(ZTOrders\RetentionDecisionError){$check(true,$label);}};
try {
 $check(in_array($id,array_column(ZTOrders\retentionReviewList($db)['rows'],'id'),true),'old request appears for review');
 $reject(array_replace($base,['review_date'=>$today]),'same-day postponement rejected');
 $reject(array_replace($base,['review_date'=>'2099-01-01']),'unbounded postponement rejected');
 $reject(array_replace($base,['reason'=>'anything']),'reason allowlist enforced');
 $reject(array_replace($base,['review_date'=>'2026-02-30']),'invalid calendar date rejected');
 ZTOrders\saveRetentionDecision($db,$base,$now);
 $check(ZTOrders\retentionDecision($db,$id)['version']===1,'first decision saved');
 $check(!in_array($id,array_column(ZTOrders\retentionReviewList($db)['rows'],'id'),true),'postponed request leaves due list');
 $report=ZTOrders\retentionReview($db,$now,true);
 $check($report['counts']['notDue']>=1,'aggregate report respects postponed check');
 $reject($base,'stale second window cannot overwrite decision');
 $ready=array_replace($base,['review_version'=>'1','decision'=>'ready','goal_ended_on'=>$today,'confirm_clear'=>'1']);
 $reject(array_replace($ready,['confirm_clear'=>'0']),'explicit confirmation required');
 $reject(array_replace($ready,['goal_ended_on'=>'2099-01-01']),'future completion rejected');
 $reject(array_replace($ready,['goal_ended_on'=>'2000-01-01']),'completion before creation rejected');
 $db->exec("UPDATE zt_orders SET complaint_open=1 WHERE id='$id'");
 $reject($ready,'known open complaint blocks cleanup mark');
 $db->exec("UPDATE zt_orders SET complaint_open=0,workflow_version=1 WHERE id='$id'");
 $reject($ready,'changed request version blocks stale decision');
 $db->exec("UPDATE zt_orders SET workflow_version=0 WHERE id='$id'");
 ZTOrders\saveRetentionDecision($db,$ready,$now);
 $review=ZTOrders\retentionDecision($db,$id);
 $check($review['decision']==='ready'&&(int)$review['version']===2,'ready decision recorded');
 $check((new DateTimeImmutable($review['erase_due_at']))->getTimestamp()-(new DateTimeImmutable($review['goal_ended_at']))->getTimestamp()===30*86400,'deadline follows declared completion by 30 days');
 $check(in_array($id,array_column(ZTOrders\retentionReviewList($db)['rows'],'id'),true),'marked request remains visible in review list');
 $check($db->query("SELECT * FROM zt_orders WHERE id='$id'")->fetch(PDO::FETCH_ASSOC)===$original,'all request fields remain untouched');
 $check((int)$db->query("SELECT COUNT(*) FROM zt_request_events WHERE order_id='$id' AND event_type='retention_reviewed'")->fetchColumn()===2,'only successful decisions journaled');
 $report=ZTOrders\retentionReview($db,$now,true);
 $check($report['deleted']===0&&$report['counts']['markedForCleanup']>=1,'report respects ready marks without deletion');
 $db->exec("CREATE TRIGGER zt_test_review_failure BEFORE INSERT ON zt_request_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic event failure'");
 try {
  try {ZTOrders\saveRetentionDecision($db,array_replace($base,['review_version'=>'2']),$now);throw new RuntimeException('Journal failure was accepted');}
  catch(PDOException){$check(ZTOrders\retentionDecision($db,$id)['decision']==='ready'&&(int)ZTOrders\retentionDecision($db,$id)['version']===2,'journal failure rolls back decision');}
 } finally {$db->exec('DROP TRIGGER zt_test_review_failure');}
 $db->exec("UPDATE zt_orders SET erased_at=UTC_TIMESTAMP() WHERE id='$id'");
 $reject(array_replace($base,['review_version'=>'2']),'erased request cannot receive new decision');
 $db->exec("UPDATE zt_orders SET erased_at=NULL WHERE id='$id'");
 $db->exec("UPDATE zt_orders SET desired_date=DATE_ADD(UTC_DATE(),INTERVAL 60 DAY) WHERE id='$id'");
 $db->exec("DELETE FROM zt_retention_reviews WHERE order_id='$id'");
 $check(!in_array($id,array_column(ZTOrders\retentionReviewList($db)['rows'],'id'),true),'future requested date protects preorder from early review');
 $check((int)$db->query("SELECT COUNT(*) FROM zt_orders WHERE id='$id'")->fetchColumn()===1,'no decision deletes request');
} finally {
 // Isolated synthetic fixture only.
 $db->exec("DELETE FROM zt_retention_reviews WHERE order_id='$id'");
 $db->exec("DELETE FROM zt_request_events WHERE order_id='$id'");
 $db->exec("DELETE FROM zt_orders WHERE id='$id'");
}

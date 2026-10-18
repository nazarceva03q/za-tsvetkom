<?php
declare(strict_types=1);
if(!isset($lab)||!preg_match('/^mysql:host=127\.0\.0\.1;port=[0-9]+;dbname=zt_test_orders_php_review;charset=utf8mb4$/D',$lab['dsn']??''))throw new RuntimeException('Disposable local schema required');
require '/private/lib/Notifications.php';require '/private/lib/Workflow.php';
$db=ZTOrders\connect($lab);
$sql=preg_replace('/^--.*$/m','',file_get_contents('/migrations/004-request-workflow.sql'));
foreach(explode(';',$sql) as $s)if(trim($s)!=='')$db->exec($s);
function check(bool $v,string $label):void{if(!$v)throw new RuntimeException($label);echo "PASS $label\n";}
function seed(PDO $db):string {
 $id=bin2hex(random_bytes(16));$q=$db->prepare("INSERT INTO zt_orders(id,order_number,idempotency_key,request_hash,kind,subject,customer_name,phone,contact_channel,comment,consent_version,consent_text_sha256,consent_at,request_type) VALUES(?,?,?,?,'inquiry','PRIVATE_SUBJECT','PRIVATE_NAME','79990000123','Телефон','PRIVATE_COMMENT','test',?,UTC_TIMESTAMP(),'question')");
 $q->execute([$id,'ZT-'.strtoupper(substr($id,0,16)),bin2hex(random_bytes(32)),bin2hex(random_bytes(32)),str_repeat('a',64)]);return $id;
}
function row(PDO $db,string $id):array{$q=$db->prepare('SELECT * FROM zt_orders WHERE id=?');$q->execute([$id]);return $q->fetch(PDO::FETCH_ASSOC);}
$id=seed($db);$form=['order_id'=>$id,'version'=>'0','status'=>'working','next_action'=>'reply','next_action_at'=>'2026-12-01T15:30','complaint'=>'0'];
ZTOrders\saveWorkflow($db,$form);$r=row($db,$id);
check($r['status']==='working'&&$r['next_action_at']==='2026-12-01 10:30:00','status and Perm deadline saved in UTC');
try{ZTOrders\saveWorkflow($db,$form);check(false,'stale');}catch(ZTOrders\WorkflowError){check(true,'stale form cannot overwrite changes');}
try{ZTOrders\workflowInput(array_replace($form,['status'=>'completed']));check(false,'completion');}catch(ZTOrders\WorkflowError){check(true,'completion requires owner confirmation');}
foreach([['status'=>'invalid'],['next_action'=>'auto_send'],['next_action_at'=>'2026-02-30T12:00'],['complaint'=>[]],['order_id'=>'bad']] as $bad){try{ZTOrders\workflowInput(array_replace($form,$bad));check(false,'invalid');}catch(ZTOrders\WorkflowError){check(true,'invalid workflow fields rejected');}}
ZTOrders\saveWorkflow($db,array_replace($form,['version'=>'1','complaint'=>'1']));check(row($db,$id)['next_action']===null,'complaint cancels assigned action');
$db->exec("ALTER TABLE zt_request_events ADD CONSTRAINT ck_test_events CHECK(actor='impossible') NOT ENFORCED");
// A trigger rejects just the new event, proving state+event atomicity without changing production code.
$db->exec("CREATE TRIGGER reject_workflow_event BEFORE INSERT ON zt_request_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test rollback'");
try{ZTOrders\saveWorkflow($db,array_replace($form,['version'=>'2','status'=>'waiting']));check(false,'rollback');}catch(PDOException){check(row($db,$id)['status']==='working'&&(int)row($db,$id)['workflow_version']===2,'event failure rolls back state');}
$db->exec('DROP TRIGGER reject_workflow_event');$db->exec('ALTER TABLE zt_request_events DROP CHECK ck_test_events');
ZTOrders\saveWorkflow($db,array_replace($form,['version'=>'2','status'=>'no_purchase']));
$closed=row($db,$id)['closed_at'];check($closed!==null&&row($db,$id)['next_action']===null,'closing stamps date and cancels action');
ZTOrders\saveWorkflow($db,array_replace($form,['version'=>'3','status'=>'no_purchase']));check(row($db,$id)['closed_at']===$closed,'repeated closure preserves date');
try{ZTOrders\retentionCandidates($db,[]);check(false,'policy');}catch(ZTOrders\WorkflowError){check(true,'unapproved policy prevents cleanup');}
$policy=['approved'=>true,'closed_no_purchase_days'=>30];check(!in_array($id,ZTOrders\retentionCandidates($db,$policy),true),'fresh closed request excluded');
$q=$db->prepare('UPDATE zt_orders SET closed_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 31 DAY),complaint_open=1 WHERE id=?');$q->execute([$id]);
check(!ZTOrders\eraseClosedRequest($db,$policy,$id),'complaint blocks cleanup');
$db->prepare('UPDATE zt_orders SET complaint_open=0 WHERE id=?')->execute([$id]);
$db->prepare("INSERT INTO zt_notification_queue(order_id,event_type,channel,status,next_attempt_at,locked_until,message_text) VALUES(?,'order.created','vk_owner','processing',UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 120 SECOND),'PRIVATE_TEXT')")->execute([$id]);
check(!ZTOrders\eraseClosedRequest($db,$policy,$id),'in-flight sender blocks cleanup');
$db->prepare("UPDATE zt_notification_queue SET status='sent' WHERE order_id=?")->execute([$id]);
$db->prepare("INSERT INTO zt_order_items(order_id,product_id,product_name,quantity,made_to_order,product_snapshot) VALUES(?,'private-id','PRIVATE_PRODUCT',1,0,'{\"name\":\"PRIVATE_SNAPSHOT\"}')")->execute([$id]);
check(ZTOrders\eraseClosedRequest($db,$policy,$id),'eligible no-purchase request cleared');
$r=row($db,$id);check($r['erased_at']!==null&&$r['customer_name']===''&&$r['phone']===''&&$r['comment']===''&&$r['subject']==='','contact and free text removed');
foreach(['zt_order_items','zt_notification_queue'] as $table){$q=$db->prepare('SELECT COUNT(*) FROM '.$table.' WHERE order_id=?');$q->execute([$id]);check((int)$q->fetchColumn()===0,'related copies removed '.$table);}
check(!ZTOrders\eraseClosedRequest($db,$policy,$id),'cleanup is repeat-safe');
try{ZTOrders\saveWorkflow($db,array_replace($form,['version'=>(string)$r['workflow_version']]));check(false,'erased');}catch(ZTOrders\WorkflowError){check(true,'erased request cannot reopen');}
$completed=seed($db);ZTOrders\saveWorkflow($db,array_replace($form,['order_id'=>$completed,'status'=>'completed','confirm_completed'=>'1']));
$db->prepare('UPDATE zt_orders SET closed_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 100 DAY) WHERE id=?')->execute([$completed]);
check(!ZTOrders\eraseClosedRequest($db,$policy,$completed),'completed purchase never purged by no-purchase rule');
ZTOrders\saveWorkflow($db,array_replace($form,['order_id'=>$completed,'version'=>'1','status'=>'no_purchase']));
$db->prepare('UPDATE zt_orders SET closed_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 100 DAY) WHERE id=?')->execute([$completed]);
check(!ZTOrders\eraseClosedRequest($db,$policy,$completed),'status correction cannot erase confirmed purchase history');
echo "WORKFLOW_READY\n";

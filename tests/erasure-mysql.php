<?php
declare(strict_types=1);
require_once '/private/lib/Notifications.php';
require_once '/private/lib/Validation.php';
require_once '/private/lib/Repository.php';
require_once '/private/lib/Erasure.php';
if(!isset($lab)||!str_starts_with($lab['dsn'],'mysql:host=127.0.0.1;'))throw new RuntimeException('Local lab required');
$db=ZTOrders\connect($lab);$db->exec(file_get_contents('/migrations/006-erasure-records.sql'));
$db->exec(file_get_contents('/migrations/007-erasure-copy-state.sql'));
$check=static function(bool $v,string $label):void {if(!$v)throw new RuntimeException($label);echo "PASS erasure $label\n";};
$id=str_repeat('d',32);$number='ZT-'.str_repeat('D',16);$key=str_repeat('d',64);
$now=new DateTimeImmutable('now',new DateTimeZone('UTC'));$today=$now->setTimezone(new DateTimeZone('Asia/Yekaterinburg'))->format('Y-m-d');
$config=['erasure'=>['schema_ready'=>true,'copies_schema_ready'=>true,'enabled'=>true,'operator'=>['name'=>'Тестовый оператор','address'=>'Тестовый адрес оператора'],
    'actor'=>['name'=>'Тестовый ответственный','role'=>'Оператор'],'system'=>'Изолированная тестовая система','processors'=>[['name'=>'Тестовый обработчик','address'=>'Тестовый адрес']]]];
$copies=['orderNumber'=>$number,'checkedAt'=>$now->format('Y-m-d\TH:i:s\Z'),'checkedBy'=>'Тестовый ответственный','reference'=>'Локальный тест; внешних копий нет','backups'=>true,'exports'=>true,'vk'=>true,'logs'=>true];
$db->prepare('INSERT INTO zt_orders(id,order_number,idempotency_key,request_hash,kind,subject,customer_name,phone,contact_channel,comment,consent_version,consent_text_sha256,consent_at,request_type,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),?,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 60 DAY))')->execute([$id,$number,$key,str_repeat('a',64),'order','Секретная тема','Секретное имя','79990000099','VK','Секретный комментарий','test',str_repeat('b',64),'cart']);
$db->prepare("INSERT INTO zt_order_items(order_id,product_id,product_name,quantity,made_to_order,product_snapshot) VALUES(?,'test','Секретный выбор',1,0,'{}')")->execute([$id]);
$db->prepare("INSERT INTO zt_notification_queue(order_id,event_type,channel,next_attempt_at) VALUES(?,'order.created','vk_owner',UTC_TIMESTAMP())")->execute([$id]);
$input=['order_id'=>$id,'review_version'=>'0','order_version'=>'0','decision'=>'ready','goal_ended_on'=>$today,'confirm_clear'=>'1'];
ZTOrders\saveRetentionDecision($db,$input,$now);
$reject=static function(array $cfg,array $c,int $version,string $label)use($db,$number,$now,$check):void{
    try{ZTOrders\eraseReviewedRequest($db,$cfg,$number,$version,$c,$now);throw new RuntimeException('Accepted '.$label);}
    catch(ZTOrders\ErasureError){$check(true,$label);}
};
try {
 $before=(int)$db->query('SELECT COUNT(*) FROM zt_orders')->fetchColumn();
 $p=ZTOrders\erasurePreview($db);$check($p['deleted']===0&&$p['mode']==='PREVIEW_ONLY','preview cannot delete');
 $cfg=$config;$cfg['erasure']['enabled']=false;$reject($cfg,$copies,1,'disabled cleanup rejected');
 $cfg=$config;$cfg['erasure']['schema_ready']=false;$reject($cfg,$copies,1,'replay schema guard required');
 $cfg=$config;$cfg['erasure']['actor']['name']='';$reject($cfg,$copies,1,'responsible person required');
 $cfg=$config;unset($cfg['erasure']['processors']);$reject($cfg,$copies,1,'processor list requires explicit configuration');
 foreach(['backups','exports','vk','logs'] as $scope)$reject($config,array_replace($copies,[$scope=>false]),1,$scope.' attestation required');
 $reject($config,array_replace($copies,['orderNumber'=>'ZT-'.str_repeat('E',16)]),1,'copy attestation bound to request');
 $reject($config,array_replace($copies,['checkedAt'=>$now->modify('-25 hours')->format('Y-m-d\TH:i:s\Z')]),1,'stale copy attestation rejected');
 $reject($config,array_replace($copies,['checkedAt'=>$now->modify('+1 hour')->format('Y-m-d\TH:i:s\Z')]),1,'future copy attestation rejected');
 $reject($config,$copies,2,'stale decision version rejected');
 $q=$db->prepare("SELECT id,details FROM zt_request_events WHERE order_id=? AND event_type='retention_reviewed' ORDER BY id DESC LIMIT 1");$q->execute([$id]);$event=$q->fetch(PDO::FETCH_ASSOC);
 $details=json_decode($event['details'],true);unset($details['orderVersion']);
 $db->prepare('UPDATE zt_request_events SET details=? WHERE id=?')->execute([json_encode($details),$event['id']]);
 $reject($config,$copies,1,'legacy decision requires reconfirmation');
 $db->prepare('UPDATE zt_request_events SET details=? WHERE id=?')->execute([$event['details'],$event['id']]);
 $db->exec("UPDATE zt_retention_reviews SET decision='keep',reason='active_order',review_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),goal_ended_at=NULL,erase_due_at=NULL WHERE order_id='$id'");
 $reject($config,$copies,1,'request still needed cannot be erased');
 $db->prepare("UPDATE zt_retention_reviews SET decision='ready',reason=NULL,review_at=NULL,goal_ended_at=?,erase_due_at=? WHERE order_id=?")->execute([ZTOrders\retentionDecisionInput($input,$now)['ended'],ZTOrders\retentionDecisionInput($input,$now)['eraseDue'],$id]);
 $db->exec("UPDATE zt_orders SET complaint_open=1 WHERE id='$id'");$reject($config,$copies,1,'known complaint blocks deletion');
 $db->exec("UPDATE zt_orders SET complaint_open=0,workflow_version=1 WHERE id='$id'");$reject($config,$copies,1,'workflow change requires reconfirmation');
 $db->exec("UPDATE zt_orders SET workflow_version=0 WHERE id='$id'");
 $db->exec("UPDATE zt_notification_queue SET status='processing' WHERE order_id='$id'");$reject($config,$copies,1,'in-flight notification blocks deletion');
 $db->exec("UPDATE zt_notification_queue SET status='pending' WHERE order_id='$id'");
 $db->exec("CREATE TRIGGER zt_test_erasure_failure BEFORE DELETE ON zt_orders FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic deletion failure'");
 try{try{ZTOrders\eraseReviewedRequest($db,$config,$number,1,$copies,$now);throw new RuntimeException('Rollback not triggered');}
 catch(PDOException){$check(true,'injected delete failure reported');}}
 finally{$db->exec('DROP TRIGGER zt_test_erasure_failure');}
 foreach(['zt_orders'=>'id','zt_order_items'=>'order_id','zt_notification_queue'=>'order_id','zt_request_events'=>'order_id','zt_retention_reviews'=>'order_id'] as $table=>$column)
  $check((int)$db->query("SELECT COUNT(*) FROM $table WHERE $column='$id'")->fetchColumn()>0,'failure restores '.$table);
 $check((int)$db->query("SELECT COUNT(*) FROM zt_erasure_records WHERE order_number='$number'")->fetchColumn()===0,'failure rolls back evidence too');
 $repo=new ZTOrders\OrderRepository($db,true);
 $check($repo->replay($key,str_repeat('a',64))['orderNumber']===$number,'guard preserves live idempotent replay');
 $r=ZTOrders\eraseReviewedRequest($db,$config,$number,1,$copies,$now);
 $check($r['deleted']===1&&$r['act']==='UNSIGNED_DRAFT','explicit cleanup succeeds without claiming signature');
 foreach(['zt_orders'=>'id','zt_order_items'=>'order_id','zt_notification_queue'=>'order_id','zt_request_events'=>'order_id','zt_retention_reviews'=>'order_id'] as $table=>$column)
  $check((int)$db->query("SELECT COUNT(*) FROM $table WHERE $column='$id'")->fetchColumn()===0,'related content removed '.$table);
 $check((int)$db->query('SELECT COUNT(*) FROM zt_orders')->fetchColumn()===$before-1,'other requests unchanged');
 $check(ZTOrders\eraseReviewedRequest($db,$config,$number,1,$copies,$now)['deleted']===0,'same target retry does not repeat deletion');
 $docs=ZTOrders\erasureDocuments($db,$r['recordId']);$joined=implode('',array_values($docs));
 $check(count($docs)===2&&str_contains($joined,'ТРЕБУЕТ ПОДПИСИ'),'act draft and journal can be re-exported');
 foreach(['79990000099','Секретное имя','Секретная тема','Секретный комментарий','Секретный выбор'] as $secret)$check(!str_contains($joined,$secret),'no copied content in evidence '.$secret);
 $record=$db->query("SELECT * FROM zt_erasure_records WHERE order_number='$number'")->fetch(PDO::FETCH_ASSOC);
 $evidence=json_decode($record['evidence'],true);
 $check(!in_array('условия получения и доставки',$evidence['categories'],true),'absent delivery fields not claimed erased');
 $check(in_array('выбранные товары и снимки карточек',$evidence['categories'],true),'existing item category recorded');
 $check($record['replay_key_hash']===hash('sha256',$key)&&$record['replay_key_hash']!==$key,'only hash of random replay key retained');
 $check($record['retain_until']===$now->modify('+3 years')->format('Y-m-d H:i:s.u'),'evidence retention set to three years');
 try{$repo->replay($key,str_repeat('a',64));throw new RuntimeException('Erased replay accepted');}
 catch(ZTOrders\RequestError $e){$check($e->errorCode==='REQUEST_ERASED','old request replay rejected');}
 $request=['kind'=>'order','subject'=>'Must not return','name'=>'Old name','phone'=>'79990000099','channel'=>'VK','date'=>'','delivery'=>'','time'=>'','address'=>'','comment'=>'','quantity'=>null,'budget'=>null,'consentVersion'=>'test','consentTextSha256'=>str_repeat('b',64),'requestType'=>'cart'];
 try{$repo->save($key,str_repeat('a',64),$request,['totalKopecks'=>null,'items'=>[]],str_repeat('f',64),100);throw new RuntimeException('Old content restored');}
 catch(ZTOrders\RequestError $e){$check($e->errorCode==='REQUEST_ERASED','save checks erased key under transaction too');}
 $check((int)$db->query("SELECT COUNT(*) FROM zt_orders WHERE idempotency_key='$key'")->fetchColumn()===0,'no resurrection after retry');
} finally {
 foreach(['zt_order_items','zt_notification_queue','zt_request_events','zt_retention_reviews'] as $table)$db->exec("DELETE FROM $table WHERE order_id='$id'");
 $db->exec("DELETE FROM zt_orders WHERE id='$id'");$db->exec("DELETE FROM zt_erasure_records WHERE order_number='$number'");
}

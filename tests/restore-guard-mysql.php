<?php
declare(strict_types=1);
require_once '/private/lib/Notifications.php';
require_once '/private/lib/Validation.php';
require_once '/private/lib/Repository.php';
require_once '/private/lib/Erasure.php';
if(!isset($lab)||!str_starts_with($lab['dsn'],'mysql:host=127.0.0.1;'))throw new RuntimeException('Local lab required');
$db=ZTOrders\connect($lab);$database=$db->query('SELECT DATABASE()')->fetchColumn();
$check=static function(bool $v,string $label):void{if(!$v)throw new RuntimeException($label);echo "PASS restore $label\n";};
$reject=static function(callable $fn,string $label)use($check):void{try{$fn();throw new RuntimeException('Accepted '.$label);}catch(ZTOrders\ErasureError|ZTOrders\RestoreGuardError){$check(true,$label);}};
$id=str_repeat('e',32);$number='ZT-'.str_repeat('E',16);$key=str_repeat('e',64);$now=new DateTimeImmutable('now',new DateTimeZone('UTC'));
$today=$now->setTimezone(new DateTimeZone('Asia/Yekaterinburg'))->format('Y-m-d');
$cfg=['dsn'=>'mysql:host=127.0.0.1;dbname=zt_live_never_used;charset=utf8mb4',
 'erasure'=>['schema_ready'=>true,'copies_schema_ready'=>true,'enabled'=>true,'copy_confirmation_enabled'=>false,
 'operator'=>['name'=>'Тестовый оператор','address'=>'Адрес оператора'],
 'actor'=>['name'=>'Тестовый проверяющий','role'=>'Оператор'],'system'=>'Тестовая система','processors'=>[],
 'backup_retention_days'=>30,'backup_rollover_approved'=>false],
 'restore_guard'=>['prepared'=>false,'enabled'=>false,'target_database'=>$database,'ledger_current_confirmed'=>false,'target_not_public_confirmed'=>false]];
$copies=['orderNumber'=>$number,'checkedAt'=>$now->format('Y-m-d\TH:i:s\Z'),'checkedBy'=>'Тестовый проверяющий','reference'=>'Synthetic fixture only',
 'backups'=>'rolling','exports'=>true,'vk'=>true,'logs'=>true,'backupRestrictionConfirmed'=>true,'restoreProcedureConfirmed'=>true];
$db->prepare('INSERT INTO zt_orders(id,order_number,idempotency_key,request_hash,kind,subject,customer_name,phone,contact_channel,comment,consent_version,consent_text_sha256,consent_at,request_type,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),?,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 60 DAY))')->execute([$id,$number,$key,str_repeat('a',64),'order','Fixture subject','Fixture customer','79991112233','VK','Fixture comment','test',str_repeat('b',64),'cart']);
$db->prepare("INSERT INTO zt_order_items(order_id,product_id,product_name,quantity,made_to_order,product_snapshot) VALUES(?,'fixture','Fixture product',1,0,'{}')")->execute([$id]);
$db->prepare("INSERT INTO zt_notification_queue(order_id,event_type,channel,next_attempt_at) VALUES(?,'order.created','vk_owner',UTC_TIMESTAMP())")->execute([$id]);
ZTOrders\saveRetentionDecision($db,['order_id'=>$id,'review_version'=>'0','order_version'=>'0','decision'=>'ready','goal_ended_on'=>$today,'confirm_clear'=>'1'],$now);
$tables=['zt_orders'=>'id','zt_order_items'=>'order_id','zt_notification_queue'=>'order_id','zt_request_events'=>'order_id','zt_retention_reviews'=>'order_id'];
$backup=[];foreach($tables as $table=>$field)$backup[$table]=$db->query("SELECT * FROM $table WHERE $field='$id'")->fetchAll(PDO::FETCH_ASSOC);
$insert=static function(string $table,array $rows)use($db):void{foreach($rows as $r){$keys=array_keys($r);$sql='INSERT INTO '.$table.' (`'.implode('`,`',$keys).'`) VALUES('.implode(',',array_fill(0,count($keys),'?')).')';$db->prepare($sql)->execute(array_values($r));}};
try{
 $reject(fn()=>ZTOrders\eraseReviewedRequest($db,$cfg,$number,1,$copies,$now),'rolling backups cannot bypass unapproved procedure');
 $cfg['erasure']['backup_rollover_approved']=true;$cfg['restore_guard']['prepared']=true;
 $bad=$copies;$bad['backupRestrictionConfirmed']=false;
 $reject(fn()=>ZTOrders\eraseReviewedRequest($db,$cfg,$number,1,$bad,$now),'actual restriction confirmation required');
 $bad=$copies;$bad['restoreProcedureConfirmed']=false;
 $reject(fn()=>ZTOrders\eraseReviewedRequest($db,$cfg,$number,1,$bad,$now),'restore procedure confirmation required');
 $badCfg=$cfg;$badCfg['erasure']['backup_retention_days']=365;
 $reject(fn()=>ZTOrders\eraseReviewedRequest($db,$badCfg,$number,1,$copies,$now),'unbounded backup retention rejected');
 $r=ZTOrders\eraseReviewedRequest($db,$cfg,$number,1,$copies,$now);$recordId=$r['recordId'];
 $check($r['deleted']===1&&$r['copies']==='BACKUPS_PENDING','working content cleared while backups explicitly pending');
 $row=$db->query("SELECT * FROM zt_erasure_records WHERE id='$recordId'")->fetch(PDO::FETCH_ASSOC);
 $check($row['copy_state']==='pending'&&$row['copies_confirmed_at']===null,'copy completion not invented');
 $check($row['backup_review_at']===$now->modify('+31 days')->format('Y-m-d H:i:s.u'),'backup review reminder saved');
 $docs=ZTOrders\erasureDocuments($db,$recordId);
 $check(str_contains($docs['act-draft.txt'],'УНИЧТОЖЕНИЕ ВСЕХ КОПИЙ НЕ ПОДТВЕРЖДЕНО'),'pending document cannot claim complete erasure');
 $db->exec("UPDATE zt_erasure_records SET backup_review_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE id='$recordId'");
 $preview=ZTOrders\erasurePreview($db,$cfg);
 $check($preview['copiesPending']>=1&&$preview['copyReviewsDue']>=1&&$preview['deleted']===0,'overdue reminder does not auto-complete or delete');
 $raw=ZTOrders\restoreLedgerExport($db,$now);$hash=hash('sha256',$raw);$ledger=ZTOrders\validateRestoreLedger($raw,$hash);
 $check($ledger['recordCount']===1,'complete restore ledger exported');
 foreach(['79991112233','Fixture customer','Fixture comment','Fixture product'] as $v)$check(!str_contains($raw,$v),'no customer content copied to ledger');
 $reject(fn()=>ZTOrders\validateRestoreLedger($raw.'x',$hash),'file hash catches alteration');
 $decoded=json_decode($raw,true);$decoded['payload']['recordCount']=2;$tampered=json_encode($decoded);
 $reject(fn()=>ZTOrders\validateRestoreLedger($tampered,hash('sha256',$tampered)),'inner checksum catches altered payload');
 $dup=$ledger;$dup['records'][]=$dup['records'][0];$dup['recordCount']=2;
 $reject(fn()=>ZTOrders\filterRestoredRequests($db,$cfg,$dup),'duplicate ledger entries rejected');
 $empty=$ledger;$empty['records']=[];$empty['recordCount']=0;
 $reject(fn()=>ZTOrders\filterRestoredRequests($db,$cfg,$empty),'ledger missing known suppression proofs rejected');
 foreach($backup as $table=>$rows)$insert($table,$rows); // simulate importing the old SQL snapshot into isolated staging
 $count=(int)$db->query('SELECT COUNT(*) FROM zt_orders')->fetchColumn();
 $p=ZTOrders\filterRestoredRequests($db,$cfg,$ledger);
 $check($p['matched']===1&&$p['deleted']===0,'restore preview identifies restored erased request without deletion');
 $check((int)$db->query('SELECT COUNT(*) FROM zt_orders')->fetchColumn()===$count,'preview keeps restored rows');
 $reject(fn()=>ZTOrders\filterRestoredRequests($db,$cfg,$ledger,true),'apply requires explicit isolated-target approval');
 $apply=$cfg;$apply['restore_guard']['enabled']=true;$apply['restore_guard']['ledger_current_confirmed']=true;$apply['restore_guard']['target_not_public_confirmed']=true;
 $wrong=$apply;$wrong['dsn']=$lab['dsn'];$reject(fn()=>ZTOrders\filterRestoredRequests($db,$wrong,$ledger,true),'main database target forbidden');
 $db->prepare('UPDATE zt_orders SET idempotency_key=? WHERE id=?')->execute([hash('sha256','restore-fixture-key-mismatch'),$id]);
 $reject(fn()=>ZTOrders\filterRestoredRequests($db,$apply,$ledger,true),'same number with different original key is a conflict');
 $db->prepare('UPDATE zt_orders SET idempotency_key=? WHERE id=?')->execute([$key,$id]);
 $token=str_repeat('e',64);$db->prepare('INSERT INTO zt_owner_sessions(token_hash,expires_at) VALUES(?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY))')->execute([$token]);
 $db->exec("CREATE TRIGGER zt_test_restore_failure BEFORE DELETE ON zt_orders FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic restore failure'");
 try{try{ZTOrders\filterRestoredRequests($db,$apply,$ledger,true);throw new RuntimeException('Rollback missing');}catch(PDOException){$check(true,'injected restore cleanup failure reported');}}
 finally{$db->exec('DROP TRIGGER zt_test_restore_failure');}
 foreach($tables as $table=>$field)$check((int)$db->query("SELECT COUNT(*) FROM $table WHERE $field='$id'")->fetchColumn()>0,'restore failure rolls back '.$table);
 $done=ZTOrders\filterRestoredRequests($db,$apply,$ledger,true);
 $check($done['deleted']===1&&$done['publication']==='REQUIRES_SEPARATE_REVIEW','restore filter clears known request without publishing');
 foreach($tables as $table=>$field)$check((int)$db->query("SELECT COUNT(*) FROM $table WHERE $field='$id'")->fetchColumn()===0,'restored copy removed '.$table);
 $check((int)$db->query('SELECT COUNT(*) FROM zt_orders')->fetchColumn()===$count-1,'unrelated restored requests retained');
 $check($done['sessionsInvalidated']>=1&&(int)$db->query("SELECT COUNT(*) FROM zt_owner_sessions WHERE token_hash='$token'")->fetchColumn()===0,'old restored login sessions invalidated');
 $check((int)$db->query("SELECT COUNT(*) FROM zt_notification_queue WHERE status IN ('pending','processing')")->fetchColumn()===0,'restored pending notification queue paused for review');
 $db->exec("DELETE FROM zt_erasure_records WHERE id='$recordId'");
 $done=ZTOrders\filterRestoredRequests($db,$apply,$ledger,true);
 $check($done['importedProofs']===1&&$done['deleted']===0,'ledger restores suppression proof missing from old backup');
 $repo=new ZTOrders\OrderRepository($db,true);
 try{$repo->replay($key,str_repeat('a',64));throw new RuntimeException('Replay restored');}catch(ZTOrders\RequestError $e){$check($e->errorCode==='REQUEST_ERASED','restored suppression proof still blocks old POST');}
 $check(ZTOrders\filterRestoredRequests($db,$apply,$ledger,true)['deleted']===0,'repeated filtering is idempotent');
 $finish=$copies;$finish['backups']=true;$finish['destroyedOn']=$today;
 $reject(fn()=>ZTOrders\confirmErasureCopies($db,$cfg,$recordId,$finish,$now),'metadata confirmation has separate enable flag');
 $cfg['erasure']['copy_confirmation_enabled']=true;$cfg['erasure']['enabled']=false;
 $reject(fn()=>ZTOrders\confirmErasureCopies($db,$cfg,$recordId,$copies,$now),'rolling copies cannot be confirmed destroyed');
 $bad=$finish;$bad['destroyedOn']='2099-01-01';$reject(fn()=>ZTOrders\confirmErasureCopies($db,$cfg,$recordId,$bad,$now),'future destruction date rejected');
 $bad=$finish;unset($bad['destroyedOn']);$reject(fn()=>ZTOrders\confirmErasureCopies($db,$cfg,$recordId,$bad,$now),'real destruction date required');
 $confirmed=ZTOrders\confirmErasureCopies($db,$cfg,$recordId,$finish,$now);
 $check($confirmed['deleted']===0&&$confirmed['mode']==='COPIES_CONFIRMED_ACT_UNSIGNED','confirmation changes metadata only and does not invent signature');
 $after=$db->query("SELECT * FROM zt_erasure_records WHERE id='$recordId'")->fetch(PDO::FETCH_ASSOC);
 $check($after['copy_state']==='confirmed'&&$after['copies_confirmed_at']!==null,'copy completion recorded separately');
 $reject(fn()=>ZTOrders\filterRestoredRequests($db,$apply,$ledger,true),'stale external ledger cannot overwrite newer completed proof');
 $docs=ZTOrders\erasureDocuments($db,$recordId);$check(str_contains($docs['act-draft.txt'],'ТРЕБУЕТ ПОДПИСИ'),'completed copy check still needs signed act');
 $artifact=ZTOrders\exportRestoreLedgerToPrivate($db,'/restore-fixture');
 $check(is_file('/restore-fixture/'.$artifact['fileName'])&&$artifact['externalCopyRequired']===true,'private ledger export explicitly requires external copy');
 $raw=file_get_contents('/restore-fixture/'.$artifact['fileName']);$newLedger=ZTOrders\validateRestoreLedger($raw,$artifact['sha256']);
 $check($newLedger['records'][0]['copy_state']==='confirmed','latest export contains copy confirmation');
 ZTOrders\privateArtifact('/restore-fixture','draft.txt','first');
 $reject(fn()=>ZTOrders\privateArtifact('/restore-fixture','draft.txt','changed'),'private export refuses overwriting changed documents');
}finally{
 foreach(array_reverse(array_keys($tables)) as $table){$field=$tables[$table];$db->exec("DELETE FROM $table WHERE $field='$id'");}
 $db->exec("DELETE FROM zt_erasure_records WHERE order_number='$number'");
}

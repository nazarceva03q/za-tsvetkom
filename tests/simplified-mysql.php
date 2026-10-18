<?php
declare(strict_types=1);
if(!isset($lab)||!preg_match('/^mysql:host=127\\.0\\.0\\.1;port=[0-9]+;dbname=zt_test_orders_php_review;charset=utf8mb4$/D',$lab['dsn']??''))throw new RuntimeException('Disposable local schema required');
require '/private/lib/Validation.php';
require '/private/lib/Repository.php';
require '/private/lib/Notifications.php';
$db=ZTOrders\connect($lab);
if($db->query('SHOW TABLES')->fetchColumn()!==false)throw new RuntimeException('Schema must be empty');
function ok(bool $v,string $label):void{if(!$v)throw new RuntimeException($label);echo "PASS $label\n";}
function migration(PDO $db,string $name):void{
 $sql=preg_replace('/^--.*$/m','',file_get_contents('/migrations/'.$name));
 foreach(explode(';',$sql) as $statement)if(trim($statement)!=='')$db->exec($statement);
}
migration($db,'001-orders.sql');migration($db,'002-owner-notifications.sql');
$db->exec("INSERT INTO zt_orders(id,order_number,idempotency_key,request_hash,kind,subject,customer_name,phone,contact_channel,delivery_address,comment,consent_version,consent_text_sha256,consent_at,total_kopecks,created_at) VALUES(REPEAT('f',32),'ZT-FFFFFFFFFFFFFFFF',REPEAT('f',64),REPEAT('f',64),'inquiry','Legacy','Legacy','79990000000','Телефон','','','old',REPEAT('a',64),UTC_TIMESTAMP(),12300,'2000-01-01')");
migration($db,'003-simple-requests.sql');
ok((int)$db->query("SELECT total_kopecks FROM zt_orders WHERE request_type='legacy'")->fetchColumn()===12300,'003 preserves historical values');
$repo=new ZTOrders\OrderRepository($db);
$base=['kind'=>'order','requestType'=>'cart','subject'=>'Заявка на заказ','name'=>'SECRET_NAME','phone'=>'79990000000','channel'=>'Телефон',
'date'=>'','delivery'=>'Доставка','time'=>'13-16','address'=>'SECRET_ADDRESS','comment'=>'SECRET_COMMENT','consent'=>true,'consentVersion'=>'2026-10-requests-v2',
'items'=>[['id'=>'brand-new-cloud-product','name'=>'Букет только в Яндексе','quantity'=>2]]];
function saveTest(array $input,string $key,string $rate,int $limit=10):array{
 global $repo;$r=ZTOrders\normalizeRequest($input);$hash=hash('sha256',ZTOrders\encode($r));$r['consentTextSha256']=str_repeat('a',64);
 return $repo->save($key,$hash,$r,ZTOrders\requestItems($r),$rate,$limit);
}
$db->exec('ALTER TABLE zt_notification_queue ADD CONSTRAINT ck_fail CHECK(attempts>0)');
try{saveTest($base,str_repeat('1',64),str_repeat('2',64));ok(false,'queue fail');}catch(PDOException){ok(true,'injected queue failure');}
foreach(['zt_order_items','zt_notification_queue','zt_order_rate_limits'] as $table)ok((int)$db->query('SELECT COUNT(*) FROM '.$table)->fetchColumn()===0,'rollback '.$table);
ok((int)$db->query('SELECT COUNT(*) FROM zt_orders')->fetchColumn()===1,'rollback preserves legacy only');
$db->exec('ALTER TABLE zt_notification_queue DROP CHECK ck_fail');
$first=saveTest($base,str_repeat('1',64),str_repeat('2',64));$again=saveTest($base,str_repeat('1',64),str_repeat('2',64));
ok($first['orderNumber']===$again['orderNumber']&&$again['replayed'],'same key same request once');
$changed=$base;$changed['comment']='Changed';
try{saveTest($changed,str_repeat('1',64),str_repeat('2',64));ok(false,'conflict');}catch(ZTOrders\RequestError $e){ok($e->errorCode==='IDEMPOTENCY_CONFLICT','key/body conflict');}
try{saveTest($base,str_repeat('3',64),str_repeat('2',64),1);ok(false,'rate');}catch(ZTOrders\RequestError $e){ok($e->errorCode==='RATE_LIMITED','rate rollback');}
ok((int)$db->query('SELECT COUNT(*) FROM zt_orders')->fetchColumn()===2,'no partial rate-limited request');
$item=$db->query('SELECT * FROM zt_order_items LIMIT 1')->fetch(PDO::FETCH_ASSOC);
ok($item['unit_price_kopecks']===null&&$item['line_total_kopecks']===null&&!str_contains($item['product_snapshot'],'images'),'no invented price or photo');
$idx=4;
foreach(['gift','large','corporate','question','preorder','other'] as $type){
 $v=array_replace($base,['kind'=>'inquiry','requestType'=>$type,'items'=>[],'delivery'=>'','time'=>'','address'=>'','quantity'=>12,'budget'=>3000]);
 saveTest($v,str_pad((string)$idx++,64,'0'),str_repeat('4',64),100);
 ok((int)$db->query("SELECT COUNT(*) FROM zt_orders WHERE request_type='$type'")->fetchColumn()===1,'saved type '.$type);
}
$db->exec("UPDATE zt_notification_queue SET status='sent'");
$id=$db->query("SELECT q.id FROM zt_notification_queue q JOIN zt_orders o ON o.id=q.order_id WHERE o.request_type='cart'")->fetchColumn();
$db->exec("UPDATE zt_notification_queue SET status='pending',next_attempt_at=UTC_TIMESTAMP() WHERE id=".(int)$id);
$jobs=[];$worker=new ZTOrders\NotificationWorker($db,['owner_id'=>12345,'timezone'=>'Asia/Yekaterinburg'],function($j)use(&$jobs){$jobs[]=$j;return ['ok'=>false,'retry'=>true,'code'=>'RELAY_HTTP_503'];});
ok($worker->runOne(),'Yandex outage handled after saved request');
ok($db->query("SELECT status FROM zt_notification_queue WHERE id=".(int)$id)->fetchColumn()==='pending','retry queued on relay outage');
ok(!$worker->runOne(),'immediate cron does not resend');
foreach(['SECRET_NAME','79990000000','SECRET_ADDRESS','SECRET_COMMENT'] as $private)ok(!str_contains($jobs[0]['message_text'],$private),'no PII in notification '.$private);
$db->exec("UPDATE zt_notification_queue SET next_attempt_at=UTC_TIMESTAMP() WHERE id=".(int)$id);
$success=new ZTOrders\NotificationWorker($db,['owner_id'=>12345,'timezone'=>'Asia/Yekaterinburg'],function($j)use(&$jobs){$jobs[]=$j;return ['ok'=>true,'messageId'=>123];});
$success->runOne();
ok($jobs[0]['vk_random_id']===$jobs[1]['vk_random_id']&&$jobs[0]['message_text']===$jobs[1]['message_text'],'stable relay payload across retry');
ok(!$success->runOne(),'sent not sent again');
$db->exec("UPDATE zt_notification_queue SET status='pending',attempts=0,next_attempt_at=UTC_TIMESTAMP() WHERE id=".(int)$id);
$claim=$worker->claim();ok($worker->claim()===null,'overlap cannot claim active lease');
$db->exec("UPDATE zt_notification_queue SET locked_until=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=".(int)$id);
$reclaim=$worker->claim();ok($claim['id']===$reclaim['id']&&$claim['vk_random_id']===$reclaim['vk_random_id'],'expired lease recovery stable');
$db->exec("UPDATE zt_notification_queue SET status='sent'");
echo "DATABASE_READY\n";

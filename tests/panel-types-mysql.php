<?php
declare(strict_types=1);
require_once '/private/lib/RequestView.php';
if(!isset($lab)||!str_starts_with($lab['dsn'],'mysql:host=127.0.0.1;'))throw new RuntimeException('Isolated lab required');
$db=ZTOrders\connect($lab);
$check=static function(bool $ok,string $label):void{if(!$ok)throw new RuntimeException($label);echo "PASS panel types $label\n";};
$db->exec('CREATE TEMPORARY TABLE zt_orders(id INT PRIMARY KEY,request_type VARCHAR(20))');
$db->exec('CREATE TEMPORARY TABLE zt_order_items(order_id INT,product_snapshot TEXT)');
try{
 $db->exec("INSERT INTO zt_orders VALUES(1,'cart'),(2,'other'),(3,'other'),(4,'question'),(5,'corporate'),(6,'legacy'),(7,'other')");
 $q=$db->prepare('INSERT INTO zt_order_items VALUES(?,?)');
 $q->execute([1,'{"business":true}']);$q->execute([2,'{"business":true}']);$q->execute([3,'{"business":false}']);$q->execute([7,'not-json']);
 $rows=$db->query('SELECT id,'.ZTOrders\panelTypeSql().' AS display_type FROM zt_orders ORDER BY id')->fetchAll(PDO::FETCH_KEY_PAIR);
 $check(array_values($rows)===['cart','business','other','question','corporate','legacy','other'],'business separated, cart and historical types preserved, invalid JSON safe');
 $q=$db->prepare('SELECT id FROM zt_orders WHERE '.ZTOrders\panelTypeSql().'=?');$q->execute(['business']);
 $check($q->fetchAll(PDO::FETCH_COLUMN)===[2],'business filter returns matching request only');
 $q->execute(['other']);$check($q->fetchAll(PDO::FETCH_COLUMN)===[3,7],'general filter excludes business without losing other requests');
 $types=ZTOrders\panelRequestTypes();
 $check(isset($types['business'])&&!isset($types['question'],$types['corporate'],$types['legacy']),'current options omit unused and historical scenarios');
}finally{$db->exec('DROP TEMPORARY TABLE zt_order_items');$db->exec('DROP TEMPORARY TABLE zt_orders');}

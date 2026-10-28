<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
try{
 $main=dirname(__DIR__);$test=dirname($main).'/private-orders-test';
 $c=require $test.'/config.php';
 if(!preg_match('/(?:^|;)dbname=u3685169_ztrestore(?:;|$)/',$c['dsn']??''))throw new RuntimeException('DATABASE');
 require_once $test.'/lib/Notifications.php';$db=\ZTOrders\connect($c);
 $result=['database'=>$db->query('SELECT DATABASE()')->fetchColumn(),
 'catalogFileExists'=>is_file($test.'/catalog/state.json'),
 'catalogReadable'=>is_readable($test.'/catalog/state.json'),
 'enrichmentLibraryExists'=>is_file($test.'/lib/BotInbox.php'),
 'catalogLibraryExists'=>is_file($test.'/lib/Catalog.php')];
 $byId=[];
 try{
  require_once $test.'/lib/Catalog.php';$s=\ZTCatalog\readState($test.'/catalog');
  foreach($s['catalog'] as $products)foreach($products as $p)$byId[$p['id']]=$p;
  $result['catalogRead']='OK';$result['catalogProducts']=count($byId);
 }catch(Throwable $e){$result['catalogRead']='FAILED';$result['catalogErrorClass']=get_class($e);}
 $q=$db->query("SELECT o.order_number,i.product_id,i.product_name,i.product_snapshot FROM zt_order_items i JOIN zt_orders o ON o.id=i.order_id WHERE o.phone='70000000000' AND o.customer_name='Вымышленный клиент' ORDER BY o.created_at DESC,i.id DESC LIMIT 5");
 $result['recentTestItems']=[];
 foreach($q->fetchAll(PDO::FETCH_ASSOC) as $r){
  $snapshot=json_decode($r['product_snapshot'],true);$p=$byId[$r['product_id']]??null;
  $result['recentTestItems'][]=['number'=>$r['order_number'],'productId'=>$r['product_id'],'productName'=>$r['product_name'],
   'snapshotSource'=>$snapshot['source']??null,'savedPhotos'=>count($snapshot['images']??[]),
   'foundInCatalog'=>$p!==null,'catalogPhotos'=>count($p['images']??[])];
 }
 echo json_encode($result,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),PHP_EOL;
}catch(Throwable $e){fwrite(STDERR,'PHOTO_CHECK_NOT_COMPLETED: '.get_class($e)."\n");exit(1);}

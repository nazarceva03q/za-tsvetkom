<?php
declare(strict_types=1);
require __DIR__.'/../backend/orders/lib/Validation.php';
use function ZTOrders\normalizeRequest;
use function ZTOrders\requestItems;
$count=0;
function verify(bool $ok,string $name):void{global $count;if(!$ok)throw new RuntimeException($name);$count++;echo "PASS $name\n";}
$today=new DateTimeImmutable('2026-10-18',new DateTimeZone('Asia/Yekaterinburg'));
$base=['kind'=>'order','requestType'=>'cart','subject'=>'Заявка на заказ','name'=>'Тест','phone'=>'79990000000','channel'=>'Телефон',
'date'=>'','delivery'=>'Доставка','time'=>'13-16','address'=>'Тестовый адрес','comment'=>'Пожелания','consent'=>true,
'consentVersion'=>'2026-10-requests-v2','quantity'=>null,'budget'=>null,
'items'=>[['id'=>'new-yandex-product','name'=>'Новый букет из Яндекса','quantity'=>2]]];
$r=normalizeRequest($base,$today);$priced=requestItems($r);
verify($priced['totalKopecks']===null && $priced['items'][0]['unitPriceKopecks']===null,'no confirmed price or catalog lookup');
verify($priced['items'][0]['name']==='Новый букет из Яндекса','name snapshot from request');
verify(!isset($priced['items'][0]['snapshot']['images']),'no photo snapshot');
foreach(['gift','large','corporate','question','preorder','other'] as $type){
 $v=array_replace($base,['kind'=>'inquiry','requestType'=>$type,'items'=>[],'delivery'=>'','time'=>'','address'=>'','quantity'=>20,'budget'=>5000]);
 $r=normalizeRequest($v,$today);verify($r['requestType']===$type && $r['comment']==='Пожелания' && $r['budget']===5000,'non-product form '.$type);
}
function rejected(array $v,string $label):void{global $today;try{normalizeRequest($v,$today);verify(false,$label);}catch(ZTOrders\RequestError){verify(true,$label);}}
foreach([
 ['phone','123'],['name',''],['consent',false],['consentVersion','2026-10-orders-v1'],
 ['requestType','anything'],['date','2020-01-01'],['website','spam'],['comment',[]],['budget',-1],['quantity',1.5],['address','']
] as [$key,$value])rejected(array_replace($base,[$key=>$value]),'invalid '.$key);
$v=$base;$v['items'][0]['expectedPriceKopecks']=1;rejected($v,'price payload rejected');
$v=$base;$v['items'][0]['images']=['https://invalid.test/a.jpg'];rejected($v,'photos rejected');
$v=$base;$v['items'][0]['name']='';rejected($v,'empty item name');
$v=$base;$v['items'][]=$v['items'][0];rejected($v,'duplicate product id');
$v=$base;$v['items'][0]['quantity']=100;rejected($v,'quantity bound');
$v=array_replace($base,['kind'=>'inquiry','requestType'=>'question','items'=>[],'delivery'=>'','time'=>'','address'=>'','comment'=>'']);rejected($v,'question requires text');
verify(normalizeRequest(array_replace($base,['date'=>'2020-01-01']),$today,false)['date']==='2020-01-01','replay ignores elapsed date before lookup');
echo "TOTAL $count\n";

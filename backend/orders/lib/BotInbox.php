<?php
declare(strict_types=1);
namespace ZTOrders;
require_once __DIR__.'/Notifications.php';

/** Read-only projection. Never return credentials, consent hashes or internal JSON. */
function inboxAuthorized(array $config, array $server): bool {
    $cfg=$config['bot_inbox']??[];
    $key=$server['HTTP_X_ZT_INBOX_KEY']??'';
    $viewer=(string)($server['HTTP_X_ZT_VIEWER_ID']??'');
    $allowed=array_map('strval', $cfg['viewer_ids']??[]);
    $owner=(string)($config['notifications']['owner_id']??'');
    if(preg_match('/^[1-9][0-9]{0,15}$/D',$owner))$allowed[]=$owner;
    return ($cfg['enabled']??false)===true && preg_match('/^[a-f0-9]{64}$/D',$cfg['secret']??'')
        && is_string($key) && hash_equals($cfg['secret'],$key)
        && preg_match('/^[1-9][0-9]{0,15}$/D',$viewer) && in_array($viewer,$allowed,true);
}

function inboxPhoto(mixed $value, string $origin): ?string {
    if(!is_string($value)||!preg_match('~^https://[a-z0-9.-]+$~D',$origin))return null;
    $relative=str_starts_with($value,$origin.'/')?substr($value,strlen($origin)+1):ltrim($value,'/');
    if(!preg_match('~^assets/[a-zA-Z0-9_./-]+\.(?:jpg|jpeg|png|webp)(?:\?v=[a-zA-Z0-9_-]+)?$~D',$relative)
        || str_contains($relative,'..'))return null;
    return $origin.'/'.$relative;
}

/** A local REG snapshot is optional: catalog failure must not block a request. */
function enrichRequestItems(array $request, array $priced, string $private): array {
    if(!is_file($private.'/catalog/state.json'))return $priced;
    try {
        require_once __DIR__.'/Catalog.php';
        $state=\ZTCatalog\readState($private.'/catalog');
        $byId=[];
        foreach($state['catalog'] as $category=>$products)foreach($products as $product)$byId[$product['id']]=$product;
        $snapshot=static function(array $p): array {
            return array_intersect_key($p,array_flip(['id','name','category','images','description','note','price','priceLabel','photoPrices','photoPriceLabels','business']))
                +['source'=>'reg_catalog_at_submission','priceConfirmed'=>false];
        };
        foreach($priced['items'] as &$item)if(isset($byId[$item['id']]))$item['snapshot']=$snapshot($byId[$item['id']]);
        unset($item);
        // Existing product inquiries carry the name in the subject. Resolve only
        // a unique exact name after a known prefix; never guess by partial words.
        if(!$priced['items']) {
            $subject=$request['subject'];$matches=[];$selectedPhoto=0;
            foreach(['Собрать похожий: ','Предзаказ: ','Уточнить цену: ','Букет из шаров: ','Оформление для бизнеса: '] as $prefix) {
                if(!str_starts_with($subject,$prefix))continue;
                $name=substr($subject,strlen($prefix));
                foreach($byId as $p)if($p['name']===$name)$matches[]=$p;
            }
            foreach($byId as $p)if(!empty($p['business'])) {
                $prefix=$p['name'].' – фото ';
                if(str_starts_with($subject,$prefix)&&preg_match('/^([1-9][0-9]?), /u',substr($subject,strlen($prefix)),$m)
                    &&isset($p['images'][(int)$m[1]-1])){$matches[]=$p;$selectedPhoto=(int)$m[1]-1;}
            }
            if(count($matches)===1){$p=$matches[0];$s=$snapshot($p);
                if($selectedPhoto>0){$url=$s['images'][$selectedPhoto];unset($s['images'][$selectedPhoto]);array_unshift($s['images'],$url);}
                if(isset($p['photoPriceLabels'][$selectedPhoto]))$s['priceLabel']=$p['photoPriceLabels'][$selectedPhoto];
                elseif(isset($p['photoPrices'][$selectedPhoto]))$s['priceLabel']=(string)$p['photoPrices'][$selectedPhoto].' ₽';
                $priced['items'][]=['id'=>$p['id'],'name'=>$p['name'],'quantity'=>1,
                'unitPriceKopecks'=>null,'lineTotalKopecks'=>null,'madeToOrder'=>false,
                'snapshot'=>$s+['inquiryReference'=>true]];}
        }
    } catch(\Throwable) { /* request stays valid without a catalog snapshot */ }
    return $priced;
}

function inboxSummary(array $row): array {
    return ['number'=>$row['order_number'],'type'=>requestTypes()[$row['request_type']]??'Обращение',
        'subject'=>$row['subject'],'name'=>$row['customer_name'],'createdAt'=>requestDate($row['created_at']).' (Пермь)'];
}
function inboxList(\PDO $db,int $offset): array {
    $q=$db->query('SELECT order_number,request_type,subject,customer_name,created_at FROM zt_orders WHERE erased_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 5 OFFSET '.$offset);
    $rows=$q->fetchAll(\PDO::FETCH_ASSOC);$more=count($rows)>4;
    return ['ok'=>true,'items'=>array_map(__NAMESPACE__.'\\inboxSummary',array_slice($rows,0,4)),
        'offset'=>$offset,'hasMore'=>$more];
}
function inboxDetail(\PDO $db,string $number,string $origin): ?array {
    $q=$db->prepare('SELECT * FROM zt_orders WHERE order_number=? AND erased_at IS NULL');$q->execute([$number]);
    $row=$q->fetch(\PDO::FETCH_ASSOC);if(!$row)return null;
    $out=inboxSummary($row);
    $fields=['phone'=>'Телефон','contact_channel'=>'Связаться через','desired_date'=>'Желаемая дата',
        'delivery_method'=>'Получение','time_slot'=>'Время получения','delivery_address'=>'Адрес доставки',
        'comment'=>'Пожелания / вопрос','requested_quantity'=>'Запрошенное количество','budget_rubles'=>'Бюджет, ₽'];
    $out['fields']=[];
    foreach($fields as $key=>$label)if(($row[$key]??'')!==''&&$row[$key]!==null)$out['fields'][]=['label'=>$label,'value'=>(string)$row[$key]];
    // First/repeat describes requests with this phone that are still retained,
    // not verified identity, completed purchases or an all-time history.
    $out['previousRequests']=null;
    if(preg_match('/^7[0-9]{10}$/D',$row['phone']??'')) {
        $q=$db->prepare('SELECT COUNT(*) FROM zt_orders WHERE phone=? AND erased_at IS NULL AND (created_at<? OR (created_at=? AND id<?))');
        $q->execute([$row['phone'],$row['created_at'],$row['created_at'],$row['id']]);$out['previousRequests']=(int)$q->fetchColumn();
    }
    $q=$db->prepare('SELECT product_id,product_name,quantity,product_snapshot FROM zt_order_items WHERE order_id=? ORDER BY id');$q->execute([$row['id']]);
    $out['items']=[];
    foreach($q->fetchAll(\PDO::FETCH_ASSOC) as $item) {
        $s=json_decode($item['product_snapshot'],true);if(!is_array($s))$s=[];
        $photos=[];foreach(($s['images']??[]) as $url){$photo=inboxPhoto($url,$origin);if($photo)$photos[]=$photo;}
        $out['items'][]=['id'=>$item['product_id'],'name'=>$item['product_name'],'quantity'=>(int)$item['quantity'],
            'category'=>is_string($s['category']??null)?$s['category']:'',
            'description'=>is_string($s['description']??null)?$s['description']:'',
            'note'=>is_string($s['note']??null)?$s['note']:'',
            'priceLabel'=>is_string($s['priceLabel']??null)?$s['priceLabel']:(isset($s['price'])?(string)$s['price'].' ₽':''),
            'photos'=>$photos,'referenceOnly'=>($s['inquiryReference']??false)===true];
    }
    return $out;
}
function runInbox(string $private): void {
    try {
        $config=require $private.'/config.php';
        if(!inboxAuthorized($config,$_SERVER)){http_response_code(403);echo '{"ok":false,"code":"FORBIDDEN"}';return;}
        if(($_SERVER['REQUEST_METHOD']??'')!=='GET'){header('Allow: GET');http_response_code(405);echo '{"ok":false,"code":"METHOD_NOT_ALLOWED"}';return;}
        $number=$_GET['number']??null;$offset=$_GET['offset']??'0';
        if(array_diff(array_keys($_GET),['number','offset']) || ($number!==null&&(!is_string($number)||!preg_match('/^ZT-[A-F0-9]{16}$/D',$number)))
            || !is_string($offset)||!preg_match('/^(?:0|[1-9][0-9]{0,5})$/D',$offset)) {
            http_response_code(422);echo '{"ok":false,"code":"INVALID_QUERY"}';return;
        }
        $db=connect($config);
        $result=$number===null?inboxList($db,(int)$offset):inboxDetail($db,$number,$config['origin']);
        if($result===null){http_response_code(404);echo '{"ok":false,"code":"NOT_FOUND"}';return;}
        echo json_encode($number===null?$result:['ok'=>true,'request'=>$result],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    } catch(\Throwable){http_response_code(503);echo '{"ok":false,"code":"INBOX_UNAVAILABLE"}';}
}

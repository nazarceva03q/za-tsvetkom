<?php
declare(strict_types=1);
namespace ZTOrders;
require_once __DIR__.'/RetentionDecisions.php';
require_once __DIR__.'/RestoreGuard.php';
final class ErasureError extends \RuntimeException {}

/** Human attestation, never an automatic assertion about provider backups or VK. */
function erasureContext(array $config,array $copies,string $number,\DateTimeImmutable $now): array {
    $policy=$config['erasure']??[];
    if(($policy['schema_ready']??false)!==true||($policy['copies_schema_ready']??false)!==true||($policy['enabled']??false)!==true)
        throw new ErasureError('ERASURE_DISABLED');
    $text=static function(mixed $v,int $max=500):string {
        if(!is_string($v)||trim($v)===''||strlen($v)>$max||preg_match('/[\x00-\x1f\x7f]/',$v))throw new ErasureError('EVIDENCE_CONFIGURATION');
        return trim($v);
    };
    $operator=$policy['operator']??[];$actor=$policy['actor']??[];
    $context=['operator'=>['name'=>$text($operator['name']??null),'address'=>$text($operator['address']??null)],
        'actor'=>['name'=>$text($actor['name']??null),'role'=>$text($actor['role']??null)],
        'system'=>$text($policy['system']??null),'processors'=>[]];
    if(!isset($policy['processors'])||!is_array($policy['processors'])||!array_is_list($policy['processors'])||count($policy['processors'])>10)
        throw new ErasureError('PROCESSORS_REQUIRED');
    foreach($policy['processors'] as $p)$context['processors'][]=['name'=>$text($p['name']??null),'address'=>$text($p['address']??null)];
    if(($copies['orderNumber']??'')!==$number)throw new ErasureError('COPY_SCOPE_MISMATCH');
    $backups=$copies['backups']??false;$reviewAt=null;
    $pendingReview=$backups==='pending';
    if($pendingReview){
        if(($policy['pending_copy_review_enabled']??false)!==true||($copies['pendingReviewAcknowledged']??false)!==true)
            throw new ErasureError('PENDING_COPY_REVIEW_DISABLED');
        // Database cleanup is useful even while external copies are unresolved.
        // This does not attest blocking, destruction, or provider compliance.
        $reviewAt=$now->modify('+1 day')->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
    } else {
        foreach(['exports','vk','logs'] as $key)
            if(($copies[$key]??false)!==true)throw new ErasureError('COPY_REVIEW_REQUIRED');
    }
    if($backups==='rolling'){
        $days=$policy['backup_retention_days']??null;
        if(($policy['backup_rollover_approved']??false)!==true||($config['restore_guard']['prepared']??false)!==true
            ||!is_int($days)||$days<1||$days>30||($copies['backupRestrictionConfirmed']??false)!==true
            ||($copies['restoreProcedureConfirmed']??false)!==true)throw new ErasureError('BACKUP_RESTRICTION_NOT_CONFIRMED');
        // Reminder only, never proof that every archive has expired.
        $reviewAt=$now->modify('+'.($days+1).' days')->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
    }elseif($backups!==true&&!$pendingReview)throw new ErasureError('COPY_REVIEW_REQUIRED');
    $at=$copies['checkedAt']??null;
    if(!is_string($at)||!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/D',$at))throw new ErasureError('COPY_REVIEW_DATE');
    try{$date=new \DateTimeImmutable($at);}catch(\Throwable){throw new ErasureError('COPY_REVIEW_DATE');}
    if($date->format('Y-m-d\TH:i:s\Z')!==$at||$date>$now||$date<$now->modify('-24 hours'))throw new ErasureError('COPY_REVIEW_EXPIRED');
    $context['copies']=['orderNumber'=>$number,'checkedAt'=>$at,'checkedBy'=>$text($copies['checkedBy']??null),
        'reference'=>$text($copies['reference']??null),'backups'=>$backups,'exports'=>!$pendingReview,'vk'=>!$pendingReview,'logs'=>!$pendingReview,
        'source'=>'human_attestation_not_provider_verification',
        'backupRestrictionConfirmed'=>$backups==='rolling','restoreProcedureConfirmed'=>$backups==='rolling',
        'backupRetentionDays'=>$backups==='rolling'?$policy['backup_retention_days']:null];
    $context['copies']['pendingReviewAcknowledged']=$pendingReview;
    $context['copyState']=$backups!==true?'pending':'confirmed';
    $context['backupReviewAt']=$reviewAt;
    $context['copiesConfirmedAt']=$backups!==true?null:$now->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
    return $context;
}

/** Aggregate preview only. No request identities or customer data on stdout. */
function erasurePreview(\PDO $db,array $config=[]): array {
    $q=$db->query("SELECT COUNT(*) AS marked,SUM(o.complaint_open<>0) AS complaints,
        SUM(EXISTS(SELECT 1 FROM zt_notification_queue n WHERE n.order_id=o.id AND n.status='processing')) AS in_flight
        FROM zt_orders o JOIN zt_retention_reviews r ON r.order_id=o.id WHERE r.decision='ready' AND o.erased_at IS NULL");
    $r=$q->fetch(\PDO::FETCH_ASSOC);
    $result=['mode'=>'PREVIEW_ONLY','marked'=>(int)$r['marked'],'openComplaints'=>(int)$r['complaints'],
        'inFlight'=>(int)$r['in_flight'],'deleted'=>0,'requires'=>'explicit_single_request_and_copy_review'];
    if(($config['erasure']['copies_schema_ready']??false)===true){
        $counts=$db->query("SELECT COUNT(*) AS pending,SUM(backup_review_at<=UTC_TIMESTAMP(6)) AS due FROM zt_erasure_records WHERE copy_state='pending'")->fetch(\PDO::FETCH_ASSOC);
        $result['copiesPending']=(int)$counts['pending'];$result['copyReviewsDue']=(int)$counts['due'];
    }
    return $result;
}

/** One explicitly named request. All database changes and evidence are atomic. */
function eraseReviewedRequest(\PDO $db,array $config,string $number,int $version,array $copies,?\DateTimeImmutable $now=null): array {
    if(!preg_match('/^ZT-[A-F0-9]{16}$/D',$number)||$version<1)throw new ErasureError('INVALID_TARGET');
    $now=($now??new \DateTimeImmutable('now',new \DateTimeZone('UTC')))->setTimezone(new \DateTimeZone('UTC'));
    $context=erasureContext($config,$copies,$number,$now);
    $db->beginTransaction();
    try {
        $q=$db->prepare('SELECT * FROM zt_orders WHERE order_number=? FOR UPDATE');$q->execute([$number]);$order=$q->fetch(\PDO::FETCH_ASSOC);
        if(!$order){
            $q=$db->prepare('SELECT id,review_version FROM zt_erasure_records WHERE order_number=?');$q->execute([$number]);$record=$q->fetch(\PDO::FETCH_ASSOC);
            if(!$record||(int)$record['review_version']!==$version)throw new ErasureError('TARGET_MISSING_OR_CHANGED');
            if(!$db->commit())throw new ErasureError('COMMIT_NOT_CONFIRMED');
            return ['mode'=>'ALREADY_CLEARED','recordId'=>$record['id'],'deleted'=>0];
        }
        if($order['erased_at']!==null||$order['complaint_open'])throw new ErasureError('MANUAL_REVIEW_REQUIRED');
        $q=$db->prepare('SELECT * FROM zt_retention_reviews WHERE order_id=? FOR UPDATE');$q->execute([$order['id']]);$review=$q->fetch(\PDO::FETCH_ASSOC);
        if(!$review||$review['decision']!=='ready'||(int)$review['version']!==$version)throw new ErasureError('DECISION_CHANGED');
        // A workflow change after a ready decision invalidates its applicability.
        $q=$db->prepare("SELECT details FROM zt_request_events WHERE order_id=? AND event_type='retention_reviewed' ORDER BY id DESC LIMIT 1");$q->execute([$order['id']]);
        $event=json_decode($q->fetchColumn()?:'{}',true,32,JSON_THROW_ON_ERROR);
        if(($event['version']??null)!==$version||($event['decision']??'')!=='ready'
            ||!isset($event['orderVersion'])||(int)$event['orderVersion']!==(int)$order['workflow_version'])throw new ErasureError('RECONFIRM_DECISION');
        $q=$db->prepare('SELECT status FROM zt_notification_queue WHERE order_id=? FOR UPDATE');$q->execute([$order['id']]);
        if(in_array('processing',$q->fetchAll(\PDO::FETCH_COLUMN),true))throw new ErasureError('NOTIFICATION_IN_FLIGHT');
        $id=bin2hex(random_bytes(16));$at=$now->format('Y-m-d H:i:s.u');
        $categories=['идентификаторы и согласие по заявке','имя и контактные данные'];
        if(($order['subject']??'')!==''||($order['comment']??'')!=='')$categories[]='содержание обращения';
        foreach(['desired_date','delivery_method','time_slot','delivery_address'] as $field)
            if(($order[$field]??'')!==''){$categories[]='условия получения и доставки';break;}
        if(($order['requested_quantity']??null)!==null||($order['budget_rubles']??null)!==null)$categories[]='запрошенное количество и бюджет';
        $q=$db->prepare('SELECT COUNT(*) FROM zt_order_items WHERE order_id=?');$q->execute([$order['id']]);
        if((int)$q->fetchColumn()>0)$categories[]='выбранные товары и снимки карточек';
        $categories[]='история действий и решение о хранении';
        $q=$db->prepare('SELECT COUNT(*) FROM zt_notification_queue WHERE order_id=?');$q->execute([$order['id']]);
        if((int)$q->fetchColumn()>0)$categories[]='очередь уведомлений';
        $evidence=$context+['rule'=>'reviewed-erasure-v1','recordId'=>$id,'subjectReference'=>$number,
            'categories'=>$categories,'reason'=>'Цель обращения завершена; владелец подтвердил отсутствие дальнейшей необходимости и другого основания хранения',
            'method'=>'Транзакционное удаление строк заявки и связанных записей из рабочей SQL-базы',
            'clearedAt'=>$now->format('Y-m-d\TH:i:s.u\Z'),'retainUntil'=>$now->modify('+3 years')->format('Y-m-d\TH:i:s.u\Z'),
            'decisionVersion'=>$version,'goalEndedAt'=>$review['goal_ended_at'],'deadlineAt'=>$review['erase_due_at'],
            'status'=>$context['copyState']==='pending'?'DATABASE_CLEARED_BACKUPS_PENDING_ACT_UNSIGNED':'DATABASE_CLEARED_COPIES_ATTESTED_ACT_UNSIGNED','signature'=>'REQUIRED',
            'scope'=>$context['copyState']==='pending'?'Удалены строки рабочей SQL-базы. Внешние экземпляры требуют отдельной проверки; полное уничтожение не подтверждено.':'Рабочая SQL-база; внешние копии подтверждены человеком, а не проверены программой. Не является физическим стиранием носителей провайдера.'];
        $q=$db->prepare('INSERT INTO zt_erasure_records(id,order_number,replay_key_hash,review_version,evidence,cleared_at,retain_until,copy_state,backup_review_at,copies_confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
        $q->execute([$id,$number,hash('sha256',$order['idempotency_key']),$version,json_encode($evidence,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),$at,$now->modify('+3 years')->format('Y-m-d H:i:s.u'),$context['copyState'],$context['backupReviewAt'],$context['copiesConfirmedAt']]);
        foreach(['zt_notification_queue','zt_order_items','zt_request_events','zt_retention_reviews'] as $table){$q=$db->prepare('DELETE FROM '.$table.' WHERE order_id=?');$q->execute([$order['id']]);}
        $q=$db->prepare('DELETE FROM zt_orders WHERE id=?');$q->execute([$order['id']]);
        if($q->rowCount()!==1)throw new ErasureError('DELETE_NOT_CONFIRMED');
        if(!$db->commit())throw new ErasureError('COMMIT_NOT_CONFIRMED');
        return ['mode'=>'DATABASE_CLEARED','recordId'=>$id,'deleted'=>1,'act'=>'UNSIGNED_DRAFT','copies'=>($context['copies']['pendingReviewAcknowledged']??false)?'REVIEW_PENDING':($context['copyState']==='pending'?'BACKUPS_PENDING':'HUMAN_ATTESTED'),'externalLedgerCopyRequired'=>true];
    }catch(\Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

/** Export from committed SQL evidence: recoverable if file creation previously failed. */
function erasureDocuments(\PDO $db,string $id): array {
    if(!preg_match('/^[a-f0-9]{32}$/D',$id))throw new ErasureError('INVALID_RECORD');
    $q=$db->prepare('SELECT evidence,copy_state,backup_review_at,copies_confirmed_at FROM zt_erasure_records WHERE id=?');$q->execute([$id]);$row=$q->fetch(\PDO::FETCH_ASSOC);
    if(!$row)throw new ErasureError('RECORD_NOT_FOUND');
    $e=json_decode($row['evidence'],true,64,JSON_THROW_ON_ERROR);
    $e['copyState']=$row['copy_state'];$e['backupReviewAt']=$row['backup_review_at'];$e['copiesConfirmedAt']=$row['copies_confirmed_at'];
    $pending=($e['copyState']??'pending')!=='confirmed';
    if($pending){$e['status']='DATABASE_CLEARED_BACKUPS_PENDING_ACT_UNSIGNED';$e['scope']='Удалены строки рабочей SQL-базы. Уничтожение всех оставшихся копий не подтверждено.';}
    $lines=[$pending?'ПРОЕКТ: ОЧИСТКА РАБОЧЕЙ БАЗЫ. УНИЧТОЖЕНИЕ ВСЕХ КОПИЙ НЕ ПОДТВЕРЖДЕНО':'ПРОЕКТ АКТА — ТРЕБУЕТ ПОДПИСИ','Запись: '.$id,'Оператор: '.$e['operator']['name'],'Адрес оператора: '.$e['operator']['address']];
    foreach($e['processors'] as $p)$lines[]='Обработчик по поручению: '.$p['name'].'; '.$p['address'];
    if(!$e['processors'])$lines[]='Обработчики по поручению: не указаны в настройке; их отсутствие этим документом не подтверждается.';
    $lines[]='Субъект: идентификатор обращения '.$e['subjectReference'];
    $lines[]='Ответственное лицо: '.$e['actor']['name'].'; '.$e['actor']['role'];
    $lines[]='Категории сведений: '.implode('; ',$e['categories']);
    $lines[]='Информационная система: '.$e['system'];$lines[]='Способ: '.$e['method'];$lines[]='Причина: '.$e['reason'];
    $lines[]='Очистка рабочей БД (UTC): '.$e['clearedAt'];$lines[]='Область: '.$e['scope'];
    if(isset($e['destroyedOn']))$lines[]='Подтверждённая дата завершения уничтожения: '.$e['destroyedOn'];
    if($pending)$lines[]='Следующая проверка копий (UTC): '.($e['backupReviewAt']??'Требуется назначить');
    $lastCheck=$e['completionCheck']??$e['copies'];
    $lines[]='Проверка копий: '.$lastCheck['checkedBy'].'; '.$lastCheck['checkedAt'].'; '.$lastCheck['reference'];
    $lines[]=$pending?'Окончательный срок хранения доказательств будет рассчитан после подтверждения уничтожения копий.':'Хранить акт и выгрузку до: '.$e['retainUntil'];
    $lines[]='Подпись ответственного лица: ____________________';
    $lines[]='Проект не подтверждает наличие подписи и не заменяет проверку фактического уничтожения всех копий.';
    $journal=['recordId'=>$id,'subjectReference'=>$e['subjectReference'],'categories'=>$e['categories'],
        'system'=>$e['system'],'reason'=>$e['reason'],'clearedAt'=>$e['clearedAt'],'scope'=>$e['scope'],'status'=>$e['status'],
        'copyState'=>$e['copyState'],'backupReviewAt'=>$e['backupReviewAt'],'copiesConfirmedAt'=>$e['copiesConfirmedAt'],'destroyedOn'=>$e['destroyedOn']??null];
    return ['act-draft.txt'=>implode("\n",$lines)."\n",'journal.json'=>json_encode($journal,JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)."\n"];
}

/** Metadata confirmation only, never deletion, never automatic expiry-by-calendar. */
function confirmErasureCopies(\PDO $db,array $config,string $id,array $copies,?\DateTimeImmutable $now=null): array {
    if(($config['erasure']['copy_confirmation_enabled']??false)!==true||!preg_match('/^[a-f0-9]{32}$/D',$id))throw new ErasureError('COPY_CONFIRMATION_DISABLED');
    $now=($now??new \DateTimeImmutable('now',new \DateTimeZone('UTC')))->setTimezone(new \DateTimeZone('UTC'));
    $db->beginTransaction();
    try{
        $q=$db->prepare('SELECT * FROM zt_erasure_records WHERE id=? FOR UPDATE');$q->execute([$id]);$row=$q->fetch(\PDO::FETCH_ASSOC);
        if(!$row)throw new ErasureError('RECORD_NOT_FOUND');
        $checkConfig=$config;$checkConfig['erasure']['enabled']=true; // gated metadata operation, not erasure authorization
        $context=erasureContext($checkConfig,$copies,$row['order_number'],$now);
        if($context['copyState']!=='confirmed')throw new ErasureError('COPIES_STILL_PENDING');
        if($row['copy_state']==='confirmed'){if(!$db->commit())throw new ErasureError('COMMIT_NOT_CONFIRMED');return ['mode'=>'COPIES_ALREADY_CONFIRMED','recordId'=>$id,'deleted'=>0];}
        $raw=$copies['destroyedOn']??'';$perm=new \DateTimeZone('Asia/Yekaterinburg');
        if(!is_string($raw)||!preg_match('/^\d{4}-\d{2}-\d{2}$/D',$raw))throw new ErasureError('DESTRUCTION_DATE_REQUIRED');
        $date=\DateTimeImmutable::createFromFormat('!Y-m-d',$raw,$perm);
        $cleared=(new \DateTimeImmutable($row['cleared_at'],new \DateTimeZone('UTC')))->setTimezone($perm)->format('Y-m-d');
        $checkedOn=(new \DateTimeImmutable($context['copies']['checkedAt']))->setTimezone($perm)->format('Y-m-d');
        if(!$date||$date->format('Y-m-d')!==$raw||$raw<$cleared||$raw>$checkedOn||$raw>$now->setTimezone($perm)->format('Y-m-d'))throw new ErasureError('INVALID_DESTRUCTION_DATE');
        $e=json_decode($row['evidence'],true,64,JSON_THROW_ON_ERROR);
        $until=$date->modify('+3 years')->modify('+1 day')->setTimezone(new \DateTimeZone('UTC'));
        $e['copyState']='confirmed';$e['copiesConfirmedAt']=$now->format('Y-m-d H:i:s.u');$e['destroyedOn']=$raw;$e['backupReviewAt']=null;
        $e['completionCheck']=$context['copies'];$e['retainUntil']=$until->format('Y-m-d\TH:i:s.u\Z');
        $e['status']='DATABASE_CLEARED_COPIES_ATTESTED_ACT_UNSIGNED';
        $e['scope']='Очистка рабочей SQL-базы и завершение уничтожения копий подтверждены по отдельной проверке человека. Подпись акта ещё требуется.';
        $q=$db->prepare("UPDATE zt_erasure_records SET copy_state='confirmed',backup_review_at=NULL,copies_confirmed_at=?,retain_until=?,evidence=? WHERE id=?");
        $q->execute([$now->format('Y-m-d H:i:s.u'),$until->format('Y-m-d H:i:s.u'),json_encode($e,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),$id]);
        if(!$db->commit())throw new ErasureError('COMMIT_NOT_CONFIRMED');
        return ['mode'=>'COPIES_CONFIRMED_ACT_UNSIGNED','recordId'=>$id,'deleted'=>0,'externalLedgerCopyRequired'=>true];
    }catch(\Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

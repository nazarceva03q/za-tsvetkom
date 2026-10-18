<?php
declare(strict_types=1);
namespace ZTOrders;
final class WorkflowError extends \RuntimeException {}
function workflowStatuses(): array {
    return ['new'=>'Новая','working'=>'В работе','waiting'=>'Ожидаем клиента',
        'completed'=>'Выполнена','cancelled'=>'Отменена','no_purchase'=>'Без покупки'];
}
function workflowActions(): array {
    return ['reply'=>'Ответить клиенту','agree'=>'Согласовать условия',
        'delivery'=>'Проверить получение','review'=>'Проверить ситуацию'];
}
function workflowInput(array $input): array {
    $id=$input['order_id']??null; $version=$input['version']??null;
    $status=$input['status']??null; $action=$input['next_action']??''; $due=$input['next_action_at']??'';
    if(!is_string($id)||!preg_match('/^[a-f0-9]{32}$/D',$id)||!is_string($version)||
        !preg_match('/^(0|[1-9][0-9]{0,9})$/D',$version)||!is_string($status)||!isset(workflowStatuses()[$status])||
        !is_string($action)||($action!==''&&!isset(workflowActions()[$action]))||!is_string($due)||
        !in_array($input['complaint']??'0',['0','1'],true)) throw new WorkflowError('Проверьте поля заявки.');
    if($status==='completed'&&($input['confirm_completed']??'')!=='1')
        throw new WorkflowError('Подтвердите, что выполнение заказа проверено вами.');
    $closed=in_array($status,['completed','cancelled','no_purchase'],true);
    $hold=($input['complaint']??'0')==='1';
    $utc=null;
    if($closed||$hold) { $action=''; }
    elseif($action!=='') {
        $date=\DateTimeImmutable::createFromFormat('!Y-m-d\TH:i',$due,new \DateTimeZone('Asia/Yekaterinburg'));
        if(!$date||$date->format('Y-m-d\TH:i')!==$due) throw new WorkflowError('Укажите срок следующего действия, время Перми.');
        $utc=$date->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    } elseif($due!=='') throw new WorkflowError('Выберите действие для указанного срока.');
    return ['id'=>$id,'version'=>(int)$version,'status'=>$status,'action'=>$action?:null,'due'=>$utc,'hold'=>$hold];
}
function saveWorkflow(\PDO $db,array $input): string {
    $v=workflowInput($input);
    $db->beginTransaction();
    try {
        $q=$db->prepare('SELECT * FROM zt_orders WHERE id=? FOR UPDATE');$q->execute([$v['id']]);$old=$q->fetch(\PDO::FETCH_ASSOC);
        if(!$old||$old['erased_at']!==null) throw new WorkflowError('Заявка недоступна для изменения.');
        if((int)$old['workflow_version']!==$v['version']) throw new WorkflowError('Заявка уже изменена. Обновите страницу перед сохранением.');
        $closed=in_array($v['status'],['completed','cancelled','no_purchase'],true);
        $closedAt=$closed?($old['closed_at']?:gmdate('Y-m-d H:i:s')):null;
        $purchaseAt=$old['purchase_confirmed_at']??($v['status']==='completed'?gmdate('Y-m-d H:i:s'):null);
        $q=$db->prepare('UPDATE zt_orders SET status=?,closed_at=?,purchase_confirmed_at=?,complaint_open=?,next_action=?,next_action_at=?,workflow_version=workflow_version+1 WHERE id=?');
        $q->execute([$v['status'],$closedAt,$purchaseAt,(int)$v['hold'],$v['action'],$v['due'],$v['id']]);
        $details=['from'=>$old['status'],'to'=>$v['status'],'complaint'=>$v['hold'],
            'nextAction'=>$v['action'],'due'=>$v['due'],'version'=>$v['version']+1,'rule'=>'workflow-v1'];
        $q=$db->prepare("INSERT INTO zt_request_events(order_id,event_type,actor,details) VALUES(?,'workflow_updated','owner',?)");
        $q->execute([$v['id'],json_encode($details,JSON_THROW_ON_ERROR)]);
        $db->commit();return $v['id'];
    }catch(\Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}
function retentionCandidates(\PDO $db,array $policy): array {
    if(($policy['approved']??false)!==true||!is_int($policy['closed_no_purchase_days']??null)||
        $policy['closed_no_purchase_days']<1||$policy['closed_no_purchase_days']>30)
        throw new WorkflowError('Сначала утвердите срок и порядок очистки закрытых обращений без покупки.');
    $q=$db->prepare("SELECT id FROM zt_orders WHERE status IN ('cancelled','no_purchase') AND closed_at IS NOT NULL
        AND closed_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY) AND purchase_confirmed_at IS NULL AND complaint_open=0 AND erased_at IS NULL ORDER BY closed_at LIMIT 100");
    $q->execute([$policy['closed_no_purchase_days']]);return $q->fetchAll(\PDO::FETCH_COLUMN);
}
/** No automatic purge of completed purchases. Each candidate rechecked under lock. */
function eraseClosedRequest(\PDO $db,array $policy,string $id): bool {
    retentionCandidates($db,$policy); // Validate explicit policy before mutations.
    $db->beginTransaction();
    try {
        $q=$db->prepare("SELECT id FROM zt_orders WHERE id=? AND status IN ('cancelled','no_purchase')
            AND closed_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY) AND purchase_confirmed_at IS NULL AND complaint_open=0 AND erased_at IS NULL FOR UPDATE");
        $q->execute([$id,$policy['closed_no_purchase_days']]);
        if(!$q->fetchColumn()){$db->commit();return false;}
        // An in-flight relay may hold a payload outside this transaction; defer cleanup until reviewed.
        $q=$db->prepare('SELECT status FROM zt_notification_queue WHERE order_id=? FOR UPDATE');$q->execute([$id]);
        if(in_array('processing',$q->fetchAll(\PDO::FETCH_COLUMN),true)){$db->commit();return false;}
        foreach(['zt_notification_queue','zt_order_items','zt_request_events'] as $table){$q=$db->prepare('DELETE FROM '.$table.' WHERE order_id=?');$q->execute([$id]);}
        $q=$db->prepare("UPDATE zt_orders SET subject='',customer_name='',phone='',contact_channel='',desired_date=NULL,
            delivery_method=NULL,time_slot=NULL,delivery_address='',comment='',requested_quantity=NULL,budget_rubles=NULL,
            total_kopecks=NULL,request_hash=?,next_action=NULL,next_action_at=NULL,erased_at=UTC_TIMESTAMP(6),
            workflow_version=workflow_version+1 WHERE id=?");
        $q->execute([bin2hex(random_bytes(32)),$id]);
        $q=$db->prepare("INSERT INTO zt_request_events(order_id,event_type,actor,details) VALUES(?,'personal_data_erased','maintenance',?)");
        $q->execute([$id,json_encode(['rule'=>'closed-no-purchase-v1','days'=>$policy['closed_no_purchase_days']],JSON_THROW_ON_ERROR)]);
        $db->commit();return true;
    }catch(\Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

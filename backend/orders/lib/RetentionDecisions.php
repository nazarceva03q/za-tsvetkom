<?php
declare(strict_types=1);
namespace ZTOrders;
require_once __DIR__.'/RetentionReview.php';
final class RetentionDecisionError extends \RuntimeException {}
function retentionReasons(): array {
    return ['active_order'=>'Заказ ещё исполняется','awaiting_customer'=>'Ожидаем ответа клиента',
        'ongoing_request'=>'Продолжается согласование обращения','dispute'=>'Разбираем претензию или спор'];
}
function retentionDecisionInput(array $input,\DateTimeImmutable $now): array {
    $id=$input['order_id']??null;$version=$input['review_version']??null;$orderVersion=$input['order_version']??null;
    $decision=$input['decision']??null;
    if(!is_string($id)||!preg_match('/^[a-f0-9]{32}$/D',$id)
        ||!is_string($version)||!preg_match('/^(0|[1-9][0-9]{0,9})$/D',$version)
        ||!is_string($orderVersion)||!preg_match('/^(0|[1-9][0-9]{0,9})$/D',$orderVersion)
        ||!in_array($decision,['keep','ready'],true))throw new RetentionDecisionError('Проверьте данные решения.');
    $perm=new \DateTimeZone('Asia/Yekaterinburg');$utc=new \DateTimeZone('UTC');
    $today=$now->setTimezone($perm)->setTime(0,0);
    $parse=static function(mixed $raw)use($perm):\DateTimeImmutable {
        if(!is_string($raw)||!preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/D',$raw))throw new RetentionDecisionError('Укажите дату в календаре.');
        $date=\DateTimeImmutable::createFromFormat('!Y-m-d',$raw,$perm);
        if(!$date||$date->format('Y-m-d')!==$raw)throw new RetentionDecisionError('Проверьте дату.');
        return $date;
    };
    $reason=null;$due=null;$ended=null;$eraseDue=null;
    if($decision==='keep') {
        $reason=$input['reason']??null;
        if(!is_string($reason)||!isset(retentionReasons()[$reason]))throw new RetentionDecisionError('Выберите, почему заявка ещё нужна.');
        $date=$parse($input['review_date']??null);
        if($date<=$today||$date>$today->modify('+90 days'))throw new RetentionDecisionError('Выберите следующую проверку от завтра до 90 дней вперёд.');
        $due=$date->setTimezone($utc)->format('Y-m-d H:i:s');
    } else {
        if(($input['confirm_clear']??'')!=='1')throw new RetentionDecisionError('Подтвердите, что обращение завершено или отменено и сведения больше не нужны.');
        $date=$parse($input['goal_ended_on']??null);
        if($date>$today)throw new RetentionDecisionError('Дата завершения не может быть в будущем.');
        $ended=$date->setTimezone($utc)->format('Y-m-d H:i:s');
        // Date-only input: use the start of that day, a conservative deadline.
        $eraseDue=$date->modify('+30 days')->setTimezone($utc)->format('Y-m-d H:i:s');
    }
    return ['id'=>$id,'version'=>(int)$version,'orderVersion'=>(int)$orderVersion,'decision'=>$decision,
        'reason'=>$reason,'due'=>$due,'ended'=>$ended,'eraseDue'=>$eraseDue];
}
function retentionDecision(\PDO $db,string $id): ?array {
    $q=$db->prepare('SELECT * FROM zt_retention_reviews WHERE order_id=?');$q->execute([$id]);
    return $q->fetch(\PDO::FETCH_ASSOC)?:null;
}
function saveRetentionDecision(\PDO $db,array $input,?\DateTimeImmutable $now=null): string {
    $now??=new \DateTimeImmutable('now',new \DateTimeZone('UTC'));
    $v=retentionDecisionInput($input,$now);
    $db->beginTransaction();
    try {
        // Serialize on the order even before the first review row exists.
        $q=$db->prepare('SELECT id,created_at,workflow_version,erased_at,complaint_open FROM zt_orders WHERE id=? FOR UPDATE');
        $q->execute([$v['id']]);$order=$q->fetch(\PDO::FETCH_ASSOC);
        if(!$order||$order['erased_at']!==null)throw new RetentionDecisionError('Заявка уже очищена или не найдена.');
        if((int)$order['workflow_version']!==$v['orderVersion'])throw new RetentionDecisionError('Заявка изменилась в другом окне. Обновите страницу.');
        $q=$db->prepare('SELECT * FROM zt_retention_reviews WHERE order_id=? FOR UPDATE');$q->execute([$v['id']]);$old=$q->fetch(\PDO::FETCH_ASSOC);
        if((int)($old['version']??0)!==$v['version'])throw new RetentionDecisionError('Решение уже изменено в другом окне. Обновите страницу.');
        if($v['decision']==='ready') {
            if($order['complaint_open'])throw new RetentionDecisionError('В заявке отмечена открытая претензия. Сначала требуется её отдельная проверка.');
            $created=(new \DateTimeImmutable($order['created_at'],new \DateTimeZone('UTC')))->setTimezone(new \DateTimeZone('Asia/Yekaterinburg'))->format('Y-m-d');
            $ended=(new \DateTimeImmutable($v['ended'],new \DateTimeZone('UTC')))->setTimezone(new \DateTimeZone('Asia/Yekaterinburg'))->format('Y-m-d');
            if($ended<$created)throw new RetentionDecisionError('Завершение не может быть раньше поступления заявки.');
        }
        $version=$v['version']+1;
        $values=[$version,$v['decision'],$v['reason'],$v['due'],$v['ended'],$v['eraseDue'],$now->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u'),$v['id']];
        if($old) {
            $q=$db->prepare('UPDATE zt_retention_reviews SET version=?,decision=?,reason=?,review_at=?,goal_ended_at=?,erase_due_at=?,decided_at=? WHERE order_id=?');
        } else {
            $q=$db->prepare('INSERT INTO zt_retention_reviews(version,decision,reason,review_at,goal_ended_at,erase_due_at,decided_at,order_id) VALUES(?,?,?,?,?,?,?,?)');
        }
        $q->execute($values);
        $q=$db->prepare("INSERT INTO zt_request_events(order_id,event_type,actor,details) VALUES(?,'retention_reviewed','owner',?)");
        $q->execute([$v['id'],json_encode(['decision'=>$v['decision'],'reason'=>$v['reason'],'reviewAt'=>$v['due'],
            'goalEndedAt'=>$v['ended'],'eraseDueAt'=>$v['eraseDue'],'version'=>$version,'orderVersion'=>$v['orderVersion'],'rule'=>'retention-review-v1'],JSON_THROW_ON_ERROR)]);
        $db->commit();return $v['id'];
    } catch(\Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}
function retentionReviewList(\PDO $db,int $page=0): array {
    if($page<0||$page>100000)throw new RetentionDecisionError('Неизвестная страница.');
    $base="GREATEST(DATE_ADD(o.created_at,INTERVAL 30 DAY),COALESCE(DATE_SUB(DATE_ADD(CAST(o.desired_date AS DATETIME),INTERVAL 31 DAY),INTERVAL 5 HOUR),DATE_ADD(o.created_at,INTERVAL 30 DAY)))";
    $where="o.erased_at IS NULL AND (r.decision='ready' OR (r.decision='keep' AND r.review_at<=UTC_TIMESTAMP()) OR (r.order_id IS NULL AND $base<=UTC_TIMESTAMP()))";
    $from=' FROM zt_orders o LEFT JOIN zt_retention_reviews r ON r.order_id=o.id WHERE '.$where;
    $total=(int)$db->query('SELECT COUNT(*)'.$from)->fetchColumn();
    $rows=$db->query('SELECT o.id,o.order_number,o.request_type,o.customer_name,o.subject,o.created_at,r.decision,r.review_at,r.erase_due_at'.$from.
        " ORDER BY (r.decision='ready') DESC,COALESCE(r.erase_due_at,r.review_at,o.created_at),o.id LIMIT 50 OFFSET ".($page*50))->fetchAll(\PDO::FETCH_ASSOC);
    return ['total'=>$total,'rows'=>$rows];
}

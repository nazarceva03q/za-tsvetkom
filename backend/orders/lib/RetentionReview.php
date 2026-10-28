<?php
declare(strict_types=1);
namespace ZTOrders;

/** Planning/review only. No deletion, closure or purchase inference. */
function requestReviewAt(array $row): \DateTimeImmutable {
    $utc=new \DateTimeZone('UTC');$perm=new \DateTimeZone('Asia/Yekaterinburg');
    $created=new \DateTimeImmutable($row['created_at'],$utc);
    $review=$created->modify('+30 days');
    if(($row['desired_date']??'')!=='') {
        $date=\DateTimeImmutable::createFromFormat('!Y-m-d',$row['desired_date'],$perm);
        if(!$date||$date->format('Y-m-d')!==$row['desired_date'])throw new \RuntimeException('INVALID_REQUEST_DATE');
        $after=$date->modify('+1 day')->modify('+30 days')->setTimezone($utc);
        if($after>$review)$review=$after;
    }
    return $review;
}
function retentionReview(\PDO $db,?\DateTimeImmutable $now=null,bool $decisions=false): array {
    $now??=new \DateTimeImmutable('now',new \DateTimeZone('UTC'));
    $counts=['scanned'=>0,'dueForReview'=>0,'notDue'=>0,'invalidDate'=>0,'manualHold'=>0,'inFlight'=>0];
    if($decisions)$counts['markedForCleanup']=0;
    $extra=$decisions?',r.decision,r.review_at':'';
    $join=$decisions?' LEFT JOIN zt_retention_reviews r ON r.order_id=o.id ':'';
    $q=$db->query("SELECT o.created_at,o.desired_date,o.complaint_open$extra,
        EXISTS(SELECT 1 FROM zt_notification_queue n WHERE n.order_id=o.id AND n.status='processing') AS in_flight
        FROM zt_orders o $join WHERE o.erased_at IS NULL ORDER BY o.created_at,o.id LIMIT 501");
    $rows=$q->fetchAll(\PDO::FETCH_ASSOC);$more=count($rows)>500;
    foreach(array_slice($rows,0,500) as $row) {
        $counts['scanned']++;
        try{$due=requestReviewAt($row);}catch(\Throwable){$counts['invalidDate']++;continue;}
        if($row['complaint_open']){$counts['manualHold']++;continue;}
        if($row['in_flight']){$counts['inFlight']++;continue;}
        if(($row['decision']??'')==='ready'){$counts['markedForCleanup']++;continue;}
        if(($row['decision']??'')==='keep')$due=new \DateTimeImmutable($row['review_at'],new \DateTimeZone('UTC'));
        $counts[$due<=$now?'dueForReview':'notDue']++;
    }
    return ['mode'=>'REVIEW_ONLY','counts'=>$counts,'partial'=>$more,'deleted'=>0];
}

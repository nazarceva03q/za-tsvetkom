<?php
declare(strict_types=1);
namespace ZTOrders;
final class RestoreGuardError extends \RuntimeException {}

function ledgerCanonical(mixed $v): string {
    $sort=static function(mixed $v)use(&$sort):mixed {
        if(!is_array($v))return $v;
        if(!array_is_list($v))ksort($v,SORT_STRING);
        foreach($v as $k=>$item)$v[$k]=$sort($item);
        return $v;
    };
    return json_encode($sort($v),JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
}
function ledgerStamp(mixed $v): bool {
    if(!is_string($v)||!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/D',$v))return false;
    $d=\DateTimeImmutable::createFromFormat('!Y-m-d H:i:s.u',$v,new \DateTimeZone('UTC'));
    return $d!==false&&$d->format('Y-m-d H:i:s.u')===$v;
}
function validateRestoreLedger(string $raw,string $expectedHash): array {
    if(strlen($raw)>16777216||!preg_match('/^[a-f0-9]{64}$/D',$expectedHash)||!hash_equals($expectedHash,hash('sha256',$raw)))throw new RestoreGuardError('LEDGER_HASH_MISMATCH');
    $d=json_decode($raw,true,64,JSON_THROW_ON_ERROR);$p=$d['payload']??null;
    if(!is_array($p)||($p['format']??'')!=='zt-restore-ledger-v1'||!ledgerStamp($p['exportedAt']??null)
        ||!is_array($p['records']??null)||!array_is_list($p['records'])||count($p['records'])>10000
        ||($p['recordCount']??null)!==count($p['records'])||!is_string($d['checksum']??null)
        ||!hash_equals(hash('sha256',ledgerCanonical($p)),$d['checksum']))throw new RestoreGuardError('INVALID_LEDGER');
    $seen=['id'=>[],'order_number'=>[],'replay_key_hash'=>[]];
    foreach($p['records'] as $r){
        if(!is_array($r)||!array_key_exists('backup_review_at',$r)||!array_key_exists('copies_confirmed_at',$r)
            ||!preg_match('/^[a-f0-9]{32}$/D',$r['id']??'')||!preg_match('/^ZT-[A-F0-9]{16}$/D',$r['order_number']??'')
            ||!preg_match('/^[a-f0-9]{64}$/D',$r['replay_key_hash']??'')||!is_int($r['review_version']??null)||$r['review_version']<1
            ||!ledgerStamp($r['cleared_at']??null)||!ledgerStamp($r['retain_until']??null)
            ||!in_array($r['copy_state']??null,['pending','confirmed'],true)||!is_array($r['evidence']??null)
            ||($r['evidence']['recordId']??null)!==$r['id']||($r['evidence']['subjectReference']??null)!==$r['order_number']
            ||($r['backup_review_at']!==null&&!ledgerStamp($r['backup_review_at']))
            ||($r['copy_state']==='pending'&&$r['copies_confirmed_at']!==null)
            ||($r['copy_state']==='confirmed'&&!ledgerStamp($r['copies_confirmed_at']??null)))throw new RestoreGuardError('INVALID_LEDGER_RECORD');
        foreach($seen as $key=>$_){if(isset($seen[$key][$r[$key]]))throw new RestoreGuardError('DUPLICATE_LEDGER_RECORD');$seen[$key][$r[$key]]=true;}
    }
    return $p;
}
/** Entire snapshot, never silently truncated. File contains no customer payload. */
function restoreLedgerExport(\PDO $db,?\DateTimeImmutable $now=null): string {
    $rows=$db->query('SELECT * FROM zt_erasure_records ORDER BY id LIMIT 10001')->fetchAll(\PDO::FETCH_ASSOC);
    if(count($rows)>10000)throw new RestoreGuardError('LEDGER_TOO_LARGE');
    foreach($rows as &$r){$r['review_version']=(int)$r['review_version'];$r['evidence']=json_decode($r['evidence'],true,64,JSON_THROW_ON_ERROR);}unset($r);
    $now??=new \DateTimeImmutable('now',new \DateTimeZone('UTC'));
    $payload=['format'=>'zt-restore-ledger-v1','exportedAt'=>$now->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u'),'recordCount'=>count($rows),'records'=>$rows];
    $body=json_encode(['payload'=>$payload,'checksum'=>hash('sha256',ledgerCanonical($payload))],JSON_PRETTY_PRINT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n";
    if(strlen($body)>16777216)throw new RestoreGuardError('LEDGER_TOO_LARGE');
    return $body;
}
function privateArtifact(string $directory,string $name,string $body): void {
    if(!preg_match('/^[a-zA-Z0-9_.-]+$/D',$name)||is_link($directory)||(!is_dir($directory)&&!mkdir($directory,0700))||!chmod($directory,0700))throw new RestoreGuardError('PRIVATE_EXPORT_DIRECTORY');
    $file=$directory.'/'.$name;
    if(is_link($file))throw new RestoreGuardError('EXPORT_FILE_CONFLICT');
    if(file_exists($file)){if(file_get_contents($file)!==$body)throw new RestoreGuardError('EXPORT_FILE_CONFLICT');return;}
    $tmp=tempnam($directory,'.ledger-');if($tmp===false)throw new RestoreGuardError('EXPORT_WRITE');
    try{
        $h=fopen($tmp,'wb');if(!$h)throw new RestoreGuardError('EXPORT_WRITE');
        try{if(!chmod($tmp,0600)||fwrite($h,$body)!==strlen($body)||!fflush($h))throw new RestoreGuardError('EXPORT_WRITE');}finally{fclose($h);}
        if(!rename($tmp,$file))throw new RestoreGuardError('EXPORT_WRITE');
    }finally{if(is_file($tmp))unlink($tmp);}
}
function exportRestoreLedgerToPrivate(\PDO $db,string $directory): array {
    $body=restoreLedgerExport($db);$hash=hash('sha256',$body);$name='restore-ledger-'.$hash.'.json';
    privateArtifact($directory,$name,$body);
    return ['sha256'=>$hash,'fileName'=>$name,'recordCount'=>json_decode($body,true,64,JSON_THROW_ON_ERROR)['payload']['recordCount'],'externalCopyRequired'=>true];
}
/** Checks the PDO really points at the explicitly configured unpublished staging DB. */
function assertRestoreTarget(\PDO $db,array $config,bool $apply): void {
    $g=$config['restore_guard']??[];$primary=null;
    if(preg_match('/(?:^|;)dbname=([a-zA-Z0-9_]+)(?:;|$)/',$config['dsn']??'',$m))$primary=$m[1];
    $target=$g['target_database']??'';
    if(!$primary||!is_string($target)||!preg_match('/^[a-zA-Z0-9_]{1,64}$/D',$target)||strcasecmp($target,$primary)===0
        ||$db->query('SELECT DATABASE()')->fetchColumn()!==$target)throw new RestoreGuardError('RESTORE_TARGET_MUST_BE_SEPARATE');
    if($apply&&(($g['enabled']??false)!==true||($g['ledger_current_confirmed']??false)!==true||($g['target_not_public_confirmed']??false)!==true))throw new RestoreGuardError('RESTORE_APPROVAL_REQUIRED');
}
/** Only a separate unpublished DB, exact identity match, one atomic transaction. */
function filterRestoredRequests(\PDO $db,array $config,array $ledger,bool $apply=false): array {
    assertRestoreTarget($db,$config,$apply);
    // Revalidate caller-provided arrays too; all entry points share the same gate.
    $raw=json_encode(['payload'=>$ledger,'checksum'=>hash('sha256',ledgerCanonical($ledger))],JSON_THROW_ON_ERROR);
    $ledger=validateRestoreLedger($raw,hash('sha256',$raw));
    $known=array_fill_keys(array_column($ledger['records'],'id'),true);
    foreach($db->query('SELECT id FROM zt_erasure_records')->fetchAll(\PDO::FETCH_COLUMN) as $existingId)
        if(!isset($known[$existingId]))throw new RestoreGuardError('LEDGER_MISSING_KNOWN_PROOFS');
    $result=['mode'=>$apply?'RESTORE_FILTER_APPLIED':'RESTORE_PREVIEW_ONLY','ledgerRecords'=>count($ledger['records']),
        'matched'=>0,'deleted'=>0,'importedProofs'=>0,'sessionsInvalidated'=>0,'notificationsStopped'=>0,'publication'=>'REQUIRES_SEPARATE_REVIEW'];
    if($apply)$db->beginTransaction();
    try{
        foreach($ledger['records'] as $r){
            $q=$db->prepare('SELECT id,idempotency_key FROM zt_orders WHERE order_number=?'.($apply?' FOR UPDATE':''));$q->execute([$r['order_number']]);$order=$q->fetch(\PDO::FETCH_ASSOC);
            if($order&&!hash_equals($r['replay_key_hash'],hash('sha256',$order['idempotency_key'])))throw new RestoreGuardError('RESTORED_IDENTITY_CONFLICT');
            $q=$db->prepare('SELECT * FROM zt_erasure_records WHERE id=? OR order_number=? OR replay_key_hash=?'.($apply?' FOR UPDATE':''));$q->execute([$r['id'],$r['order_number'],$r['replay_key_hash']]);$old=$q->fetchAll(\PDO::FETCH_ASSOC);
            if(count($old)>1)throw new RestoreGuardError('RESTORED_PROOF_CONFLICT');
            if($old){$o=$old[0];foreach(['id','order_number','replay_key_hash','cleared_at'] as $field)if($o[$field]!==$r[$field])throw new RestoreGuardError('RESTORED_PROOF_CONFLICT');
                if((int)$o['review_version']!==$r['review_version']||($o['copies_confirmed_at']!==null&&($r['copies_confirmed_at']===null||$o['copies_confirmed_at']>$r['copies_confirmed_at'])))throw new RestoreGuardError('LEDGER_STALE');}
            if($order)$result['matched']++;
            if(!$apply)continue;
            $values=[$r['order_number'],$r['replay_key_hash'],$r['review_version'],json_encode($r['evidence'],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),$r['cleared_at'],$r['retain_until'],$r['copy_state'],$r['backup_review_at'],$r['copies_confirmed_at'],$r['id']];
            if($old)$q=$db->prepare('UPDATE zt_erasure_records SET order_number=?,replay_key_hash=?,review_version=?,evidence=?,cleared_at=?,retain_until=?,copy_state=?,backup_review_at=?,copies_confirmed_at=? WHERE id=?');
            else{$q=$db->prepare('INSERT INTO zt_erasure_records(order_number,replay_key_hash,review_version,evidence,cleared_at,retain_until,copy_state,backup_review_at,copies_confirmed_at,id) VALUES(?,?,?,?,?,?,?,?,?,?)');$result['importedProofs']++;}
            $q->execute($values);
            if($order){
                foreach(['zt_notification_queue','zt_order_items','zt_request_events','zt_retention_reviews'] as $table){$q=$db->prepare('DELETE FROM '.$table.' WHERE order_id=?');$q->execute([$order['id']]);}
                $q=$db->prepare('DELETE FROM zt_orders WHERE id=?');$q->execute([$order['id']]);$result['deleted']+=$q->rowCount();
            }
        }
        if($apply){
            $result['sessionsInvalidated']=$db->exec('DELETE FROM zt_owner_sessions');
            $result['notificationsStopped']=$db->exec("UPDATE zt_notification_queue SET status='failed',last_error_code='RESTORE_REVIEW_REQUIRED',claim_token=NULL,locked_until=NULL WHERE status IN ('pending','processing')");
            if(!$db->commit())throw new RestoreGuardError('RESTORE_COMMIT_NOT_CONFIRMED');
        }
        return $result;
    }catch(\Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}

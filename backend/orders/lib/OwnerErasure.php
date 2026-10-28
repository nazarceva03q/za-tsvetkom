<?php
declare(strict_types=1);
namespace ZTOrders;
require_once __DIR__.'/Erasure.php';

function ownerErasureEnabled(array $config): bool {
    return ($config['retention_review']['enabled']??false)===true
        && ($config['erasure']['panel_enabled']??false)===true;
}
/** The browser may attest a check, but cannot enable deletion or approve backups. */
function ownerErasureInput(array $input,array $config,string $number): array {
    if(($input['backup_state']??'')==='pending'){
        if(($config['erasure']['pending_copy_review_enabled']??false)!==true||($input['confirm_delete']??'')!=='1')
            throw new ErasureError('PENDING_COPY_REVIEW_DISABLED');
        return ['orderNumber'=>$number,'checkedAt'=>gmdate('Y-m-d\TH:i:s\Z'),
            'checkedBy'=>$config['erasure']['actor']['name']??'',
            'reference'=>'Удаление только из рабочей базы. Проверка внешних экземпляров, включая архивы, сообщения и журналы, не завершена.',
            'backups'=>'pending','exports'=>false,'vk'=>false,'logs'=>false,
            'backupRestrictionConfirmed'=>false,'restoreProcedureConfirmed'=>false,'pendingReviewAcknowledged'=>true];
    }
    foreach(['exports','vk','logs','confirm_delete'] as $key)
        if(($input[$key]??null)!=='1')throw new ErasureError('Подтвердите каждую проверку и удаление одной заявки.');
    if(($input['confirm_number']??null)!==$number)throw new ErasureError('Введите номер заявки точно, чтобы подтвердить удаление.');
    $reference=$input['copy_reference']??null;
    if(!is_string($reference)||trim($reference)===''||strlen($reference)>500||preg_match('/[\x00-\x1f\x7f]/',$reference))
        throw new ErasureError('Укажите кратко, как проверены копии, без контактов клиента.');
    $mode=$input['backup_state']??'';
    if(!in_array($mode,['destroyed','rolling'],true))throw new ErasureError('Укажите фактическое состояние резервных копий.');
    if(($input['backup_confirm']??null)!=='1')throw new ErasureError('Подтвердите проверку резервных копий.');
    if($mode==='rolling'&&(($input['backup_restriction']??null)!=='1'||($input['restore_procedure']??null)!=='1'))
        throw new ErasureError('Нужно подтвердить ограничение доступа к копиям и порядок восстановления.');
    $actor=$config['erasure']['actor']['name']??'';
    return ['orderNumber'=>$number,'checkedAt'=>gmdate('Y-m-d\TH:i:s\Z'),'checkedBy'=>$actor,
        'reference'=>trim($reference),'backups'=>$mode==='rolling'?'rolling':true,
        'exports'=>true,'vk'=>true,'logs'=>true,
        'backupRestrictionConfirmed'=>$mode==='rolling','restoreProcedureConfirmed'=>$mode==='rolling'];
}

function ownerEraseRequest(\PDO $db,array $config,array $input): array {
    if(!ownerErasureEnabled($config))throw new ErasureError('Очистка из панели пока выключена.');
    $number=$input['order_number']??'';$version=$input['review_version']??'';
    if(!is_string($number)||!preg_match('/^ZT-[A-F0-9]{16}$/D',$number)
        ||!is_string($version)||!preg_match('/^[1-9][0-9]{0,8}$/D',$version))throw new ErasureError('Обновите страницу проверки заявки.');
    $copies=ownerErasureInput($input,$config,$number);
    // Existing engine verifies current review/workflow versions, complaint and
    // in-flight notification under transaction locks. No browser bypass flags.
    $result=eraseReviewedRequest($db,$config,$number,(int)$version,$copies);
    // Commit may already have succeeded. Never turn an export failure into a
    // misleading claim that deletion failed or rolled back.
    try {
        $directory=$config['erasure']['evidence_directory']??'';
        if(!is_string($directory)||$directory===''||!str_starts_with($directory,DIRECTORY_SEPARATOR))
            throw new ErasureError('PRIVATE_EVIDENCE_DIRECTORY_REQUIRED');
        $result['ledger']=exportRestoreLedgerToPrivate($db,$directory);
    } catch(\Throwable) { $result['ledgerExport']='RETRY_REQUIRED'; }
    return $result;
}

function ownerErasureMessage(string $code): string {
    return match($code) {
        'ERASURE_DISABLED'=>'Удаление выключено или его настройка не завершена. Данные не удалены.',
        'PENDING_COPY_REVIEW_DISABLED'=>'Подтвердите удаление выбранной заявки. Если ошибка повторяется, обратитесь к Алине.',
        'BACKUP_RESTRICTION_NOT_CONFIRMED'=>'Удаление пока недоступно. Данные не удалены.',
        'DECISION_CHANGED','RECONFIRM_DECISION','MANUAL_REVIEW_REQUIRED','TARGET_MISSING_OR_CHANGED'=>'Заявка или решение изменились. Откройте её заново и повторно проверьте необходимость хранения.',
        'NOTIFICATION_IN_FLIGHT'=>'Сейчас отправляется уведомление. Дождитесь завершения и обновите страницу.',
        'COPY_REVIEW_REQUIRED','COPY_SCOPE_MISMATCH','COPY_REVIEW_EXPIRED','COPY_REVIEW_DATE'=>'Операция не подтверждена. Обновите страницу.',
        'EVIDENCE_CONFIGURATION','PROCESSORS_REQUIRED'=>'Удаление пока недоступно. Данные не удалены.',
        default=>preg_match('/^[A-Z0-9_]+$/D',$code)?'Операция не подтверждена. Обновите страницу; при повторной ошибке проверьте состояние заявки.':$code,
    };
}

function ownerConfirmErasureCopies(\PDO $db,array $config,array $input): array {
    if(!ownerErasureEnabled($config)||($input['confirm_copies']??'')!=='1')throw new ErasureError('Подтвердите фактическое завершение проверки копий.');
    $record=$input['record_id']??'';
    if(!is_string($record)||!preg_match('/^[a-f0-9]{32}$/D',$record))throw new ErasureError('INVALID_RECORD');
    $q=$db->prepare('SELECT order_number FROM zt_erasure_records WHERE id=?');$q->execute([$record]);$number=$q->fetchColumn();
    if(!is_string($number))throw new ErasureError('RECORD_NOT_FOUND');
    $copies=ownerErasureInput($input+['confirm_delete'=>'1','confirm_number'=>$number,'backup_state'=>'destroyed'],$config,$number);
    if($copies['backups']!==true)throw new ErasureError('COPIES_STILL_PENDING');
    $copies['destroyedOn']=$input['destroyed_on']??'';
    return confirmErasureCopies($db,$config,$record,$copies);
}

function renderOwnerErasure(\PDO $db,array $config,string $csrf,string $error=''): void {
    pageStart();
    echo '<p><a class="back" href="orders.php?view=retention">К проверке сроков</a></p><section class="detail"><h2>Очистка одной заявки</h2>';
    if($error!=='')echo '<p class="error" role="alert">'.escape(ownerErasureMessage($error)).'</p>';
    if(!ownerErasureEnabled($config)){
        http_response_code(403);echo '<p class="notice">Очистка из панели пока выключена. Отметка «Можно очистить» сохранена, данные не удалены.</p></section>';pageEnd();return;
    }
    if(!isset($_GET['number'])&&!isset($_GET['record'])) {
        echo '<p>Выберите заявку в разделе «Проверка сроков».</p></section>';pageEnd();return;
    }
    $record=$_GET['record']??'';
    if(is_string($record)&&preg_match('/^[a-f0-9]{32}$/D',$record)){
        $q=$db->prepare('SELECT order_number,copy_state,backup_review_at FROM zt_erasure_records WHERE id=?');$q->execute([$record]);$proof=$q->fetch(\PDO::FETCH_ASSOC);
        if(!$proof){http_response_code(404);echo '<p>Запись очистки не найдена.</p></section>';pageEnd();return;}
        echo '<p class="number">'.escape($proof['order_number']).'</p><p class="notice">Заявка удалена из панели.</p><p><a class="back" href="orders.php">Вернуться к заявкам</a></p>';
        echo '</section>';pageEnd();return;
    }
    $number=$_GET['number']??'';
    if(!is_string($number)||!preg_match('/^ZT-[A-F0-9]{16}$/D',$number)){
        http_response_code(422);echo '<p>Откройте очистку из карточки отмеченной заявки.</p></section>';pageEnd();return;
    }
    $q=$db->prepare('SELECT o.id,o.order_number,o.complaint_open,r.decision,r.version FROM zt_orders o LEFT JOIN zt_retention_reviews r ON r.order_id=o.id WHERE o.order_number=? AND o.erased_at IS NULL');
    $q->execute([$number]);$row=$q->fetch(\PDO::FETCH_ASSOC);
    if(!$row||$row['decision']!=='ready'||$row['complaint_open']){
        http_response_code(409);echo '<p>Для очистки нужно актуальное решение «Можно очистить» и отсутствие открытой претензии.</p></section>';pageEnd();return;
    }
    echo '<p class="number"><strong>'.escape($number).'</strong></p><p>Данные этой заявки будут удалены из панели. Отменить удаление нельзя.</p>';
    if(($config['erasure']['pending_copy_review_enabled']??false)===true){
        echo '<form method="post" class="cleanup-form"><input type="hidden" name="csrf" value="'.escape($csrf).'"><input type="hidden" name="action" value="erase_request"><input type="hidden" name="order_number" value="'.escape($number).'"><input type="hidden" name="review_version" value="'.(int)$row['version'].'"><input type="hidden" name="backup_state" value="pending"><fieldset><legend>Подтверждение удаления</legend>';
        echo '<label class="check"><input type="checkbox" name="confirm_delete" value="1" required>Подтверждаю удаление этой заявки из панели.</label><button type="submit" class="danger-button">Удалить данные этой заявки</button><a href="orders.php?number='.escape($number).'">Отмена — вернуться к заявке</a></fieldset></form></section>';
        pageEnd();return;
    }
    echo '<p>Удаление пока недоступно.</p></section>';
    pageEnd();
}

/** Downloads are not available in the owner panel. */
function ownerErasureDownload(\PDO $db,array $config): void {
    http_response_code(404);
    echo 'Страница не найдена.';
}

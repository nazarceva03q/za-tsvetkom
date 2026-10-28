<?php
declare(strict_types=1);
namespace ZTOrders;
require_once __DIR__.'/BotInbox.php';
function pageStart(): void {
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Заявки — За цветком</title><link rel="stylesheet" href="orders.css"></head><body><main class="workspace"><header class="masthead"><p class="shop">За цветком</p><h1>Заявки магазина</h1></header>';
}
function pageEnd(): void { echo '</main></body></html>'; }
/** Current storefront scenarios; historical API types remain readable, not advertised. */
function panelRequestTypes(): array {
    return ['cart'=>'Товары из корзины','gift'=>'Подбор подарка','large'=>'Большой букет',
        'preorder'=>'Предзаказ','business'=>'Оформление для бизнеса','other'=>'Другие заявки сайта'];
}
function panelBusinessSql(): string {
    return "(request_type IN ('other','corporate') AND EXISTS (SELECT 1 FROM zt_order_items pi WHERE pi.order_id=zt_orders.id AND CASE WHEN JSON_VALID(pi.product_snapshot) THEN JSON_EXTRACT(pi.product_snapshot,'$.business')=true ELSE false END))";
}
function panelTypeSql(): string { return "CASE WHEN ".panelBusinessSql()." THEN 'business' ELSE request_type END"; }
function renderRequestView(\PDO $db,bool $session,string $csrf,string $error,bool $workflow=false,string $origin='',bool $retentionEnabled=false): void {
    if (!$session) {
        pageStart();
        echo '<section class="login"><h2>Вход для Екатерины</h2><p>Войдите, чтобы увидеть заявки и контакты покупателей.</p>';
        if ($error!=='') echo '<p class="error" role="alert">'.escape($error).'</p>';
        echo '<form method="post"><input type="hidden" name="csrf" value="'.escape($csrf).'"><label>Логин<input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required maxlength="100"></label><label>Пароль<input name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required maxlength="1024"></label><button>Войти</button></form></section>';
        pageEnd(); return;
    }
    $types=panelRequestTypes()+requestTypes();
    $view=$_GET['view']??'all';
    if(!is_string($view)||!in_array($view,['all','retention'],true)){
        http_response_code(422);pageStart();echo '<p>Неизвестный раздел. <a href="orders.php">Все заявки</a></p>';pageEnd();return;
    }
    if($view==='retention'&&!$retentionEnabled){http_response_code(403);pageStart();echo '<p>Проверка сроков пока выключена.</p>';pageEnd();return;}
    $id=$_GET['id']??'';
    $number=$_GET['number']??'';
    if(!is_string($number)||($number!==''&&(!preg_match('/^ZT-[A-F0-9]{16}$/D',$number)||$id!==''))) {
        http_response_code(404);pageStart();echo '<p>Заявка не найдена. <a href="orders.php">Вернуться к списку</a></p>';pageEnd();return;
    }
    if($number!=='') {
        $q=$db->prepare('SELECT id FROM zt_orders WHERE order_number=?');$q->execute([$number]);$id=$q->fetchColumn();
        if(!is_string($id)){http_response_code(404);pageStart();echo '<p>Заявка не найдена. <a href="orders.php">Вернуться к списку</a></p>';pageEnd();return;}
    }
    if(!is_string($id) || ($id!=='' && !preg_match('/^[a-f0-9]{32}$/D',$id))) {
        http_response_code(404);pageStart();echo '<p>Заявка не найдена. <a href="orders.php">Вернуться к списку</a></p>';pageEnd();return;
    }
    if($id!=='') {
        $q=$db->prepare('SELECT *,'.panelTypeSql().' AS panel_type FROM zt_orders WHERE id=?');$q->execute([$id]);$order=$q->fetch(\PDO::FETCH_ASSOC);
        if(!$order){http_response_code(404);pageStart();echo '<p>Заявка не найдена. <a href="orders.php">Вернуться к списку</a></p>';pageEnd();return;}
    }
    $type=$_GET['type']??'';
    if(!is_string($type)||($type!==''&&!isset($types[$type]))) {http_response_code(422);pageStart();echo '<p>Неизвестный тип заявки. <a href="orders.php">Все заявки</a></p>';pageEnd();return;}
    pageStart();
    echo '<form class="logout" method="post"><input type="hidden" name="csrf" value="'.escape($csrf).'"><button class="secondary" name="action" value="logout">Выйти</button></form>';
    if($retentionEnabled)echo '<nav class="panel-tabs" aria-label="Разделы заявок"><a href="orders.php"'.($view==='all'?' aria-current="page"':'').'>Все заявки</a><a href="?view=retention"'.($view==='retention'?' aria-current="page"':'').'>Проверка сроков</a></nav>';
    if($view==='retention'&&$id===''){renderRetentionList($db);pageEnd();return;}
    if($id!=='') {
        echo '<a class="back" href="orders.php">Все заявки</a><article class="detail"><p class="meta">'.escape(requestDate($order['created_at'])).' · время Перми</p><h2>'.escape($types[$order['panel_type']]??'Обращение').'</h2><p class="number">'.escape($order['order_number']).'</p>';
        echo '<p class="notice">Заявка на согласование. Цена и наличие подтверждаются при общении с покупателем.</p>';
        if($workflow) renderWorkflow($db,$order,$csrf);
        $fields=['subject'=>'Тема','customer_name'=>'Имя','phone'=>'Телефон','contact_channel'=>'Удобный способ связи',
            'desired_date'=>'Желаемая дата','delivery_method'=>'Получение','time_slot'=>'Удобное время',
            'delivery_address'=>'Адрес доставки','comment'=>'Пожелания / вопрос',
            'requested_quantity'=>'Запрошенное количество','budget_rubles'=>'Указанный бюджет, ₽'];
        echo '<dl>';
        foreach($fields as $key=>$label) {
            $value=(string)($order[$key]??'');if($value==='')continue;
            echo '<dt>'.escape($label).'</dt><dd>';
            if($key==='phone'&&preg_match('/^7[0-9]{10}$/D',$value))
                echo '<a class="phone" href="tel:+'.escape($value).'">+'.escape($value).'</a>';
            else echo nl2br(escape($value));
            echo '</dd>';
        }
        echo '</dl>';
        $detail=inboxDetail($db,$order['order_number'],$origin);
        if($detail!==null) {
            $previous=$detail['previousRequests'];
            if(is_int($previous))echo '<p class="notice">'.escape($previous>0?'Повторное обращение: более ранних заявок с этим телефоном — '.$previous.'.':'Первое обращение с этим телефоном среди сохранённых заявок.').'<br><span class="muted">Совпадение телефона не подтверждает личность или покупку. Очищенные заявки не учитываются.</span></p>';
            renderRequestProducts($detail['items']);
        }
        if($order['request_type']==='legacy'&&$order['total_kopecks']!==null)echo '<p>Ранее сохранённая сумма: '.escape(money((int)$order['total_kopecks'])).'</p>';
        if($retentionEnabled)renderRetentionDecision($db,$order,$csrf,$error);
        $q=$db->prepare('SELECT status,attempts,last_error_code FROM zt_notification_queue WHERE order_id=?');$q->execute([$id]);
        $statuses=['pending'=>'Ожидает отправки','processing'=>'Отправляется','sent'=>'Передано в VK','failed'=>'Не отправлено — требуется проверка'];
        echo '<section class="delivery-status"><h3>Уведомление Екатерине</h3>';
        foreach($q->fetchAll(\PDO::FETCH_ASSOC) as $row){echo '<p>'.escape($statuses[$row['status']]??'Ожидает проверки').'.</p>';if($row['status']==='failed'||$row['last_error_code']){echo '<details class="technical-details"><summary>Сведения для технического исполнителя</summary><p>Попыток: '.(int)$row['attempts'].'</p>';if($row['last_error_code'])echo '<p class="muted">Код: '.escape($row['last_error_code']).'</p>';echo '</details>';}}
        echo '<p class="muted">Заявка уже хранится здесь независимо от доставки сообщения.</p></section></article>';
    } else {
        $page=max(0,min(100000,(int)($_GET['page']??0)));$offset=$page*50;
        $where=$type!==''?' WHERE '.panelTypeSql().'=?':'';
        $count=$db->prepare('SELECT COUNT(*) FROM zt_orders'.$where);$count->execute($type!==''?[$type]:[]);$total=(int)$count->fetchColumn();
        echo '<form class="filters" method="get"><label>Тип заявки<select name="type"><option value="">Все типы</option>';
        foreach(panelRequestTypes() as $key=>$label)echo '<option value="'.escape($key).'"'.($type===$key?' selected':'').'>'.escape($label).'</option>';
        if($type!==''&&!isset(panelRequestTypes()[$type]))echo '<option selected value="'.escape($type).'">'.escape(($types[$type]??$type).' — ранее сохранённые').'</option>';
        echo '</select></label><button>Показать</button></form><p class="summary">Заявок: '.$total.'. Время указано по Перми.</p>';
        $extra=$workflow?',status,complaint_open,next_action,next_action_at,erased_at':'';
        $sorting=$workflow?' ORDER BY (erased_at IS NULL AND complaint_open=1) DESC,(next_action_at IS NOT NULL AND next_action_at<=UTC_TIMESTAMP()) DESC,(status=\'new\' AND erased_at IS NULL) DESC,created_at DESC,id DESC':' ORDER BY created_at DESC,id DESC';
        if($workflow)echo '<p class="notice">Сначала — заявки с претензией, просроченным действием и новые. Напоминания здесь внутренние: сообщения покупателям не отправляются.</p>';
        $q=$db->prepare('SELECT id,order_number,request_type,'.panelTypeSql().' AS panel_type,customer_name,subject,created_at'.$extra.' FROM zt_orders'.$where.$sorting.' LIMIT 50 OFFSET '.$offset);
        $q->execute($type!==''?[$type]:[]);$rows=$q->fetchAll(\PDO::FETCH_ASSOC);
        if(!$rows)echo '<section class="empty"><h2>Заявок пока нет</h2><p>После сохранения заявки сайта появятся здесь. Если выбран фильтр, попробуйте все типы.</p></section>';
        echo '<ol class="requests">';
        foreach($rows as $row){echo '<li><a class="request" href="?id='.escape($row['id']).'"><span class="request-top"><strong>'.escape($types[$row['panel_type']]??'Обращение').'</strong><time>'.escape(requestDate($row['created_at'])).'</time></span><span class="subject">'.escape($row['subject']).'</span><span>'.escape($row['customer_name']).'</span>';
            if($workflow){echo '<p class="workflow-summary">'.escape($row['erased_at']?'Личные данные очищены':(workflowStatuses()[$row['status']]??'Требуется проверка'));
                if($row['complaint_open'])echo ' · Есть претензия';
                if($row['next_action'])echo ' · '.escape(workflowActions()[$row['next_action']]??'Проверить').': '.escape(requestDate($row['next_action_at']));echo '</p>';}
            echo '<span class="request-bottom"><small>'.escape($row['order_number']).'</small><span>Открыть заявку</span></span></a></li>';}
        echo '</ol><nav class="pagination" aria-label="Страницы заявок">';
        $suffix='&amp;type='.escape($type);
        if($page>0)echo '<a href="?page='.($page-1).$suffix.'">Предыдущие</a>';
        if($offset+50<$total)echo '<a href="?page='.($page+1).$suffix.'">Следующие</a>';
        echo '</nav>';
    }
    pageEnd();
}
function renderRetentionList(\PDO $db): void {
    $raw=$_GET['page']??'0';
    if(!is_string($raw)||!preg_match('/^(?:0|[1-9][0-9]{0,5})$/D',$raw)||(int)$raw>100000){http_response_code(422);echo '<p>Неизвестная страница.</p>';return;}
    $page=(int)$raw;$result=retentionReviewList($db,$page);$types=requestTypes();
    echo '<h2>Проверка сроков</h2><p class="notice">Здесь обращения, которые пора проверить, и заявки с отметкой «Можно очистить». Автоматическое удаление не включено.</p><p class="summary">Для проверки или дальнейшей очистки: '.$result['total'].'.</p>';
    if(!$result['rows'])echo '<section class="empty"><h3>Проверка пока не требуется</h3><p>Новые заявки доступны в разделе «Все заявки». Действующую заявку можно открыть и проверить раньше срока.</p></section>';
    echo '<ol class="requests">';
    foreach($result['rows'] as $row){
        $label=$row['decision']==='ready'?'Отмечена к очистке':($row['decision']==='keep'?'Повторная проверка':'Пора проверить');
        echo '<li><a class="request" href="?id='.escape($row['id']).'#retention-review"><span class="request-top"><strong>'.escape($types[$row['request_type']]??'Обращение').'</strong><time>'.escape(requestDate($row['created_at'])).'</time></span><span class="subject">'.escape($row['subject']).'</span><span>'.escape($row['customer_name']).'</span><span class="retention-label">'.escape($label).'</span><span class="request-bottom"><small>'.escape($row['order_number']).'</small><span>Открыть и проверить</span></span></a></li>';
    }
    echo '</ol><nav class="pagination" aria-label="Страницы проверки">';
    if($page>0)echo '<a href="?view=retention&amp;page='.($page-1).'">Предыдущие</a>';
    if(($page+1)*50<$result['total'])echo '<a href="?view=retention&amp;page='.($page+1).'">Следующие</a>';
    echo '</nav>';
}
function renderRetentionDecision(\PDO $db,array $order,string $csrf,string $error=''): void {
    echo '<section id="retention-review" class="retention-section"><h3>Хранение заявки</h3>';
    if($order['erased_at']!==null){echo '<p>Личные данные этой заявки уже очищены. Новое решение недоступно.</p></section>';return;}
    $review=retentionDecision($db,$order['id']);$perm=new \DateTimeZone('Asia/Yekaterinburg');
    $today=new \DateTimeImmutable('today',$perm);
    if($error!=='')echo '<p class="error" role="alert">'.escape($error).'</p>';
    if(($review['decision']??'')==='keep')echo '<p class="notice">Оставлена до следующей проверки: '.escape(requestDate($review['review_at'])).'. Причина: '.escape(retentionReasons()[$review['reason']]??'Требуется проверка').'.</p>';
    elseif(($review['decision']??'')==='ready')echo '<p class="notice">Отмечена к очистке. Данные пока не удалены. Ориентир срока уничтожения по указанной дате завершения: '.escape(requestDate($review['erase_due_at'])).'.</p>';
    else echo '<p class="notice">Плановая проверка: '.escape(requestReviewAt($order)->setTimezone($perm)->format('d.m.Y H:i')).' — время Перми. При завершении обращения его можно проверить раньше.</p>';
    echo '<p>Если работа с обращением закончена, выберите «Можно очистить». Пока оно в работе, ничего удалять не нужно.</p>';
    $hidden='';
    foreach(['csrf'=>$csrf,'action'=>'retention_review','order_id'=>$order['id'],'order_version'=>(string)$order['workflow_version'],'review_version'=>(string)($review['version']??0)] as $name=>$value)$hidden.='<input type="hidden" name="'.escape($name).'" value="'.escape($value).'">';
    $reason=$review['reason']??'';$date=$today->modify('+30 days')->format('Y-m-d');$ended='';
    if(($review['decision']??'')==='ready')$ended=(new \DateTimeImmutable($review['goal_ended_at'],new \DateTimeZone('UTC')))->setTimezone($perm)->format('Y-m-d');
    if($error!==''&&($_POST['order_id']??'')===$order['id']){
        if(is_string($_POST['reason']??null))$reason=$_POST['reason'];
        if(is_string($_POST['review_date']??null))$date=substr($_POST['review_date'],0,10);
        if(is_string($_POST['goal_ended_on']??null))$ended=substr($_POST['goal_ended_on'],0,10);
    }
    if(($review['decision']??'')==='ready')echo '<p><a class="cleanup-link" href="?view=cleanup&amp;number='.escape($order['order_number']).'">Перейти к удалению заявки</a></p><details class="technical-details"'.($error!==''?' open':'').'><summary>Изменить решение о хранении</summary>';
    echo '<div class="retention-options"><details class="retention-keep"'.(($error!==''&&($_POST['decision']??'')==='keep')?' open':'').'><summary>Ещё нужна — назначить следующую проверку</summary><form method="post" class="retention-form">'.$hidden.'<input type="hidden" name="decision" value="keep"><fieldset><legend>Ещё нужна</legend><label>Причина<select name="reason" required><option value="">Выберите причину</option>';
    foreach(retentionReasons() as $key=>$label)echo '<option value="'.escape($key).'"'.($reason===$key?' selected':'').'>'.escape($label).'</option>';
    echo '</select></label><label>Когда проверить снова<input type="date" name="review_date" value="'.escape($date).'" min="'.$today->modify('+1 day')->format('Y-m-d').'" max="'.$today->modify('+90 days')->format('Y-m-d').'" required></label><p class="muted">От завтра до 90 дней вперёд. Это дата проверки, не автоматического удаления.</p><button type="submit">Сохранить дату проверки</button></fieldset></form></details>';
    $created=(new \DateTimeImmutable($order['created_at'],new \DateTimeZone('UTC')))->setTimezone($perm)->format('Y-m-d');
    echo '<form method="post" class="retention-form">'.$hidden.'<input type="hidden" name="decision" value="ready"><fieldset><legend>Можно очистить</legend><label>Когда обращение завершено или отменено<input type="date" name="goal_ended_on" value="'.escape($ended).'" min="'.$created.'" max="'.$today->format('Y-m-d').'" required></label><label class="check"><input type="checkbox" name="confirm_clear" value="1" required>Обращение завершено, сведения больше не нужны и других оснований хранить их нет.</label><p class="muted">Кнопка сохранит решение. Данные сейчас не удалятся. Затем можно перейти к удалению заявки.</p><button type="submit">Можно очистить</button></fieldset></form></div>';
    if(($review['decision']??'')==='ready')echo '</details>';
    echo '<a href="?view=retention">К списку проверки сроков</a></section>';
}
function renderRequestProducts(array $items): void {
    if(!$items)return;
    echo '<h3>Выбранные товары</h3><ul class="request-products">';
    foreach($items as $item) {
        echo '<li><h4>'.escape($item['name']).'</h4><p>'.escape($item['referenceOnly']?'Пример для обсуждения; количество не подтверждено.':'Количество: '.$item['quantity'].' шт.').'</p>';
        foreach(['category'=>'Раздел каталога','description'=>'Состав / описание','note'=>'Дополнительно','priceLabel'=>'Цена в карточке при обращении — требует подтверждения'] as $key=>$label)
            if($item[$key]!=='')echo '<p><strong>'.escape($label).':</strong> '.nl2br(escape($item[$key])).'</p>';
        if($item['photos']) {
            echo '<div class="request-photos">';
            foreach($item['photos'] as $index=>$photo)echo '<a href="'.escape($photo).'" target="_blank" rel="noopener noreferrer" aria-label="'.escape('Открыть фото '.($index+1).' товара «'.$item['name'].'»').'">'.
                '<img src="'.escape($photo).'" alt="'.escape($item['name'].' — фото '.($index+1)).'" loading="lazy" decoding="async" width="240" height="300" referrerpolicy="no-referrer"></a>';
            echo '</div><p class="muted">Фотографии из снимка карточки при обращении. Нажмите фото, чтобы открыть крупнее.</p>';
        } else echo '<p class="muted">Фото при подаче этой заявки не сохранено.</p>';
        echo '</li>';
    }
    echo '</ul>';
}
function renderWorkflow(\PDO $db,array $order,string $csrf): void {
    if($order['erased_at']){echo '<p class="notice">Личные данные очищены '.escape(requestDate($order['erased_at'])).'. Осталась ограниченная служебная запись для защиты от повторов. Это не анонимная статистика.</p>';return;}
    echo '<section class="workflow"><h3>Работа с заявкой</h3><p>Статус и следующее действие задаёте вы. Доставка сообщения VK не подтверждает покупку.</p><form method="post">';
    foreach(['csrf'=>$csrf,'action'=>'workflow','order_id'=>$order['id'],'version'=>(string)$order['workflow_version']] as $name=>$value)echo '<input type="hidden" name="'.escape($name).'" value="'.escape($value).'">';
    echo '<label>Статус<select name="status">';foreach(workflowStatuses() as $key=>$label)echo '<option value="'.escape($key).'"'.($order['status']===$key?' selected':'').'>'.escape($label).'</option>';echo '</select></label>';
    echo '<label>Претензия<select name="complaint"><option value="0">Нет открытой претензии</option><option value="1"'.($order['complaint_open']?' selected':'').'>Есть — требуется человек, очистка приостановлена</option></select></label>';
    echo '<label>Следующее действие<select name="next_action"><option value="">Не назначено</option>';foreach(workflowActions() as $key=>$label)echo '<option value="'.escape($key).'"'.($order['next_action']===$key?' selected':'').'>'.escape($label).'</option>';echo '</select></label>';
    $due=$order['next_action_at']?(new \DateTimeImmutable($order['next_action_at'],new \DateTimeZone('UTC')))->setTimezone(new \DateTimeZone('Asia/Yekaterinburg'))->format('Y-m-d\TH:i'):'';
    echo '<label>Срок действия — время Перми<input type="datetime-local" name="next_action_at" value="'.escape($due).'"></label><label class="check"><input type="checkbox" name="confirm_completed" value="1"> Выполнение заказа проверено мной (нужно для статуса «Выполнена»)</label><p class="muted">Закрытие заявки или открытая претензия отменяет назначенное действие. Для претензии следующую проверку организует сотрудник. Очистка выполненных заказов автоматически не запускается.</p><button>Сохранить изменения</button></form>';
    $q=$db->prepare('SELECT event_type,actor,details,created_at FROM zt_request_events WHERE order_id=? ORDER BY id DESC LIMIT 20');$q->execute([$order['id']]);
    echo '<h3>Последние изменения</h3><ul>';foreach($q->fetchAll(\PDO::FETCH_ASSOC) as $event){$d=json_decode($event['details'],true);echo '<li>'.escape(requestDate($event['created_at'])).' — '.escape($event['event_type']==='workflow_updated'?'Изменено владельцем: '.(workflowStatuses()[$d['to']??'']??'Проверить'):'Служебная очистка').'</li>';}echo '</ul></section>';
}

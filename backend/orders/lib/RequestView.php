<?php
declare(strict_types=1);
namespace ZTOrders;
function pageStart(): void {
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Заявки — За цветком</title><link rel="stylesheet" href="orders.css"></head><body><main class="workspace"><header class="masthead"><p class="shop">За цветком</p><h1>Заявки магазина</h1></header>';
}
function pageEnd(): void { echo '</main></body></html>'; }
function renderRequestView(\PDO $db,bool $session,string $csrf,string $error,bool $workflow=false): void {
    if (!$session) {
        pageStart();
        echo '<section class="login"><h2>Вход для Екатерины</h2><p>Войдите, чтобы увидеть заявки и контакты покупателей.</p>';
        if ($error!=='') echo '<p class="error" role="alert">'.escape($error).'</p>';
        echo '<form method="post"><input type="hidden" name="csrf" value="'.escape($csrf).'"><label>Логин<input name="username" autocomplete="username" required maxlength="100"></label><label>Пароль<input name="password" type="password" autocomplete="current-password" required maxlength="1024"></label><button>Войти</button></form></section>';
        pageEnd(); return;
    }
    $types=requestTypes();
    $id=$_GET['id']??'';
    if(!is_string($id) || ($id!=='' && !preg_match('/^[a-f0-9]{32}$/D',$id))) {
        http_response_code(404);pageStart();echo '<p>Заявка не найдена. <a href="orders.php">Вернуться к списку</a></p>';pageEnd();return;
    }
    if($id!=='') {
        $q=$db->prepare('SELECT * FROM zt_orders WHERE id=?');$q->execute([$id]);$order=$q->fetch(\PDO::FETCH_ASSOC);
        if(!$order){http_response_code(404);pageStart();echo '<p>Заявка не найдена. <a href="orders.php">Вернуться к списку</a></p>';pageEnd();return;}
    }
    $type=$_GET['type']??'';
    if(!is_string($type)||($type!==''&&!isset($types[$type]))) {http_response_code(422);pageStart();echo '<p>Неизвестный тип заявки. <a href="orders.php">Все заявки</a></p>';pageEnd();return;}
    pageStart();
    echo '<form class="logout" method="post"><input type="hidden" name="csrf" value="'.escape($csrf).'"><button class="secondary" name="action" value="logout">Выйти</button></form>';
    if($id!=='') {
        echo '<a class="back" href="orders.php">Все заявки</a><article class="detail"><p class="meta">'.escape(requestDate($order['created_at'])).' · время Перми</p><h2>'.escape($types[$order['request_type']]??'Обращение').'</h2><p class="number">'.escape($order['order_number']).'</p>';
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
        $q=$db->prepare('SELECT product_name,quantity FROM zt_order_items WHERE order_id=? ORDER BY id');$q->execute([$id]);$items=$q->fetchAll(\PDO::FETCH_ASSOC);
        if($items){echo '<h3>Выбранные товары</h3><ul class="items">';foreach($items as $item)echo '<li><span>'.escape($item['product_name']).'</span><strong>'.(int)$item['quantity'].' шт.</strong></li>';echo '</ul><p class="muted">Названия переданы в заявке покупателем. Фото здесь не хранятся.</p>';}
        if($order['request_type']==='legacy'&&$order['total_kopecks']!==null)echo '<p>Ранее сохранённая сумма: '.escape(money((int)$order['total_kopecks'])).'</p>';
        $q=$db->prepare('SELECT status,attempts,last_error_code FROM zt_notification_queue WHERE order_id=?');$q->execute([$id]);
        $statuses=['pending'=>'Ожидает отправки','processing'=>'Отправляется','sent'=>'Передано в VK','failed'=>'Не отправлено — требуется проверка'];
        echo '<section class="delivery-status"><h3>Уведомление Екатерине</h3>';
        foreach($q->fetchAll(\PDO::FETCH_ASSOC) as $row){echo '<p>'.escape($statuses[$row['status']]??'Ожидает проверки').'. Попыток: '.(int)$row['attempts'].'</p>';if($row['last_error_code'])echo '<p class="muted">Код: '.escape($row['last_error_code']).'</p>';}
        echo '<p class="muted">Заявка уже хранится здесь независимо от доставки сообщения.</p></section></article>';
    } else {
        $page=max(0,min(100000,(int)($_GET['page']??0)));$offset=$page*50;
        $where=$type!==''?' WHERE request_type=?':'';
        $count=$db->prepare('SELECT COUNT(*) FROM zt_orders'.$where);$count->execute($type!==''?[$type]:[]);$total=(int)$count->fetchColumn();
        echo '<form class="filters" method="get"><label>Тип заявки<select name="type"><option value="">Все типы</option>';
        foreach($types as $key=>$label)echo '<option value="'.escape($key).'"'.($type===$key?' selected':'').'>'.escape($label).'</option>';
        echo '</select></label><button>Показать</button></form><p class="summary">Заявок: '.$total.'. Время указано по Перми.</p>';
        $extra=$workflow?',status,complaint_open,next_action,next_action_at,erased_at':'';
        $sorting=$workflow?' ORDER BY (erased_at IS NULL AND complaint_open=1) DESC,(next_action_at IS NOT NULL AND next_action_at<=UTC_TIMESTAMP()) DESC,(status=\'new\' AND erased_at IS NULL) DESC,created_at DESC,id DESC':' ORDER BY created_at DESC,id DESC';
        if($workflow)echo '<p class="notice">Сначала — заявки с претензией, просроченным действием и новые. Напоминания здесь внутренние: сообщения покупателям не отправляются.</p>';
        $q=$db->prepare('SELECT id,order_number,request_type,customer_name,subject,created_at'.$extra.' FROM zt_orders'.$where.$sorting.' LIMIT 50 OFFSET '.$offset);
        $q->execute($type!==''?[$type]:[]);$rows=$q->fetchAll(\PDO::FETCH_ASSOC);
        if(!$rows)echo '<section class="empty"><h2>Заявок пока нет</h2><p>После сохранения заявки сайта появятся здесь. Если выбран фильтр, попробуйте все типы.</p></section>';
        echo '<ol class="requests">';
        foreach($rows as $row){echo '<li><a class="request" href="?id='.escape($row['id']).'"><span class="request-top"><strong>'.escape($types[$row['request_type']]??'Обращение').'</strong><time>'.escape(requestDate($row['created_at'])).'</time></span><span class="subject">'.escape($row['subject']).'</span><span>'.escape($row['customer_name']).'</span>';
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

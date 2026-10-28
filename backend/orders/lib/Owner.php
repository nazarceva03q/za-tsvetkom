<?php
declare(strict_types=1);
namespace ZTOrders;
require_once __DIR__ . '/Notifications.php';
require_once __DIR__ . '/RequestView.php';
require_once __DIR__ . '/Workflow.php';
function escape(string $text): string { return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function ownerCookie(string $name, string $value, int $expires): void {
    setcookie($name, $value, ['expires'=>$expires, 'path'=>'/', 'secure'=>true, 'httponly'=>true, 'samesite'=>'Strict']);
}
function ownerReturnPath(array $query): string {
    $number=$query['number']??null;
    if(is_string($number)&&preg_match('/^ZT-[A-F0-9]{16}$/D',$number))return 'orders.php?number='.$number;
    $id=$query['id']??null;
    if(is_string($id)&&preg_match('/^[a-f0-9]{32}$/D',$id))return 'orders.php?id='.$id;
    if(($query['view']??'')==='retention')return 'orders.php?view=retention';
    return 'orders.php';
}
function ownerOriginAllowed(array $server,string $expected): bool {
    if(isset($server['HTTP_SEC_FETCH_SITE'])&&$server['HTTP_SEC_FETCH_SITE']!=='same-origin')return false;
    $origin=$server['HTTP_ORIGIN']??'';
    // An explicitly foreign/opaque Origin must never be overridden by Referer.
    if($origin!=='')return is_string($origin)&&hash_equals($expected,$origin);
    $referer=$server['HTTP_REFERER']??'';
    if(!is_string($referer))return false;
    $parts=parse_url($referer);
    if(!is_array($parts)||!isset($parts['scheme'],$parts['host'])||isset($parts['user'])||isset($parts['pass']))return false;
    $refererOrigin=$parts['scheme'].'://'.$parts['host'].(isset($parts['port'])?':'.$parts['port']:'');
    return hash_equals($expected,$refererOrigin);
}
function ownerAuthDenied(string $code): void {
    http_response_code(403);
    pageStart();
    echo '<section class="login"><h2>Не удалось подтвердить вход</h2><p>Обновите страницу входа и попробуйте снова. Во встроенном браузере VK откройте ссылку в Safari или другом обычном браузере.</p><p class="muted">Код проверки: '.escape($code).'</p><a href="orders.php">Открыть страницу входа заново</a></section>';
    pageEnd();
}
function ownerIsLoginPost(array $post): bool {
    return !array_diff(array_keys($post),['csrf','username','password'])
        && is_string($post['csrf']??null)&&is_string($post['username']??null)&&is_string($post['password']??null);
}
function ownerPage(array $config): void {
    http_response_code(200);
    ob_start(); // Keep headers changeable until all authorization/render checks finish.
    $owner = $config['owner'] ?? [];
    $retentionEnabled=($config['retention_review']['enabled']??false)===true;
    if($retentionEnabled)require_once __DIR__.'/RetentionDecisions.php';
    if($retentionEnabled)require_once __DIR__.'/OwnerErasure.php';
    if (empty($owner['enabled']) || strlen($owner['secret'] ?? '') < 64 ||
        empty($owner['username']) || empty($owner['password_hash'])) throw new \RuntimeException('CONFIG');
    $db = connect($config); // All authorization fails closed on database outage.
    $token = $_COOKIE['__Host-zt-owner'] ?? '';
    $session = false;
    if (is_string($token) && preg_match('/^[a-f0-9]{64}$/D', $token)) {
        $q = $db->prepare('SELECT token_hash FROM zt_owner_sessions WHERE token_hash=? AND expires_at>UTC_TIMESTAMP()');
        $q->execute([hash('sha256', $token)]); $session = (bool)$q->fetchColumn();
    }
    $nonce = $_COOKIE['__Host-zt-login'] ?? '';
    $hasLoginCookie=is_string($nonce)&&preg_match('/^[a-f0-9]{64}$/D',$nonce);
    if (!$hasLoginCookie) {
        $nonce = bin2hex(random_bytes(32)); ownerCookie('__Host-zt-login', $nonce, time()+1800);
    }
    $csrf = hash_hmac('sha256', $session ? $token : $nonce, $owner['secret']);
    $error = '';
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
        if(!ownerOriginAllowed($_SERVER,$config['origin'])){ownerAuthDenied('AUTH_ORIGIN');return;}
        if(!$session&&!$hasLoginCookie){ownerAuthDenied('AUTH_COOKIES');return;}
        // A second submit may arrive after the first one established a session
        // (autofill, another tab, Back/resubmit). Its pre-login token is then
        // different from the session CSRF. Reuse the valid session for this
        // read-only redirect only; never accept a login token for mutations.
        if($session&&ownerIsLoginPost($_POST)) {
            $loginCsrf=hash_hmac('sha256',$nonce,$owner['secret']);
            if(hash_equals($csrf,$_POST['csrf'])||($hasLoginCookie&&hash_equals($loginCsrf,$_POST['csrf']))) {
                header('Location: '.ownerReturnPath($_GET),true,303);return;
            }
        }
        if(!is_string($_POST['csrf']??null)||!hash_equals($csrf,$_POST['csrf'])){ownerAuthDenied('AUTH_FORM');return;}
        if ($session && ($_POST['action'] ?? '') === 'logout') {
            $q = $db->prepare('DELETE FROM zt_owner_sessions WHERE token_hash=?'); $q->execute([hash('sha256',$token)]);
            ownerCookie('__Host-zt-owner','',time()-3600); header('Location: orders.php',true,303); return;
        }
        if($session&&($_POST['action']??'')==='retention_review') {
            if(!$retentionEnabled){http_response_code(403);echo 'Проверка сроков пока выключена.';return;}
            try{$id=saveRetentionDecision($db,$_POST);header('Location: orders.php?id='.$id.'#retention-review',true,303);return;}
            catch(RetentionDecisionError $e){
                http_response_code(409);
                $id=$_POST['order_id']??'';
                if(is_string($id)&&preg_match('/^[a-f0-9]{32}$/D',$id)){
                    $_GET=['id'=>$id];renderRequestView($db,true,$csrf,$e->getMessage(),($config['workflow']['enabled']??false)===true,$config['origin']??'',true);
                }else{pageStart();echo '<p class="error" role="alert">'.escape($e->getMessage()).'</p><a href="orders.php">Открыть список</a>';pageEnd();}
                return;
            }
        }
        if($session&&($_POST['action']??'')==='erase_request') {
            if(!$retentionEnabled){http_response_code(403);echo 'Очистка пока выключена.';return;}
            try {
                $result=ownerEraseRequest($db,$config,$_POST);
                header('Location: orders.php?view=cleanup&record='.$result['recordId'].
                    (isset($result['ledgerExport'])?'&export=retry':''),true,303);return;
            } catch(ErasureError $e) {
                http_response_code(409);$_GET=['view'=>'cleanup','number'=>$_POST['order_number']??''];
                renderOwnerErasure($db,$config,$csrf,$e->getMessage());return;
            }
        }
        if($session&&($_POST['action']??'')==='confirm_erasure_copies') {
            if(!$retentionEnabled){http_response_code(403);echo 'Очистка пока выключена.';return;}
            try{$result=ownerConfirmErasureCopies($db,$config,$_POST);header('Location: orders.php?view=cleanup&record='.$result['recordId'],true,303);return;}
            catch(ErasureError $e){http_response_code(409);$_GET=['view'=>'cleanup','record'=>$_POST['record_id']??''];renderOwnerErasure($db,$config,$csrf,$e->getMessage());return;}
        }
        if ($session && ($_POST['action'] ?? '') === 'workflow') {
            if (($config['workflow']['enabled']??false)!==true) {http_response_code(403);echo 'Изменения заявок пока выключены.';return;}
            try {$id=saveWorkflow($db,$_POST);header('Location: orders.php?id='.$id,true,303);return;}
            catch(WorkflowError $e){http_response_code(409);pageStart();echo '<p class="error" role="alert">'.escape($e->getMessage()).'</p><a href="orders.php">Открыть актуальный список</a>';pageEnd();return;}
        }
        if ($session) {http_response_code(400);echo 'Неизвестное действие.';return;}
        if (!$session) {
            $bucket = hash_hmac('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . ':' . intdiv(time(),900), $owner['secret']);
            // Atomic increment counts every attempt; concurrent requests cannot bypass the limit.
            $q = $db->prepare('INSERT INTO zt_owner_login_limits(bucket_key,attempts,expires_at)
                VALUES(?,1,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE)) ON DUPLICATE KEY UPDATE attempts=attempts+1');
            $q->execute([$bucket]);
            $q = $db->prepare('SELECT attempts FROM zt_owner_login_limits WHERE bucket_key=?');
            $q->execute([$bucket]);
            if ((int)$q->fetchColumn()>10) { http_response_code(429); echo 'Слишком много попыток. Повторите через 15 минут. Код проверки: AUTH_LIMIT.'; return; }
            $password = $_POST['password'] ?? '';
            $username = $_POST['username'] ?? '';
            if(is_string($username))$username=trim($username);
            $verified = is_string($password) && strlen($password)<=1024 && password_verify($password,$owner['password_hash']);
            if ($verified && is_string($username) && hash_equals($owner['username'],$username)) {
                $token = bin2hex(random_bytes(32));
                $q = $db->prepare('INSERT INTO zt_owner_sessions(token_hash,expires_at) VALUES(?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR))');
                $q->execute([hash('sha256',$token)]);
                ownerCookie('__Host-zt-owner',$token,time()+28800);
                header('Location: '.ownerReturnPath($_GET),true,303); return;
            }
            http_response_code(401); $error='Неверный логин или пароль. Код проверки: AUTH_CREDENTIALS.';
        }
    } elseif (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        http_response_code(405); return;
    }
    if (!$session && !$error) http_response_code(401);
    if($session&&$retentionEnabled&&($_GET['view']??'')==='cleanup') {
        if(isset($_GET['download']))ownerErasureDownload($db,$config);
        else renderOwnerErasure($db,$config,$csrf);
        return;
    }
    renderRequestView($db, $session, $csrf, $error, ($config['workflow']['enabled']??false)===true, $config['origin']??'', $retentionEnabled);
}

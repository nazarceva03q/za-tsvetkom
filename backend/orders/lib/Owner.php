<?php
declare(strict_types=1);
namespace ZTOrders;
require_once __DIR__ . '/Notifications.php';
require_once __DIR__ . '/RequestView.php';
function escape(string $text): string { return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function ownerCookie(string $name, string $value, int $expires): void {
    setcookie($name, $value, ['expires'=>$expires, 'path'=>'/', 'secure'=>true, 'httponly'=>true, 'samesite'=>'Strict']);
}
function ownerPage(array $config): void {
    http_response_code(200);
    ob_start(); // Keep headers changeable until all authorization/render checks finish.
    $owner = $config['owner'] ?? [];
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
    if (!is_string($nonce) || !preg_match('/^[a-f0-9]{64}$/D', $nonce)) {
        $nonce = bin2hex(random_bytes(32)); ownerCookie('__Host-zt-login', $nonce, time()+1800);
    }
    $csrf = hash_hmac('sha256', $session ? $token : $nonce, $owner['secret']);
    $error = '';
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
        if (($_SERVER['HTTP_ORIGIN'] ?? '') !== $config['origin'] ||
            !is_string($_POST['csrf'] ?? null) || !hash_equals($csrf, $_POST['csrf'])) {
            http_response_code(403); echo 'Запрос отклонён.'; return;
        }
        if ($session && ($_POST['action'] ?? '') === 'logout') {
            $q = $db->prepare('DELETE FROM zt_owner_sessions WHERE token_hash=?'); $q->execute([hash('sha256',$token)]);
            ownerCookie('__Host-zt-owner','',time()-3600); header('Location: orders.php',true,303); return;
        }
        if (!$session) {
            $bucket = hash_hmac('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . ':' . intdiv(time(),900), $owner['secret']);
            // Atomic increment counts every attempt; concurrent requests cannot bypass the limit.
            $q = $db->prepare('INSERT INTO zt_owner_login_limits(bucket_key,attempts,expires_at)
                VALUES(?,1,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE)) ON DUPLICATE KEY UPDATE attempts=attempts+1');
            $q->execute([$bucket]);
            $q = $db->prepare('SELECT attempts FROM zt_owner_login_limits WHERE bucket_key=?');
            $q->execute([$bucket]);
            if ((int)$q->fetchColumn()>10) { http_response_code(429); echo 'Слишком много попыток. Повторите позднее.'; return; }
            $password = $_POST['password'] ?? '';
            $username = $_POST['username'] ?? '';
            $verified = is_string($password) && strlen($password)<=1024 && password_verify($password,$owner['password_hash']);
            if ($verified && is_string($username) && hash_equals($owner['username'],$username)) {
                $token = bin2hex(random_bytes(32));
                $q = $db->prepare('INSERT INTO zt_owner_sessions(token_hash,expires_at) VALUES(?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR))');
                $q->execute([hash('sha256',$token)]);
                ownerCookie('__Host-zt-owner',$token,time()+28800);
                header('Location: orders.php',true,303); return;
            }
            http_response_code(401); $error='Неверные данные входа.';
        }
    } elseif (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        http_response_code(405); return;
    }
    if (!$session && !$error) http_response_code(401);
    renderRequestView($db, $session, $csrf, $error);
}

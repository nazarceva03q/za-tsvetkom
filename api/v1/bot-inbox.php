<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');
$private=realpath(getenv('ZT_ORDERS_PRIVATE_DIR')?:'');
$public=realpath($_SERVER['DOCUMENT_ROOT']??__DIR__);
if(!$private||!$public||$private===$public||str_starts_with($private.DIRECTORY_SEPARATOR,$public.DIRECTORY_SEPARATOR)
    ||!is_file($private.'/lib/BotInbox.php')) {
    http_response_code(503);echo '{"ok":false,"code":"INBOX_NOT_CONFIGURED"}';exit;
}
require $private.'/lib/BotInbox.php';
\ZTOrders\runInbox($private);

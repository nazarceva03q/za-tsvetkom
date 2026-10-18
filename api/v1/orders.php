<?php
declare(strict_types=1);
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    echo '{"ok":false,"code":"METHOD_NOT_ALLOWED"}';
    exit;
}

// Set in the hosting/FastCGI environment. No public config file fallback.
$private = getenv('ZT_ORDERS_PRIVATE_DIR');
$private = is_string($private) && $private !== '' ? realpath($private) : false;
$public = realpath($_SERVER['DOCUMENT_ROOT'] ?? __DIR__);
if (!$private || !$public || $private === $public
    || str_starts_with($private . DIRECTORY_SEPARATOR, $public . DIRECTORY_SEPARATOR)
    || !is_file($private . '/config.php') || !is_file($private . '/lib/Http.php')) {
    http_response_code(503);
    echo '{"ok":false,"code":"ORDERS_NOT_CONFIGURED","message":"Приём заявок пока не подключён. Позвоните в магазин."}';
    exit;
}
require $private . '/lib/Http.php';
\ZTOrders\run($private);

<?php
declare(strict_types=1);
ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$private = realpath(getenv('ZT_ORDERS_PRIVATE_DIR') ?: '');
$public = realpath($_SERVER['DOCUMENT_ROOT'] ?? __DIR__);
if (!$private || !$public || $private === $public
    || str_starts_with($private . DIRECTORY_SEPARATOR, $public . DIRECTORY_SEPARATOR)
    || !is_file($private . '/lib/Catalog.php')) {
    http_response_code(503);
    echo '{"ok":false,"code":"CATALOG_NOT_CONFIGURED"}';
    exit;
}
require $private . '/lib/Catalog.php';
\ZTCatalog\run($private, $public);

<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Cache-Control: no-store, private');
header('X-Robots-Tag: noindex, nofollow');
header('X-Content-Type-Options: nosniff');
// Preserve Origin for same-site HTML form POSTs; do not disclose referrers externally.
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
if (($_SERVER['HTTPS'] ?? '') !== 'on' && (string)($_SERVER['SERVER_PORT'] ?? '') !== '443') {
    http_response_code(403); echo 'Требуется HTTPS.'; exit;
}
try {
    $private = realpath((string)getenv('ZT_ORDERS_PRIVATE_DIR'));
    $public = realpath($_SERVER['DOCUMENT_ROOT'] ?? __DIR__);
    if (!$private || !$public || $private === $public || str_starts_with($private, $public . DIRECTORY_SEPARATOR))
        throw new RuntimeException('CONFIG');
    require $private . '/lib/Owner.php';
    \ZTOrders\ownerPage(require $private . '/config.php');
} catch (Throwable $e) {
    http_response_code(503);
    echo 'Закрытый просмотр временно недоступен. Повторите позднее.';
}

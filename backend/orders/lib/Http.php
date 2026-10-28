<?php
declare(strict_types=1);
namespace ZTOrders;
require_once __DIR__ . '/Validation.php';
require_once __DIR__ . '/Repository.php';

function respond(int $status, array $body): never
{
    http_response_code($status);
    echo encode($body);
    exit;
}

function run(string $privateDirectory): never
{
    $requestId = bin2hex(random_bytes(8));
    try {
        $config = require $privateDirectory . '/config.php';
        if (!is_array($config) || ($config['enabled'] ?? false) !== true) {
            throw new RequestError('ORDERS_DISABLED', 503, 'Приём заявок временно недоступен. Позвоните в магазин.');
        }
        if (($config['consent_version'] ?? '') !== '2026-10-requests-v2') throw new \RuntimeException('Consent approval required');
        $origin = $config['origin'] ?? '';
        $originParts = is_string($origin) ? parse_url($origin) : false;
        if (!$originParts || ($originParts['scheme'] ?? '') !== 'https' || !isset($originParts['host'])
            || isset($originParts['user']) || isset($originParts['pass']) || isset($originParts['query'])
            || isset($originParts['fragment']) || isset($originParts['path'])) {
            throw new \RuntimeException('Invalid origin configuration');
        }
        // Do not trust X-Forwarded-Host/For from arbitrary clients.
        $requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($requestOrigin === '') {
            $referer = $_SERVER['HTTP_REFERER'] ?? '';
            $parts = parse_url($referer);
            $requestOrigin = is_array($parts) && isset($parts['scheme'], $parts['host'])
                ? $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '') : '';
        }
        if (!hash_equals($origin, $requestOrigin)
            || (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && $_SERVER['HTTP_SEC_FETCH_SITE'] !== 'same-origin')) {
            throw new RequestError('ORIGIN_FORBIDDEN', 403, 'Отправьте заявку со страницы магазина.');
        }
        if (!preg_match('~^application/json(?:\s*;.*)?$~i', $_SERVER['CONTENT_TYPE'] ?? '')) {
            throw new RequestError('INVALID_CONTENT_TYPE', 415, 'Ожидается JSON.');
        }
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 32768) {
            throw new RequestError('REQUEST_TOO_LARGE', 413, 'Запрос слишком большой.');
        }
        $raw = file_get_contents('php://input', false, null, 0, 32769);
        if ($raw === false || strlen($raw) > 32768) throw new RequestError('REQUEST_TOO_LARGE', 413, 'Запрос слишком большой.');
        try {
            $input = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new RequestError('INVALID_JSON', 400, 'Некорректный запрос.');
        }
        if (!is_array($input) || array_is_list($input)) throw new RequestError('INVALID_JSON', 400, 'Ожидается объект.');
        $key = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? '';
        if (!preg_match('/^[a-f0-9]{64}$/D', $key)) throw new RequestError('INVALID_KEY', 400, 'Некорректный ключ запроса.');
        // A retry must work even after the desired date has passed.
        $request = normalizeRequest($input, null, false);
        $hash = hash('sha256', encode($request));
        if (!is_string($config['rate_secret'] ?? null) || strlen($config['rate_secret']) < 64
            || !is_int($config['rate_limit'] ?? null) || $config['rate_limit'] < 1 || $config['rate_limit'] > 100) {
            throw new \RuntimeException('Invalid rate configuration');
        }
        $db = new \PDO($config['dsn'], $config['user'], $config['password'], [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_EMULATE_PREPARES => false,
            \PDO::ATTR_PERSISTENT => false, \PDO::ATTR_TIMEOUT => 5,
        ]);
        $db->exec("SET time_zone = '+00:00'");
        $repository = new OrderRepository($db,($config['erasure']['schema_ready']??false)===true);
        $saved = $repository->replay($key, $hash);
        if ($saved !== null) respond(200, $saved);
        normalizeRequest($input);
        $priced = requestItems($request); // No dependency on Yandex.
        if(is_file(__DIR__.'/BotInbox.php')) {
            require_once __DIR__.'/BotInbox.php';
            $priced = enrichRequestItems($request,$priced,$privateDirectory);
        }
        $consent = file_get_contents($privateDirectory . '/consent.html');
        if ($consent === false || !str_contains($consent, 'data-consent-version="2026-10-requests-v2"')) throw new \RuntimeException('Consent snapshot mismatch');
        $request['consentTextSha256'] = hash_file('sha256', $privateDirectory . '/consent.html');
        if (!is_string($request['consentTextSha256'])) throw new \RuntimeException('Missing consent snapshot');
        $address = $_SERVER['REMOTE_ADDR'] ?? '';
        if (!filter_var($address, FILTER_VALIDATE_IP)) throw new \RuntimeException('Missing client address');
        $rateKey = hash_hmac('sha256', $address . ':' . intdiv(time(), 600), $config['rate_secret']);
        $saved = $repository->save($key, $hash, $request, $priced, $rateKey, $config['rate_limit']);
        respond($saved['replayed'] ? 200 : 201, $saved);
    } catch (RequestError $error) {
        if ($error->status === 429) header('Retry-After: 600');
        respond($error->status, ['ok' => false, 'saved' => false, 'code' => $error->errorCode,
            'message' => $error->getMessage(), 'requestId' => $requestId]);
    } catch (\Throwable $error) {
        // Never log request data, SQL exception messages, credentials or raw IP.
        error_log('[orders] request=' . $requestId . ' failure=' . get_class($error));
        respond(503, ['ok' => false, 'code' => 'TEMPORARILY_UNAVAILABLE',
            'message' => 'Сохранение не подтверждено. Корзина сохранена. Повторите с теми же данными или позвоните.',
            'requestId' => $requestId]);
    }
}

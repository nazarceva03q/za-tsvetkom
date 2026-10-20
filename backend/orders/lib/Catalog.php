<?php
declare(strict_types=1);
namespace ZTCatalog;

const CATEGORIES = ['Букет дня','Розы','Сборные букеты','Монобукеты','Композиции','Свадебные букеты','Букеты из шаров','Для девушек','14 февраля','Девичник','Новый год','Последний звонок','Для девочек','Для мальчиков','Гендер пати','Коробка с шарами','Годовасия','Для мужчин','Для бизнеса'];

function validate(array $catalog, string $public, string $origin): void {
    if (count($catalog) !== count(CATEGORIES)) throw new \InvalidArgumentException('categories');
    $ids = []; $count = 0;
    foreach (CATEGORIES as $category) {
        if (!isset($catalog[$category]) || !is_array($catalog[$category]) || !array_is_list($catalog[$category])) throw new \InvalidArgumentException('category');
        foreach ($catalog[$category] as $p) {
            if (++$count > 5000 || !is_array($p) || !preg_match('/^[a-z0-9-]{1,100}$/D', $p['id'] ?? '') || isset($ids[$p['id']])
                || ($p['category'] ?? '') !== $category || !is_string($p['name'] ?? null) || trim($p['name']) === '' || strlen($p['name']) > 1020
                || (!is_int($p['price'] ?? null) && !is_float($p['price'] ?? null)) || !is_finite((float)$p['price']) || $p['price'] <= 0 || $p['price'] > 10000000
                || !array_key_exists('stock', $p) || ($p['stock'] !== null && (!is_int($p['stock']) || $p['stock'] < 0 || $p['stock'] > 10000))
                || !is_array($p['images'] ?? null) || !array_is_list($p['images']) || count($p['images']) < 1 || count($p['images']) > 20) throw new \InvalidArgumentException('product');
            $ids[$p['id']] = true;
            foreach (['description','note','badge','tags','slug'] as $field) if (isset($p[$field]) && (!is_string($p[$field]) || strlen($p[$field]) > 16000)) throw new \InvalidArgumentException('text');
            foreach ($p['images'] as $image) {
                if (!is_string($image) || preg_match('/[\x00-\x20<>"\'\\\\]/', $image)) throw new \InvalidArgumentException('image');
                $relative = str_starts_with($image, $origin . '/') ? substr($image, strlen($origin) + 1) : ltrim($image, '/');
                // Existing storefront images carry a harmless cache-version query.
                if (str_contains($relative, '?')) {
                    [$relative, $query] = explode('?', $relative, 2);
                    if (!preg_match('/^v=[a-zA-Z0-9_-]{1,100}$/D', $query)) throw new \InvalidArgumentException('image query');
                }
                if (str_contains($relative, ':') || str_contains($relative, '?') || str_contains($relative, '#') || str_contains($relative, '..')) throw new \InvalidArgumentException('image path');
                $resolved = realpath($public . '/' . rawurldecode($relative));
                if (!$resolved || !str_starts_with($resolved, $public . DIRECTORY_SEPARATOR) || !is_file($resolved)
                    || !preg_match('/\.(?:jpg|jpeg|png|webp|avif)$/iD', $resolved)) throw new \InvalidArgumentException('missing image');
            }
            if (!empty($p['business'])) {
                $prices = $p['photoPrices'] ?? null;
                if (!is_array($prices) || count($prices) !== count($p['images']) || !$prices) throw new \InvalidArgumentException('photo prices');
                foreach ($prices as $price) if ((!is_int($price) && !is_float($price)) || $price <= 0 || $price > 10000000) throw new \InvalidArgumentException('photo price');
                if ($p['price'] != min($prices) || ($p['maxPrice'] ?? null) != max($prices)) throw new \InvalidArgumentException('price range');
            }
        }
    }
}

function writeState(string $directory, array $state): void {
    $tmp = tempnam($directory, '.catalog-');
    if ($tmp === false) throw new \RuntimeException('temporary file');
    try {
        $encoded = json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!chmod($tmp, 0600) || file_put_contents($tmp, $encoded) !== strlen($encoded)
            || !rename($tmp, $directory . '/state.json')) throw new \RuntimeException('catalog write');
    } finally { if (is_file($tmp)) unlink($tmp); }
}
function revision(array $catalog): string {
    return '"' . hash('sha256', json_encode($catalog, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) . '"';
}
function readState(string $directory): array {
    try { $state = json_decode((string)file_get_contents($directory . '/state.json'), true, 64, JSON_THROW_ON_ERROR); }
    catch (\JsonException $e) { throw new \RuntimeException('corrupt catalog', 0, $e); }
    if (!is_array($state['catalog'] ?? null) || ($state['etag'] ?? '') !== revision($state['catalog'])) throw new \RuntimeException('corrupt catalog');
    return $state;
}
function input(int $limit): string {
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > $limit) throw new \LengthException();
    $data = file_get_contents('php://input', false, null, 0, $limit + 1);
    if ($data === false || strlen($data) > $limit) throw new \LengthException();
    return $data;
}
function run(string $private, string $public): void {
    $lock = null;
    try {
        $config = require $private . '/config.php';
        $cfg = $config['catalog'] ?? [];
        if (($cfg['enabled'] ?? false) !== true) { http_response_code(503); echo '{"ok":false,"code":"CATALOG_DISABLED"}'; return; }
        $method = $_SERVER['REQUEST_METHOD'] ?? '';
        if (!in_array($method, ['GET','PUT','POST'], true)) { header('Allow: GET, PUT, POST'); http_response_code(405); echo '{"ok":false,"code":"METHOD_NOT_ALLOWED"}'; return; }
        $origin = rtrim($config['origin'] ?? '', '/');
        if (!preg_match('~^https://[^/]+$~D', $origin)) throw new \RuntimeException('origin');
        if ($method !== 'GET') {
            $secret = $cfg['secret'] ?? '';
            $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
            // Some Apache/FastCGI installations strip Authorization. A dedicated
            // server-to-server header carries the same secret, never a URL/body.
            if ($auth === '' && isset($_SERVER['HTTP_X_ZT_CATALOG_KEY'])) $auth = 'Bearer ' . $_SERVER['HTTP_X_ZT_CATALOG_KEY'];
            if (!preg_match('/^[a-f0-9]{64}$/iD', $secret) || !hash_equals('Bearer ' . $secret, $auth)) { http_response_code(403); echo '{"ok":false,"code":"FORBIDDEN"}'; return; }
        }
        $directory = $private . '/catalog';
        if (!is_file($directory . '/state.json')) throw new \RuntimeException('catalog not initialized');
        if ($method === 'POST') {
            if (($_GET['action'] ?? '') !== 'photo') throw new \InvalidArgumentException('action');
            $bytes = input(15 * 1024 * 1024);
            $image = @getimagesizefromstring($bytes);
            $extensions = ['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'];
            $mime = $image['mime'] ?? '';
            if (!$image || !isset($extensions[$mime]) || $mime !== ($_SERVER['CONTENT_TYPE'] ?? '') || $image[0] > 12000 || $image[1] > 12000 || $image[0] * $image[1] > 40000000) throw new \InvalidArgumentException('photo');
            $photos = $public . '/assets/catalog';
            if (!is_dir($photos) || is_link($photos) || realpath($photos) !== $photos) throw new \RuntimeException('photo directory');
            $name = hash('sha256', $bytes) . '.' . $extensions[$mime];
            $file = $photos . '/' . $name;
            if (!is_file($file)) {
                $tmp = tempnam($photos, '.photo-');
                if ($tmp === false) throw new \RuntimeException('photo temporary file');
                try { if (file_put_contents($tmp, $bytes) !== strlen($bytes) || !chmod($tmp, 0644) || !rename($tmp, $file)) throw new \RuntimeException('photo write'); }
                finally { if (is_file($tmp)) unlink($tmp); }
            }
            echo json_encode(['ok'=>true,'url'=>$origin . '/assets/catalog/' . $name], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES); return;
        }
        if ($method === 'GET') {
            $state = readState($directory); header('ETag: ' . $state['etag']);
            // Compression proxies can rewrite ETag; application revision cannot.
            header('X-Catalog-Version: ' . $state['etag']);
            echo json_encode($state['catalog'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); return;
        }
        if (($_SERVER['CONTENT_TYPE'] ?? '') !== 'application/json') throw new \InvalidArgumentException('content type');
        $body = input(8 * 1024 * 1024);
        $catalog = json_decode($body, true, 64, JSON_THROW_ON_ERROR);
        if (!is_array($catalog)) throw new \InvalidArgumentException('catalog');
        validate($catalog, $public, $origin);
        $operation = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? '';
        $expected = $_SERVER['HTTP_IF_MATCH'] ?? '';
        if (!preg_match('/^[a-f0-9]{64}$/D', $operation) || !preg_match('/^"[a-f0-9]{64}"$/D', $expected)) throw new \InvalidArgumentException('revision');
        $fingerprint = hash('sha256', $expected . "\n" . $body);
        $lock = fopen($directory . '/write.lock', 'c');
        if (!$lock || !flock($lock, LOCK_EX)) throw new \RuntimeException('catalog lock');
        $state = readState($directory);
        $receipts = $state['receipts'] ?? [];
        if (isset($receipts[$operation])) {
            if (!hash_equals($receipts[$operation], $fingerprint)) { http_response_code(409); echo '{"ok":false,"code":"IDEMPOTENCY_CONFLICT"}'; return; }
            echo '{"ok":true,"replayed":true}'; return;
        }
        if (!hash_equals($state['etag'], $expected)) { http_response_code(409); echo '{"ok":false,"code":"CATALOG_CHANGED"}'; return; }
        $receipts[$operation] = $fingerprint;
        writeState($directory, ['catalog'=>$catalog,'etag'=>revision($catalog),'receipts'=>array_slice($receipts, -100, null, true)]);
        echo '{"ok":true}';
    } catch (\InvalidArgumentException | \JsonException $e) { http_response_code(422); echo '{"ok":false,"code":"INVALID_CATALOG"}'; }
    catch (\LengthException $e) { http_response_code(413); echo '{"ok":false,"code":"TOO_LARGE"}'; }
    catch (\Throwable $e) { http_response_code(503); echo '{"ok":false,"code":"CATALOG_UNAVAILABLE"}'; }
    finally { if (is_resource($lock)) { flock($lock, LOCK_UN); fclose($lock); } }
}

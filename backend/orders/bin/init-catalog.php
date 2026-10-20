<?php
declare(strict_types=1);
// First creation only. Run from the private installation after reviewing the seed.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/lib/Catalog.php';
try {
    if ($argc !== 3) throw new RuntimeException('Usage: init-catalog.php SEED_JSON PUBLIC_ROOT');
    $private = dirname(__DIR__); $public = realpath($argv[2]);
    if (!$public || $public === $private || str_starts_with($private . '/', $public . '/')) throw new RuntimeException('Invalid public root');
    $config = require $private . '/config.php';
    $catalog = json_decode((string)file_get_contents($argv[1]), true, 64, JSON_THROW_ON_ERROR);
    \ZTCatalog\validate($catalog, $public, rtrim($config['origin'], '/'));
    $directory = $private . '/catalog';
    if (!is_dir($directory) && !mkdir($directory, 0700)) throw new RuntimeException('Cannot create private directory');
    $lock = fopen($directory . '/write.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock');
    if (file_exists($directory . '/state.json')) throw new RuntimeException('Catalogue already exists; refusing to overwrite');
    $photos = $public . '/assets/catalog';
    if (!is_dir($photos) && !mkdir($photos, 0755, true)) throw new RuntimeException('Cannot create photo directory');
    \ZTCatalog\writeState($directory, ['catalog'=>$catalog,'etag'=>\ZTCatalog\revision($catalog),'receipts'=>[]]);
    echo "CATALOG_INITIALIZED\n";
} catch (Throwable $e) { fwrite(STDERR, "CATALOG_INIT_FAILED: " . $e->getMessage() . "\n"); exit(1); }

<?php
declare(strict_types=1);
// OPTIONAL ONLY: disposable LOCAL MySQL 8 database. Never production.
// Does not load config.php or environment variables used by the working site.
require __DIR__ . '/../backend/orders/lib/Validation.php';
require __DIR__ . '/../backend/orders/lib/Repository.php';
$dsn = getenv('ZT_TEST_MYSQL_DSN') ?: '';
if (getenv('ZT_ALLOW_DISPOSABLE_TEST_DB') !== 'yes'
 || !preg_match('/^mysql:host=127\\.0\\.0\\.1;port=([0-9]{2,5});dbname=(zt_test_orders_[a-z0-9_]+);charset=utf8mb4$/D', $dsn)) {
 fwrite(STDERR, "REFUSED: explicitly named disposable LOCAL test database required.\n"); exit(2);
}
$db = new PDO($dsn, getenv('ZT_TEST_MYSQL_USER') ?: '', getenv('ZT_TEST_MYSQL_PASSWORD') ?: '',
 [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false]);
if ($db->query('SHOW TABLES')->fetchColumn() !== false) throw new RuntimeException('REFUSED: test schema is not empty');
$sql = preg_replace('/^--.*$/m', '', file_get_contents(__DIR__ . '/../backend/orders/migrations/001-orders.sql'));
foreach (explode(';', $sql) as $statement) if (trim($statement) !== '') $db->exec($statement);
function ensure(bool $value, string $label): void { if (!$value) throw new RuntimeException('FAIL: '.$label); }
$repository = new ZTOrders\OrderRepository($db);
$input = ['kind'=>'order','subject'=>'Локальная проверка','name'=>'Тест','phone'=>'79990000000','channel'=>'Телефон',
 'date'=>'','delivery'=>'Самовывоз','time'=>'13-16','address'=>'','comment'=>'','consent'=>true,
 'consentVersion'=>'2026-10-orders-v1','items'=>[['id'=>'balloon-bouquet-violet-wishes','quantity'=>2,'expectedPriceKopecks'=>250000]]];
$request = ZTOrders\normalizeRequest($input);
$hash = hash('sha256', ZTOrders\encode($request));
$request['consentTextSha256'] = str_repeat('a',64);
$priced = ZTOrders\priceItems($request,ZTOrders\loadCatalog(__DIR__.'/../backend/orders/catalog.json'));
$key = str_repeat('1',64); $rateKey = str_repeat('2',64);
$db->exec('ALTER TABLE zt_notification_queue ADD CONSTRAINT ck_test_queue_failure CHECK (attempts > 0)');
$failed=false;
try { $repository->save($key,$hash,$request,$priced,$rateKey,10); } catch (PDOException) { $failed=true; }
ensure($failed,'injected queue failure');
foreach (['zt_orders','zt_order_items','zt_notification_queue','zt_order_rate_limits'] as $table)
 ensure((int)$db->query('SELECT COUNT(*) FROM '.$table)->fetchColumn()===0,'rollback '.$table);
$db->exec('ALTER TABLE zt_notification_queue DROP CHECK ck_test_queue_failure');
$first=$repository->save($key,$hash,$request,$priced,$rateKey,10);
$repeat=$repository->replay($key,$hash);
ensure($first['orderNumber']===$repeat['orderNumber'],'same order number');
$repeat=$repository->save($key,$hash,$request,$priced,$rateKey,10);
ensure($repeat['replayed']===true,'duplicate insert resolved');
ensure((int)$db->query('SELECT COUNT(*) FROM zt_orders')->fetchColumn()===1,'one order');
ensure((int)$db->query('SELECT COUNT(*) FROM zt_order_items')->fetchColumn()===1,'one position');
ensure((int)$db->query('SELECT COUNT(*) FROM zt_notification_queue')->fetchColumn()===1,'one queue record');
ensure((int)$db->query('SELECT attempts FROM zt_order_rate_limits')->fetchColumn()===1,'retry not charged');
$conflict=false;
try { $repository->replay($key,str_repeat('f',64)); } catch (ZTOrders\RequestError $e) { $conflict=$e->errorCode==='IDEMPOTENCY_CONFLICT'; }
ensure($conflict,'changed body rejected');
$limited=false;
try { $repository->save(str_repeat('3',64),$hash,$request,$priced,$rateKey,1); }
catch (ZTOrders\RequestError $e) { $limited=$e->errorCode==='RATE_LIMITED'; }
ensure($limited,'rate limit');
ensure((int)$db->query('SELECT COUNT(*) FROM zt_orders')->fetchColumn()===1,'rate rollback');
$row=$db->query('SELECT product_name,unit_price_kopecks,product_snapshot FROM zt_order_items')->fetch(PDO::FETCH_ASSOC);
ensure((int)$row['unit_price_kopecks']===250000,'saved trusted price');
ensure(json_decode($row['product_snapshot'],true,64,JSON_THROW_ON_ERROR)['name']===$row['product_name'],'name snapshot');
echo "PASS: local MySQL transaction, injected queue failure rollback, uniqueness, replay, conflict, rate rollback, history.\n";

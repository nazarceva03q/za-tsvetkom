<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
if ($argc !== 2 || !in_array($argv[1], ['--preview', '--prepare-test', '--apply-test'], true)) {
    echo "Use --preview, --prepare-test or --apply-test; separate synthetic test database only.\n";
    exit(1);
}
require_once __DIR__.'/../lib/Notifications.php';
require_once __DIR__.'/../lib/RestoreGuard.php';
try {
    $config = require __DIR__.'/../config.php';
    $target = 'u3685169_ztrestore';
    if (($config['restore_guard']['target_database'] ?? '') !== $target
        || !preg_match('/(?:^|;)dbname=([a-zA-Z0-9_]+)(?:;|$)/', $config['dsn'] ?? '', $m)
        || strcasecmp($m[1], $target) === 0) {
        throw new RuntimeException('SEPARATE_TEST_TARGET_REQUIRED');
    }
    $id = 'a72200000000000000000000000000ff';
    $number = 'ZT-A722000000000001';
    $payload = [
        'format'=>'zt-restore-ledger-v1', 'exportedAt'=>'2026-10-22 00:00:00.000000',
        'recordCount'=>1, 'records'=>[[
            'id'=>$id, 'order_number'=>$number,
            'replay_key_hash'=>hash('sha256', hash('sha256', 'restore-test-20261022-delete')),
            'review_version'=>1, 'cleared_at'=>'2026-10-22 00:00:00.000000',
            'retain_until'=>'2029-10-23 00:00:00.000000', 'copy_state'=>'pending',
            'backup_review_at'=>null, 'copies_confirmed_at'=>null,
            'evidence'=>['recordId'=>$id, 'subjectReference'=>$number,
                'status'=>'SYNTHETIC_RESTORE_DRILL_ONLY_NOT_REAL_ERASURE',
                'scope'=>'Fictional staging fixture only; not an act or real erasure proof.'],
        ]],
    ];
    $raw = json_encode(['payload'=>$payload,
        'checksum'=>hash('sha256', \ZTOrders\ledgerCanonical($payload))], JSON_THROW_ON_ERROR);
    $ledger = \ZTOrders\validateRestoreLedger($raw, hash('sha256', $raw));
    $stage = $config;
    $stage['dsn'] = preg_replace('/(^|;)dbname=[a-zA-Z0-9_]+(?=;|$)/', '$1dbname='.$target, $config['dsn'], 1);
    $db = \ZTOrders\connect($stage);
    \ZTOrders\assertRestoreTarget($db, $config, false);
    if ($argv[1] === '--prepare-test') {
        // This inserts only a fixed fictional fixture; no queue row or message.
        // Never overwrite a collision or alter the primary connection settings.
        $fixtureId = 'a7220000000000000000000000000001';
        $key = hash('sha256', 'restore-test-20261022-delete');
        $db->beginTransaction();
        try {
            $q = $db->prepare('SELECT id,order_number,idempotency_key,customer_name,phone FROM zt_orders WHERE id=? OR order_number=? OR idempotency_key=? FOR UPDATE');
            $q->execute([$fixtureId, $number, $key]);
            $rows = $q->fetchAll(PDO::FETCH_ASSOC);
            if ($rows) {
                if (count($rows) !== 1 || $rows[0]['id'] !== $fixtureId || $rows[0]['order_number'] !== $number
                    || $rows[0]['idempotency_key'] !== $key || $rows[0]['customer_name'] !== 'Вымышленный клиент'
                    || $rows[0]['phone'] !== '70000000000') throw new RuntimeException('FIXTURE_CONFLICT');
            } else {
                $q = $db->prepare('INSERT INTO zt_orders (id,order_number,idempotency_key,request_hash,kind,subject,customer_name,phone,contact_channel,comment,consent_version,consent_text_sha256,consent_at,total_kopecks) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6),0)');
                $q->execute([$fixtureId,$number,$key,hash('sha256','restore-drill-fictional-body'),
                    'inquiry','ТЕСТ ВОССТАНОВЛЕНИЯ — вымышленные данные','Вымышленный клиент','70000000000','VK',
                    'Только проверка фильтра восстановления. Не обращение покупателя.',
                    'TEST_ONLY',hash('sha256','SYNTHETIC_TEST_ONLY')]);
            }
            $db->commit();
            echo json_encode(['mode'=>'SYNTHETIC_FIXTURE_READY','database'=>$target,'inserted'=>$rows ? 0 : 1,
                'notificationsCreated'=>0,'liveLedgerChanged'=>false],JSON_THROW_ON_ERROR),PHP_EOL;
            exit;
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }
    }
    $apply = $argv[1] === '--apply-test';
    if ($apply) {
        // Scoped exercise only. Do not enable the production restore procedure.
        // The normal restore filter also revokes staging sessions and stops its
        // pending queue. Refuse if any such collateral change would be needed.
        $q = $db->query("SELECT COUNT(*) FROM zt_notification_queue WHERE status IN ('pending','processing')");
        if ((int)$q->fetchColumn() !== 0) throw new \ZTOrders\RestoreGuardError('TEST_QUEUE_MUST_BE_IDLE');
        if ((int)$db->query('SELECT COUNT(*) FROM zt_owner_sessions')->fetchColumn() !== 0)
            throw new \ZTOrders\RestoreGuardError('TEST_SESSIONS_MUST_BE_CLOSED');
        $q = $db->prepare('SELECT id,idempotency_key,customer_name,phone FROM zt_orders WHERE order_number=?');
        $q->execute([$number]); $fixture = $q->fetch(PDO::FETCH_ASSOC);
        if ($fixture && ($fixture['id'] !== 'a7220000000000000000000000000001'
            || $fixture['idempotency_key'] !== hash('sha256','restore-test-20261022-delete')
            || $fixture['customer_name'] !== 'Вымышленный клиент' || $fixture['phone'] !== '70000000000'))
            throw new \ZTOrders\RestoreGuardError('SYNTHETIC_FIXTURE_REQUIRED');
        // All inputs are fixed by this CLI drill, never a customer erasure ledger.
        $config['restore_guard']['enabled'] = true;
        $config['restore_guard']['ledger_current_confirmed'] = true;
        $config['restore_guard']['target_not_public_confirmed'] = true;
    }
    $result = \ZTOrders\filterRestoredRequests($db, $config, $ledger, $apply);
    echo json_encode(['synthetic'=>true, 'database'=>$target, 'liveLedgerChanged'=>false] + $result,
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), PHP_EOL;
} catch (\ZTOrders\RestoreGuardError $e) {
    $safe = preg_match('/^[A-Z0-9_]+$/D', $e->getMessage()) ? $e->getMessage() : 'GUARD_REJECTED';
    fwrite(STDERR, 'RESTORE_DRILL_STOPPED: '.$safe.PHP_EOL); exit(1);
} catch (Throwable) {
    fwrite(STDERR, "RESTORE_DRILL_NOT_CONFIRMED: verify test database permissions and schema.\n"); exit(1);
}

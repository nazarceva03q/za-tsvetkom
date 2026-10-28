<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
if ($argc !== 2 || $argv[1] !== '--send-test') {
    echo "NO_SEND; use --send-test for one persistent synthetic notification.\n"; exit;
}
$file = null;
try {
    $private = dirname(__DIR__);
    $config = require $private.'/config.php';
    require_once $private.'/lib/YandexRelay.php';
    $relay = $config['notifications'] ?? [];
    if (($relay['enabled'] ?? false) !== true || ($relay['relay_expiry_enabled'] ?? false) !== true ||
        (string)($relay['owner_id'] ?? '') !== '424315265') throw new RuntimeException('CONFIG');
    $statePath = $private.'/relay-cleanup-probe.json';
    umask(0077);
    if (is_link($statePath)) throw new RuntimeException('STATE_LINK');
    $new = !file_exists($statePath);
    $file = fopen($statePath, $new ? 'x+b' : 'r+b');
    if (!$file || !flock($file,LOCK_EX | LOCK_NB)) throw new RuntimeException('STATE_BUSY');
    $stat = fstat($file);
    if (($stat['mode'] & 0077) !== 0 || $stat['size'] > 4096) throw new RuntimeException('PRIVATE_STATE');
    if ($new) {
        $created = new DateTimeImmutable('now',new DateTimeZone('UTC'));
        $number = 'ZT-'.strtoupper(bin2hex(random_bytes(8)));
        $job = ['id'=>'9223372036854770026','recipient_vk_id'=>424315265,
            'vk_random_id'=>random_int(1,2147483647),'created_at'=>$created->format('Y-m-d H:i:s.u'),
            'message_text'=>'Заявка '.$number."\n".$created->setTimezone(new DateTimeZone('Asia/Yekaterinburg'))->format('d.m.Y H:i:s')." (Asia/Yekaterinburg)\nОбращение"];
        $state = json_encode(['job'=>$job,'synthetic'=>true],JSON_THROW_ON_ERROR);
        if (fwrite($file,$state) !== strlen($state) || !fflush($file)) throw new RuntimeException('STATE_WRITE');
    } else {
        $state = json_decode(stream_get_contents($file),true,16,JSON_THROW_ON_ERROR);
        if (($state['synthetic'] ?? false) !== true || !is_array($state['job'] ?? null)) throw new RuntimeException('STATE');
        $job = $state['job'];
    }
    // The saved identity/time are reused, including on a second CLI invocation.
    // Never delete the state file or refresh created_at to force another send.
    $payload = \ZTOrders\YandexRelaySender::payload($job,true);
    if (time() - $payload['issuedAt'] >= 86400) throw new RuntimeException('PROBE_EXPIRED');
    $sender = new \ZTOrders\YandexRelaySender($relay);
    $result = $sender($job);
    echo json_encode(['mode'=>'SYNTHETIC_RELAY_V2','databaseChanged'=>false,
        'orderNumber'=>$payload['orderNumber'],'issuedAt'=>$payload['issuedAt'],
        'result'=>$result],JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR).PHP_EOL;
    exit(!empty($result['ok']) ? 0 : 1);
} catch (Throwable) {
    fwrite(STDERR,"RELAY_V2_TEST_NOT_CONFIRMED: check config, library and private probe state; do not print secrets or renew probe identity.\n");
    exit(1);
}

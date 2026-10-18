<?php
declare(strict_types=1);
namespace ZTOrders;

function connect(array $config): \PDO {
    $db = new \PDO($config['dsn'], $config['user'], $config['password'], [
        \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
        \PDO::ATTR_EMULATE_PREPARES => false,
        \PDO::ATTR_TIMEOUT => 5,
    ]);
    $db->exec("SET time_zone = '+00:00'");
    return $db;
}
function money(int $amount): string { return number_format($amount / 100, 2, ',', ' ') . ' руб.'; }
function requestTypes(): array {
    return ['cart'=>'Товары из корзины','gift'=>'Подбор подарка','large'=>'Большой букет',
        'corporate'=>'Корпоративные подарки','question'=>'Вопрос','preorder'=>'Предзаказ',
        'other'=>'Обращение','legacy'=>'Ранее сохранённая заявка'];
}
function requestDate(string $utc): string {
    return (new \DateTimeImmutable($utc,new \DateTimeZone('UTC')))
        ->setTimezone(new \DateTimeZone('Asia/Yekaterinburg'))->format('d.m.Y H:i');
}
function notificationText(array $order, array $items, string $timezone): string {
    $date=new \DateTimeImmutable($order['created_at'],new \DateTimeZone('UTC'));
    $type=requestTypes()[$order['request_type']??'legacy']??'Обращение';
    $lines=['Заявка '.$order['order_number'],$date->setTimezone(new \DateTimeZone($timezone))->format('d.m.Y H:i:s').' ('.$timezone.')',$type];
    foreach($items as $item) $lines[]=$item['product_name'].' × '.(int)$item['quantity'];
    $lines[]='Цена и наличие согласуются. Контакты и пожелания — в закрытой панели заявок.';
    // No contact details, subject, comments, images, or unconfirmed prices in VK.
    return implode("\n",$lines);
}
final class VkSender {
    public function __construct(private array $config) {}
    public function __invoke(array $job): array {
        if (!extension_loaded('curl')) throw new \RuntimeException('CURL_REQUIRED');
        $curl = curl_init('https://api.vk.com/method/messages.send');
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query([
                'access_token' => $this->config['token'], 'v' => $this->config['version'],
                'peer_id' => $job['recipient_vk_id'], 'random_id' => $job['vk_random_id'],
                'message' => $job['message_text'],
            ]),
            CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 20,
            CURLOPT_FOLLOWLOCATION => false, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $raw = curl_exec($curl);
        $http = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);
        return self::interpret($raw, $http);
    }
    public static function interpret(string|false $raw, int $http): array {
        if ($raw === false || $http !== 200) return ['ok' => false, 'retry' => true, 'code' => 'VK_HTTP_' . $http];
        try { $body = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); }
        catch (\Throwable) { return ['ok' => false, 'retry' => true, 'code' => 'VK_INVALID_JSON']; }
        if (isset($body['error']['error_code'])) {
            $code = (int)$body['error']['error_code'];
            return ['ok' => false, 'retry' => in_array($code, [1, 6, 9, 10, 29], true), 'code' => 'VK_' . $code];
        }
        if (!isset($body['response']) || !is_int($body['response']) || $body['response'] <= 0)
            return ['ok' => false, 'retry' => true, 'code' => 'VK_INVALID_RESPONSE'];
        return ['ok' => true, 'messageId' => $body['response']];
    }
}
final class NotificationWorker {
    public function __construct(private \PDO $db, private array $config, private $send) {}
    public function claim(): ?array {
        $this->db->beginTransaction();
        try {
            $q = $this->db->query("SELECT * FROM zt_notification_queue
                WHERE channel='vk_owner' AND event_type='order.created' AND
                ((status='pending' AND next_attempt_at<=UTC_TIMESTAMP(6)) OR
                 (status='processing' AND locked_until<UTC_TIMESTAMP(6)))
                ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
            $job = $q->fetch(\PDO::FETCH_ASSOC);
            if (!$job) { $this->db->commit(); return null; }
            // Stop automatic retries after 12 attempts or 12 hours, including uncertain sends.
            // VK does not guarantee perpetual duplicate suppression.
            if ((int)$job['attempts'] >= 12 || ($job['first_attempt_at'] &&
                strtotime($job['first_attempt_at'] . ' UTC') < time() - 43200)) {
                $q = $this->db->prepare("UPDATE zt_notification_queue SET status='failed',
                    last_error_code='REVIEW_REQUIRED', locked_until=NULL, claim_token=NULL WHERE id=?");
                $q->execute([$job['id']]); $this->db->commit(); return null;
            }
            if ($job['message_text'] === null) {
                $q = $this->db->prepare('SELECT order_number,kind,request_type,created_at,total_kopecks FROM zt_orders WHERE id=?');
                $q->execute([$job['order_id']]); $order = $q->fetch(\PDO::FETCH_ASSOC);
                if (!$order) throw new \RuntimeException('ORDER_MISSING');
                $q = $this->db->prepare('SELECT product_name,quantity,line_total_kopecks FROM zt_order_items WHERE order_id=? ORDER BY id');
                $q->execute([$job['order_id']]);
                $text = notificationText($order, $q->fetchAll(\PDO::FETCH_ASSOC), $this->config['timezone']);
                // Conservative single-message limit: do not silently omit products.
                if (mb_strlen($text, 'UTF-8') > 4096) {
                    $q = $this->db->prepare("UPDATE zt_notification_queue SET status='failed',last_error_code='MESSAGE_TOO_LONG' WHERE id=?");
                    $q->execute([$job['id']]); $this->db->commit(); return null;
                }
                $job['recipient_vk_id'] = $this->config['owner_id'];
                // Persist once; avoid predictable overlap with other community senders.
                $job['vk_random_id'] = random_int(1, 2147483647);
                $job['message_text'] = $text;
            }
            $job['claim_token'] = bin2hex(random_bytes(16));
            $q = $this->db->prepare("UPDATE zt_notification_queue SET status='processing',
                attempts=attempts+1, claim_token=?, locked_until=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 120 SECOND),
                recipient_vk_id=?,vk_random_id=?,message_text=?,first_attempt_at=COALESCE(first_attempt_at,UTC_TIMESTAMP(6)) WHERE id=?");
            $q->execute([$job['claim_token'], $job['recipient_vk_id'], $job['vk_random_id'], $job['message_text'], $job['id']]);
            $job['attempts'] = (int)$job['attempts'] + 1;
            $this->db->commit(); return $job;
        } catch (\Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }
    public function runOne(): bool {
        $job = $this->claim(); if (!$job) return false;
        try { $result = ($this->send)($job); }
        catch (\Throwable) { $result = ['ok'=>false,'retry'=>true,'code'=>'TRANSPORT_EXCEPTION']; }
        if (!empty($result['ok'])) {
            $q = $this->db->prepare("UPDATE zt_notification_queue SET status='sent',sent_at=UTC_TIMESTAMP(6),
                vk_message_id=?,locked_until=NULL,claim_token=NULL,last_error_code=NULL WHERE id=? AND claim_token=? AND status='processing'");
            $q->execute([$result['messageId'], $job['id'], $job['claim_token']]);
        } else {
            $retry = !empty($result['retry']) && $job['attempts'] < 12;
            $delay = min(3600, 60 * (2 ** min(6, $job['attempts'] - 1))) + random_int(0, 30);
            $code = preg_match('/^[A-Z0-9_]{1,64}$/D', $result['code'] ?? '') ? $result['code'] : 'TRANSPORT_ERROR';
            $q = $this->db->prepare("UPDATE zt_notification_queue SET status=?,last_error_code=?,
                next_attempt_at=DATE_ADD(UTC_TIMESTAMP(6),INTERVAL ? SECOND),locked_until=NULL,claim_token=NULL
                WHERE id=? AND claim_token=? AND status='processing'");
            $q->execute([$retry ? 'pending' : 'failed', $code, $delay, $job['id'], $job['claim_token']]);
        }
        return true;
    }
}

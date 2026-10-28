<?php
declare(strict_types=1);
namespace ZTOrders;

function encode(array $value): string
{
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

final class OrderRepository
{
    public function __construct(private readonly \PDO $db,private readonly bool $erasureSchema=false) {}

    private function rejectErasedReplay(string $key,bool $lock=false): void {
        if(!$this->erasureSchema)return;
        $q=$this->db->prepare('SELECT id FROM zt_erasure_records WHERE replay_key_hash=?'.($lock?' FOR UPDATE':''));
        $q->execute([hash('sha256',$key)]);
        if($q->fetchColumn())throw new RequestError('REQUEST_ERASED',409,'Эта заявка уже удалена. Для нового обращения проверьте данные и отправьте форму заново.');
    }

    private function find(string $key, string $hash): ?array
    {
        $this->rejectErasedReplay($key);
        $query = $this->db->prepare('SELECT order_number, request_hash FROM zt_orders WHERE idempotency_key = ?');
        $query->execute([$key]);
        $row = $query->fetch(\PDO::FETCH_ASSOC);
        if (!$row) return null;
        if (!hash_equals($row['request_hash'], $hash)) {
            throw new RequestError('IDEMPOTENCY_CONFLICT', 409, 'Этот ключ уже использован для других данных.');
        }
        return ['ok' => true, 'saved' => true, 'orderNumber' => $row['order_number'], 'replayed' => true];
    }

    // Lookup precedes catalog checks: an acknowledged/committed retry remains valid
    // even if the catalog or date changed after the original successful request.
    public function replay(string $key, string $hash): ?array
    {
        return $this->find($key, $hash);
    }

    public function save(string $key, string $hash, array $request, array $priced, string $rateKey, int $limit): array
    {
        $id = bin2hex(random_bytes(16));
        $number = 'ZT-' . strtoupper(bin2hex(random_bytes(8)));
        $this->db->beginTransaction();
        try {
            // Insert first: concurrent requests with the same key block on the unique
            // constraint; only the winner creates positions, queue and rate charge.
            $query = $this->db->prepare('INSERT INTO zt_orders
                (id, order_number, idempotency_key, request_hash, kind, subject, customer_name, phone,
                 contact_channel, desired_date, delivery_method, time_slot, delivery_address, comment,
                 requested_quantity, budget_rubles, consent_version, consent_text_sha256, consent_at, status, total_kopecks, request_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?, ?)');
            $query->execute([$id, $number, $key, $hash, $request['kind'], $request['subject'], $request['name'],
                $request['phone'], $request['channel'], $request['date'] ?: null, $request['delivery'] ?: null,
                $request['time'] ?: null, $request['address'], $request['comment'], $request['quantity'],
                $request['budget'], $request['consentVersion'], $request['consentTextSha256'], 'new', $priced['totalKopecks'], $request['requestType']]);
            // Current locking read catches a cleanup that committed while INSERT
            // waited for the old order's unique key. A stale POST must not restore PII.
            $this->rejectErasedReplay($key,true);
            $query = $this->db->prepare('INSERT INTO zt_order_rate_limits (bucket_key, attempts, expires_at)
                VALUES (?, 1, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 20 MINUTE))
                ON DUPLICATE KEY UPDATE attempts = attempts + 1');
            $query->execute([$rateKey]);
            $query = $this->db->prepare('SELECT attempts FROM zt_order_rate_limits WHERE bucket_key = ? FOR UPDATE');
            $query->execute([$rateKey]);
            if ((int)$query->fetchColumn() > $limit) {
                throw new RequestError('RATE_LIMITED', 429, 'Слишком много обращений. Повторите позднее или позвоните.');
            }
            $query = $this->db->prepare('INSERT INTO zt_order_items
                (order_id, product_id, product_name, quantity, unit_price_kopecks, line_total_kopecks, made_to_order, product_snapshot)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            foreach ($priced['items'] as $item) {
                $query->execute([$id, $item['id'], $item['name'], $item['quantity'], $item['unitPriceKopecks'],
                    $item['lineTotalKopecks'], (int)$item['madeToOrder'], encode($item['snapshot'])]);
            }
            // Contains only order identity. No token, phone or address in queue payload.
            $query = $this->db->prepare('INSERT INTO zt_notification_queue
                (order_id, event_type, channel, status, attempts, next_attempt_at)
                VALUES (?, ?, ?, ?, 0, UTC_TIMESTAMP(6))');
            $query->execute([$id, 'order.created', 'vk_owner', 'pending']);
            if (!$this->db->commit()) throw new \RuntimeException('Commit not confirmed');
            return ['ok' => true, 'saved' => true, 'orderNumber' => $number, 'replayed' => false];
        } catch (\Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            if ($error instanceof \PDOException && (int)($error->errorInfo[1] ?? 0) === 1062) {
                $saved = $this->find($key, $hash);
                if ($saved !== null) return $saved;
            }
            // A connection failure during COMMIT can be ambiguous. Client keeps the
            // same key; a retry discovers the committed row or performs one insert.
            throw $error;
        }
    }
}

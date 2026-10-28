<?php
declare(strict_types=1);
namespace ZTOrders;

/** REG.RU -> private relay on Yandex -> VK. No VK token on REG.RU. */
final class YandexRelaySender {
    public function __construct(private array $config) {
        $parts = parse_url($config['url'] ?? '');
        if (!$parts || ($parts['scheme'] ?? '') !== 'https' ||
            ($parts['host'] ?? '') !== 'functions.yandexcloud.net' ||
            !preg_match('~^/[a-zA-Z0-9_-]+$~D', $parts['path'] ?? '') ||
            isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) ||
            isset($parts['fragment']) || isset($parts['port']) ||
            !preg_match('/^[a-f0-9]{64,128}$/D', $config['secret'] ?? '')) {
            throw new \RuntimeException('INVALID_RELAY_CONFIG');
        }
    }
    public function __invoke(array $job): array {
        if (!extension_loaded('curl')) throw new \RuntimeException('CURL_REQUIRED');
        $payload = self::payload($job, ($this->config['relay_expiry_enabled'] ?? false) === true);
        $curl = curl_init($this->config['url']);
        curl_setopt_array($curl, [
            CURLOPT_POST=>true, CURLOPT_POSTFIELDS=>json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            CURLOPT_HTTPHEADER=>['Content-Type: application/json', 'X-Relay-Key: '.$this->config['secret']],
            CURLOPT_RETURNTRANSFER=>true, CURLOPT_CONNECTTIMEOUT=>5, CURLOPT_TIMEOUT=>25,
            CURLOPT_FOLLOWLOCATION=>false, CURLOPT_SSL_VERIFYPEER=>true, CURLOPT_SSL_VERIFYHOST=>2,
        ]);
        $raw=curl_exec($curl); $http=(int)curl_getinfo($curl,CURLINFO_HTTP_CODE); curl_close($curl);
        return self::interpret($raw,$http,$payload);
    }
    public static function payload(array $job, bool $withExpiry = false): array {
        if (!preg_match('/ZT-[A-F0-9]{16}/', $job['message_text'], $match)) throw new \RuntimeException('INVALID_NOTIFICATION');
        $payload = [
            'type'=>'site.lead.saved', 'notificationId'=>(string)$job['id'],
            'orderNumber'=>$match[0], 'recipientId'=>(string)$job['recipient_vk_id'],
            'randomId'=>(int)$job['vk_random_id'], 'message'=>$job['message_text'],
        ];
        if ($withExpiry) {
            // Never use time() or first_attempt_at: resetting a retry or restoring
            // an old database must not give the notification a new replay window.
            $created = $job['created_at'] ?? '';
            if (!is_string($created) || !preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/D', $created))
                throw new \RuntimeException('NOTIFICATION_CREATION_TIME_REQUIRED');
            $date = new \DateTimeImmutable($created, new \DateTimeZone('UTC'));
            if ($date->format('Y-m-d H:i:s') !== substr($created,0,19)) throw new \RuntimeException('INVALID_NOTIFICATION_CREATION_TIME');
            $payload['issuedAt'] = $date->getTimestamp();
        }
        return $payload;
    }
    public static function interpret(string|false $raw,int $http,array $payload): array {
        if ($raw===false || $http!==200) {
            return ['ok'=>false,'retry'=>!in_array($http,[400,401,403,409,413],true),'code'=>'RELAY_HTTP_'.$http];
        }
        try { $body=json_decode($raw,true,16,JSON_THROW_ON_ERROR); }
        catch (\Throwable) { return ['ok'=>false,'retry'=>true,'code'=>'RELAY_INVALID_JSON']; }
        if (($body['ok']??false)!==true || ($body['delivered']??false)!==true ||
            ($body['notificationId']??null)!==$payload['notificationId'] ||
            ($body['randomId']??null)!==$payload['randomId'] ||
            !is_int($body['messageId']??null) || $body['messageId']<=0) {
            return ['ok'=>false,'retry'=>true,'code'=>'RELAY_UNCONFIRMED'];
        }
        return ['ok'=>true,'messageId'=>$body['messageId']];
    }
}

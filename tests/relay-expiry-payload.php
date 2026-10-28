<?php
declare(strict_types=1);
require_once __DIR__.'/../backend/orders/lib/YandexRelay.php';
$job=['id'=>'1','recipient_vk_id'=>'99','vk_random_id'=>123,
 'message_text'=>'Заявка ZT-1234567890ABCDEF','created_at'=>'2026-10-26 10:00:00.123456'];
$assert=static function(bool $ok,string $message):void {if(!$ok)throw new RuntimeException($message);};
$old=\ZTOrders\YandexRelaySender::payload($job);
$assert(!isset($old['issuedAt']),'legacy mode unchanged');
$timed=\ZTOrders\YandexRelaySender::payload($job,true);
$assert($timed['issuedAt']===(new DateTimeImmutable('2026-10-26 10:00:00',new DateTimeZone('UTC')))->getTimestamp(),'UTC creation time');
$retried=$job;$retried['first_attempt_at']='2026-10-27 10:00:00';$retried['attempts']=0;
$assert(\ZTOrders\YandexRelaySender::payload($retried,true)===$timed,'retry/reset does not renew issuance');
foreach(['','2026-02-30 10:00:00','not a date'] as $invalid){
 $bad=$job;$bad['created_at']=$invalid;$thrown=false;
 try{\ZTOrders\YandexRelaySender::payload($bad,true);}catch(Throwable){$thrown=true;}
 $assert($thrown,'invalid creation date fails closed');
}
$r=\ZTOrders\YandexRelaySender::interpret('{}',409,$timed);
$assert($r['ok']===false&&$r['retry']===false,'expired relay requires review, no retry');
echo "PASS relay expiry payload and non-renewable retry identity\n";

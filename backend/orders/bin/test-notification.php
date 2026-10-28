<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
if($argc!==2||$argv[1]!=='--send-test'){echo "TEST_NOT_SENT; use --send-test for synthetic notice ZT-FFFFFFFFFFFFFF23 only.\n";exit;}
try{
    $private=dirname(__DIR__);$config=require $private.'/config.php';
    require_once $private.'/lib/YandexRelay.php';
    $relay=$config['notifications']??[];
    if(($relay['owner_id']??null)!==424315265)throw new RuntimeException('UNEXPECTED_RECIPIENT');
    // Fixed synthetic identity: reruns reuse relay receipt and VK random_id.
    $job=['id'=>'9223372036854770023','recipient_vk_id'=>424315265,
        'vk_random_id'=>2037100023,
        'message_text'=>"Тестовая заявка ZT-FFFFFFFFFFFFFF23\nТехническая проверка без покупателя\nОбращение"];
    $sender=new \ZTOrders\YandexRelaySender($relay);
    $result=$sender($job);
    echo json_encode(['mode'=>'SYNTHETIC_NOTICE_ONLY','databaseChanged'=>false,'orderNumber'=>'ZT-FFFFFFFFFFFFFF23','result'=>$result],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),PHP_EOL;
    exit(!empty($result['ok'])?0:1);
}catch(Throwable){fwrite(STDERR,"TEST_NOTICE_NOT_CONFIRMED; check installed libraries and private configuration.\n");exit(1);}

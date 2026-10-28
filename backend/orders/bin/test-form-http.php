<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
if($argc!==2||$argv[1]!=='--run'){echo "No requests sent; use --run for synthetic staging test.\n";exit;}
try{
    $main=dirname(__DIR__);$private=dirname($main).'/private-orders-test';
    $config=require $main.'/config.php';$stage=require $private.'/config.php';
    if(($config['enabled']??null)!==false||!preg_match('/(?:^|;)dbname=u3685169_ztrestore(?:;|$)/',$stage['dsn']??''))throw new RuntimeException('CONFIG');
    $origin=$config['origin']??'';
    if($origin!=='https://xn----ctbjb9aqim7a5cq.online')throw new RuntimeException('ORIGIN');
    $key=file_get_contents($private.'/access.key');if(!is_string($key)||!preg_match('/^[a-f0-9]{64}$/D',$key))throw new RuntimeException('KEY');
    $input=['kind'=>'inquiry','requestType'=>'question','subject'=>'ТЕСТ HTTPS 24.10.2026','name'=>'Вымышленный клиент','phone'=>'70000000000','channel'=>'VK','comment'=>'Техническая проверка без реального покупателя','consent'=>true,'consentVersion'=>'2026-10-requests-v2','items'=>[]];
    $results=[];
    for($i=0;$i<2;$i++){
        $h=curl_init($origin.'/owner/form-test.php');
        curl_setopt_array($h,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($input,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),CURLOPT_HTTPHEADER=>['Content-Type: application/json','Origin: '.$origin,'Sec-Fetch-Site: same-origin','Idempotency-Key: '.hash('sha256','zt-private-form-test-2026-10-24-v1'),'X-Test-Key: '.$key],CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>30,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2]);
        $raw=curl_exec($h);$status=(int)curl_getinfo($h,CURLINFO_HTTP_CODE);curl_close($h);
        $body=is_string($raw)?json_decode($raw,true):null;
        $results[]=['http'=>$status,'response'=>is_array($body)?$body:['code'=>'NON_JSON_RESPONSE']];
        if(!in_array($status,[200,201],true))break;
    }
    echo json_encode(['mode'=>'SYNTHETIC_HTTPS_TEST','database'=>'u3685169_ztrestore','results'=>$results],JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),PHP_EOL;
}catch(Throwable){fwrite(STDERR,"FORM_HTTP_TEST_NOT_COMPLETED; verify files and private test configuration.\n");exit(1);}

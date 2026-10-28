<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
if($argc!==2||$argv[1]!=='--create'){echo "No link created; use --create.\n";exit;}
try{
 $private=dirname(__DIR__);$c=require $private.'/config.php';
 require $private.'/lib/OwnerPasswordReset.php';
 if(($c['owner']['enabled']??false)!==true||!is_string($c['owner']['password_hash']??null)||password_get_info($c['owner']['password_hash'])['algo']===null||($c['origin']??'')!=='https://xn----ctbjb9aqim7a5cq.online')throw new RuntimeException();
 $key=bin2hex(random_bytes(32));
 \ZTOrders\resetPrivateWrite($private.'/owner-reset.json',json_encode(['tokenHash'=>hash('sha256',$key),'expires'=>time()+1800,'oldHashFingerprint'=>hash('sha256',$c['owner']['password_hash'])],JSON_THROW_ON_ERROR));
 echo "ONE_TIME_LINK_EXPIRES_IN_30_MINUTES; forward privately to Ekaterina, do not post in this chat:\n".$c['origin'].'/owner/reset-password.php#'.$key."\n";
}catch(Throwable){fwrite(STDERR,"RESET_LINK_NOT_CREATED\n");exit(1);}

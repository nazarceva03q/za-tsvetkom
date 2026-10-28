<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
try{
    $file=dirname(dirname(__DIR__)).'/private-orders-test/lib/Owner.php';
    if(is_link($file)||!is_file($file))throw new RuntimeException();
    $body=file_get_contents($file);
    if(str_contains($body,'__Host-zt-test-owner')){echo "TEST_PANEL_COOKIES_ALREADY_ISOLATED\n";exit;}
    if(!str_contains($body,'__Host-zt-owner')||!str_contains($body,'__Host-zt-login'))throw new RuntimeException();
    $new=str_replace(['__Host-zt-owner','__Host-zt-login'],['__Host-zt-test-owner','__Host-zt-test-login'],$body);
    $tmp=tempnam(dirname($file),'.owner-');if(!$tmp)throw new RuntimeException();
    try{if(!chmod($tmp,0600)||file_put_contents($tmp,$new)!==strlen($new)||!rename($tmp,$file))throw new RuntimeException();}
    finally{if(is_file($tmp))unlink($tmp);}
    echo "TEST_PANEL_COOKIES_ISOLATED; live files unchanged\n";
}catch(Throwable){fwrite(STDERR,"TEST_PANEL_NOT_PREPARED\n");exit(1);}

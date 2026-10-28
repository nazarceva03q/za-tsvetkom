<?php
declare(strict_types=1);
namespace ZTOrders;
function resetConfigText(string $text,string $old,string $new):string{
    if(password_get_info($new)['algo']===null)throw new \RuntimeException('HASH');
    $pattern='~([\'\"]password_hash[\'\"]\s*=>\s*)([\'\"])'.preg_quote($old,'~').'\2~';
    $result=preg_replace_callback($pattern,static fn($m)=>$m[1].var_export($new,true),$text,-1,$count);
    if($result===null||$count!==1)throw new \RuntimeException('CONFIG_LAYOUT');
    return $result;
}
function resetPrivateWrite(string $file,string $body):void{
    if(is_link($file))throw new \RuntimeException('SYMLINK');
    $tmp=tempnam(dirname($file),'.reset-');if(!$tmp)throw new \RuntimeException('WRITE');
    try{if(!chmod($tmp,0600)||file_put_contents($tmp,$body)!==strlen($body)||!rename($tmp,$file))throw new \RuntimeException('WRITE');}
    finally{if(is_file($tmp))unlink($tmp);}
}

<?php
declare(strict_types=1);
require_once '/private/lib/OwnerPasswordReset.php';
$old=password_hash('original-test-secret',PASSWORD_DEFAULT);$new=password_hash('new-test-secret-only',PASSWORD_DEFAULT);
$source="<?php\nreturn ['enabled'=>false,'password'=>'database-test-password','owner'=>['password_hash'=>".var_export($old,true).",'secret'=>'unchanged']];\n";
$after=ZTOrders\resetConfigText($source,$old,$new);
if(!str_contains($after,"'password'=>'database-test-password'")||!str_contains($after,"'enabled'=>false")||!str_contains($after,"'secret'=>'unchanged'")||str_contains($after,$old)||!str_contains($after,$new))throw new RuntimeException('Unrelated configuration changed');
foreach([$source.$source,str_replace($old,'different',$source)] as $bad){
 try{ZTOrders\resetConfigText($bad,$old,$new);throw new LogicException('Ambiguous config accepted');}catch(RuntimeException $e){if($e instanceof LogicException)throw $e;}
}
ZTOrders\resetPrivateWrite('/reset-test.php',$after);$config=require '/reset-test.php';
if(!password_verify('new-test-secret-only',$config['owner']['password_hash'])||password_verify('original-test-secret',$config['owner']['password_hash'])||$config['enabled']!==false)throw new RuntimeException('Reset configuration invalid');
unlink('/reset-test.php');echo "PASS owner password replacement preserves config, refuses ambiguous layouts, writes valid PHP\n";

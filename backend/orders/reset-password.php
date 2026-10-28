<?php
declare(strict_types=1);
ini_set('display_errors','0');
header('Cache-Control: no-store, private');header('Referrer-Policy: no-referrer');header('X-Robots-Tag: noindex, nofollow');header('X-Content-Type-Options: nosniff');
$scriptNonce=base64_encode(random_bytes(24));
header("Content-Security-Policy: default-src 'none'; style-src 'self'; script-src 'nonce-$scriptNonce'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
$lock=null;$error='';$success=false;
try{
 if(($_SERVER['HTTPS']??'')!=='on'&&(string)($_SERVER['SERVER_PORT']??'')!=='443')throw new RuntimeException();
 $private=realpath((string)getenv('ZT_ORDERS_PRIVATE_DIR'));
 if(!$private||basename($private)!=='private-orders')throw new RuntimeException();
 require_once $private.'/lib/OwnerPasswordReset.php';require_once $private.'/lib/Notifications.php';
 $file=$private.'/owner-reset.json';if(is_link($file)||!is_file($file))throw new RuntimeException();
 $cookie=$_COOKIE['__Host-zt-reset']??'';
 if(!is_string($cookie)||!preg_match('/^[a-f0-9]{64}$/D',$cookie)){$cookie=bin2hex(random_bytes(32));setcookie('__Host-zt-reset',$cookie,['expires'=>time()+1800,'path'=>'/','secure'=>true,'httponly'=>true,'samesite'=>'Strict']);}
 if(($_SERVER['REQUEST_METHOD']??'')==='POST'){
  $lock=fopen($private.'/owner-reset.lock','c');if(!$lock||!chmod($private.'/owner-reset.lock',0600)||!flock($lock,LOCK_EX))throw new RuntimeException();
 }
 $state=json_decode(file_get_contents($file),true,16,JSON_THROW_ON_ERROR);
 if(!is_int($state['expires']??null)||time()>$state['expires'])throw new RuntimeException();
 $c=require $private.'/config.php';
 $csrf=hash_hmac('sha256',$cookie,$c['owner']['secret']);
 if(($_SERVER['REQUEST_METHOD']??'')==='POST'){
  $origin=$_SERVER['HTTP_ORIGIN']??'';
  if($origin!==$c['origin']||!hash_equals($csrf,(string)($_POST['csrf']??'')))throw new RuntimeException();
  $token=$_POST['token']??'';
  if(!is_string($token)||!preg_match('/^[a-f0-9]{64}$/D',$token)||!hash_equals($state['tokenHash'],hash('sha256',$token))||!hash_equals($state['oldHashFingerprint'],hash('sha256',$c['owner']['password_hash'])))throw new RuntimeException();
  $password=$_POST['password']??null;$repeat=$_POST['repeat']??null;
  if(!is_string($password)||strlen($password)<12||strlen($password)>72||!is_string($repeat)||!hash_equals($password,$repeat)){
   $error='Пароли должны совпадать. Используйте от 12 до 72 латинских символов, цифр или знаков; пароль не обрезается автоматически.';
  }elseif(!preg_match('/^[\x21-\x7e]{12,72}$/D',$password)){
   $error='Используйте латинские буквы, цифры и знаки без пробелов: от 12 до 72 символов.';
  }else{
   $hash=password_hash($password,PASSWORD_DEFAULT);if(!is_string($hash))throw new RuntimeException();
   $configFile=$private.'/config.php';if(is_link($configFile))throw new RuntimeException();
   $before=file_get_contents($configFile);$after=\ZTOrders\resetConfigText($before,$c['owner']['password_hash'],$hash);
   // Revoke sessions before updating the password. A failed file update leaves
   // the old password valid, but cannot report a successful reset.
   $db=\ZTOrders\connect($c);$db->exec('DELETE FROM zt_owner_sessions');
   if(file_get_contents($configFile)!==$before)throw new RuntimeException();
   \ZTOrders\resetPrivateWrite($configFile,$after);
   if(function_exists('opcache_invalidate'))opcache_invalidate($configFile,true);
   // The old-hash fingerprint also prevents token reuse if unlink fails.
   @unlink($file);$success=true;
   setcookie('__Host-zt-owner','',['expires'=>time()-3600,'path'=>'/','secure'=>true,'httponly'=>true,'samesite'=>'Strict']);
  }
 }elseif(($_SERVER['REQUEST_METHOD']??'')!=='GET')throw new RuntimeException();
}catch(Throwable){http_response_code(403);$error='Ссылка недействительна, истекла или смена не подтверждена. Запросите новую ссылку. Пароль и токен не отправляйте в переписку.';}
finally{if(is_resource($lock)){flock($lock,LOCK_UN);fclose($lock);}}
?><!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Новый пароль — За цветком</title><link rel="stylesheet" href="orders.css"></head><body><main class="workspace"><header class="masthead"><p class="shop">За цветком</p><h1>Пароль панели заявок</h1></header><section class="login">
<?php if($success): ?><h2>Пароль изменён</h2><p>Прежние сеансы входа завершены. Сохраните новый пароль у себя.</p><a href="orders.php">Войти в панель</a>
<?php else: ?><h2>Для Екатерины</h2><p>Задайте уникальный пароль и сохраните его в своём менеджере паролей. Не передавайте его разработчику.</p>
<?php if($error!==''): ?><p role="alert" class="error"><?=htmlspecialchars($error,ENT_QUOTES,'UTF-8')?></p><?php endif; ?>
<?php if(http_response_code()!==403): ?><form method="post" action="reset-password.php"><input type="hidden" name="csrf" value="<?=htmlspecialchars($csrf,ENT_QUOTES,'UTF-8')?>"><input type="hidden" id="token" name="token" value="<?=htmlspecialchars(is_string($_POST['token']??null)?$_POST['token']:'',ENT_QUOTES,'UTF-8')?>"><label>Новый пароль<input type="password" name="password" autocomplete="new-password" required minlength="12" maxlength="72"></label><label>Повторите пароль<input type="password" name="repeat" autocomplete="new-password" required minlength="12" maxlength="72"></label><button type="submit">Сохранить новый пароль</button></form><script nonce="<?=htmlspecialchars($scriptNonce,ENT_QUOTES)?>">const token=location.hash.slice(1);if(/^[a-f0-9]{64}$/.test(token)){document.getElementById('token').value=token;history.replaceState(null,'',location.pathname);}</script><?php endif; ?>
<?php endif; ?></section></main></body></html>

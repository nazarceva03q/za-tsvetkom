<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
if($argc!==2||$argv[1]!=='--prepare'){echo "No changes; use --prepare for private synthetic test configuration.\n";exit;}
try{
    $source=dirname(__DIR__);$target=dirname($source).'/private-orders-test';
    if(basename($source)!=='private-orders'||is_link($target)||!is_dir($target))throw new RuntimeException('DIRECTORY');
    if(file_exists($target.'/config.php'))throw new RuntimeException('ALREADY_PREPARED');
    $config=require $source.'/config.php';
    if(($config['enabled']??null)!==false||($config['notifications']['enabled']??null)!==false)throw new RuntimeException('LIVE_STATE_CHANGED');
    if(($config['restore_guard']['target_database']??null)!=='u3685169_ztrestore')throw new RuntimeException('TARGET');
    if(!preg_match('/(?:^|;)dbname=([a-zA-Z0-9_]+)(?:;|$)/',$config['dsn']??'',$m)||strcasecmp($m[1],'u3685169_ztrestore')===0)throw new RuntimeException('MAIN_DATABASE');
    $config['dsn']=preg_replace('/(^|;)dbname=[a-zA-Z0-9_]+(?=;|$)/','$1dbname=u3685169_ztrestore',$config['dsn'],1);
    require_once $source.'/lib/Notifications.php';
    $db=\ZTOrders\connect($config);
    if($db->query('SELECT DATABASE()')->fetchColumn()!=='u3685169_ztrestore')throw new RuntimeException('DATABASE');
    // Test-only copy: the approved-version gate is satisfied ONLY for fictional fixtures.
    // No public endpoint is created by this installer.
    $config['enabled']=true;$config['consent_version']='2026-10-requests-v2';
    foreach(['notifications','owner','catalog','bot_inbox','workflow','retention_review','retention','erasure','restore_guard'] as $key){
        if(isset($config[$key])&&is_array($config[$key]))$config[$key]['enabled']=false;
    }
    $config['erasure']['copy_confirmation_enabled']=false;
    $config['restore_guard']['prepared']=false;
    $config['restore_guard']['ledger_current_confirmed']=false;
    $config['restore_guard']['target_not_public_confirmed']=false;
    $write=static function(string $path,string $body):void{
        if(is_link($path)||file_exists($path))throw new RuntimeException('EXISTING_FILE');
        $h=fopen($path,'xb');if(!$h)throw new RuntimeException('WRITE');
        try{if(!chmod($path,0600)||fwrite($h,$body)!==strlen($body)||!fflush($h))throw new RuntimeException('WRITE');}finally{fclose($h);}
    };
    if(!chmod($target,0700)||is_link($target.'/lib')||(!is_dir($target.'/lib')&&!mkdir($target.'/lib',0700)))throw new RuntimeException('PERMISSIONS');
    foreach(glob($source.'/lib/*.php') as $file){if(is_link($file))throw new RuntimeException('SYMLINK');$write($target.'/lib/'.basename($file),file_get_contents($file));}
    $consent=file_get_contents($source.'/consent.html');
    if(!is_string($consent)||!str_contains($consent,'data-consent-version="2026-10-requests-v2"'))throw new RuntimeException('CONSENT_FIXTURE');
    $write($target.'/consent.html',$consent);
    $write($target.'/config.php',"<?php\n// SYNTHETIC PRIVATE TEST ONLY; not legal approval or public launch.\nreturn ".var_export($config,true).";\n");
    echo '{"mode":"PRIVATE_FORM_TEST_PREPARED","database":"u3685169_ztrestore","publicEndpointCreated":false,"notificationsEnabled":false,"liveConfigChanged":false}',PHP_EOL;
}catch(Throwable $e){fwrite(STDERR,'FORM_TEST_PREPARATION_NOT_COMPLETED: '.get_class($e)."; do not publish or enable live forms.\n");exit(1);}

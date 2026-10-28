<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require_once __DIR__.'/../lib/Notifications.php';
require_once __DIR__.'/../lib/Erasure.php';
try {
    $config=require __DIR__.'/../config.php';$db=\ZTOrders\connect($config);$args=array_slice($argv,1);
    if($args===[]){echo json_encode(\ZTOrders\erasurePreview($db,$config),JSON_THROW_ON_ERROR).PHP_EOL;exit;}
    $copyInput=static function():array {
        $file=__DIR__.'/../erasure-copies.json';
        if(is_link($file)||!is_file($file)||filesize($file)>8192||((fileperms($file)&0077)!==0))throw new RuntimeException('PRIVATE_COPY_ATTESTATION_REQUIRED');
        $v=json_decode(file_get_contents($file),true,16,JSON_THROW_ON_ERROR);
        if(!is_array($v))throw new RuntimeException('INVALID_COPY_ATTESTATION');return $v;
    };
    $exportLedger=static function()use($db,$config):array {
        if(($config['erasure']['copies_schema_ready']??false)!==true)throw new RuntimeException('COPY_SCHEMA_REQUIRED');
        return \ZTOrders\exportRestoreLedgerToPrivate($db,__DIR__.'/../erasure-evidence');
    };
    if($args===['--export-ledger']){echo json_encode(['mode'=>'PRIVATE_LEDGER_EXPORTED']+$exportLedger(),JSON_THROW_ON_ERROR).PHP_EOL;exit;}
    if(count($args)===3&&$args[0]==='--export'&&preg_match('/^[a-f0-9]{32}$/D',$args[1])&&$args[2]==='--private-files'){
        $docs=\ZTOrders\erasureDocuments($db,$args[1]);
        $directory=__DIR__.'/../erasure-evidence';$revision=substr(hash('sha256',implode('',array_values($docs))),0,12);
        foreach($docs as $suffix=>$body){
            \ZTOrders\privateArtifact($directory,$args[1].'-'.$revision.'-'.$suffix,$body);
        }
        echo json_encode(['mode'=>'EXPORTED_UNSIGNED_DRAFT','recordId'=>$args[1],'files'=>count($docs)],JSON_THROW_ON_ERROR).PHP_EOL;exit;
    }
    if(count($args)===3&&$args[0]==='--confirm-copies'&&preg_match('/^[a-f0-9]{32}$/D',$args[1])&&$args[2]==='--copies-reviewed'){
        $result=\ZTOrders\confirmErasureCopies($db,$config,$args[1],$copyInput());
        try{$result['ledger']=$exportLedger();}catch(Throwable){$result['ledgerExport']='RETRY_REQUIRED';echo json_encode($result,JSON_THROW_ON_ERROR).PHP_EOL;exit(2);}
        echo json_encode($result,JSON_THROW_ON_ERROR).PHP_EOL;exit;
    }
    if(count($args)!==4||$args[0]!=='--apply'||!preg_match('/^ZT-[A-F0-9]{16}$/D',$args[1])
        ||!preg_match('/^[1-9][0-9]{0,8}$/D',$args[2]))throw new RuntimeException('ARGS');
    // Fixed private location; no arbitrary public paths or filename interpolation.
    if($args[3]!=='--copies-reviewed')throw new RuntimeException('COPY_ATTESTATION_REQUIRED');
    $copies=$copyInput();
    $result=\ZTOrders\eraseReviewedRequest($db,$config,$args[1],(int)$args[2],$copies);
    // Database commit already happened. Export failure must not claim rollback.
    try{$result['ledger']=$exportLedger();}catch(Throwable){$result['ledgerExport']='RETRY_REQUIRED';echo json_encode($result,JSON_THROW_ON_ERROR).PHP_EOL;exit(2);}
    echo json_encode($result,JSON_THROW_ON_ERROR).PHP_EOL;
}catch(\ZTOrders\ErasureError $e){fwrite(STDERR,'ERASURE_NOT_COMPLETED: '.$e->getMessage().PHP_EOL);exit(1);}
catch(Throwable){fwrite(STDERR,"ERASURE_NOT_CONFIRMED: check schema, arguments and private configuration; do not print secrets.\n");exit(1);}

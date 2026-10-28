<?php
declare(strict_types=1);
require_once '/private/lib/Owner.php';
$origin='https://xn----ctbjb9aqim7a5cq.online';
$cases=[
    [['HTTP_ORIGIN'=>$origin],true,'same-origin header accepted'],
    [['HTTP_ORIGIN'=>$origin,'HTTP_SEC_FETCH_SITE'=>'same-origin'],true,'same-origin fetch accepted'],
    [['HTTP_REFERER'=>$origin.'/owner/orders.php?number=ZT-1234567890ABCDEF'],true,'missing Origin accepts exact-origin Referer'],
    [['HTTP_ORIGIN'=>'https://evil.test','HTTP_REFERER'=>$origin.'/owner/orders.php'],false,'foreign Origin cannot be overridden'],
    [['HTTP_ORIGIN'=>'null','HTTP_REFERER'=>$origin.'/owner/orders.php'],false,'opaque Origin rejected'],
    [['HTTP_ORIGIN'=>$origin,'HTTP_SEC_FETCH_SITE'=>'cross-site'],false,'cross-site fetch rejected'],
    [['HTTP_REFERER'=>$origin.'.evil.test/owner/orders.php'],false,'suffix impersonation rejected'],
    [['HTTP_REFERER'=>'https://evil@xn----ctbjb9aqim7a5cq.online/owner/orders.php'],false,'userinfo Referer rejected'],
    [['HTTP_REFERER'=>'http://xn----ctbjb9aqim7a5cq.online/owner/orders.php'],false,'HTTP Referer rejected'],
    [[],false,'missing both origin signals rejected'],
];
foreach($cases as [$server,$expected,$label]) {
    if(ZTOrders\ownerOriginAllowed($server,$origin)!==$expected)throw new RuntimeException($label);
    echo "PASS owner-auth $label\n";
}
$login=['csrf'=>'token','username'=>'owner','password'=>'test-only'];
if(!ZTOrders\ownerIsLoginPost($login))throw new RuntimeException('login form recognized');
foreach([['action'=>'logout'],['action'=>'workflow'],['order_id'=>'x'],['password'=>['bad']]] as $extra)
    if(ZTOrders\ownerIsLoginPost(array_replace($login,$extra)))throw new RuntimeException('mutation cannot use login exception');
echo "PASS owner-auth replay exception limited to login fields\n";
if(ZTOrders\ownerReturnPath(['view'=>'retention'])!=='orders.php?view=retention')throw new RuntimeException('review section lost on login');
if(ZTOrders\ownerReturnPath(['view'=>'https://evil.test'])!=='orders.php')throw new RuntimeException('foreign redirect accepted');
echo "PASS owner-auth return to allowlisted review section\n";

<?php
declare(strict_types=1);
// Copy only OUTSIDE document root. Never commit a filled configuration.
return [
    'enabled'=>false,
    'consent_version'=>'UNAPPROVED', // set only after final legal/consent approval
    'origin'=>'https://xn----ctbjb9aqim7a5cq.online',
    'dsn'=>'mysql:unix_socket=/var/run/mysqld_native/mysqld.sock;dbname=REPLACE_DATABASE;charset=utf8mb4',
    'user'=>'REPLACE_RUNTIME_USER',
    'password'=>'',
    'rate_secret'=>'', // separate random_bytes(32), hex encoded
    'rate_limit'=>10,
    'notifications'=>[
        'enabled'=>false, // ONLY after separate permission and Yandex/VK setup
        'url'=>'', // https://functions.yandexcloud.net/<function-id>, no query/key in URL
        'secret'=>'', // same 64+ hex secret as SITE_RELAY_SECRET on Yandex, never browser-visible
        'owner_id'=>0, // must match VK_OWNER_ID on Yandex; freezes recipient on first attempt
        'timezone'=>'Asia/Yekaterinburg',
    ],
    'owner'=>[
        'enabled'=>false,
        'username'=>'',
        'password_hash'=>'', // password_hash of a unique password; never plaintext
        'secret'=>'', // separate random_bytes(32), hex encoded
    ],
];

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
    'catalog'=>[
        'enabled'=>false, // enable only after init-catalog.php and photo-directory setup
        'secret'=>'', // separate 64 hex characters; matches REG_CATALOG_SECRET on Yandex
    ],
    'bot_inbox'=>[
        'enabled'=>false, // read-only VK section; enable after migration 004 and tests
        'secret'=>'', // NEW separate 64 lowercase hex; REG_INBOX_SECRET on Yandex
        'viewer_ids'=>[], // additional VK admins allowed to read contacts; owner_id always allowed
    ],
    'workflow'=>['enabled'=>false], // enable ONLY after migration 004 and updated lib/UI
    'retention_review'=>['enabled'=>false], // independent of workflow; enable only after 005 and new code; never enables deletion
    'erasure'=>[
        'schema_ready'=>false, // after 006 + Repository/Http update; keep true after first erasure to block old POST retries
        'enabled'=>false, // single explicitly named request only; never cron/bulk
        'panel_enabled'=>false, // authenticated single-request UI; needs Erasure settings and copy procedure
        'pending_copy_review_enabled'=>false, // database-only removal; unresolved external copies remain pending
        'evidence_directory'=>'', // absolute private path outside document root; no secrets in browser
        'copies_schema_ready'=>false, // after 007 and new Erasure/RestoreGuard/CLI; does not enable deletion
        'copy_confirmation_enabled'=>false, // metadata confirmation only, separate from deletion
        'backup_retention_days'=>30, // observed REG policy, not a legal destruction deadline
        'backup_rollover_approved'=>false, // only after actual restrictions, restore drill and copy procedure
        'operator'=>['name'=>'','address'=>''],
        'actor'=>['name'=>'','role'=>''], // person actually performing deletion, not inferred from login
        'system'=>'Заявки сайта «За цветком», рабочая SQL-база REG.RU',
        'processors'=>[], // actual legal names/addresses from applicable processing contracts; verify, never guess
    ],
    'restore_guard'=>[
        'prepared'=>false, // only after drill + external ledger procedure, never inferred from installation
        'enabled'=>false, // manual staging filtering; never modifies main database
        'target_database'=>'', // existing separate, unpublished database; must differ from dsn dbname
        'ledger_current_confirmed'=>false, // operator verified latest externally kept snapshot and checksum
        'target_not_public_confirmed'=>false,
    ],
    'retention'=>[
        'approved'=>false, // operator approves purpose, closure and deletion rules
        'enabled'=>false, // CLI --apply is additionally required
        'closed_no_purchase_days'=>30, // proposal, not an approved universal retention period
        'backup_procedure_approved'=>false, // backups, restores and external copies covered separately
    ],
    'notifications'=>[
        'enabled'=>false, // ONLY after separate permission and Yandex/VK setup
        'relay_expiry_enabled'=>false, // immutable queue created_at in timed relay payload; coordinate strict mode on Yandex
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

-- Apply only after explicit approval and backup; additive MySQL 8 migration.
ALTER TABLE zt_notification_queue
 ADD claim_token CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
 ADD recipient_vk_id BIGINT UNSIGNED NULL,
 ADD vk_random_id BIGINT UNSIGNED NULL,
 ADD message_text TEXT NULL,
 ADD vk_message_id BIGINT UNSIGNED NULL,
 ADD first_attempt_at DATETIME(6) NULL,
 ADD UNIQUE KEY uq_zt_vk_random (recipient_vk_id, vk_random_id);
CREATE TABLE zt_owner_sessions (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 expires_at DATETIME NOT NULL,
 KEY ix_zt_owner_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE zt_owner_login_limits (
 bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 attempts INT UNSIGNED NOT NULL,
 expires_at DATETIME NOT NULL,
 KEY ix_zt_owner_login_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

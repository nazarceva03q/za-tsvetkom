-- REVIEW ONLY: never run automatically. Select and verify the target database.
-- MySQL 8 / InnoDB. No catalog import, DROP, TRUNCATE or DELETE.
-- No IF NOT EXISTS: a collision must be reviewed, not silently ignored.
-- DDL is not transactional. Inspect all names and take a backup before applying.
CREATE TABLE zt_orders (
 id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 order_number CHAR(19) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 idempotency_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 kind ENUM('order','inquiry') NOT NULL,
 subject VARCHAR(300) NOT NULL,
 customer_name VARCHAR(80) NOT NULL,
 phone VARCHAR(11) CHARACTER SET ascii NOT NULL,
 contact_channel VARCHAR(16) NOT NULL,
 desired_date DATE NULL,
 delivery_method VARCHAR(20) NULL,
 time_slot VARCHAR(10) NULL,
 delivery_address VARCHAR(250) NOT NULL DEFAULT '',
 comment TEXT NOT NULL,
 requested_quantity INT UNSIGNED NULL,
 budget_rubles INT UNSIGNED NULL,
 consent_version VARCHAR(40) NOT NULL,
 consent_text_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 consent_at DATETIME(6) NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'new',
 total_kopecks BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_zt_order_number (order_number),
 UNIQUE KEY uq_zt_order_idempotency (idempotency_key),
 KEY ix_zt_order_created (created_at),
 CONSTRAINT ck_zt_order_total CHECK (total_kopecks <= 1000000000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE zt_order_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 order_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 product_name VARCHAR(255) NOT NULL,
 quantity SMALLINT UNSIGNED NOT NULL,
 unit_price_kopecks BIGINT UNSIGNED NOT NULL,
 line_total_kopecks BIGINT UNSIGNED NOT NULL,
 made_to_order BOOLEAN NOT NULL,
 product_snapshot JSON NOT NULL,
 UNIQUE KEY uq_zt_order_product (order_id, product_id),
 CONSTRAINT fk_zt_items_order FOREIGN KEY (order_id) REFERENCES zt_orders(id) ON DELETE RESTRICT,
 CONSTRAINT ck_zt_item_quantity CHECK (quantity BETWEEN 1 AND 99),
 CONSTRAINT ck_zt_item_price CHECK (unit_price_kopecks > 0),
 CONSTRAINT ck_zt_item_total CHECK (line_total_kopecks = unit_price_kopecks * quantity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE zt_notification_queue (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 order_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 event_type VARCHAR(32) CHARACTER SET ascii NOT NULL,
 channel VARCHAR(24) CHARACTER SET ascii NOT NULL,
 status ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
 attempts INT UNSIGNED NOT NULL DEFAULT 0,
 next_attempt_at DATETIME(6) NOT NULL,
 locked_until DATETIME(6) NULL,
 sent_at DATETIME(6) NULL,
 last_error_code VARCHAR(64) NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_zt_notification (order_id, event_type, channel),
 KEY ix_zt_notification_due (status, next_attempt_at),
 CONSTRAINT fk_zt_queue_order FOREIGN KEY (order_id) REFERENCES zt_orders(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- HMAC of source address and time window; no raw IP.
-- Cleanup of expired counters will be a separately approved maintenance task.
CREATE TABLE zt_order_rate_limits (
 bucket_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 attempts INT UNSIGNED NOT NULL,
 expires_at DATETIME NOT NULL,
 KEY ix_zt_rate_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

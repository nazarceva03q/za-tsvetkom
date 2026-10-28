-- Apply once after 005 and a fresh SQL export. No data deletion or enabling.
-- Deliberately no foreign key to zt_orders: evidence survives removal of a request.
CREATE TABLE zt_erasure_records (
 id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 order_number CHAR(19) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 replay_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 review_version INT UNSIGNED NOT NULL,
 evidence JSON NOT NULL,
 cleared_at DATETIME(6) NOT NULL,
 retain_until DATETIME(6) NOT NULL,
 UNIQUE KEY uq_zt_erasure_number (order_number),
 UNIQUE KEY uq_zt_erasure_replay (replay_key_hash),
 KEY ix_zt_erasure_retention (retain_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

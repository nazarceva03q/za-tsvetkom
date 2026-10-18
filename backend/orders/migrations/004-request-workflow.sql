-- Apply once after 003, a fresh backup, and schema review. Never automatic.
ALTER TABLE zt_orders
 ADD workflow_version INT UNSIGNED NOT NULL DEFAULT 0,
 ADD closed_at DATETIME(6) NULL,
 ADD purchase_confirmed_at DATETIME(6) NULL,
 ADD complaint_open BOOLEAN NOT NULL DEFAULT FALSE,
 ADD next_action VARCHAR(24) NULL,
 ADD next_action_at DATETIME NULL,
 ADD erased_at DATETIME(6) NULL,
 ADD KEY ix_zt_next_action (next_action_at,status),
 ADD KEY ix_zt_closed (status,closed_at);
CREATE TABLE zt_request_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 order_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 event_type VARCHAR(32) CHARACTER SET ascii NOT NULL,
 actor VARCHAR(16) CHARACTER SET ascii NOT NULL,
 details JSON NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY ix_zt_event_order (order_id,id),
 CONSTRAINT fk_zt_event_order FOREIGN KEY (order_id) REFERENCES zt_orders(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

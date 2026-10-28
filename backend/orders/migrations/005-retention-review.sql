-- Apply once after 004 and a fresh SQL export. No deletion or cron activation.
-- New metadata only; existing orders, items, contacts and sessions are unchanged.
CREATE TABLE zt_retention_reviews (
 order_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 version INT UNSIGNED NOT NULL,
 decision VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 reason VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
 review_at DATETIME NULL,
 goal_ended_at DATETIME NULL,
 erase_due_at DATETIME NULL,
 decided_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY ix_zt_retention_due (decision,review_at),
 CONSTRAINT fk_zt_retention_order FOREIGN KEY (order_id) REFERENCES zt_orders(id) ON DELETE RESTRICT,
 CONSTRAINT ck_zt_retention_decision CHECK (
  (decision='keep' AND reason IN ('active_order','awaiting_customer','ongoing_request','dispute')
    AND reason IS NOT NULL AND review_at IS NOT NULL AND goal_ended_at IS NULL AND erase_due_at IS NULL)
  OR (decision='ready' AND reason IS NULL AND review_at IS NULL AND goal_ended_at IS NOT NULL AND erase_due_at IS NOT NULL)
 )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

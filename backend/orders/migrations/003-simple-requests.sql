-- REVIEW ONLY. Apply once after 001 and 002, explicit approval and a fresh export.
-- No catalog import, no removal of historical orders or prices.
-- DDL is not an atomic transaction. On error inspect schema; do not rerun blindly.
ALTER TABLE zt_orders
 ADD request_type VARCHAR(24) NOT NULL DEFAULT 'legacy',
 MODIFY total_kopecks BIGINT UNSIGNED NULL;
ALTER TABLE zt_order_items
 MODIFY unit_price_kopecks BIGINT UNSIGNED NULL,
 MODIFY line_total_kopecks BIGINT UNSIGNED NULL;
-- Existing CHECK constraints accept NULL: no confirmed price in a simple request.
-- Existing foreign keys, uniqueness and historical values remain intact.

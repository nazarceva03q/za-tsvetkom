-- Apply once after 006 and a fresh SQL export. No erasure is enabled.
-- Old records intentionally need a fresh copy-completion check.
ALTER TABLE zt_erasure_records
 ADD copy_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
 ADD backup_review_at DATETIME(6) NULL,
 ADD copies_confirmed_at DATETIME(6) NULL,
 ADD KEY ix_zt_erasure_copy_review (copy_state,backup_review_at),
 ADD CONSTRAINT ck_zt_erasure_copy_state CHECK (
  (copy_state='pending' AND copies_confirmed_at IS NULL)
  OR (copy_state='confirmed' AND copies_confirmed_at IS NOT NULL)
 );

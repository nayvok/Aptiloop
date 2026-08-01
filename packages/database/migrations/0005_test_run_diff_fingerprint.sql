ALTER TABLE test_runs ADD COLUMN diff_fingerprint TEXT;
ALTER TABLE test_runs ADD COLUMN diff_truncated INTEGER NOT NULL DEFAULT 0 CHECK (diff_truncated IN (0, 1));

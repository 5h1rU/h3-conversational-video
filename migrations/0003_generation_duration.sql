ALTER TABLE generation_jobs
ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 5000
CHECK (duration_ms IN (5000, 7000));

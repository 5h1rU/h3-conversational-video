CREATE TABLE IF NOT EXISTS answer_plans (
  generation_job_id TEXT PRIMARY KEY REFERENCES generation_jobs(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('GROUNDED', 'UNANSWERED')),
  topic TEXT NOT NULL CHECK (topic IN ('messi', 'us-open', 'other')),
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  can_answer INTEGER NOT NULL CHECK (can_answer IN (0, 1)),
  answer_text TEXT NOT NULL,
  ingress_text TEXT NOT NULL,
  egress_text TEXT NOT NULL,
  information_as_of TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  gateway_log_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_answer_plans_created_at
ON answer_plans(created_at);

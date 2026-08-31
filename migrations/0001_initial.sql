PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  show_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_state_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS viewer_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  transcript TEXT NOT NULL,
  playback_ms INTEGER NOT NULL,
  accepted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  branch_id TEXT NOT NULL,
  clip_id TEXT NOT NULL,
  desired_ordinal INTEGER NOT NULL,
  state_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_request_id TEXT UNIQUE,
  prompt_compiler_version TEXT NOT NULL,
  artifact_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_attempts (
  id TEXT PRIMARY KEY,
  generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id),
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_id TEXT,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  request_id TEXT PRIMARY KEY,
  signature_timestamp INTEGER NOT NULL,
  status TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_ledger (
  id TEXT PRIMARY KEY,
  generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id),
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  output_seconds REAL NOT NULL,
  amount_usd REAL NOT NULL,
  wasted INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generation_session ON generation_jobs(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_session ON cost_ledger(session_id, recorded_at);

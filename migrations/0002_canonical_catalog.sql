PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_episodes (
  episode_id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL,
  show_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('BUILDING', 'PUBLISHED', 'QUARANTINED')),
  continuity_contract_version TEXT NOT NULL,
  continuity_contract_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS canonical_clips (
  episode_id TEXT NOT NULL REFERENCES canonical_episodes(episode_id),
  ordinal INTEGER NOT NULL,
  clip_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  speaker TEXT NOT NULL,
  anchor TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms = 5000),
  artifact_id TEXT NOT NULL,
  manifest_key TEXT NOT NULL,
  provider_request_id TEXT NOT NULL,
  generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id),
  prompt_compiler_version TEXT NOT NULL,
  continuity_contract_version TEXT NOT NULL,
  continuity_input_key TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('APPROVED', 'QUARANTINED')),
  validation_evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (episode_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_canonical_episode_status
  ON canonical_episodes(status, published_at);

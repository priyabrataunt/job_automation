-- Postgres schema for Neon (Phase 1)

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  ats_source TEXT NOT NULL,
  location TEXT DEFAULT '',
  remote INTEGER DEFAULT 0,
  posted_at TIMESTAMPTZ,
  apply_url TEXT NOT NULL,
  job_type TEXT DEFAULT 'fulltime',
  experience_level TEXT DEFAULT 'entry',
  department TEXT DEFAULT '',
  description_snippet TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  raw_json TEXT DEFAULT '',
  first_seen_at TIMESTAMPTZ NOT NULL,
  relevance_score INTEGER DEFAULT 0,
  hired_score INTEGER DEFAULT NULL,
  hired_score_details TEXT DEFAULT NULL,
  max_experience_years INTEGER DEFAULT NULL,
  status_updated_at TIMESTAMPTZ DEFAULT NULL,
  visa_signal INTEGER DEFAULT NULL,
  opt_friendly INTEGER DEFAULT 0,
  sponsor_tier TEXT DEFAULT NULL,
  queue_position INTEGER DEFAULT NULL,
  mode TEXT DEFAULT 'bulk',
  mode_reason TEXT DEFAULT NULL,
  UNIQUE(external_id, ats_source)
);

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  ats_platform TEXT NOT NULL,
  ats_url TEXT NOT NULL,
  last_crawled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS runs (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  jobs_found INTEGER DEFAULT 0,
  jobs_new INTEGER DEFAULT 0,
  errors TEXT DEFAULT '',
  status TEXT DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY,
  keywords TEXT DEFAULT '[]',
  company_allowlist TEXT DEFAULT '[]',
  company_blocklist TEXT DEFAULT '[]',
  CONSTRAINT user_preferences_single CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS user_resume (
  id INTEGER PRIMARY KEY,
  filename TEXT DEFAULT '',
  resume_text TEXT DEFAULT '',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_resume_single CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS answer_cache (
  id SERIAL PRIMARY KEY,
  question_text TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  answer TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  times_used INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS application_sessions (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES jobs(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'in_progress',
  fields_total INTEGER DEFAULT 0,
  fields_filled INTEGER DEFAULT 0,
  fields_corrected INTEGER DEFAULT 0,
  adapter_used TEXT,
  error_log TEXT,
  form_snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_ats_source ON jobs(ats_source);
CREATE INDEX IF NOT EXISTS idx_jobs_relevance ON jobs(relevance_score);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_position ON jobs(queue_position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_answer_cache_hash ON answer_cache(question_hash);

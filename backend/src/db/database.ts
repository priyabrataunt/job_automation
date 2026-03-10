import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(__dirname, '../../jobs.db');

const db = new Database(DB_PATH);

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      ats_source TEXT NOT NULL,
      location TEXT DEFAULT '',
      remote INTEGER DEFAULT 0,
      posted_at TEXT,
      apply_url TEXT NOT NULL,
      job_type TEXT DEFAULT 'fulltime',
      experience_level TEXT DEFAULT 'entry',
      department TEXT DEFAULT '',
      description_snippet TEXT DEFAULT '',
      status TEXT DEFAULT 'new',
      raw_json TEXT DEFAULT '',
      first_seen_at TEXT NOT NULL,
      UNIQUE(external_id, ats_source)
    );

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ats_platform TEXT NOT NULL,
      ats_url TEXT NOT NULL,
      last_crawled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      jobs_found INTEGER DEFAULT 0,
      jobs_new INTEGER DEFAULT 0,
      errors TEXT DEFAULT '',
      status TEXT DEFAULT 'running'
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_ats_source ON jobs(ats_source);
  `);

  // Migration: add experience_level if it doesn't exist yet (for existing DBs)
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN experience_level TEXT DEFAULT 'entry'`);
  } catch {
    // Column already exists — ignore
  }

  console.log('Database initialized at', DB_PATH);
}

export default db;

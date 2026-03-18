import Database from 'better-sqlite3';
import path from 'path';
import { COMPANIES as WORKDAY_COMPANIES } from '../collectors/workday';
import { parseExperienceYears, isEntryTitle, detectExperienceLevel } from '../collectors/filters';
import { isOptFriendly, getSponsorTier } from '../data/opt-friendly-companies';

const DB_PATH = path.join(__dirname, '../../jobs.db');

const db = new Database(DB_PATH);

// Register a custom SQL function to filter US/Remote jobs
const US_STATES = [
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
  'minnesota','mississippi','missouri','montana','nebraska','nevada',
  'new hampshire','new jersey','new mexico','new york','north carolina',
  'north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
  'south carolina','south dakota','tennessee','texas','utah','vermont',
  'virginia','washington','west virginia','wisconsin','wyoming',
  'district of columbia',
];
const US_STATE_ABBRS = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];
const US_CITIES = [
  'new york','nyc','manhattan','brooklyn','san francisco','sf','los angeles',
  'chicago','houston','phoenix','philadelphia','san antonio','san diego',
  'dallas','austin','san jose','jacksonville','columbus','charlotte',
  'indianapolis','seattle','denver','nashville','boston','el paso','detroit',
  'memphis','portland','las vegas','louisville','baltimore','milwaukee',
  'albuquerque','tucson','fresno','sacramento','mesa','kansas city','atlanta',
  'omaha','raleigh','long beach','colorado springs','miami','tampa','tulsa',
  'minneapolis','arlington','pittsburgh','palo alto','mountain view',
  'sunnyvale','santa clara','cupertino','menlo park','redwood city',
  'foster city','san mateo','fremont','irvine','bellevue','redmond','kirkland',
  'reston','mclean','herndon','tysons','cambridge','somerville','boulder',
  'fort collins','durham','chapel hill','ann arbor','madison','salt lake city',
  'provo','scottsdale','tempe','plano','frisco','irving','huntsville',
  'huntington beach','oakland','berkeley','pasadena','burbank','glendale',
  'santa monica','venice','culver city','torrance','scotts valley',
  'concord','walnut creek','pleasanton','loveland','nampa','stennis',
];
function isUSLocation(location: string): boolean {
  if (!location || !location.trim()) return true; // empty = keep
  const l = location.toLowerCase().trim();
  // Explicit US markers
  if (/\bunited states\b|\busa\b|\bu\.s\.a\b|\bu\.s\b/.test(l)) return true;
  // "US" as standalone token
  if (/(?:^|[\s,\-/|;])us(?:$|[\s,\-/|;])/.test(l)) return true;
  // Check full state names
  if (US_STATES.some(s => l.includes(s))) return true;
  // Check state abbreviations — word-bounded, case-sensitive on original
  if (US_STATE_ABBRS.some(a => new RegExp(`(?:^|[\\s,\\-/|;(])${a}(?:$|[\\s,\\-/|;)])`).test(location))) return true;
  // Check known US cities
  if (US_CITIES.some(c => l.includes(c))) return true;
  // "Remote" alone (no region qualifier like "Remote - India") = assume US
  if (/\bremote\b/i.test(l) && !/remote\s*[-–]\s*(?!us\b|sf\b|bay\b|nyc\b)/i.test(l)) return true;
  // "North America" includes US
  if (l.includes('north america')) return true;
  return false;
}

db.function('is_us_job', (loc: string | null) => isUSLocation(loc || '') ? 1 : 0);
db.function('is_entry_title', (title: string | null) => isEntryTitle(title || '') ? 1 : 0);

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

  // Migration: add relevance_score
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN relevance_score INTEGER DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add hired_score for Getting Hired Score feature
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN hired_score INTEGER DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add hired_score_details JSON for score breakdown tooltip
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN hired_score_details TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add max_experience_years for Entry Roles filter
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN max_experience_years INTEGER DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add status_updated_at for follow-up reminder tracking
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN status_updated_at TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add visa_signal for per-job visa badge (0=no sponsor, 50=ambiguous, 100=sponsors)
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN visa_signal INTEGER DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add opt_friendly flag (known H1B/OPT sponsor company)
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN opt_friendly INTEGER DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // Migration: add sponsor_tier for tiered visa intelligence (top/regular/known/null)
  try {
    db.exec(`ALTER TABLE jobs ADD COLUMN sponsor_tier TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — ignore
  }

  // User preferences (single-row config)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      keywords TEXT DEFAULT '[]',
      company_allowlist TEXT DEFAULT '[]',
      company_blocklist TEXT DEFAULT '[]'
    );
  `);
  // Ensure the single row exists
  db.exec(`INSERT OR IGNORE INTO user_preferences (id) VALUES (1)`);

  // Push subscriptions for browser notifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL UNIQUE,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Index for digest queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_relevance ON jobs(relevance_score)`);

  // Resume storage (single-row, stores parsed text from uploaded PDF)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_resume (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      filename TEXT DEFAULT '',
      resume_text TEXT DEFAULT '',
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migration: remove cross-ATS duplicates (keep one per title+company,
  // preferring non-aggregator sources and user-modified statuses like saved/applied).
  const dupeCount = (db.prepare(`
    SELECT COUNT(*) as c FROM jobs WHERE id NOT IN (
      SELECT MIN(id) FROM jobs GROUP BY LOWER(TRIM(title)), LOWER(TRIM(company))
    )
  `).get() as any).c;
  if (dupeCount > 0) {
    // Keep the best row per (title, company) group:
    // 1. Prefer rows with status saved/applied
    // 2. Prefer non-aggregator (non-simplifyjobs) sources
    // 3. Prefer the earliest (lowest id)
    db.exec(`
      DELETE FROM jobs WHERE id NOT IN (
        SELECT id FROM (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY LOWER(TRIM(title)), LOWER(TRIM(company))
              ORDER BY
                CASE WHEN status IN ('saved','applied') THEN 0 ELSE 1 END,
                CASE WHEN ats_source = 'simplifyjobs' THEN 1 ELSE 0 END,
                id
            ) as rn
          FROM jobs
        ) WHERE rn = 1
      )
    `);
    console.log(`[DB] Cleaned ${dupeCount} cross-ATS duplicate rows`);
  }

  // Migration: fix Workday apply_url to include board path for browsable career page links
  const fixUrlStmt = db.prepare(
    `UPDATE jobs SET apply_url = ? || '/en-US/' || ? || SUBSTR(apply_url, LENGTH(?) + 1)
     WHERE ats_source = 'workday' AND company = ? AND apply_url LIKE ? || '/job/%'`
  );
  let fixedUrls = 0;
  for (const c of WORKDAY_COMPANIES) {
    const base = `https://${c.id}.${c.wd}.myworkdayjobs.com`;
    const result = fixUrlStmt.run(base, c.board, base, c.displayName, base);
    fixedUrls += result.changes;
  }
  if (fixedUrls > 0) {
    console.log(`[DB] Fixed ${fixedUrls} Workday apply URLs (added board path)`);
  }

  // Fix experience_level for jobs misclassified due to substring matching (e.g. "International" → "internship")
  const misclassified = db.prepare(
    `SELECT id, title, experience_level FROM jobs`
  ).all() as any[];
  const fixExpLevel = db.prepare('UPDATE jobs SET experience_level = ? WHERE id = ?');
  let fixedExpLevel = 0;
  for (const row of misclassified) {
    const correct = detectExperienceLevel(row.title);
    if (correct !== row.experience_level) {
      fixExpLevel.run(correct, row.id);
      fixedExpLevel++;
    }
  }
  if (fixedExpLevel > 0) {
    console.log(`[DB] Fixed experience_level for ${fixedExpLevel} misclassified jobs`);
  }

  // Backfill max_experience_years for existing jobs that haven't been parsed
  const unparsed = db.prepare(
    `SELECT id, title, description_snippet, raw_json FROM jobs WHERE max_experience_years IS NULL`
  ).all() as any[];
  if (unparsed.length > 0) {
    const updateExp = db.prepare('UPDATE jobs SET max_experience_years = ? WHERE id = ?');
    let backfilled = 0;
    for (const row of unparsed) {
      let desc = row.description_snippet || '';
      if (row.raw_json) {
        try {
          const raw = JSON.parse(row.raw_json);
          const rawDesc = raw.description || raw.content || raw.descriptionPlain || raw.jobDescription || '';
          if (typeof rawDesc === 'string' && rawDesc.length > desc.length) {
            desc = rawDesc.replace(/<[^>]+>/g, ' ');
          }
        } catch { /* use snippet */ }
      }
      const years = parseExperienceYears(row.title + ' ' + desc);
      if (years !== null) {
        updateExp.run(years, row.id);
        backfilled++;
      }
    }
    if (backfilled > 0) {
      console.log(`[DB] Backfilled max_experience_years for ${backfilled} jobs`);
    }
  }

  // Backfill opt_friendly for existing jobs that haven't been flagged
  const unFlagged = db.prepare(
    `SELECT id, company FROM jobs WHERE opt_friendly = 0`
  ).all() as { id: number; company: string }[];
  if (unFlagged.length > 0) {
    const updateOpt = db.prepare('UPDATE jobs SET opt_friendly = ? WHERE id = ?');
    let flagged = 0;
    db.transaction(() => {
      for (const row of unFlagged) {
        if (isOptFriendly(row.company)) {
          updateOpt.run(1, row.id);
          flagged++;
        }
      }
    })();
    if (flagged > 0) {
      console.log(`[DB] Flagged ${flagged} OPT-friendly companies`);
    }
  }

  // Backfill sponsor_tier for all jobs
  const untiered = db.prepare(
    `SELECT id, company FROM jobs WHERE sponsor_tier IS NULL`
  ).all() as { id: number; company: string }[];
  if (untiered.length > 0) {
    const updateTier = db.prepare('UPDATE jobs SET sponsor_tier = ? WHERE id = ?');
    let tiered = 0;
    db.transaction(() => {
      for (const row of untiered) {
        const tier = getSponsorTier(row.company);
        if (tier) {
          updateTier.run(tier, row.id);
          tiered++;
        }
      }
    })();
    if (tiered > 0) {
      console.log(`[DB] Set sponsor_tier for ${tiered} jobs`);
    }
  }

  console.log('Database initialized at', DB_PATH);
}

export default db;

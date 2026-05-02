import { Pool, PoolClient, QueryResultRow } from 'pg';
import { COMPANIES as WORKDAY_COMPANIES } from '../collectors/workday';
import { parseExperienceYears, detectExperienceLevel } from '../collectors/filters';
import { isOptFriendly, getSponsorTier } from '../data/opt-friendly-companies';

interface RunResult {
  changes: number;
  lastInsertRowid?: number;
}

interface PreparedStatement {
  get<T extends QueryResultRow = QueryResultRow>(...params: any[]): Promise<T | undefined>;
  all<T extends QueryResultRow = QueryResultRow>(...params: any[]): Promise<T[]>;
  run(...params: any[]): Promise<RunResult>;
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Add it to backend/.env');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('sslmode=require') || DATABASE_URL.includes('neon.tech')
    ? { rejectUnauthorized: false }
    : undefined,
});

function normalizeSql(sql: string): string {
  let out = sql.trim();

  // SQLite compat transforms
  const hadInsertOrIgnore = /\binsert\s+or\s+ignore\s+into\b/i.test(out);
  out = out.replace(/\binsert\s+or\s+ignore\s+into\b/gi, 'INSERT INTO');
  out = out.replace(/datetime\('now'\)/gi, 'NOW()');

  if (hadInsertOrIgnore && !/\bon\s+conflict\b/i.test(out)) {
    out = `${out} ON CONFLICT DO NOTHING`;
  }

  return out;
}

function normalizeParamValue(value: any): any {
  if (value === undefined) return null;
  return value;
}

function buildQuery(sql: string, params: any[]): { text: string; values: any[] } {
  const text = normalizeSql(sql);

  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0]) && /@[a-zA-Z_]\w*/.test(text)) {
    const named = params[0] as Record<string, any>;
    const values: any[] = [];
    const rewritten = text.replace(/@([a-zA-Z_]\w*)/g, (_match, key: string) => {
      values.push(normalizeParamValue(named[key]));
      return `$${values.length}`;
    });
    return { text: rewritten, values };
  }

  let idx = 0;
  const values = params.map(normalizeParamValue);
  const rewritten = text.replace(/\?/g, () => {
    idx += 1;
    return `$${idx}`;
  });

  return { text: rewritten, values };
}

async function execute(sql: string, params: any[] = []): Promise<{ rows: any[]; rowCount: number }> {
  const { text, values } = buildQuery(sql, params);
  const result = await pool.query(text, values);
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}

const db = {
  async exec(sql: string, retries = 3): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await pool.query(normalizeSql(sql));
        return;
      } catch (err: any) {
        if (i === retries - 1) throw err;
        if (err.message.includes('tuple concurrently updated')) {
          console.warn(`[DB] exec collision, retrying (${i + 1}/${retries})...`);
          await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
          continue;
        }
        throw err;
      }
    }
  },

  /**
   * Run `fn` inside a real Postgres transaction on a dedicated connection.
   * `fn` receives a db-like object whose queries run on the transaction client,
   * so BEGIN/COMMIT/ROLLBACK are fully honoured.
   */
  async withTransaction<T>(fn: (txDb: { prepare: (sql: string) => PreparedStatement; exec: (sql: string) => Promise<void> }) => Promise<T>): Promise<T> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');

      const txExec = async (sql: string) => { await client.query(normalizeSql(sql)); };

      const txPrepare = (sql: string): PreparedStatement => ({
        async get<R extends QueryResultRow = QueryResultRow>(...params: any[]): Promise<R | undefined> {
          const { text, values } = buildQuery(sql, params);
          const result = await client.query<R>(text, values);
          return result.rows[0];
        },
        async all<R extends QueryResultRow = QueryResultRow>(...params: any[]): Promise<R[]> {
          const { text, values } = buildQuery(sql, params);
          const result = await client.query<R>(text, values);
          return result.rows;
        },
        async run(...params: any[]): Promise<RunResult> {
          const { text, values } = buildQuery(sql, params);
          const result = await client.query(text, values);
          return { changes: result.rowCount ?? 0 };
        },
      });

      const result = await fn({ prepare: txPrepare, exec: txExec });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /** @deprecated Use withTransaction instead — this wrapper does not provide real atomicity. */
  transaction<T extends any[]>(fn: (...args: T) => Promise<void> | void): (...args: T) => Promise<void> {
    return async (...args: T): Promise<void> => {
      await fn(...args);
    };
  },

  prepare(sql: string): PreparedStatement {
    return {
      async get<T extends QueryResultRow = QueryResultRow>(...params: any[]): Promise<T | undefined> {
        const { rows } = await execute(sql, params);
        return rows[0] as T | undefined;
      },

      async all<T extends QueryResultRow = QueryResultRow>(...params: any[]): Promise<T[]> {
        const { rows } = await execute(sql, params);
        return rows as T[];
      },

      async run(...params: any[]): Promise<RunResult> {
        const { rows, rowCount } = await execute(sql, params);
        let lastInsertRowid: number | undefined;

        if (rows[0]?.id !== undefined && rows[0]?.id !== null) {
          const id = Number(rows[0].id);
          lastInsertRowid = Number.isNaN(id) ? undefined : id;
        } else if (/^\s*insert\b/i.test(sql) && rowCount > 0) {
          try {
            const result = await pool.query('SELECT LASTVAL() AS id');
            const id = Number(result.rows[0]?.id);
            lastInsertRowid = Number.isNaN(id) ? undefined : id;
          } catch {
            // ignore when no sequence-backed insert is involved
          }
        }

        return {
          changes: rowCount,
          lastInsertRowid,
        };
      },
    };
  },
};

async function createSqlFunctions(): Promise<void> {
  const usStates = [
    'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
    'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
    'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
    'minnesota','mississippi','missouri','montana','nebraska','nevada',
    'new hampshire','new jersey','new mexico','new york','north carolina',
    'north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
    'south carolina','south dakota','tennessee','texas','utah','vermont',
    'virginia','washington','west virginia','wisconsin','wyoming','district of columbia',
  ];

  const usStateAbbrs = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC',
  ];

  const usCities = [
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

  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const stateList = usStates.map(quote).join(', ');
  const stateAbbrList = usStateAbbrs.map(quote).join(', ');
  const cityList = usCities.map(quote).join(', ');

  await db.exec(`
    CREATE OR REPLACE FUNCTION is_entry_title(title TEXT)
    RETURNS INTEGER
    LANGUAGE SQL
    IMMUTABLE
    AS $$
      SELECT CASE
        WHEN COALESCE(title, '') ~* '(\\mintern\\M|\\minternship\\M|\\mco-?op\\M|\\mjunior\\M|\\mjr\\.?\\M|\\mnew\\s+grads?\\M|\\mentry[\\s-]level\\M|\\mapprentice\\M|\\mearly\\s+career\\M|\\mgraduates?\\M|\\massociate\\M|\\mfellow\\M|\\mstudent\\M)'
        THEN 1
        ELSE 0
      END
    $$;
  `);

  await db.exec(`
    CREATE OR REPLACE FUNCTION is_us_job(location TEXT)
    RETURNS INTEGER
    LANGUAGE plpgsql
    IMMUTABLE
    AS $$
    DECLARE
      l TEXT := lower(trim(COALESCE(location, '')));
      state_name TEXT;
      state_abbr TEXT;
      city_name TEXT;
      us_states TEXT[] := ARRAY[${stateList}];
      us_state_abbrs TEXT[] := ARRAY[${stateAbbrList}];
      us_cities TEXT[] := ARRAY[${cityList}];
    BEGIN
      IF l = '' THEN
        RETURN 1;
      END IF;

      IF l ~ '(\\munited states\\M|\\musa\\M|\\mu\\.s\\.a\\M|\\mu\\.s\\M)' THEN
        RETURN 1;
      END IF;

      IF l ~ '(^|[[:space:],\\-/|;])us($|[[:space:],\\-/|;])' THEN
        RETURN 1;
      END IF;

      FOREACH state_name IN ARRAY us_states LOOP
        IF POSITION(state_name IN l) > 0 THEN
          RETURN 1;
        END IF;
      END LOOP;

      FOREACH state_abbr IN ARRAY us_state_abbrs LOOP
        IF COALESCE(location, '') ~ ('(^|[[:space:],\\-/|;(])' || state_abbr || '($|[[:space:],\\-/|;)])') THEN
          RETURN 1;
        END IF;
      END LOOP;

      FOREACH city_name IN ARRAY us_cities LOOP
        IF POSITION(city_name IN l) > 0 THEN
          RETURN 1;
        END IF;
      END LOOP;

      IF l ~ 'remote' AND l !~ 'remote\\s*[-–]\\s*(us\\M|sf\\M|bay\\M|nyc\\M)' THEN
        RETURN 1;
      END IF;

      IF POSITION('north america' IN l) > 0 THEN
        RETURN 1;
      END IF;

      RETURN 0;
    END
    $$;
  `);
}

export async function initDb(): Promise<void> {
  await createSqlFunctions();

  await db.exec(`
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
      h1b_probability TEXT DEFAULT NULL,
      h1b_lca_count INTEGER DEFAULT NULL,
      queue_position INTEGER DEFAULT NULL,
      mode TEXT DEFAULT 'bulk',
      mode_reason TEXT DEFAULT NULL,
      archetype TEXT DEFAULT NULL,
      visa_clauses TEXT DEFAULT NULL,
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

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_resume (
      id INTEGER PRIMARY KEY,
      filename TEXT DEFAULT '',
      resume_text TEXT DEFAULT '',
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT user_resume_single CHECK (id = 1)
    );

    CREATE TABLE IF NOT EXISTS user_resumes (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      filename TEXT NOT NULL,
      resume_text TEXT NOT NULL,
      is_default BOOLEAN DEFAULT FALSE,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS job_resume_scores (
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      resume_id INTEGER NOT NULL REFERENCES user_resumes(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      details JSONB,
      scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (job_id, resume_id)
    );

    CREATE TABLE IF NOT EXISTS priority_scan_runs (
      id SERIAL PRIMARY KEY,
      scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      hours INTEGER NOT NULL DEFAULT 48,
      limit_count INTEGER NOT NULL DEFAULT 15,
      total_jobs_considered INTEGER NOT NULL DEFAULT 0
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
    CREATE INDEX IF NOT EXISTS idx_user_resumes_default ON user_resumes(is_default);
    CREATE INDEX IF NOT EXISTS idx_job_resume_scores_resume ON job_resume_scores(resume_id);
    CREATE INDEX IF NOT EXISTS idx_job_resume_scores_score ON job_resume_scores(score DESC);
  `);

  // Migration: upgrade non-unique index to unique (for existing databases)
  await db.exec(`DROP INDEX IF EXISTS idx_answer_cache_hash`);
  await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_answer_cache_hash ON answer_cache(question_hash)`);

  await db.prepare('INSERT INTO user_preferences (id) VALUES (1) ON CONFLICT (id) DO NOTHING').run();

  // One-time migration from legacy single-resume storage.
  await db.prepare(
    `INSERT INTO user_resumes (label, filename, resume_text, is_default, uploaded_at)
     SELECT
       'Default',
       COALESCE(NULLIF(filename, ''), 'resume'),
       resume_text,
       TRUE,
       COALESCE(uploaded_at, NOW())
     FROM user_resume
     WHERE id = 1
       AND COALESCE(resume_text, '') <> ''
       AND NOT EXISTS (SELECT 1 FROM user_resumes)`
  ).run();

  // Remove cross-ATS duplicates (keep one per title+company)
  const dupeCountRow = await db.prepare(`
    SELECT COUNT(*)::int AS c FROM jobs WHERE id NOT IN (
      SELECT MIN(id) FROM jobs GROUP BY LOWER(TRIM(title)), LOWER(TRIM(company))
    )
  `).get<{ c: number }>();
  const dupeCount = dupeCountRow?.c ?? 0;

  if (dupeCount > 0) {
    await db.exec(`
      DELETE FROM jobs WHERE id NOT IN (
        SELECT id FROM (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY LOWER(TRIM(title)), LOWER(TRIM(company))
              ORDER BY
                CASE WHEN status IN ('saved','applied') THEN 0 ELSE 1 END,
                CASE WHEN ats_source = 'simplifyjobs' THEN 1 ELSE 0 END,
                id
            ) AS rn
          FROM jobs
        ) AS ranked
        WHERE rn = 1
      )
    `);
    console.log(`[DB] Cleaned ${dupeCount} cross-ATS duplicate rows`);
  }

  // Fix Workday apply_url to include board path for browsable career page links
  const fixUrlStmt = db.prepare(
    `UPDATE jobs
     SET apply_url = ? || '/en-US/' || ? || SUBSTRING(apply_url FROM LENGTH(?) + 1)
     WHERE ats_source = 'workday' AND company = ? AND apply_url LIKE ?`
  );
  let fixedUrls = 0;
  for (const c of WORKDAY_COMPANIES) {
    const base = `https://${c.id}.${c.wd}.myworkdayjobs.com`;
    const pattern = `${base}/job/%`;
    const result = await fixUrlStmt.run(base, c.board, base, c.displayName, pattern);
    fixedUrls += result.changes;
  }
  if (fixedUrls > 0) {
    console.log(`[DB] Fixed ${fixedUrls} Workday apply URLs (added board path)`);
  }

  // Fix experience_level for jobs misclassified due to substring matching
  const misclassified = await db.prepare(
    'SELECT id, title, experience_level FROM jobs'
  ).all<{ id: number; title: string; experience_level: string }>();
  const fixExpLevel = db.prepare('UPDATE jobs SET experience_level = ? WHERE id = ?');
  let fixedExpLevel = 0;
  for (const row of misclassified) {
    const correct = detectExperienceLevel(row.title);
    if (correct !== row.experience_level) {
      await fixExpLevel.run(correct, row.id);
      fixedExpLevel++;
    }
  }
  if (fixedExpLevel > 0) {
    console.log(`[DB] Fixed experience_level for ${fixedExpLevel} misclassified jobs`);
  }

  // Backfill max_experience_years for existing jobs that haven't been parsed
  const unparsed = await db.prepare(
    'SELECT id, title, description_snippet, raw_json FROM jobs WHERE max_experience_years IS NULL'
  ).all<{ id: number; title: string; description_snippet: string; raw_json: string }>();
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
        } catch {
          // use snippet fallback
        }
      }

      const years = parseExperienceYears(`${row.title} ${desc}`);
      if (years !== null) {
        await updateExp.run(years, row.id);
        backfilled++;
      }
    }

    if (backfilled > 0) {
      console.log(`[DB] Backfilled max_experience_years for ${backfilled} jobs`);
    }
  }

  // Backfill opt_friendly for existing jobs that haven't been flagged
  const unFlagged = await db.prepare(
    'SELECT id, company FROM jobs WHERE opt_friendly = 0'
  ).all<{ id: number; company: string }>();
  if (unFlagged.length > 0) {
    const updateOpt = db.prepare('UPDATE jobs SET opt_friendly = ? WHERE id = ?');
    let flagged = 0;
    for (const row of unFlagged) {
      if (isOptFriendly(row.company)) {
        await updateOpt.run(1, row.id);
        flagged++;
      }
    }
    if (flagged > 0) {
      console.log(`[DB] Flagged ${flagged} OPT-friendly companies`);
    }
  }

  // Backfill sponsor_tier for all jobs
  const untiered = await db.prepare(
    'SELECT id, company FROM jobs WHERE sponsor_tier IS NULL'
  ).all<{ id: number; company: string }>();
  if (untiered.length > 0) {
    const updateTier = db.prepare('UPDATE jobs SET sponsor_tier = ? WHERE id = ?');
    let tiered = 0;
    for (const row of untiered) {
      const tier = getSponsorTier(row.company);
      if (tier) {
        await updateTier.run(tier, row.id);
        tiered++;
      }
    }
    if (tiered > 0) {
      console.log(`[DB] Set sponsor_tier for ${tiered} jobs`);
    }
  }

  // Add mode/mode_reason columns if they don't exist (runtime migration)
  try {
    await db.exec("ALTER TABLE jobs ADD COLUMN mode TEXT DEFAULT 'bulk'");
  } catch { /* column already exists */ }
  try {
    await db.exec("ALTER TABLE jobs ADD COLUMN mode_reason TEXT DEFAULT NULL");
  } catch { /* column already exists */ }
  try {
    await db.exec("ALTER TABLE jobs ADD COLUMN h1b_probability TEXT DEFAULT NULL");
  } catch { /* column already exists */ }
  try {
    await db.exec("ALTER TABLE jobs ADD COLUMN h1b_lca_count INTEGER DEFAULT NULL");
  } catch { /* column already exists */ }
  try {
    await db.exec("ALTER TABLE jobs ADD COLUMN archetype TEXT DEFAULT NULL");
  } catch { /* column already exists */ }
  try {
    await db.exec("ALTER TABLE jobs ADD COLUMN visa_clauses TEXT DEFAULT NULL");
  } catch { /* column already exists */ }

  console.log('[DB] Database initialized');
}

export default db;

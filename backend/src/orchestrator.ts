import db from './db/database';
import { runAllCollectors } from './collectors';
import { collectJSearch } from './collectors/jsearch';
import { Job } from './db/schema';
import { scoreNewJobs } from './scoring';
import { parseExperienceYears } from './collectors/filters';
import { getSponsorTier } from './data/opt-friendly-companies';

/**
 * Deduplicate jobs across ATS sources by normalized title + company.
 * Prefers original ATS postings over aggregators (simplifyjobs).
 */
function deduplicateJobs(jobs: Job[]): Job[] {
  const seen = new Map<string, Job>();
  const aggregators = new Set(['simplifyjobs']);

  for (const job of jobs) {
    const key = `${job.title.toLowerCase().trim()}||${job.company.toLowerCase().trim()}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, job);
    } else {
      // Keep original ATS over aggregator
      if (aggregators.has(existing.ats_source) && !aggregators.has(job.ats_source)) {
        seen.set(key, job);
      }
      // Otherwise keep the first one (discard this duplicate)
    }
  }
  return Array.from(seen.values());
}

export interface RunResult {
  runId: number;
  jobsFound: number;
  jobsNew: number;
  errors: string[];
  status: string;
}

let isRunning = false;

export function isCollectionRunning(): boolean {
  return isRunning;
}

export async function runCollection(hoursBack: number = 48): Promise<RunResult> {
  if (isRunning) {
    console.log('[Orchestrator] Collection already in progress, skipping');
    return { runId: -1, jobsFound: 0, jobsNew: 0, errors: ['Already running'], status: 'skipped' };
  }

  isRunning = true;
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  const runResult = await db.prepare(
    `INSERT INTO runs (started_at, status) VALUES (?, 'running') RETURNING id`
  ).run(startedAt);
  const runId = runResult.lastInsertRowid ?? -1;

  console.log(`[Orchestrator] Run #${runId} started`);

  let jobs: Job[] = [];
  try {
    jobs = await runAllCollectors(hoursBack);
  } catch (err: any) {
    errors.push(err.message);
  }

  // Deduplicate across ATS sources (same title + company)
  const beforeDedup = jobs.length;
  jobs = deduplicateJobs(jobs);
  const dupsRemoved = beforeDedup - jobs.length;
  if (dupsRemoved > 0) {
    console.log(`[Orchestrator] Removed ${dupsRemoved} cross-ATS duplicates`);
  }

  const insertJob = db.prepare(`
    INSERT INTO jobs
      (external_id, title, company, ats_source, location, remote, posted_at,
       apply_url, job_type, experience_level, department, description_snippet, status, raw_json, first_seen_at)
    VALUES
      (@external_id, @title, @company, @ats_source, @location, @remote, @posted_at,
       @apply_url, @job_type, @experience_level, @department, @description_snippet, @status, @raw_json, @first_seen_at)
    ON CONFLICT (external_id, ats_source) DO NOTHING
    RETURNING id
  `);

  let jobsNew = 0;
  const newJobIds: number[] = [];

  try {
    for (const job of jobs) {
      const result = await insertJob.run({
        ...job,
        remote: job.remote ? 1 : 0,
      });
      if (result.changes > 0) {
        jobsNew++;
        if (result.lastInsertRowid !== undefined) {
          newJobIds.push(result.lastInsertRowid);
        }
      }
    }
  } catch (err: any) {
    errors.push(`DB insert error: ${err.message}`);
  }

  // Score newly inserted jobs based on user preferences
  try {
    await scoreNewJobs(newJobIds);
  } catch (err: any) {
    errors.push(`Scoring error: ${err.message}`);
  }

  // Parse experience-years from descriptions for Entry Roles filtering
  try {
    if (newJobIds.length > 0) {
      const expStmt = db.prepare('UPDATE jobs SET max_experience_years = ? WHERE id = ?');
      const rows = await db.prepare(
        `SELECT id, title, description_snippet, raw_json FROM jobs WHERE id IN (${newJobIds.map(() => '?').join(',')})`
      ).all(...newJobIds) as any[];

      for (const row of rows) {
        let desc = row.description_snippet || '';
        if (row.raw_json) {
          try {
            const raw = JSON.parse(row.raw_json);
            desc = raw.description || raw.content || raw.descriptionPlain || raw.jobDescription || desc;
            if (typeof desc !== 'string') desc = '';
            desc = desc.replace(/<[^>]+>/g, ' ');
          } catch {
            // use snippet
          }
        }

        const years = parseExperienceYears(`${row.title} ${desc}`);
        if (years !== null) {
          await expStmt.run(years, row.id);
        }
      }
    }
  } catch (err: any) {
    errors.push(`Experience parsing error: ${err.message}`);
  }

  // Flag OPT-friendly companies and set sponsor tier for new jobs
  try {
    if (newJobIds.length > 0) {
      const optStmt = db.prepare('UPDATE jobs SET opt_friendly = ?, sponsor_tier = ? WHERE id = ?');
      const optRows = await db.prepare(
        `SELECT id, company FROM jobs WHERE id IN (${newJobIds.map(() => '?').join(',')})`
      ).all(...newJobIds) as { id: number; company: string }[];

      for (const row of optRows) {
        const tier = getSponsorTier(row.company);
        await optStmt.run(tier ? 1 : 0, tier, row.id);
      }
    }
  } catch (err: any) {
    errors.push(`OPT flagging error: ${err.message}`);
  }

  const finishedAt = new Date().toISOString();
  await db.prepare(`
    UPDATE runs SET finished_at = ?, jobs_found = ?, jobs_new = ?, errors = ?, status = 'completed'
    WHERE id = ?
  `).run(finishedAt, jobs.length, jobsNew, errors.join('; '), runId);

  isRunning = false;
  console.log(`[Orchestrator] Run #${runId} complete: ${jobs.length} found, ${jobsNew} new, ${dupsRemoved} cross-ATS dupes removed`);

  return { runId, jobsFound: jobs.length, jobsNew, errors, status: 'completed' };
}

/**
 * Manual-only JSearch collection (LinkedIn/Indeed/Glassdoor via RapidAPI).
 * Not part of the auto scheduler — triggered by the user from the UI.
 */
export async function runJSearchCollection(hoursBack: number = 48): Promise<RunResult> {
  if (isRunning) {
    return { runId: -1, jobsFound: 0, jobsNew: 0, errors: ['Collection already running'], status: 'skipped' };
  }

  isRunning = true;
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  const runResult = await db.prepare(
    `INSERT INTO runs (started_at, status) VALUES (?, 'running') RETURNING id`
  ).run(startedAt);
  const runId = runResult.lastInsertRowid ?? -1;

  console.log(`[JSearch] Run #${runId} started`);

  let jobs: Job[] = [];
  try {
    jobs = await collectJSearch(hoursBack);
  } catch (err: any) {
    errors.push(err.message);
  }

  jobs = deduplicateJobs(jobs);

  const insertJob = db.prepare(`
    INSERT INTO jobs
      (external_id, title, company, ats_source, location, remote, posted_at,
       apply_url, job_type, experience_level, department, description_snippet, status, raw_json, first_seen_at)
    VALUES
      (@external_id, @title, @company, @ats_source, @location, @remote, @posted_at,
       @apply_url, @job_type, @experience_level, @department, @description_snippet, @status, @raw_json, @first_seen_at)
    ON CONFLICT (external_id, ats_source) DO NOTHING
    RETURNING id
  `);

  let jobsNew = 0;
  const newJobIds: number[] = [];

  try {
    for (const job of jobs) {
      const result = await insertJob.run({
        ...job,
        remote: job.remote ? 1 : 0,
      });
      if (result.changes > 0) {
        jobsNew++;
        if (result.lastInsertRowid !== undefined) {
          newJobIds.push(result.lastInsertRowid);
        }
      }
    }
  } catch (err: any) {
    errors.push(`DB insert error: ${err.message}`);
  }

  try {
    await scoreNewJobs(newJobIds);
  } catch (err: any) {
    errors.push(`Scoring error: ${err.message}`);
  }

  try {
    if (newJobIds.length > 0) {
      const expStmt = db.prepare('UPDATE jobs SET max_experience_years = ? WHERE id = ?');
      const rows = await db.prepare(
        `SELECT id, title, description_snippet, raw_json FROM jobs WHERE id IN (${newJobIds.map(() => '?').join(',')})`
      ).all(...newJobIds) as any[];

      for (const row of rows) {
        let desc = row.description_snippet || '';
        if (row.raw_json) {
          try {
            const raw = JSON.parse(row.raw_json);
            desc = raw.description || raw.content || raw.descriptionPlain || raw.jobDescription || desc;
            if (typeof desc !== 'string') desc = '';
            desc = desc.replace(/<[^>]+>/g, ' ');
          } catch {
            // use snippet
          }
        }
        const years = parseExperienceYears(`${row.title} ${desc}`);
        if (years !== null) {
          await expStmt.run(years, row.id);
        }
      }
    }
  } catch (err: any) {
    errors.push(`Experience parsing error: ${err.message}`);
  }

  try {
    if (newJobIds.length > 0) {
      const optStmt = db.prepare('UPDATE jobs SET opt_friendly = ?, sponsor_tier = ? WHERE id = ?');
      const optRows = await db.prepare(
        `SELECT id, company FROM jobs WHERE id IN (${newJobIds.map(() => '?').join(',')})`
      ).all(...newJobIds) as { id: number; company: string }[];

      for (const row of optRows) {
        const tier = getSponsorTier(row.company);
        await optStmt.run(tier ? 1 : 0, tier, row.id);
      }
    }
  } catch (err: any) {
    errors.push(`OPT flagging error: ${err.message}`);
  }

  const finishedAt = new Date().toISOString();
  await db.prepare(`
    UPDATE runs SET finished_at = ?, jobs_found = ?, jobs_new = ?, errors = ?, status = 'completed'
    WHERE id = ?
  `).run(finishedAt, jobs.length, jobsNew, errors.join('; '), runId);

  isRunning = false;
  console.log(`[JSearch] Run #${runId} complete: ${jobs.length} found, ${jobsNew} new`);

  return { runId, jobsFound: jobs.length, jobsNew, errors, status: 'completed' };
}

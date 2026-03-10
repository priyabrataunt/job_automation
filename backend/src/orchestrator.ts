import db from './db/database';
import { runAllCollectors } from './collectors';
import { Job } from './db/schema';

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

  const insertRun = db.prepare(`
    INSERT INTO runs (started_at, status) VALUES (?, 'running')
  `);
  const runResult = insertRun.run(startedAt);
  const runId = runResult.lastInsertRowid as number;

  console.log(`[Orchestrator] Run #${runId} started`);

  let jobs: Job[] = [];
  try {
    jobs = await runAllCollectors(hoursBack);
  } catch (err: any) {
    errors.push(err.message);
  }

  const insertJob = db.prepare(`
    INSERT OR IGNORE INTO jobs
      (external_id, title, company, ats_source, location, remote, posted_at,
       apply_url, job_type, experience_level, department, description_snippet, status, raw_json, first_seen_at)
    VALUES
      (@external_id, @title, @company, @ats_source, @location, @remote, @posted_at,
       @apply_url, @job_type, @experience_level, @department, @description_snippet, @status, @raw_json, @first_seen_at)
  `);

  let jobsNew = 0;
  const insertMany = db.transaction((jobList: Job[]) => {
    for (const job of jobList) {
      const result = insertJob.run({
        ...job,
        remote: job.remote ? 1 : 0,
      });
      if (result.changes > 0) jobsNew++;
    }
  });

  try {
    insertMany(jobs);
  } catch (err: any) {
    errors.push(`DB insert error: ${err.message}`);
  }

  const finishedAt = new Date().toISOString();
  db.prepare(`
    UPDATE runs SET finished_at = ?, jobs_found = ?, jobs_new = ?, errors = ?, status = 'completed'
    WHERE id = ?
  `).run(finishedAt, jobs.length, jobsNew, errors.join('; '), runId);

  isRunning = false;
  console.log(`[Orchestrator] Run #${runId} complete: ${jobs.length} found, ${jobsNew} new`);

  return { runId, jobsFound: jobs.length, jobsNew, errors, status: 'completed' };
}

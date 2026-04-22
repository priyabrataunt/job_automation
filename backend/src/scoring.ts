import db from './db/database';
import { UserPreferences } from './db/schema';

export async function getPreferences(): Promise<UserPreferences> {
  const row = await db.prepare('SELECT * FROM user_preferences WHERE id = 1').get() as any;
  return {
    keywords: JSON.parse(row?.keywords || '[]'),
    company_allowlist: JSON.parse(row?.company_allowlist || '[]'),
    company_blocklist: JSON.parse(row?.company_blocklist || '[]'),
  };
}

/**
 * Score a single job based on user preferences.
 * Higher score = more relevant.
 *
 * Scoring:
 * - Each keyword match in title/description: +10
 * - Company in allowlist: +25
 * - Company in blocklist: -100
 * - Base: 1 (so every job has a positive score unless blocklisted)
 */
export function scoreJob(
  title: string,
  company: string,
  description: string,
  prefs: UserPreferences,
): number {
  let score = 1;
  const titleLower = title.toLowerCase();
  const descLower = description.toLowerCase();
  const companyLower = company.toLowerCase();

  for (const kw of prefs.keywords) {
    const kwLower = kw.toLowerCase();
    if (titleLower.includes(kwLower)) score += 15;
    else if (descLower.includes(kwLower)) score += 5;
  }

  for (const c of prefs.company_allowlist) {
    if (companyLower.includes(c.toLowerCase())) {
      score += 25;
      break;
    }
  }

  for (const c of prefs.company_blocklist) {
    if (companyLower.includes(c.toLowerCase())) {
      score -= 100;
      break;
    }
  }

  return Math.max(0, score);
}

/**
 * Re-score all jobs in the database.
 * Called after preferences change or after a collection run.
 */
export async function rescoreAllJobs(): Promise<number> {
  const prefs = await getPreferences();
  const jobs = await db.prepare(
    'SELECT id, title, company, description_snippet FROM jobs'
  ).all() as { id: number; title: string; company: string; description_snippet: string }[];

  const update = db.prepare('UPDATE jobs SET relevance_score = ? WHERE id = ?');

  for (const job of jobs) {
    const score = scoreJob(job.title, job.company, job.description_snippet, prefs);
    await update.run(score, job.id);
  }

  return jobs.length;
}

/**
 * Score only newly inserted jobs (by IDs).
 */
export async function scoreNewJobs(jobIds: number[]): Promise<void> {
  if (jobIds.length === 0) return;

  const prefs = await getPreferences();

  const placeholders = jobIds.map(() => '?').join(',');
  const jobs = await db.prepare(
    `SELECT id, title, company, description_snippet FROM jobs WHERE id IN (${placeholders})`
  ).all(...jobIds) as { id: number; title: string; company: string; description_snippet: string }[];

  const update = db.prepare('UPDATE jobs SET relevance_score = ? WHERE id = ?');

  for (const job of jobs) {
    const score = scoreJob(job.title, job.company, job.description_snippet, prefs);
    await update.run(score, job.id);
  }
}

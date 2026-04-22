import cron from 'node-cron';
import { runCollection } from './orchestrator';
import { sendDigestPush } from './push';
import db from './db/database';

export async function purgeOldJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const result = await db.prepare(
    `DELETE FROM jobs WHERE posted_at < ? AND status NOT IN ('saved', 'applied')`
  ).run(cutoff);
  return result.changes;
}

export function startScheduler(): void {
  console.log('[Scheduler] Starting — collection every 6h, cleanup every 1h, digest push at 8am daily');

  // Every 6 hours at minute 0
  cron.schedule('0 */6 * * *', async () => {
    const startTime = new Date().toISOString();
    console.log(`[Scheduler] Tick at ${startTime}`);
    try {
      const result = await runCollection(8);
      console.log(`[Scheduler] Done: ${result.jobsNew} new jobs`);
    } catch (err: any) {
      console.error('[Scheduler] Error:', err.message);
    }
  });

  // Every hour: purge jobs older than 48h
  cron.schedule('0 * * * *', async () => {
    const removed = await purgeOldJobs();
    if (removed > 0) console.log(`[Scheduler] Purged ${removed} jobs older than 48h`);
  });

  // Daily digest push at 8:00 AM
  cron.schedule('0 8 * * *', async () => {
    console.log('[Scheduler] Sending daily digest push');
    try {
      await sendDigestPush();
    } catch (err: any) {
      console.error('[Scheduler] Push error:', err.message);
    }
  });
}

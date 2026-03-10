import cron from 'node-cron';
import { runCollection } from './orchestrator';

export function startScheduler(): void {
  console.log('[Scheduler] Starting — runs every 6 hours');

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
}

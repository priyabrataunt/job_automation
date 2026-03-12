import 'dotenv/config';
import { initDb } from './db/database';
import { startServer } from './api/server';
import { startScheduler, purgeOldJobs } from './scheduler';
import { runCollection } from './orchestrator';
import { initPush } from './push';

async function main() {
  console.log('[App] Starting Job Tracker...');

  initDb();
  initPush();
  await startServer(8000);
  startScheduler();

  // Purge stale jobs on startup
  const purged = purgeOldJobs();
  if (purged > 0) console.log(`[App] Purged ${purged} stale jobs (>48h old)`);

  console.log('[App] Running initial collection (48h back)...');
  runCollection(48).catch(err => {
    console.error('[App] Initial collection failed:', err.message);
  });
}

main().catch(err => {
  console.error('[App] Fatal error:', err);
  process.exit(1);
});

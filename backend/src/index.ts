import { initDb } from './db/database';
import { startServer } from './api/server';
import { startScheduler } from './scheduler';
import { runCollection } from './orchestrator';

async function main() {
  console.log('[App] Starting Job Tracker...');

  initDb();
  await startServer(8000);
  startScheduler();

  console.log('[App] Running initial collection (168h back)...');
  runCollection(168).catch(err => {
    console.error('[App] Initial collection failed:', err.message);
  });
}

main().catch(err => {
  console.error('[App] Fatal error:', err);
  process.exit(1);
});

/**
 * Playwright Batch Apply Engine
 *
 * Usage:
 *   cd playwright && npm run apply-batch
 *
 * Environment variables:
 *   API_BASE     Backend URL (default: http://localhost:8000)
 *   PROFILE_PATH Path to profile JSON (default: ~/.job-automation/profile.json)
 *   HEADLESS     Set to "true" for headless mode (default: false)
 *
 * Setup:
 *   1. Copy profile.example.json to ~/.job-automation/profile.json and fill in your details.
 *   2. Queue jobs via the dashboard (status = "queued").
 *   3. Run: cd playwright && npm run apply-batch
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import { launchSession, getPage } from './session';
import { FormEngine } from './form-engine';
import type { EngineConfig, JobResult, QueuedJob, UserProfile } from './types';
import * as ui from './terminal-ui';

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: EngineConfig = {
  apiBase:     process.env.API_BASE     ?? 'http://localhost:8000',
  profilePath: process.env.PROFILE_PATH ?? path.join(os.homedir(), '.job-automation', 'profile.json'),
  headless:    process.env.HEADLESS === 'true',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadProfile(profilePath: string): UserProfile {
  const resolved = profilePath.replace(/^~/, os.homedir());
  if (!fs.existsSync(resolved)) {
    const exampleSrc = path.join(__dirname, '..', 'profile.example.json');
    const dest = path.join(os.homedir(), '.job-automation', 'profile.json');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(exampleSrc)) {
      fs.copyFileSync(exampleSrc, dest);
      throw new Error(
        `No profile found. Copied example to ${dest}\n` +
        `  Fill in your details and run again.`,
      );
    }
    throw new Error(
      `Profile not found at ${resolved}.\n` +
      `  Create the file — see playwright/profile.example.json for the format.`,
    );
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

async function fetchQueue(apiBase: string): Promise<QueuedJob[]> {
  const res = await fetch(`${apiBase}/api/jobs/queue`);
  if (!res.ok) throw new Error(`Failed to load queue (${res.status}): ${res.statusText}`);
  const data = (await res.json()) as { jobs: QueuedJob[] };
  return data.jobs ?? [];
}

async function markApplied(apiBase: string, jobId: number): Promise<void> {
  await fetch(`${apiBase}/api/jobs/${jobId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'applied' }),
  });
}

async function removeFromQueue(apiBase: string, jobId: number): Promise<void> {
  await fetch(`${apiBase}/api/jobs/${jobId}/queue`, { method: 'DELETE' });
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function run(config: EngineConfig = DEFAULT_CONFIG): Promise<void> {
  ui.printHeader();

  // 1. Load user profile
  let profile: UserProfile;
  try {
    profile = loadProfile(config.profilePath);
    console.log(`[Engine] Profile : ${profile.personal?.name ?? 'unknown'} <${profile.personal?.email ?? ''}>`);
  } catch (err: any) {
    console.error(`\n[Engine] ERROR: ${err.message}\n`);
    process.exit(1);
  }

  // 2. Fetch queue
  console.log(`[Engine] Backend  : ${config.apiBase}`);
  let queue: QueuedJob[];
  try {
    queue = await fetchQueue(config.apiBase);
  } catch (err: any) {
    console.error(`\n[Engine] Cannot reach backend: ${err.message}`);
    console.error(`         Make sure the backend is running (cd backend && npm run dev)\n`);
    process.exit(1);
  }

  if (queue.length === 0) {
    console.log('\n[Engine] Queue is empty. Add jobs via the dashboard and queue them first.\n');
    process.exit(0);
  }
  console.log(`[Engine] Queue    : ${queue.length} job(s) to process`);

  // 3. Build form engine (used by adapters in Phase 3+)
  const formEngine = new FormEngine(profile, config.apiBase);

  // 4. Launch browser
  console.log('[Engine] Launching browser...');
  const context = await launchSession(config.headless);
  const page = await getPage(context);

  const results: JobResult[] = [];

  // 5. Process queue
  try {
    for (let i = 0; i < queue.length; i++) {
      const job = queue[i];
      ui.printJobHeader(job, i + 1, queue.length);

      // Navigate to application page
      try {
        await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (err: any) {
        const msg = err.message ?? String(err);
        ui.printError(job, `Navigation failed: ${msg}`);
        results.push({ jobId: job.id, title: job.title, company: job.company, status: 'error', error: msg });
        continue;
      }

      // Show controls and wait for first keypress
      ui.printControls();
      const action = await ui.waitForUserAction();

      if (action === 'quit') {
        console.log('\n[Engine] Quitting — remaining jobs stay queued.');
        break;
      }

      if (action === 'skip') {
        ui.printSkipped(job);
        await removeFromQueue(config.apiBase, job.id);
        results.push({ jobId: job.id, title: job.title, company: job.company, status: 'skipped' });
        continue;
      }

      // action === 'proceed': bring browser to front and wait for submission
      try {
        await page.bringToFront();
      } catch {
        // Not all environments support bringToFront — ignore
      }
      ui.printSubmitControls();
      const submitAction = await ui.waitForUserAction();

      if (submitAction === 'quit') {
        console.log('\n[Engine] Quitting — remaining jobs stay queued.');
        break;
      }

      if (submitAction === 'skip') {
        ui.printSkipped(job);
        await removeFromQueue(config.apiBase, job.id);
        results.push({ jobId: job.id, title: job.title, company: job.company, status: 'skipped' });
        continue;
      }

      // Mark as applied
      await markApplied(config.apiBase, job.id);
      ui.printSuccess(job);
      results.push({ jobId: job.id, title: job.title, company: job.company, status: 'applied' });
    }
  } finally {
    ui.printBatchSummary(results);
    await context.close();
  }
}

// Entry point
run(DEFAULT_CONFIG).catch((err: unknown) => {
  console.error('\n[Engine] Fatal error:', err);
  process.exit(1);
});

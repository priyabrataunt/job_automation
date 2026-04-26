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
import { detectAdapter } from './adapters/index';
import { detectAndSaveCorrections, CachedField } from './cache';
import { runAuthPreflight } from './auth-handler';
import type { Page } from 'playwright';
import type { AuthPreflightResult, EngineConfig, FillResult, JobResult, QueuedJob, UserProfile } from './types';
import * as ui from './terminal-ui';

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: EngineConfig = {
  apiBase:     process.env.API_BASE     ?? 'http://localhost:8000',
  profilePath: process.env.PROFILE_PATH ?? path.join(os.homedir(), '.job-automation', 'profile.json'),
  headless:    process.env.HEADLESS === 'true',
};

const AUTH_MAX_ATTEMPTS = 2;
const LOG_DIR = path.join(os.homedir(), '.job-automation', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'apply-engine-events.jsonl');

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
  const res = await fetch(`${apiBase}/api/jobs/queue?mode=bulk`);
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

/**
 * Snapshot all visible form field values on the current page.
 * Returns a map of label → current value for correction detection.
 */
async function snapshotFormState(page: Page): Promise<Record<string, string>> {
  try {
    return await page.evaluate(() => {
      const result: Record<string, string> = {};
      const inputs = document.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select',
      );
      for (const el of inputs) {
        let label = '';
        const id = el.getAttribute('id');
        if (id) {
          const labelEl = document.querySelector(`label[for="${id}"]`);
          if (labelEl?.textContent) label = labelEl.textContent.replace(/\s+/g, ' ').trim().replace(/\s*\*+\s*$/, '');
        }
        if (!label) label = el.getAttribute('aria-label')?.trim() ?? '';
        if (!label) {
          const enclosing = el.closest('label');
          if (enclosing?.textContent) label = enclosing.textContent.replace(/\s+/g, ' ').trim().replace(/\s*\*+\s*$/, '');
        }
        if (!label) {
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
            label = el.placeholder?.trim() ?? '';
        }
        if (!label) continue;

        const tag = el.tagName.toLowerCase();
        if (tag === 'select') {
          const sel = el as HTMLSelectElement;
          result[label] = sel.options[sel.selectedIndex]?.text?.trim() ?? '';
        } else if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
          if (el.checked) {
            const prev = result[label];
            result[label] = prev ? `${prev}, ${el.value}` : el.value;
          }
        } else {
          result[label] = (el as HTMLInputElement).value ?? '';
        }
      }
      return result;
    });
  } catch {
    return {};
  }
}

async function saveSession(apiBase: string, jobId: number, adapterName: string, fillResults: FillResult[]): Promise<void> {
  try {
    await fetch(`${apiBase}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, adapterName, fillResults, appliedAt: new Date().toISOString() }),
    });
  } catch {
    // Optional — silently ignore if endpoint doesn't exist or errors
  }
}

function appendRunEvent(event: Record<string, unknown>): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
  } catch {
    // Monitoring must never block the engine
  }
}

async function hasCaptcha(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const title = document.title.toLowerCase();
      if (title.includes('just a moment') || title.includes('attention required')) return true;
      const iframes = Array.from(document.querySelectorAll('iframe'));
      return iframes.some(f => {
        const src = f.getAttribute('src') ?? '';
        return src.includes('recaptcha') || src.includes('hcaptcha') || src.includes('turnstile');
      });
    });
  } catch {
    return false;
  }
}

async function demoteToAssisted(apiBase: string, jobId: number, reason: string): Promise<void> {
  try {
    await fetch(`${apiBase}/api/jobs/${jobId}/queue-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'assisted', mode_reason: `auto-demote: ${reason}` }),
    });
  } catch {
    // Best-effort — job stays in queue to be picked up by extension
  }
}

async function ensureApplicationReady(
  page: Page,
  profile: UserProfile,
  job: QueuedJob,
): Promise<{ decision: 'ready' | 'skip' | 'quit' | 'demote'; authResult: AuthPreflightResult }> {
  let latest: AuthPreflightResult = {
    state: 'application-ready',
    reason: 'not-run',
    pageUrl: page.url(),
  };

  for (let attempt = 1; attempt <= AUTH_MAX_ATTEMPTS; attempt++) {
    latest = await runAuthPreflight(page, profile);
    appendRunEvent({
      event: 'auth-preflight',
      jobId: job.id,
      jobTitle: job.title,
      attempt,
      state: latest.state,
      reason: latest.reason,
      pageUrl: latest.pageUrl,
    });

    if (latest.state === 'application-ready' || latest.state === 'auth-handled') {
      if (latest.state === 'auth-handled') {
        ui.printAuthStatus(`Auth completed (${latest.reason}).`);
      }
      return { decision: 'ready', authResult: latest };
    }

    if (latest.state === 'demote-to-assisted') {
      return { decision: 'demote', authResult: latest };
    }

    if (attempt < AUTH_MAX_ATTEMPTS) {
      ui.printAuthStatus(`Auth attempt ${attempt} failed (${latest.reason}). Retrying once...`);
      try {
        await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch {
        // next loop iteration will fail with current page state and skip safely
      }
      continue;
    }
  }

  return { decision: 'skip', authResult: latest };
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

      // Check for captcha/Cloudflare after navigation
      if (await hasCaptcha(page)) {
        await demoteToAssisted(config.apiBase, job.id, 'captcha');
        ui.printAuthStatus(`Captcha detected — demoted to assisted (${job.title})`);
        results.push({ jobId: job.id, title: job.title, company: job.company, status: 'skipped', skipReason: 'auto-demote: captcha' });
        continue;
      }

      const authGate = await ensureApplicationReady(page, profile, job);
      if (authGate.decision === 'quit') {
        console.log('\n[Engine] Quitting — remaining jobs stay queued.');
        break;
      }
      if (authGate.decision === 'demote') {
        await demoteToAssisted(config.apiBase, job.id, authGate.authResult.reason);
        ui.printAuthStatus(`Auth wall detected — demoted to assisted (${job.title})`);
        results.push({ jobId: job.id, title: job.title, company: job.company, status: 'skipped', skipReason: `auto-demote: ${authGate.authResult.reason}` });
        continue;
      }
      if (authGate.decision === 'skip') {
        ui.printSkipped(job);
        await removeFromQueue(config.apiBase, job.id);
        results.push({
          jobId: job.id,
          title: job.title,
          company: job.company,
          status: 'skipped',
          skipReason: `auth: ${authGate.authResult.reason}`,
        });
        appendRunEvent({
          event: 'job-skipped-auth',
          jobId: job.id,
          jobTitle: job.title,
          reason: authGate.authResult.reason,
          pageUrl: authGate.authResult.pageUrl,
        });
        continue;
      }

      // Detect platform adapter and fill the form
      let fillResults: FillResult[] = [];
      let adapterName = 'unknown';
      try {
        console.log(`\n  [Engine] Detecting platform adapter...`);
        const adapter = await detectAdapter(page);
        adapterName = adapter.name;
        console.log(`  [Engine] Detected adapter: ${adapterName}`);

        // Fill current page/step
        console.log(`  [Engine] Scanning for form fields (Step 1)...`);
        fillResults = await adapter.fillForm(page, formEngine, job);

        // Handle multi-step forms (up to 5 steps)
        const MAX_STEPS = 5;
        for (let step = 1; step < MAX_STEPS; step++) {
          const advanced = await adapter.handleMultiStep(page);
          if (!advanced) break;
          console.log(`  [Engine] Advanced to Step ${step + 1}. Scanning for form fields...`);
          const stepResults = await adapter.fillForm(page, formEngine, job);
          fillResults = fillResults.concat(stepResults);
        }

        // Upload resume if profile has one
        if (profile.resume_path) {
          try {
            console.log(`  [Engine] Uploading resume from ${profile.resume_path}...`);
            await adapter.uploadResume(page, profile.resume_path);
          } catch (resumeErr: any) {
            console.warn(`[Engine] Resume upload warning: ${resumeErr.message ?? resumeErr}`);
          }
        }
      } catch (adapterErr: any) {
        console.warn(`[Engine] Adapter error: ${adapterErr.message ?? adapterErr} — continuing in manual mode`);
      }

      // Print field summary (always, even if empty after an error)
      ui.printFieldSummary(fillResults, adapterName);

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

      // Snapshot form state after user review (captures any manual corrections)
      const postSubmitState = await snapshotFormState(page);

      // Detect and save corrections (compare what we filled vs what user changed)
      const preFillData: CachedField[] = fillResults
        .filter(r => r.source !== 'unfilled' && r.value)
        .map(r => ({ label: r.label, value: r.value, source: r.source as CachedField['source'] }));
      const corrections = await detectAndSaveCorrections(config.apiBase, preFillData, postSubmitState);
      if (corrections.length > 0) {
        console.log(`[Engine] Learned ${corrections.length} correction(s) from your edits:`);
        for (const c of corrections) {
          console.log(`  "${c.question_text}": "${c.original_answer}" → "${c.corrected_answer}"`);
        }
      }

      // Mark as applied
      await markApplied(config.apiBase, job.id);
      // Save application session
      await saveSession(config.apiBase, job.id, adapterName, fillResults);
      ui.printSuccess(job);
      results.push({ jobId: job.id, title: job.title, company: job.company, status: 'applied', fillResults, adapterUsed: adapterName });
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

"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const session_1 = require("./session");
const form_engine_1 = require("./form-engine");
const index_1 = require("./adapters/index");
const cache_1 = require("./cache");
const ui = __importStar(require("./terminal-ui"));
// ── Config ────────────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
    apiBase: process.env.API_BASE ?? 'http://localhost:8000',
    profilePath: process.env.PROFILE_PATH ?? path.join(os.homedir(), '.job-automation', 'profile.json'),
    headless: process.env.HEADLESS === 'true',
};
// ── Helpers ───────────────────────────────────────────────────────────────────
function loadProfile(profilePath) {
    const resolved = profilePath.replace(/^~/, os.homedir());
    if (!fs.existsSync(resolved)) {
        const exampleSrc = path.join(__dirname, '..', 'profile.example.json');
        const dest = path.join(os.homedir(), '.job-automation', 'profile.json');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (fs.existsSync(exampleSrc)) {
            fs.copyFileSync(exampleSrc, dest);
            throw new Error(`No profile found. Copied example to ${dest}\n` +
                `  Fill in your details and run again.`);
        }
        throw new Error(`Profile not found at ${resolved}.\n` +
            `  Create the file — see playwright/profile.example.json for the format.`);
    }
    return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}
async function fetchQueue(apiBase) {
    const res = await fetch(`${apiBase}/api/jobs/queue`);
    if (!res.ok)
        throw new Error(`Failed to load queue (${res.status}): ${res.statusText}`);
    const data = (await res.json());
    return data.jobs ?? [];
}
async function markApplied(apiBase, jobId) {
    await fetch(`${apiBase}/api/jobs/${jobId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'applied' }),
    });
}
async function removeFromQueue(apiBase, jobId) {
    await fetch(`${apiBase}/api/jobs/${jobId}/queue`, { method: 'DELETE' });
}
/**
 * Snapshot all visible form field values on the current page.
 * Returns a map of label → current value for correction detection.
 */
async function snapshotFormState(page) {
    try {
        return await page.evaluate(() => {
            const result = {};
            const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
            for (const el of inputs) {
                let label = '';
                const id = el.getAttribute('id');
                if (id) {
                    const labelEl = document.querySelector(`label[for="${id}"]`);
                    if (labelEl?.textContent)
                        label = labelEl.textContent.replace(/\s+/g, ' ').trim().replace(/\s*\*+\s*$/, '');
                }
                if (!label)
                    label = el.getAttribute('aria-label')?.trim() ?? '';
                if (!label) {
                    const enclosing = el.closest('label');
                    if (enclosing?.textContent)
                        label = enclosing.textContent.replace(/\s+/g, ' ').trim().replace(/\s*\*+\s*$/, '');
                }
                if (!label) {
                    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
                        label = el.placeholder?.trim() ?? '';
                }
                if (!label)
                    continue;
                const tag = el.tagName.toLowerCase();
                if (tag === 'select') {
                    const sel = el;
                    result[label] = sel.options[sel.selectedIndex]?.text?.trim() ?? '';
                }
                else if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
                    if (el.checked) {
                        const prev = result[label];
                        result[label] = prev ? `${prev}, ${el.value}` : el.value;
                    }
                }
                else {
                    result[label] = el.value ?? '';
                }
            }
            return result;
        });
    }
    catch {
        return {};
    }
}
async function saveSession(apiBase, jobId, adapterName, fillResults) {
    try {
        await fetch(`${apiBase}/api/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId, adapterName, fillResults, appliedAt: new Date().toISOString() }),
        });
    }
    catch {
        // Optional — silently ignore if endpoint doesn't exist or errors
    }
}
// ── Main runner ───────────────────────────────────────────────────────────────
async function run(config = DEFAULT_CONFIG) {
    ui.printHeader();
    // 1. Load user profile
    let profile;
    try {
        profile = loadProfile(config.profilePath);
        console.log(`[Engine] Profile : ${profile.personal?.name ?? 'unknown'} <${profile.personal?.email ?? ''}>`);
    }
    catch (err) {
        console.error(`\n[Engine] ERROR: ${err.message}\n`);
        process.exit(1);
    }
    // 2. Fetch queue
    console.log(`[Engine] Backend  : ${config.apiBase}`);
    let queue;
    try {
        queue = await fetchQueue(config.apiBase);
    }
    catch (err) {
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
    const formEngine = new form_engine_1.FormEngine(profile, config.apiBase);
    // 4. Launch browser
    console.log('[Engine] Launching browser...');
    const context = await (0, session_1.launchSession)(config.headless);
    const page = await (0, session_1.getPage)(context);
    const results = [];
    // 5. Process queue
    try {
        for (let i = 0; i < queue.length; i++) {
            const job = queue[i];
            ui.printJobHeader(job, i + 1, queue.length);
            // Navigate to application page
            try {
                await page.goto(job.apply_url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            }
            catch (err) {
                const msg = err.message ?? String(err);
                ui.printError(job, `Navigation failed: ${msg}`);
                results.push({ jobId: job.id, title: job.title, company: job.company, status: 'error', error: msg });
                continue;
            }
            // Detect platform adapter and fill the form
            let fillResults = [];
            let adapterName = 'unknown';
            try {
                const adapter = await (0, index_1.detectAdapter)(page);
                adapterName = adapter.name;
                // Fill current page/step
                fillResults = await adapter.fillForm(page, formEngine, job);
                // Handle multi-step forms (up to 5 steps)
                const MAX_STEPS = 5;
                for (let step = 1; step < MAX_STEPS; step++) {
                    const advanced = await adapter.handleMultiStep(page);
                    if (!advanced)
                        break;
                    const stepResults = await adapter.fillForm(page, formEngine, job);
                    fillResults = fillResults.concat(stepResults);
                }
                // Upload resume if profile has one
                if (profile.resume_path) {
                    try {
                        await adapter.uploadResume(page, profile.resume_path);
                    }
                    catch (resumeErr) {
                        console.warn(`[Engine] Resume upload warning: ${resumeErr.message ?? resumeErr}`);
                    }
                }
            }
            catch (adapterErr) {
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
            }
            catch {
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
            const preFillData = fillResults
                .filter(r => r.source !== 'unfilled' && r.value)
                .map(r => ({ label: r.label, value: r.value, source: r.source }));
            const corrections = await (0, cache_1.detectAndSaveCorrections)(config.apiBase, preFillData, postSubmitState);
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
    }
    finally {
        ui.printBatchSummary(results);
        await context.close();
    }
}
// Entry point
run(DEFAULT_CONFIG).catch((err) => {
    console.error('\n[Engine] Fatal error:', err);
    process.exit(1);
});

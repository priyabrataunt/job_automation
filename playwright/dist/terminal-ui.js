"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.printHeader = printHeader;
exports.printJobHeader = printJobHeader;
exports.printFieldSummary = printFieldSummary;
exports.printAuthStatus = printAuthStatus;
exports.printAuthPrompt = printAuthPrompt;
exports.printControls = printControls;
exports.printSubmitControls = printSubmitControls;
exports.waitForUserAction = waitForUserAction;
exports.printSuccess = printSuccess;
exports.printSkipped = printSkipped;
exports.printError = printError;
exports.printBatchSummary = printBatchSummary;
const DIVIDER = '─'.repeat(70);
const BOLD_DIVIDER = '═'.repeat(70);
const SOURCE_ICON = {
    profile: '✓',
    cache: '✓',
    ai: '⚠',
    unfilled: '✗',
};
const SOURCE_LABEL = {
    profile: 'profile',
    cache: 'cached',
    ai: 'AI-generated (review)',
    unfilled: 'UNFILLED',
};
function printHeader() {
    console.log('\n' + BOLD_DIVIDER);
    console.log('  Job Automation — Batch Apply Engine');
    console.log(BOLD_DIVIDER);
}
function printJobHeader(job, current, total) {
    const src = job.ats_source.charAt(0).toUpperCase() + job.ats_source.slice(1);
    console.log('\n' + DIVIDER);
    console.log(`[${current}/${total}] Applying to: ${job.title} @ ${job.company} (${src})`);
    if (job.location)
        console.log(`     Location : ${job.location}`);
    console.log(`     URL      : ${job.apply_url}`);
    console.log(DIVIDER);
}
function printFieldSummary(results, adapterName) {
    console.log(`\n  [Adapter: ${adapterName}]`);
    if (results.length === 0) {
        console.log('  (no fields detected)');
        return;
    }
    for (const r of results) {
        const icon = SOURCE_ICON[r.source] ?? '?';
        const label = SOURCE_LABEL[r.source] ?? r.source;
        if (r.source === 'unfilled') {
            console.log(`  ${icon} ${r.label} → unfilled (manual fill needed)`);
        }
        else {
            const val = r.value
                ? `"${r.value.slice(0, 60)}${r.value.length > 60 ? '…' : ''}"`
                : '(empty)';
            console.log(`  ${icon} ${r.label} → ${val} (${label})`);
        }
    }
}
function printAuthStatus(message) {
    console.log(`\n  [Auth] ${message}`);
}
function printAuthPrompt() {
    console.log('  Complete sign-in/sign-up in the browser if needed.');
    console.log('  Press Enter to continue | s to skip this job | q to quit...');
}
function printControls() {
    console.log('\n  Press Enter to focus browser | s to skip | q to quit...');
}
function printSubmitControls() {
    console.log('\n  Review and submit in the browser.');
    console.log('  Press Enter after submitting | s to skip | q to quit...');
}
/** Waits for a single keypress and returns the action. */
async function waitForUserAction() {
    if (!process.stdin.isTTY) {
        // Non-interactive (piped/CI) mode: auto-proceed after a short delay.
        // Note: this will reach markApplied without human confirmation.
        // The engine never auto-clicks Submit, but jobs will be marked 'applied' automatically.
        // To disable this behavior in CI, set env REQUIRE_TTY=true and exit early before calling run().
        await new Promise(r => setTimeout(r, 2000));
        return 'proceed';
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    return new Promise((resolve) => {
        const onKey = (key) => {
            if (key === '\r' || key === '\n' || key === ' ') {
                cleanup();
                resolve('proceed');
            }
            else if (key === 's' || key === 'S') {
                cleanup();
                resolve('skip');
            }
            else if (key === 'q' || key === 'Q' || key === '\u0003') { // ctrl+c
                cleanup();
                resolve('quit');
            }
            // Ignore other keys
        };
        const cleanup = () => {
            process.stdin.off('data', onKey);
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
            process.stdin.pause();
        };
        process.stdin.on('data', onKey);
    });
}
function printSuccess(job) {
    console.log(`\n  ✓ Applied: ${job.title} @ ${job.company}`);
}
function printSkipped(job) {
    console.log(`\n  → Skipped: ${job.title} @ ${job.company}`);
}
function printError(job, message) {
    console.log(`\n  ✗ Error on ${job.title} @ ${job.company}: ${message}`);
}
function printBatchSummary(results) {
    const applied = results.filter(r => r.status === 'applied').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const errors = results.filter(r => r.status === 'error').length;
    const remaining = results.length - applied - skipped - errors;
    console.log('\n' + BOLD_DIVIDER);
    console.log(`  Batch complete: ${applied} applied  |  ${skipped} skipped  |  ${errors} error(s)`);
    if (remaining > 0) {
        console.log(`  ${remaining} job(s) remain queued for next session.`);
    }
    console.log(BOLD_DIVIDER + '\n');
}

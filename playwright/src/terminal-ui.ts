import { FillResult, JobResult, QueuedJob } from './types';

const DIVIDER = '─'.repeat(70);
const BOLD_DIVIDER = '═'.repeat(70);

const SOURCE_ICON: Record<string, string> = {
  profile: '✓',
  cache:   '✓',
  ai:      '⚠',
  unfilled: '✗',
};

const SOURCE_LABEL: Record<string, string> = {
  profile:  'profile',
  cache:    'cached',
  ai:       'AI-generated (review)',
  unfilled: 'UNFILLED',
};

export type UserAction = 'proceed' | 'skip' | 'quit';

export function printHeader(): void {
  console.log('\n' + BOLD_DIVIDER);
  console.log('  Job Automation — Batch Apply Engine');
  console.log(BOLD_DIVIDER);
}

export function printJobHeader(job: QueuedJob, current: number, total: number): void {
  const src = job.ats_source.charAt(0).toUpperCase() + job.ats_source.slice(1);
  console.log('\n' + DIVIDER);
  console.log(`[${current}/${total}] Applying to: ${job.title} @ ${job.company} (${src})`);
  if (job.location) console.log(`     Location : ${job.location}`);
  console.log(`     URL      : ${job.apply_url}`);
  console.log(DIVIDER);
}

export function printFillResults(results: FillResult[]): void {
  if (results.length === 0) return;
  console.log('  Fields filled:');
  for (const r of results) {
    const icon  = SOURCE_ICON[r.source]  ?? '?';
    const label = SOURCE_LABEL[r.source] ?? r.source;
    const val   = r.value
      ? `"${r.value.slice(0, 50)}${r.value.length > 50 ? '…' : ''}"`
      : '(empty)';
    console.log(`    ${icon} "${r.label}" → ${val}  [${label}]`);
  }
}

export function printControls(): void {
  console.log('\n  Press Enter to focus browser | s to skip | q to quit...');
}

export function printSubmitControls(): void {
  console.log('\n  Review and submit in the browser.');
  console.log('  Press Enter after submitting | s to skip | q to quit...');
}

/** Waits for a single keypress and returns the action. */
export async function waitForUserAction(): Promise<UserAction> {
  if (!process.stdin.isTTY) {
    // Non-interactive mode — auto-proceed after a short delay
    await new Promise(r => setTimeout(r, 2000));
    return 'proceed';
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise<UserAction>((resolve) => {
    const onKey = (key: string) => {
      if (key === '\r' || key === '\n' || key === ' ') {
        cleanup();
        resolve('proceed');
      } else if (key === 's' || key === 'S') {
        cleanup();
        resolve('skip');
      } else if (key === 'q' || key === 'Q' || key === '\u0003') { // ctrl+c
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

export function printSuccess(job: QueuedJob): void {
  console.log(`\n  ✓ Applied: ${job.title} @ ${job.company}`);
}

export function printSkipped(job: QueuedJob): void {
  console.log(`\n  → Skipped: ${job.title} @ ${job.company}`);
}

export function printError(job: QueuedJob, message: string): void {
  console.log(`\n  ✗ Error on ${job.title} @ ${job.company}: ${message}`);
}

export function printBatchSummary(results: JobResult[]): void {
  const applied  = results.filter(r => r.status === 'applied').length;
  const skipped  = results.filter(r => r.status === 'skipped').length;
  const errors   = results.filter(r => r.status === 'error').length;
  const remaining = results.length - applied - skipped - errors;

  console.log('\n' + BOLD_DIVIDER);
  console.log(`  Batch complete: ${applied} applied  |  ${skipped} skipped  |  ${errors} error(s)`);
  if (remaining > 0) {
    console.log(`  ${remaining} job(s) remain queued for next session.`);
  }
  console.log(BOLD_DIVIDER + '\n');
}

import { chromium, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const PROFILE_DIR = path.join(os.homedir(), '.job-automation', 'browser-profile');

export async function launchSession(headless = false): Promise<BrowserContext> {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1280, height: 900 },
    // Reduce automation detection signals
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  return context;
}

export async function getPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  // Reuse an existing blank tab if available
  const blank = pages.find(p => p.url() === 'about:blank');
  if (blank) return blank;
  return context.newPage();
}

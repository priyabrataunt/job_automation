import type { Page } from 'playwright';
import type { AuthPreflightResult, AuthPreflightState, UserProfile } from './types';

type PageSignals = {
  hasPasswordInput: boolean;
  hasEmailInput: boolean;
  hasAuthCopy: boolean;
  hasApplySignal: boolean;
  hasForm: boolean;
  hasApplyButton: boolean;
  candidateSubmitSelector: string | null;
};

interface AuthCredentials {
  email: string;
  password: string;
}

function getCredentials(profile: UserProfile): AuthCredentials | null {
  const password = process.env.JOB_AUTOMATION_PASSWORD?.trim() ?? '';
  const email = profile.personal?.email?.trim() ?? '';

  if (!email || !password) return null;
  return { email, password };
}

async function scanPageSignals(page: Page): Promise<PageSignals> {
  return page.evaluate(() => {
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
    const bodyText = normalize(document.body?.innerText ?? '');

    const hasPasswordInput = !!document.querySelector('input[type="password"]');
    const hasEmailInput = !!document.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i]');
    const hasAuthCopy = /(sign in|signin|log in|login|create account|sign up|signup|continue with|forgot password|welcome back)/i.test(bodyText);

    const hasForm = !!document.querySelector('form');

    const hasApplySignal = !!Array.from(document.querySelectorAll('label, legend, h1, h2, p, span')).find((el) => {
      const text = normalize(el.textContent ?? '');
      return /(first name|last name|phone|resume|cover letter|linkedin|portfolio|work authorization|start date|salary)/i.test(text);
    });

    const applyButton = Array.from(document.querySelectorAll('button, input[type="submit"], a')).find((el) => {
      const text = normalize(el.textContent ?? (el as HTMLInputElement).value ?? '');
      return /(submit application|apply now|submit|apply)/i.test(text);
    });

    const authButton = Array.from(document.querySelectorAll('button, input[type="submit"], a')).find((el) => {
      const text = normalize(el.textContent ?? (el as HTMLInputElement).value ?? '');
      return /(sign in|log in|continue|next)/i.test(text);
    });

    const selectorFor = (el: Element | undefined): string | null => {
      if (!el) return null;
      if (el.id) return `#${el.id}`;
      const name = el.getAttribute('name');
      if (name) return `[name="${name}"]`;
      const testId = el.getAttribute('data-testid');
      if (testId) return `[data-testid="${testId}"]`;
      return null;
    };

    return {
      hasPasswordInput,
      hasEmailInput,
      hasAuthCopy,
      hasApplySignal,
      hasForm,
      hasApplyButton: Boolean(applyButton),
      candidateSubmitSelector: selectorFor(authButton ?? undefined),
    };
  });
}

function classifySignals(signals: PageSignals): AuthPreflightState {
  const looksLikeAuth = signals.hasPasswordInput || (signals.hasEmailInput && signals.hasAuthCopy && !signals.hasApplySignal);
  const looksLikeApplication = (signals.hasForm && (signals.hasApplySignal || signals.hasApplyButton)) && !signals.hasPasswordInput;

  if (looksLikeApplication) return 'application-ready';
  if (looksLikeAuth) return 'auth-required';
  return 'application-ready';
}

async function fillLoginForm(page: Page, credentials: AuthCredentials, candidateSubmitSelector: string | null): Promise<void> {
  const emailCandidates = [
    'input[type="email"]',
    'input[name*="email" i]',
    'input[id*="email" i]',
  ];
  const passwordCandidates = [
    'input[type="password"]',
    'input[name*="password" i]',
    'input[id*="password" i]',
  ];

  for (const selector of emailCandidates) {
    const field = page.locator(selector).first();
    if ((await field.count()) > 0) {
      await field.fill(credentials.email);
      break;
    }
  }

  for (const selector of passwordCandidates) {
    const field = page.locator(selector).first();
    if ((await field.count()) > 0) {
      await field.fill(credentials.password);
      break;
    }
  }

  if (candidateSubmitSelector) {
    const button = page.locator(candidateSubmitSelector).first();
    if ((await button.count()) > 0) {
      await button.click();
      return;
    }
  }

  const fallbackSubmit = page
    .locator('button, input[type="submit"], a')
    .filter({ hasText: /sign in|log in|continue|next/i })
    .first();

  if ((await fallbackSubmit.count()) > 0) {
    await fallbackSubmit.click();
    return;
  }

  const passwordInput = page.locator('input[type="password"]').first();
  if ((await passwordInput.count()) > 0) {
    await passwordInput.press('Enter');
  }
}

async function waitForPostAuth(page: Page): Promise<void> {
  await Promise.race([
    page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null),
    page.waitForURL((url) => /apply|jobs|greenhouse|lever|ashby/i.test(url.toString()), { timeout: 10_000 }).catch(() => null),
    page.waitForTimeout(2_000),
  ]);
}

export async function runAuthPreflight(page: Page, profile: UserProfile): Promise<AuthPreflightResult> {
  const signals = await scanPageSignals(page);
  const initialState = classifySignals(signals);

  if (initialState === 'application-ready') {
    return { state: 'application-ready', reason: 'application-form-detected', pageUrl: page.url() };
  }

  if (initialState !== 'auth-required') {
    return { state: 'application-ready', reason: 'no-auth-signals', pageUrl: page.url() };
  }

  const credentials = getCredentials(profile);
  if (!credentials) {
    return {
      state: 'auth-failed',
      reason: 'missing JOB_AUTOMATION_PASSWORD or profile email',
      pageUrl: page.url(),
    };
  }

  try {
    await fillLoginForm(page, credentials, signals.candidateSubmitSelector);
    await waitForPostAuth(page);

    const afterSignals = await scanPageSignals(page);
    const finalState = classifySignals(afterSignals);

    if (finalState === 'application-ready') {
      return { state: 'auth-handled', reason: 'login-submitted-and-application-visible', pageUrl: page.url() };
    }

    return { state: 'demote-to-assisted', reason: 'auth-submitted-but-application-not-visible', pageUrl: page.url() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { state: 'auth-failed', reason: `auth-preflight-error: ${message}`, pageUrl: page.url() };
  }
}

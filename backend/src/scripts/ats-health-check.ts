import axios from 'axios';
import companiesData from '../data/companies.json';
import { COMPANIES as WORKDAY_COMPANIES } from '../collectors/workday';

type StatusLabel = 'healthy' | 'stale' | 'error';

interface CheckResult {
  ats: string;
  name: string;
  slug: string;
  endpoint: string;
  statusCode: number | null;
  status: StatusLabel;
  note: string;
}

interface Company {
  slug: string;
  name: string;
  ats: string;
}

const companies = companiesData as Company[];

function classify(statusCode: number | null, errCode?: string): { status: StatusLabel; note: string } {
  if (statusCode === 200) return { status: 'healthy', note: 'OK' };
  if (statusCode === 404) return { status: 'stale', note: 'Not found (likely moved ATS/slug)' };
  if (statusCode === 429) return { status: 'error', note: 'Rate limited' };
  if (statusCode && statusCode >= 500) return { status: 'error', note: 'Server error' };
  if (errCode) return { status: 'error', note: `Network error (${errCode})` };
  return { status: 'error', note: statusCode ? `HTTP ${statusCode}` : 'Unknown error' };
}

async function checkGet(ats: string, name: string, slug: string, endpoint: string): Promise<CheckResult> {
  try {
    const resp = await axios.get(endpoint, { timeout: 12000, validateStatus: () => true });
    const classified = classify(resp.status);
    return {
      ats,
      name,
      slug,
      endpoint,
      statusCode: resp.status,
      status: classified.status,
      note: classified.note,
    };
  } catch (err: any) {
    const code = err?.response?.status ?? null;
    const classified = classify(code, err?.code);
    return {
      ats,
      name,
      slug,
      endpoint,
      statusCode: code,
      status: classified.status,
      note: classified.note,
    };
  }
}

async function checkPost(ats: string, name: string, slug: string, endpoint: string, body: unknown): Promise<CheckResult> {
  try {
    const resp = await axios.post(endpoint, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 12000,
      validateStatus: () => true,
    });
    const classified = classify(resp.status);
    return {
      ats,
      name,
      slug,
      endpoint,
      statusCode: resp.status,
      status: classified.status,
      note: classified.note,
    };
  } catch (err: any) {
    const code = err?.response?.status ?? null;
    const classified = classify(code, err?.code);
    return {
      ats,
      name,
      slug,
      endpoint,
      statusCode: code,
      status: classified.status,
      note: classified.note,
    };
  }
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<CheckResult>): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  let i = 0;

  async function loop() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => loop()));
  return results;
}

async function main() {
  const checks: Array<() => Promise<CheckResult>> = [];

  for (const c of companies) {
    if (c.ats === 'greenhouse') {
      const endpoint = `https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`;
      checks.push(() => checkGet(c.ats, c.name, c.slug, endpoint));
    } else if (c.ats === 'ashby') {
      const endpoint = `https://api.ashbyhq.com/posting-api/job-board/${c.slug}`;
      checks.push(() => checkGet(c.ats, c.name, c.slug, endpoint));
    } else if (c.ats === 'lever') {
      const endpoint = `https://api.lever.co/v0/postings/${c.slug}?mode=json&limit=1`;
      checks.push(() => checkGet(c.ats, c.name, c.slug, endpoint));
    } else if (c.ats === 'smartrecruiters') {
      const endpoint = `https://api.smartrecruiters.com/v1/companies/${c.slug}/postings?limit=1&offset=0`;
      checks.push(() => checkGet(c.ats, c.name, c.slug, endpoint));
    } else if (c.ats === 'workable') {
      const endpoint = `https://apply.workable.com/api/v3/accounts/${c.slug}/jobs`;
      const body = { query: '', location: [], department: [], worktype: [], remote: [] };
      checks.push(() => checkPost(c.ats, c.name, c.slug, endpoint, body));
    }
  }

  for (const c of WORKDAY_COMPANIES) {
    const endpoint = `https://${c.id}.${c.wd}.myworkdayjobs.com/wday/cxs/${c.id}/${c.board}/jobs`;
    const body = { appliedFacets: {}, limit: 1, offset: 0, searchText: 'software engineer' };
    checks.push(() => checkPost('workday', c.displayName, c.id, endpoint, body));
  }

  checks.push(() =>
    checkGet(
      'simplifyjobs',
      'SimplifyJobs New Grad',
      'New-Grad-Positions',
      'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json'
    )
  );
  checks.push(() =>
    checkGet(
      'jobright',
      'JobRight 2026 New Grad',
      '2026-Software-Engineer-New-Grad',
      'https://raw.githubusercontent.com/jobright-ai/2026-Software-Engineer-New-Grad/master/README.md'
    )
  );

  const results = await runWithConcurrency(checks, 10, fn => fn());
  const healthy = results.filter(r => r.status === 'healthy').length;
  const stale = results.filter(r => r.status === 'stale').length;
  const errors = results.filter(r => r.status === 'error').length;

  const staleOrError = results.filter(r => r.status !== 'healthy');
  staleOrError.sort((a, b) => a.ats.localeCompare(b.ats) || a.slug.localeCompare(b.slug));

  console.log(`[ATS Health] total=${results.length} healthy=${healthy} stale=${stale} errors=${errors}`);
  if (staleOrError.length === 0) {
    console.log('[ATS Health] No stale/error endpoints found.');
    return;
  }

  console.log('[ATS Health] Stale/Error endpoints:');
  for (const r of staleOrError) {
    console.log(
      `- [${r.ats}] ${r.name} (${r.slug}) -> ${r.statusCode ?? 'n/a'} ${r.note}`
    );
  }
}

main().catch(err => {
  console.error('[ATS Health] Fatal error:', err?.message || err);
  process.exit(1);
});

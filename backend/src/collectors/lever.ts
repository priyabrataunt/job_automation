import axios from 'axios';
import { Job } from '../db/schema';
import { normalizeLever } from './normalizers';
import companiesData from '../data/companies.json';

const COMPANIES = (companiesData as { slug: string; name: string; ats: string }[])
  .filter(c => c.ats === 'lever')
  .map(c => ({ slug: c.slug, name: c.name }));

async function fetchLever(
  company: { slug: string; name: string },
  cutoff: Date,
  diag: { ok: number; notFound: number; errors: string[]; rawTotal: number },
): Promise<Job[]> {
  try {
    const url = `https://api.lever.co/v0/postings/${company.slug}?mode=json&limit=100`;
    const { data } = await axios.get(url, { timeout: 10000 });
    const jobs: any[] = Array.isArray(data) ? data : [];
    diag.ok++;
    diag.rawTotal += jobs.length;
    return jobs
      .map(j => normalizeLever(j, company, cutoff))
      .filter((j): j is Job => j !== null);
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404) {
      diag.notFound++;
    } else {
      diag.errors.push(`${company.slug}: ${status || err?.code || err?.message || 'unknown'}`);
    }
    return [];
  }
}

export async function collectLever(hoursBack: number): Promise<Job[]> {
  const results: Job[] = [];
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const BATCH = 10;
  const diag = { ok: 0, notFound: 0, errors: [] as string[], rawTotal: 0 };

  for (let i = 0; i < COMPANIES.length; i += BATCH) {
    const batch = COMPANIES.slice(i, i + BATCH);
    const settled = await Promise.allSettled(batch.map(c => fetchLever(c, cutoff, diag)));
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(...r.value);
    }
  }

  console.log(
    `[Lever] companies=${COMPANIES.length} ok=${diag.ok} 404=${diag.notFound} ` +
    `errors=${diag.errors.length} raw=${diag.rawTotal} kept=${results.length}` +
    (diag.errors.length ? ` — first errs: ${diag.errors.slice(0, 3).join('; ')}` : '')
  );

  return results;
}

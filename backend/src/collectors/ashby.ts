import axios from 'axios';
import { Job } from '../db/schema';
import { normalizeAshby } from './normalizers';
import companiesData from '../data/companies.json';

const COMPANIES = (companiesData as { slug: string; name: string; ats: string }[])
  .filter(c => c.ats === 'ashby')
  .map(c => ({ slug: c.slug, name: c.name }));

async function fetchAshby(company: { slug: string; name: string }, cutoff: Date): Promise<Job[]> {
  try {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${company.slug}`;
    const { data } = await axios.get(url, { timeout: 6000 });
    const jobs: any[] = data.jobs || [];
    return jobs
      .map(j => normalizeAshby(j, company, cutoff))
      .filter((j): j is Job => j !== null);
  } catch (err: any) {
    console.warn(`[Ashby] ${company.slug}: ${err?.response?.status ?? err?.message}`);
    return [];
  }
}

export async function collectAshby(hoursBack: number): Promise<Job[]> {
  const results: Job[] = [];
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const BATCH = 10;

  for (let i = 0; i < COMPANIES.length; i += BATCH) {
    const batch = COMPANIES.slice(i, i + BATCH);
    const settled = await Promise.allSettled(batch.map(c => fetchAshby(c, cutoff)));
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(...r.value);
    }
  }

  return results;
}

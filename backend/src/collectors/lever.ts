import axios from 'axios';
import { Job } from '../db/schema';
import { normalizeLever } from './normalizers';
import companiesData from '../data/companies.json';

const COMPANIES = (companiesData as { slug: string; name: string; ats: string }[])
  .filter(c => c.ats === 'lever')
  .map(c => ({ slug: c.slug, name: c.name }));

async function fetchLever(company: { slug: string; name: string }, cutoff: Date): Promise<Job[]> {
  try {
    const url = `https://api.lever.co/v0/postings/${company.slug}?mode=json&limit=100`;
    const { data } = await axios.get(url, { timeout: 6000 });
    const jobs: any[] = Array.isArray(data) ? data : [];
    return jobs
      .map(j => normalizeLever(j, company, cutoff))
      .filter((j): j is Job => j !== null);
  } catch {
    // Most Lever slugs return 404 — silent skip
    return [];
  }
}

export async function collectLever(hoursBack: number): Promise<Job[]> {
  const results: Job[] = [];
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const BATCH = 10;

  for (let i = 0; i < COMPANIES.length; i += BATCH) {
    const batch = COMPANIES.slice(i, i + BATCH);
    const settled = await Promise.allSettled(batch.map(c => fetchLever(c, cutoff)));
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(...r.value);
    }
  }

  return results;
}

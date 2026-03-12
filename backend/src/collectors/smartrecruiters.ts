import axios from 'axios';
import { filterJob } from './filters';
import { Job } from '../db/schema';
import companiesData from '../data/companies.json';

const COMPANIES = (companiesData as { slug: string; name: string; ats: string }[])
  .filter(c => c.ats === 'smartrecruiters')
  .map(c => ({ slug: c.slug, name: c.name }));

async function fetchSmartRecruiters(company: { slug: string; name: string }, cutoff: Date): Promise<Job[]> {
  const results: Job[] = [];
  let offset = 0;
  const limit = 100;
  try {
    while (true) {
      // Don't filter by country — let filterJob handle US/Remote filtering
      const url = `https://api.smartrecruiters.com/v1/companies/${company.slug}/postings?limit=${limit}&offset=${offset}`;
      const { data } = await axios.get(url, { timeout: 8000 });
      const jobs = data.content || [];

      for (const j of jobs) {
        const postedAt = new Date(j.releasedDate);
        if (postedAt < cutoff) continue;

        const loc = j.location?.fullLocation
          || [j.location?.city, j.location?.region, j.location?.country]
            .filter(Boolean)
            .join(', ');

        const filter = filterJob(j.name, loc, '');
        if (!filter) continue;

        results.push({
          external_id: String(j.id || j.uuid),
          title: j.name,
          company: company.name,
          ats_source: 'smartrecruiters',
          location: loc,
          remote: j.location?.remote || filter.remote,
          posted_at: postedAt.toISOString(),
          apply_url: `https://jobs.smartrecruiters.com/${company.slug}/${j.id}`,
          job_type: filter.job_type,
          experience_level: filter.experience_level,
          department: j.department?.label || '',
          description_snippet: '',
          status: 'new',
          raw_json: JSON.stringify(j),
          first_seen_at: new Date().toISOString(),
        });
      }

      // Paginate if there are more results
      if (jobs.length < limit || offset + limit >= (data.totalFound || 0)) break;
      offset += limit;
    }
  } catch (err: any) {
    if (err?.response?.status !== 404) {
      console.warn(`[SmartRecruiters] ${company.slug}: ${err?.response?.status ?? err?.message}`);
    }
  }
  return results;
}

export async function collectSmartRecruiters(hoursBack: number): Promise<Job[]> {
  const results: Job[] = [];
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const BATCH = 10;

  for (let i = 0; i < COMPANIES.length; i += BATCH) {
    const batch = COMPANIES.slice(i, i + BATCH);
    const settled = await Promise.allSettled(batch.map(c => fetchSmartRecruiters(c, cutoff)));
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(...r.value);
    }
  }

  return results;
}

import axios from 'axios';
import { filterJob } from './filters';
import { Job } from '../db/schema';
import companiesData from '../data/companies.json';

const COMPANIES = (companiesData as { slug: string; name: string; ats: string }[])
  .filter(c => c.ats === 'workable')
  .map(c => ({ slug: c.slug, name: c.name }));

async function fetchWorkable(company: { slug: string; name: string }, cutoff: Date): Promise<Job[]> {
  const results: Job[] = [];
  let hasMore = true;
  let token: string | undefined;

  try {
    while (hasMore) {
      // Use v3 POST API — the v1 widget API is deprecated and returns 0 results
      const url = `https://apply.workable.com/api/v3/accounts/${company.slug}/jobs`;
      const body: any = { query: '', location: [], department: [], worktype: [], remote: [] };
      if (token) body.token = token;

      const { data } = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000,
      });
      const jobs = data.results || [];

      for (const j of jobs) {
        const postedAt = j.published ? new Date(j.published) : (j.created_at ? new Date(j.created_at) : new Date());
        if (postedAt < cutoff) continue;

        const location = j.location?.city
          ? [j.location.city, j.location.region, j.location.countryName || j.location.country].filter(Boolean).join(', ')
          : j.location || '';

        const title = j.title || '';
        const filter = filterJob(title, location, '');
        if (!filter) continue;

        const applyUrl = j.url
          || `https://apply.workable.com/${company.slug}/j/${j.shortcode || j.id}/`;

        results.push({
          external_id: String(j.shortcode || j.id),
          title,
          company: company.name,
          ats_source: 'workable',
          location,
          remote: j.remote || filter.remote,
          posted_at: postedAt.toISOString(),
          apply_url: applyUrl,
          job_type: filter.job_type,
          experience_level: filter.experience_level,
          department: j.department || '',
          description_snippet: '',
          status: 'new',
          raw_json: JSON.stringify(j),
          first_seen_at: new Date().toISOString(),
        });
      }

      // Handle pagination via nextPage token
      token = data.nextPage;
      hasMore = !!token && jobs.length > 0;
    }
  } catch (err: any) {
    // Fallback: try v1 widget API for older Workable accounts
    try {
      const url = `https://apply.workable.com/api/v1/widget/accounts/${company.slug}`;
      const { data } = await axios.get(url, { timeout: 8000 });
      const jobs = data.jobs || [];

      for (const j of jobs) {
        if (j.state !== 'published') continue;
        const postedAt = new Date(j.created_at);
        if (postedAt < cutoff) continue;

        const location = j.location || '';
        const filter = filterJob(j.title, location, '');
        if (!filter) continue;

        results.push({
          external_id: String(j.id),
          title: j.title,
          company: company.name,
          ats_source: 'workable',
          location,
          remote: filter.remote,
          posted_at: postedAt.toISOString(),
          apply_url: j.url,
          job_type: filter.job_type,
          experience_level: filter.experience_level,
          department: j.department || '',
          description_snippet: '',
          status: 'new',
          raw_json: JSON.stringify(j),
          first_seen_at: new Date().toISOString(),
        });
      }
    } catch (fallbackErr: any) {
      if (fallbackErr?.response?.status !== 404) {
        console.warn(`[Workable] ${company.slug}: ${fallbackErr?.response?.status ?? fallbackErr?.message}`);
      }
    }
  }
  return results;
}

export async function collectWorkable(hoursBack: number): Promise<Job[]> {
  const results: Job[] = [];
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const BATCH = 10;

  for (let i = 0; i < COMPANIES.length; i += BATCH) {
    const batch = COMPANIES.slice(i, i + BATCH);
    const settled = await Promise.allSettled(batch.map(c => fetchWorkable(c, cutoff)));
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(...r.value);
    }
  }

  return results;
}

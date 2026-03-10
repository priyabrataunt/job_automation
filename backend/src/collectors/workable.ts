import axios from 'axios';
import { filterJob } from './filters';
import { Job } from '../db/schema';

const COMPANIES: { slug: string; name: string }[] = [
  { slug: 'figma', name: 'Figma' },
  { slug: 'airtable', name: 'Airtable' },
  { slug: 'notion', name: 'Notion' },
  { slug: 'linear', name: 'Linear' },
  { slug: 'vercel', name: 'Vercel' },
  { slug: 'tailscale', name: 'Tailscale' },
  { slug: 'planetscale', name: 'PlanetScale' },
  { slug: 'dbt-labs', name: 'dbt Labs' },
  { slug: 'airbyte', name: 'Airbyte' },
  { slug: 'dagster', name: 'Dagster' },
  { slug: 'prefect', name: 'Prefect' },
  { slug: 'supabase', name: 'Supabase' },
  { slug: 'neon', name: 'Neon' },
  { slug: 'fly-io', name: 'Fly.io' },
  { slug: 'warp', name: 'Warp' },
  { slug: 'raycast', name: 'Raycast' },
  { slug: 'codeium', name: 'Codeium' },
  { slug: 'sourcegraph', name: 'Sourcegraph' },
  { slug: 'gitpod', name: 'Gitpod' },
  { slug: 'render', name: 'Render' },
  { slug: 'railway', name: 'Railway' },
];

async function fetchWorkable(company: { slug: string; name: string }, cutoff: Date): Promise<Job[]> {
  const results: Job[] = [];
  try {
    const url = `https://apply.workable.com/api/v1/widget/accounts/${company.slug}`;
    const { data } = await axios.get(url, { timeout: 6000 });
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
  } catch {
    // Skip companies that don't use Workable or have errors
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

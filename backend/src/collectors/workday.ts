import axios from 'axios';
import { filterJob } from './filters';
import { Job } from '../db/schema';

interface WorkdayCompany {
  id: string;
  wd: string;   // wd1, wd2, wd3, wd5
  board: string;
  displayName: string;
}

// Board URLs — format: https://{id}.{wd}.myworkdayjobs.com/wday/cxs/{id}/{board}/jobs
// Failures are handled gracefully; invalid entries just return 0 jobs.
// Only verified-working Workday configs (others moved to SmartRecruiters)
export const COMPANIES: WorkdayCompany[] = [
  { id: 'nvidia', wd: 'wd5', board: 'NVIDIAExternalCareerSite', displayName: 'NVIDIA' },
  { id: 'adobe', wd: 'wd5', board: 'external_experienced', displayName: 'Adobe' },
  { id: 'crowdstrike', wd: 'wd5', board: 'crowdstrikecareers', displayName: 'CrowdStrike' },
  { id: 'intel', wd: 'wd1', board: 'External', displayName: 'Intel' },
  { id: 'mastercard', wd: 'wd1', board: 'CorporateCareers', displayName: 'Mastercard' },
  { id: 'hp', wd: 'wd5', board: 'ExternalCareerSite', displayName: 'HP' },
  { id: 'dell', wd: 'wd1', board: 'External', displayName: 'Dell' },
];

// Parse Workday's human-readable postedOn: "Posted Today", "Posted Yesterday", "Posted 6 Days Ago"
function parseWorkdayPostedOn(postedOn: string | undefined): Date | null {
  if (!postedOn) return null;
  const s = postedOn.toLowerCase();
  if (s.includes('today')) return new Date();
  if (s.includes('yesterday')) return new Date(Date.now() - 86400000);
  const m = s.match(/posted\s+(\d+)\s+day/);
  if (m) return new Date(Date.now() - parseInt(m[1]) * 86400000);
  // Try direct ISO parse as fallback
  const d = new Date(postedOn);
  return isNaN(d.getTime()) ? null : d;
}

async function tryWorkdayFetch(company: WorkdayCompany): Promise<any[]> {
  const url = `https://${company.id}.${company.wd}.myworkdayjobs.com/wday/cxs/${company.id}/${company.board}/jobs`;
  const { data } = await axios.post(
    url,
    { appliedFacets: {}, limit: 20, offset: 0, searchText: 'software engineer' },
    { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
  );
  return data.jobPostings || [];
}

async function fetchWorkday(company: WorkdayCompany, cutoff: Date): Promise<Job[]> {
  const results: Job[] = [];
  try {
    const jobs = await tryWorkdayFetch(company);

    for (const j of jobs) {
      const postedAt = parseWorkdayPostedOn(j.postedOn) ?? new Date();
      if (postedAt < cutoff) continue;

      const location = j.locationsText || j.primaryLocation || '';
      const title = j.title || j.jobTitle || '';

      const filter = filterJob(title, location, '');
      if (!filter) continue;

      const externalId = j.externalPath || j.title + '_' + company.id;

      results.push({
        external_id: String(externalId),
        title,
        company: company.displayName,
        ats_source: 'workday',
        location,
        remote: filter.remote,
        posted_at: postedAt.toISOString(),
        apply_url: j.externalPath
          ? `https://${company.id}.${company.wd}.myworkdayjobs.com/en-US/${company.board}${j.externalPath}`
          : `https://${company.id}.${company.wd}.myworkdayjobs.com/en-US/${company.board}`,
        job_type: filter.job_type,
        experience_level: filter.experience_level,
        department: '',
        description_snippet: '',
        status: 'new',
        raw_json: JSON.stringify(j),
        first_seen_at: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    console.warn(`[Workday] ${company.id}: ${err?.response?.status ?? err?.message}`);
  }
  return results;
}

export async function collectWorkday(hoursBack: number): Promise<Job[]> {
  const results: Job[] = [];
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const BATCH = 8;

  for (let i = 0; i < COMPANIES.length; i += BATCH) {
    const batch = COMPANIES.slice(i, i + BATCH);
    const settled = await Promise.allSettled(batch.map(c => fetchWorkday(c, cutoff)));
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(...r.value);
    }
  }

  return results;
}

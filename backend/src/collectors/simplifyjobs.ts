import axios from 'axios';
import { filterJob, isUSOrRemote } from './filters';
import { Job } from '../db/schema';

// SimplifyJobs curated listings from GitHub
const SOURCES = [
  {
    url: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json',
    label: 'Summer2026-Internships',
    defaultJobType: 'internship' as const,
  },
  {
    url: 'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json',
    label: 'New-Grad-Positions',
    defaultJobType: 'fulltime' as const,
  },
];

interface SimplifyListing {
  id: string;
  url: string;
  title: string;
  company_name: string;
  company_url?: string;
  locations: string[];
  active: boolean;
  is_visible: boolean;
  date_posted: number;   // unix seconds
  date_updated: number;
  terms?: string[];
  sponsorship?: string;
  source?: string;
}

function normalizeSimplifyJob(
  listing: SimplifyListing,
  cutoff: Date,
  defaultJobType: 'fulltime' | 'internship',
): Job | null {
  if (!listing.active || !listing.is_visible) return null;

  const postedAt = new Date(listing.date_posted * 1000);
  if (isNaN(postedAt.getTime()) || postedAt < cutoff) return null;

  const title = listing.title || '';
  if (!title) return null;

  // Combine all locations into one string for filtering
  const location = (listing.locations || []).join(', ');

  const filter = filterJob(title, location, '');

  // SimplifyJobs entries are already curated for entry-level/intern roles,
  // so allow them even if our title filter is too strict.
  const jobType = filter?.job_type ?? defaultJobType;
  const experienceLevel = filter?.experience_level ?? (defaultJobType === 'internship' ? 'internship' : 'entry');
  const remote = filter?.remote ?? /remote/i.test(location);

  // Still skip non-US locations (our filter handles this)
  if (filter === null) {
    // If filterJob rejected it, check if it was only because of title keywords.
    // SimplifyJobs data is pre-curated, so we relax the title check but keep location filter.
    if (!isUSOrRemote(location)) return null;
  }

  return {
    external_id: `simplify_${listing.id}`,
    title,
    company: listing.company_name || 'Unknown',
    ats_source: 'simplifyjobs',
    location,
    remote,
    posted_at: postedAt.toISOString(),
    apply_url: listing.url || '',
    job_type: jobType,
    experience_level: experienceLevel,
    department: '',
    description_snippet: listing.terms?.join(', ') || '',
    status: 'new',
    raw_json: JSON.stringify(listing),
    first_seen_at: new Date().toISOString(),
  };
}

async function fetchSource(
  source: typeof SOURCES[number],
  cutoff: Date,
): Promise<Job[]> {
  try {
    const { data } = await axios.get<SimplifyListing[]>(source.url, { timeout: 20000 });
    if (!Array.isArray(data)) return [];

    const jobs: Job[] = [];
    for (const listing of data) {
      const job = normalizeSimplifyJob(listing, cutoff, source.defaultJobType);
      if (job) jobs.push(job);
    }
    return jobs;
  } catch (err: any) {
    console.warn(`[SimplifyJobs] ${source.label}: ${err?.message}`);
    return [];
  }
}

export async function collectSimplifyJobs(hoursBack: number): Promise<Job[]> {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const results = await Promise.allSettled(SOURCES.map(s => fetchSource(s, cutoff)));

  const allJobs: Job[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') allJobs.push(...r.value);
  }
  return allJobs;
}

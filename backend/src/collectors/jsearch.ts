import axios from 'axios';
import { filterJob, isUSOrRemote } from './filters';
import { Job } from '../db/schema';

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';
const JSEARCH_HOST = 'jsearch.p.rapidapi.com';

const SEARCH_QUERIES = [
  'software engineer entry level',
  'software developer intern',
  'software engineer new grad',
];

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name: string;
  employer_website?: string;
  job_apply_link: string;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_is_remote?: boolean;
  job_description?: string;
  job_posted_at_datetime_utc?: string;
  job_employment_type?: string;
  job_highlights?: {
    Qualifications?: string[];
    Responsibilities?: string[];
  };
}

interface JSearchResponse {
  status: string;
  data: JSearchJob[];
}

function buildLocation(job: JSearchJob): string {
  const parts: string[] = [];
  if (job.job_city) parts.push(job.job_city);
  if (job.job_state) parts.push(job.job_state);
  if (job.job_country) parts.push(job.job_country);
  if (job.job_is_remote) parts.push('Remote');
  return parts.join(', ') || '';
}

function normalizeJSearchJob(job: JSearchJob, cutoff: Date): Job | null {
  const postedAt = job.job_posted_at_datetime_utc
    ? new Date(job.job_posted_at_datetime_utc)
    : null;

  if (!postedAt || isNaN(postedAt.getTime()) || postedAt < cutoff) return null;

  const title = job.job_title || '';
  if (!title) return null;

  const location = buildLocation(job);
  const description = job.job_description || '';

  // Use the shared filter — checks title relevance, seniority, and US location
  const filter = filterJob(title, location, description);
  if (!filter) return null;

  const snippet = description.substring(0, 500);

  return {
    external_id: `jsearch_${job.job_id}`,
    title,
    company: job.employer_name || 'Unknown',
    ats_source: 'jsearch',
    location,
    remote: filter.remote || !!job.job_is_remote,
    posted_at: postedAt.toISOString(),
    apply_url: job.job_apply_link || '',
    job_type: filter.job_type,
    experience_level: filter.experience_level,
    department: '',
    description_snippet: snippet,
    status: 'new',
    raw_json: JSON.stringify(job),
    first_seen_at: new Date().toISOString(),
  };
}

async function searchJobs(query: string, cutoff: Date): Promise<Job[]> {
  try {
    const { data } = await axios.get<JSearchResponse>(
      `https://${JSEARCH_HOST}/search`,
      {
        params: {
          query,
          country: 'US',
          date_posted: 'today',
          num_pages: 1,
        },
        headers: {
          'x-rapidapi-key': RAPIDAPI_KEY,
          'x-rapidapi-host': JSEARCH_HOST,
        },
        timeout: 15000,
      },
    );

    if (!data?.data || !Array.isArray(data.data)) return [];

    const jobs: Job[] = [];
    for (const item of data.data) {
      const job = normalizeJSearchJob(item, cutoff);
      if (job) jobs.push(job);
    }
    return jobs;
  } catch (err: any) {
    console.warn(`[JSearch] Query "${query}": ${err?.response?.status ?? err?.message}`);
    return [];
  }
}

export async function collectJSearch(hoursBack: number): Promise<Job[]> {
  if (!RAPIDAPI_KEY) {
    console.warn('[JSearch] Skipping — RAPIDAPI_KEY not set');
    return [];
  }

  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const seen = new Set<string>();
  const allJobs: Job[] = [];

  // Run queries sequentially to respect rate limits
  for (const query of SEARCH_QUERIES) {
    const jobs = await searchJobs(query, cutoff);
    for (const job of jobs) {
      if (!seen.has(job.external_id)) {
        seen.add(job.external_id);
        allJobs.push(job);
      }
    }
  }

  return allJobs;
}

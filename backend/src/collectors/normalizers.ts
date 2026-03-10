/**
 * ATS Normalizers
 *
 * Each function takes a raw API response object from a specific ATS and maps it
 * into the unified Job schema. Returns null if the job should be skipped
 * (wrong date range, filtered out, missing required fields).
 */

import { filterJob } from './filters';
import { Job } from '../db/schema';

type CompanyEntry = { slug: string; name: string };

// ── Greenhouse ──────────────────────────────────────────────────────────────
// API: GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
// Key fields: id, title, updated_at, offices[].name, location.name,
//             absolute_url, departments[].name, content (HTML)
export function normalizeGreenhouse(j: any, company: CompanyEntry, cutoff: Date): Job | null {
  const postedAt = new Date(j.updated_at);
  if (isNaN(postedAt.getTime()) || postedAt < cutoff) return null;

  const title: string = j.title || '';
  if (!title) return null;

  const location: string =
    j.offices?.length > 0
      ? j.offices.map((o: any) => o.name).join(', ')
      : j.location?.name || '';

  const snippet: string = j.content
    ? j.content.replace(/<[^>]+>/g, '').slice(0, 600)
    : '';

  const filter = filterJob(title, location, snippet);
  if (!filter) return null;

  return {
    external_id: String(j.id),
    title,
    company: company.name,
    ats_source: 'greenhouse',
    location,
    remote: filter.remote,
    posted_at: postedAt.toISOString(),
    apply_url: j.absolute_url || `https://boards.greenhouse.io/${company.slug}/jobs/${j.id}`,
    job_type: filter.job_type,
    experience_level: filter.experience_level,
    department: j.departments?.[0]?.name || '',
    description_snippet: snippet,
    status: 'new',
    raw_json: JSON.stringify(j),
    first_seen_at: new Date().toISOString(),
  };
}

// ── Ashby ───────────────────────────────────────────────────────────────────
// API: GET https://api.ashbyhq.com/posting-api/job-board/{slug}
// Key fields: id, title, publishedAt (ISO string), location, applyUrl,
//             department, team, descriptionPlain
export function normalizeAshby(j: any, company: CompanyEntry, cutoff: Date): Job | null {
  if (!j.publishedAt) return null;
  const postedAt = new Date(j.publishedAt);
  if (isNaN(postedAt.getTime()) || postedAt < cutoff) return null;

  const title: string = j.title || '';
  if (!title) return null;

  const location: string = j.location || '';
  const snippet: string = (j.descriptionPlain || '').replace(/<[^>]+>/g, '').slice(0, 600);

  const filter = filterJob(title, location, snippet);
  if (!filter) return null;

  return {
    external_id: String(j.id),
    title,
    company: company.name,
    ats_source: 'ashby',
    location,
    remote: filter.remote,
    posted_at: postedAt.toISOString(),
    apply_url: j.applyUrl || `https://jobs.ashbyhq.com/${company.slug}/${j.id}`,
    job_type: filter.job_type,
    experience_level: filter.experience_level,
    department: j.department || j.team || '',
    description_snippet: snippet,
    status: 'new',
    raw_json: JSON.stringify(j),
    first_seen_at: new Date().toISOString(),
  };
}

// ── Lever ───────────────────────────────────────────────────────────────────
// API: GET https://api.lever.co/v0/postings/{slug}?mode=json&limit=100
// Key fields: id, text (title), createdAt (Unix ms), categories.location,
//             categories.allLocations[], hostedUrl, categories.department,
//             categories.team, lists[].content (HTML), descriptionPlain
export function normalizeLever(j: any, company: CompanyEntry, cutoff: Date): Job | null {
  // createdAt is a Unix timestamp in milliseconds
  const postedAt = new Date(j.createdAt);
  if (isNaN(postedAt.getTime()) || postedAt < cutoff) return null;

  const title: string = j.text || '';
  if (!title) return null;

  const location: string =
    j.categories?.location ||
    j.categories?.allLocations?.[0] ||
    '';

  const snippet: string = j.lists
    ? j.lists.map((l: any) => l.content || '').join(' ').replace(/<[^>]+>/g, '').slice(0, 600)
    : (j.descriptionPlain || '').slice(0, 600);

  const filter = filterJob(title, location, snippet);
  if (!filter) return null;

  return {
    external_id: String(j.id),
    title,
    company: company.name,
    ats_source: 'lever',
    location,
    remote: filter.remote,
    posted_at: postedAt.toISOString(),
    apply_url: j.hostedUrl || `https://jobs.lever.co/${company.slug}/${j.id}`,
    job_type: filter.job_type,
    experience_level: filter.experience_level,
    department: j.categories?.department || j.categories?.team || '',
    description_snippet: snippet,
    status: 'new',
    raw_json: JSON.stringify(j),
    first_seen_at: new Date().toISOString(),
  };
}

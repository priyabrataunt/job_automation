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
export const COMPANIES: WorkdayCompany[] = [
  // ── Big Tech ──────────────────────────────────────────────────────────
  { id: 'nvidia', wd: 'wd5', board: 'NVIDIAExternalCareerSite', displayName: 'NVIDIA' },
  { id: 'adobe', wd: 'wd5', board: 'external_experienced', displayName: 'Adobe' },
  { id: 'salesforce', wd: 'wd12', board: 'External', displayName: 'Salesforce' },
  { id: 'servicenow', wd: 'wd1', board: 'Careers', displayName: 'ServiceNow' },
  { id: 'intuit', wd: 'wd5', board: 'Intuit', displayName: 'Intuit' },
  { id: 'netflix', wd: 'wd5', board: 'External', displayName: 'Netflix' },
  { id: 'oracle', wd: 'wd1', board: 'Careers', displayName: 'Oracle' },
  { id: 'uber', wd: 'wd5', board: 'Uber', displayName: 'Uber' },

  // ── Cybersecurity / Infra ─────────────────────────────────────────────
  { id: 'crowdstrike', wd: 'wd5', board: 'crowdstrikecareers', displayName: 'CrowdStrike' },
  { id: 'paloaltonetworks', wd: 'wd5', board: 'Careers', displayName: 'Palo Alto Networks' },
  { id: 'fortinet', wd: 'wd5', board: 'FTNTExternalCareerSite', displayName: 'Fortinet' },
  { id: 'zscaler', wd: 'wd5', board: 'Careers', displayName: 'Zscaler' },

  // ── Semiconductors ────────────────────────────────────────────────────
  { id: 'qualcomm', wd: 'wd5', board: 'External', displayName: 'Qualcomm' },
  { id: 'intel', wd: 'wd1', board: 'External', displayName: 'Intel' },
  { id: 'amd', wd: 'wd1', board: 'AMD', displayName: 'AMD' },
  { id: 'broadcom', wd: 'wd1', board: 'External', displayName: 'Broadcom' },

  // ── Finance / Fintech ─────────────────────────────────────────────────
  { id: 'capitalone', wd: 'wd1', board: 'Capital_One', displayName: 'Capital One' },
  { id: 'visa', wd: 'wd5', board: 'ExternalSite', displayName: 'Visa' },
  { id: 'mastercard', wd: 'wd1', board: 'CorporateCareers', displayName: 'Mastercard' },
  { id: 'goldmansachs', wd: 'wd1', board: 'GS_Careers', displayName: 'Goldman Sachs' },
  { id: 'morganstanley', wd: 'wd5', board: 'morganstanley', displayName: 'Morgan Stanley' },
  { id: 'jpmc', wd: 'wd3', board: 'JPMCCampus', displayName: 'JPMorgan Chase' },

  // ── Defense / Aerospace ───────────────────────────────────────────────
  { id: 'lockheedmartin', wd: 'wd5', board: 'LMCAREER', displayName: 'Lockheed Martin' },
  { id: 'northropgrumman', wd: 'wd5', board: 'ExternalSite', displayName: 'Northrop Grumman' },
  { id: 'rtx', wd: 'wd1', board: 'RTX_Careers', displayName: 'RTX (Raytheon)' },
  { id: 'generaldynamics', wd: 'wd5', board: 'ExternalCareerSite', displayName: 'General Dynamics' },
  { id: 'boeing', wd: 'wd1', board: 'EXTERNAL', displayName: 'Boeing' },
  { id: 'lmco', wd: 'wd5', board: 'SpaceCareerSite', displayName: 'Lockheed Space' },

  // ── Enterprise / Consulting ───────────────────────────────────────────
  { id: 'deloitteus', wd: 'wd5', board: 'AutoDeloitteUS', displayName: 'Deloitte' },
  { id: 'accenture', wd: 'wd3', board: 'AccentureCareers', displayName: 'Accenture' },
  { id: 'ibm', wd: 'wd1', board: 'External', displayName: 'IBM' },
  { id: 'cisco', wd: 'wd5', board: 'External', displayName: 'Cisco' },

  // ── Hardware / Consumer ───────────────────────────────────────────────
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

import axios from 'axios';
import { filterJob } from './filters';
import { Job } from '../db/schema';

const JOBRIGHT_README_URL =
  'https://raw.githubusercontent.com/jobright-ai/2026-Software-Engineer-New-Grad/master/README.md';

interface ParsedMarkdownLink {
  text: string;
  url: string;
}

function stripMarkdown(cell: string): string {
  return cell
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}

function parseMarkdownLink(cell: string): ParsedMarkdownLink | null {
  const match = cell.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
  if (!match) return null;
  return {
    text: stripMarkdown(match[1] || ''),
    url: (match[2] || '').trim(),
  };
}

function parsePostedAt(rawDate: string): Date | null {
  const cleaned = stripMarkdown(rawDate);
  const now = new Date();
  const parsed = new Date(`${cleaned} ${now.getFullYear()} 23:59:59`);
  if (Number.isNaN(parsed.getTime())) return null;

  // Handles year rollover where Jan listings may be parsed into next year.
  if (parsed.getTime() - now.getTime() > 36 * 60 * 60 * 1000) {
    parsed.setFullYear(parsed.getFullYear() - 1);
  }
  return parsed;
}

function fallbackExternalId(company: string, title: string, location: string, postedAtIso: string): string {
  const slug = `${company}_${title}_${location}_${postedAtIso.slice(0, 10)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return `jobright_${slug || Date.now()}`;
}

export async function collectJobRight(hoursBack: number): Promise<Job[]> {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const nowIso = new Date().toISOString();

  try {
    const { data } = await axios.get<string>(JOBRIGHT_README_URL, { timeout: 20000 });
    const lines = data.split('\n');
    const jobs: Job[] = [];
    let lastCompany = '';

    for (const line of lines) {
      if (!line.startsWith('|')) continue;
      if (line.includes('| ----- |')) continue;
      if (line.toLowerCase().includes('| company | job title |')) continue;

      const columns = line
        .split('|')
        .slice(1, -1)
        .map(part => part.trim());

      if (columns.length < 5) continue;

      const companyCell = columns[0] || '';
      const titleCell = columns[1] || '';
      const location = stripMarkdown(columns[2] || '');
      const workModel = stripMarkdown(columns[3] || '');
      const postedAt = parsePostedAt(columns[4] || '');

      if (!postedAt || postedAt < cutoff) continue;

      const companyLink = parseMarkdownLink(companyCell);
      const rawCompany = stripMarkdown(companyCell);
      const company =
        rawCompany === '↳'
          ? lastCompany
          : companyLink?.text || rawCompany;

      if (rawCompany !== '↳' && company) lastCompany = company;
      if (!company) continue;

      const titleLink = parseMarkdownLink(titleCell);
      const title = titleLink?.text || stripMarkdown(titleCell);
      const applyUrl = titleLink?.url || '';
      if (!title || !applyUrl) continue;

      const filter = filterJob(title, location, workModel);
      if (!filter) continue;

      const externalIdMatch = applyUrl.match(/\/info\/([a-zA-Z0-9]+)/);
      const postedAtIso = postedAt.toISOString();
      const externalId = externalIdMatch
        ? `jobright_${externalIdMatch[1]}`
        : fallbackExternalId(company, title, location, postedAtIso);

      jobs.push({
        external_id: externalId,
        title,
        company,
        ats_source: 'jobright',
        location,
        remote: filter.remote,
        posted_at: postedAtIso,
        apply_url: applyUrl,
        job_type: filter.job_type,
        experience_level: filter.experience_level,
        department: '',
        description_snippet: `Work Model: ${workModel}`,
        status: 'new',
        raw_json: JSON.stringify({
          company,
          title,
          location,
          work_model: workModel,
          posted_date: columns[4] || '',
          apply_url: applyUrl,
          source_url: JOBRIGHT_README_URL,
        }),
        first_seen_at: nowIso,
      });
    }

    return jobs;
  } catch (err: any) {
    console.warn(`[JobRight] ${err?.message}`);
    return [];
  }
}

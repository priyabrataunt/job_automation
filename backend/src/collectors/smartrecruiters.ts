import axios from 'axios';
import { filterJob } from './filters';
import { Job } from '../db/schema';

const COMPANIES: { slug: string; name: string }[] = [
  { slug: 'spotify', name: 'Spotify' },
  { slug: 'klarna', name: 'Klarna' },
  { slug: 'booking', name: 'Booking.com' },
  { slug: 'docusign', name: 'DocuSign' },
  { slug: 'zendesk', name: 'Zendesk' },
  { slug: 'indeed', name: 'Indeed' },
  { slug: 'lyft', name: 'Lyft' },
  { slug: 'dropbox', name: 'Dropbox' },
  { slug: 'pandadoc', name: 'PandaDoc' },
  { slug: 'gitlab', name: 'GitLab' },
  { slug: 'twilio', name: 'Twilio' },
  { slug: 'sendgrid', name: 'SendGrid' },
  { slug: 'brex', name: 'Brex' },
  { slug: 'lattice', name: 'Lattice' },
  { slug: 'retool', name: 'Retool' },
  { slug: 'gusto', name: 'Gusto' },
  { slug: 'carta', name: 'Carta' },
  { slug: 'chime', name: 'Chime' },
  { slug: 'rippling', name: 'Rippling' },
  { slug: 'deel', name: 'Deel' },
  { slug: 'remote', name: 'Remote' },
  { slug: 'adyen', name: 'Adyen' },
  { slug: 'contentful', name: 'Contentful' },
  { slug: 'personio', name: 'Personio' },
];

async function fetchSmartRecruiters(company: { slug: string; name: string }, cutoff: Date): Promise<Job[]> {
  const results: Job[] = [];
  try {
    const url = `https://api.smartrecruiters.com/v1/companies/${company.slug}/postings?limit=100&country=USA`;
    const { data } = await axios.get(url, { timeout: 6000 });
    const jobs = data.content || [];

    for (const j of jobs) {
      const postedAt = new Date(j.releasedDate);
      if (postedAt < cutoff) continue;

      const location = [j.location?.city, j.location?.region, j.location?.country]
        .filter(Boolean)
        .join(', ');

      const filter = filterJob(j.name, location, '');
      if (!filter) continue;

      results.push({
        external_id: String(j.id),
        title: j.name,
        company: company.name,
        ats_source: 'smartrecruiters',
        location,
        remote: filter.remote,
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
  } catch {
    // Skip companies that don't use SmartRecruiters or have errors
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

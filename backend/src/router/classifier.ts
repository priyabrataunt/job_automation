const BULK_HOSTS = new Set(['boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com']);
const ASSISTED_HOSTS = ['simplify.jobs', 'linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com'];

export function classifyUrl(url: string): 'bulk' | 'assisted' {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (BULK_HOSTS.has(host)) return 'bulk';
    if (ASSISTED_HOSTS.some(h => host === h || host.endsWith('.' + h))) return 'assisted';
    return 'bulk';
  } catch {
    return 'bulk';
  }
}

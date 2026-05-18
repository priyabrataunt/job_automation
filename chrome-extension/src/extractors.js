// ── Page Extraction: extract structured job data from the current page ────────

const JOB_EXTRACTORS = {
  'linkedin.com': {
    title: () => {
      const el = document.querySelector('.job-details-jobs-unified-top-card__job-title h1, .top-card-layout__title, .jobs-unified-top-card__job-title');
      return el?.textContent?.trim() || '';
    },
    company: () => {
      const el = document.querySelector('.job-details-jobs-unified-top-card__company-name a, .topcard__org-name-link, .jobs-unified-top-card__company-name a');
      return el?.textContent?.trim() || '';
    },
    location: () => {
      const el = document.querySelector('.job-details-jobs-unified-top-card__bullet, .topcard__flavor--bullet, .jobs-unified-top-card__bullet');
      return el?.textContent?.trim() || '';
    },
    jobType: () => {
      const items = document.querySelectorAll('.job-details-jobs-unified-top-card__job-insight span, .description__job-criteria-text');
      for (const item of items) {
        const text = (item.textContent || '').toLowerCase();
        if (text.includes('full-time')) return 'fulltime';
        if (text.includes('internship')) return 'internship';
        if (text.includes('contract')) return 'contract';
        if (text.includes('part-time')) return 'parttime';
      }
      return '';
    },
    description: () => {
      const el = document.querySelector('.jobs-description__content, .show-more-less-html__markup, .description__text');
      return el?.textContent?.trim()?.slice(0, 2000) || '';
    },
  },

  'jobright.ai': {
    title: () => document.querySelector('h1, [class*="job-title"], [data-testid="job-title"]')?.textContent?.trim() || '',
    company: () => document.querySelector('[class*="company-name"], [data-testid="company-name"], h2')?.textContent?.trim() || '',
    location: () => document.querySelector('[class*="location"], [data-testid="location"]')?.textContent?.trim() || '',
    jobType: () => '',
    description: () => document.querySelector('[class*="job-description"], [class*="description"]')?.textContent?.trim()?.slice(0, 2000) || '',
  },

  'joinhandshake.com': {
    title: () => document.querySelector('[data-hook="job-title"], h1')?.textContent?.trim() || '',
    company: () => document.querySelector('[data-hook="employer-name"], [class*="employer-name"]')?.textContent?.trim() || '',
    location: () => document.querySelector('[data-hook="job-location"], [class*="location"]')?.textContent?.trim() || '',
    jobType: () => {
      const el = document.querySelector('[data-hook="job-employment-type"], [class*="employment-type"]');
      const text = (el?.textContent || '').toLowerCase();
      if (text.includes('full')) return 'fulltime';
      if (text.includes('intern')) return 'internship';
      return '';
    },
    description: () => document.querySelector('[data-hook="job-description"], [class*="job-description"]')?.textContent?.trim()?.slice(0, 2000) || '',
  },
};

function extractGenericJobData() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      let data = JSON.parse(script.textContent || '');
      if (Array.isArray(data)) data = data[0];
      if (data['@graph']) data = data['@graph'].find(item => item['@type'] === 'JobPosting') || data;
      if (data['@type'] === 'JobPosting') {
        return {
          title: data.title || '',
          company: typeof data.hiringOrganization === 'string'
            ? data.hiringOrganization
            : data.hiringOrganization?.name || '',
          location: typeof data.jobLocation === 'string'
            ? data.jobLocation
            : data.jobLocation?.address?.addressLocality || data.jobLocation?.name || '',
          jobType: (data.employmentType || '').toLowerCase().includes('full') ? 'fulltime'
            : (data.employmentType || '').toLowerCase().includes('intern') ? 'internship' : '',
          description: (data.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000),
          source: 'ld+json',
        };
      }
    } catch { /* ignore malformed JSON-LD */ }
  }

  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || '';
  const h1 = document.querySelector('h1')?.textContent?.trim() || '';

  return {
    title: ogTitle || h1 || document.title || '',
    company: ogSiteName || '',
    location: '',
    jobType: '',
    description: '',
    source: ogTitle ? 'og-meta' : 'fallback',
  };
}

function extractJobFromCurrentPage() {
  const hostname = window.location.hostname.toLowerCase();

  let extractor = null;
  for (const [domain, ext] of Object.entries(JOB_EXTRACTORS)) {
    if (hostname.includes(domain)) {
      extractor = ext;
      break;
    }
  }

  if (extractor) {
    return {
      title: extractor.title(),
      company: extractor.company(),
      location: extractor.location(),
      jobType: extractor.jobType(),
      description: extractor.description(),
      url: window.location.href,
      source: hostname,
    };
  }

  const generic = extractGenericJobData();
  return {
    ...generic,
    url: window.location.href,
  };
}

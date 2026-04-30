// Computer-science role keywords. The filter looks for these as substrings of
// the title (case-insensitive), so partial phrases like "software engineer"
// will match "Senior Software Engineer - Backend" etc.
const TITLE_KEYWORDS = [
  // SWE — generic
  'software engineer', 'software developer', 'software development engineer',
  'sde', 'swe',
  // SWE — by stack
  'backend engineer', 'backend developer', 'back-end engineer', 'back end engineer',
  'frontend engineer', 'frontend developer', 'front-end engineer', 'front end engineer',
  'full stack', 'fullstack', 'full-stack',
  'mobile engineer', 'mobile developer', 'ios engineer', 'android engineer',
  'web engineer', 'web developer',
  'application engineer', 'applications engineer',
  // AI / ML / Data
  'ai engineer', 'ml engineer', 'machine learning engineer',
  'applied scientist', 'research engineer', 'research scientist',
  'machine learning scientist', 'data scientist',
  'data engineer', 'analytics engineer', 'mlops',
  // Platform / Infra / DevOps / SRE
  'platform engineer', 'infrastructure engineer', 'cloud engineer',
  'devops engineer', 'site reliability', 'sre',
  'tooling engineer', 'developer tools', 'developer experience', 'devex',
  'build engineer', 'release engineer',
  // Systems / Embedded / Compiler
  'systems engineer', 'system engineer', 'embedded engineer', 'firmware engineer',
  'compiler engineer', 'kernel engineer', 'distributed systems',
  'performance engineer', 'database engineer',
  // Security / Networking
  'security engineer', 'security software engineer', 'application security',
  'product security', 'network engineer',
  // QA / Test
  'qa engineer', 'quality engineer', 'test engineer', 'sdet',
  // New-grad / level signals (intern/coop alone is NOT enough — see below)
  'new grad', 'new graduate',
  'engineer i', 'engineer ii', 'engineer 1', 'engineer 2', 'associate engineer',
  'junior engineer', 'junior developer', 'entry level engineer',
];

// Used only when the title contains "intern" / "co-op". A bare "Intern" title
// is not enough — it also has to mention a CS domain word, otherwise things
// like "Materials Characterization Intern" or "NDT Technician Co-op" leak in.
const CS_DOMAIN_KEYWORDS = [
  'software', 'computer', 'coding', 'programming', 'algorithm',
  'backend', 'back-end', 'back end', 'frontend', 'front-end', 'front end',
  'full stack', 'fullstack', 'full-stack',
  'web', 'mobile', 'ios', 'android',
  'data', 'analytics', 'machine learning', ' ml ', ' ai ', ' ai/', '/ai',
  'artificial intelligence', 'deep learning', 'nlp', 'computer vision',
  'devops', 'sre', 'site reliability', 'platform', 'infrastructure', 'cloud',
  'systems', 'embedded', 'firmware', 'compiler', 'kernel', 'distributed',
  'security', 'cyber', 'network engineer', 'database',
  'qa', 'sdet', 'test automation',
  'developer', 'engineering', 'engineer',
  'sde', 'swe', 'tech', 'it ',
];

// Non-CS roles that frequently slip through because they contain "engineer"
// or "developer". Reject before TITLE_KEYWORDS evaluation.
const NON_CS_TITLE_BLOCKLIST = [
  'sales engineer', 'solutions engineer', 'solution engineer',
  'customer engineer', 'support engineer', 'field engineer',
  'forward deployed engineer', 'implementation engineer',
  'business development', 'developer relations', 'developer advocate',
  'mechanical engineer', 'electrical engineer', 'hardware engineer',
  'civil engineer', 'chemical engineer', 'biomedical', 'optical engineer',
  'manufacturing engineer', 'process engineer', 'industrial engineer',
  'rf engineer', 'antenna engineer',
];

const ENTRY_LEVEL_KEYWORDS = [
  'entry level', 'entry-level', 'junior', 'new grad', 'new graduate',
  '0-2 years', '0 to 2 years', '1-2 years', '1 to 2 years',
  'associate', 'intern', 'internship', 'co-op', 'coop',
  'recent graduate', 'early career', 'early-career', 'graduate engineer',
];

const EXCLUDE_SENIORITY = [
  'senior', 'sr.', ' sr ', 'lead', 'principal', 'staff', 'manager',
  'director', 'architect', 'head of', 'vp ', 'vice president',
  'distinguished', 'fellow', 'expert', 'specialist', 'consultant',
  '5+ years', '6+ years', '7+ years', '8+ years', '10+ years',
  '5 years', '6 years', '7 years', '8 years', '10 years',
];

export function isRelevantTitle(title: string): boolean {
  const t = ` ${title.toLowerCase()} `;
  if (NON_CS_TITLE_BLOCKLIST.some(kw => t.includes(kw))) return false;
  if (TITLE_KEYWORDS.some(kw => t.includes(kw))) return true;
  // For intern / co-op titles, require an explicit CS-domain keyword.
  const isIntern = /\bintern(ship)?\b|\bco-?op\b/.test(t);
  if (isIntern && CS_DOMAIN_KEYWORDS.some(kw => t.includes(kw))) return true;
  return false;
}

// Reject postings that require US citizenship or active security clearance.
// These are not viable for international students on OPT/CPT/H-1B.
const CITIZENSHIP_PHRASES = [
  'u.s. citizen', 'us citizen', 'united states citizen', 'american citizen',
  'must be a us citizen', 'must be a u.s. citizen',
  'citizenship is required', 'citizenship required',
  'requires us citizenship', 'requires u.s. citizenship',
  'sole us citizen', 'sole u.s. citizen',
  'no sponsorship', 'unable to sponsor', 'will not sponsor', 'do not sponsor',
  'security clearance required', 'active security clearance',
  'secret clearance', 'top secret clearance', 'ts/sci', 'ts / sci',
  'public trust clearance', 'dod clearance', 'doe clearance',
  'itar', 'export control',
];

export function requiresUsCitizenship(...texts: (string | undefined | null)[]): boolean {
  const blob = texts
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join('  ')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ');
  return CITIZENSHIP_PHRASES.some(p => blob.includes(p));
}

export function isEntryLevel(title: string, description: string): boolean {
  const t = title.toLowerCase();

  // Interns/co-ops always pass
  if (t.includes('intern') || t.includes('co-op') || t.includes('coop')) return true;

  // Exclude only if seniority keywords are explicitly present in title
  if (EXCLUDE_SENIORITY.some(kw => t.includes(kw))) return false;

  // Everything else passes — "Software Engineer" is assumed to be entry-level eligible
  return true;
}

export function detectJobType(title: string): 'fulltime' | 'internship' | 'coop' {
  const t = title.toLowerCase();
  if (t.includes('co-op') || t.includes('coop')) return 'coop';
  if (t.includes('intern') || t.includes('internship')) return 'internship';
  return 'fulltime';
}

const NON_US_COUNTRIES = [
  'canada', 'uk', 'united kingdom', 'england', 'india', 'germany', 'france',
  'australia', 'netherlands', 'ireland', 'spain', 'italy', 'sweden', 'norway',
  'denmark', 'finland', 'switzerland', 'austria', 'poland', 'brazil', 'mexico',
  'singapore', 'japan', 'china', 'israel', 'south korea', 'taiwan',
  'new zealand', 'argentina', 'colombia', 'portugal', 'belgium', 'czechia',
];

export function isUSOrRemote(location: string): boolean {
  if (!location) return true;
  const l = location.toLowerCase();
  if (/\bremote\b/.test(l) && !NON_US_COUNTRIES.some(c => l.includes(c))) return true;
  return !NON_US_COUNTRIES.some(c => l.includes(c));
}

export function detectRemote(title: string, location: string, description: string): boolean {
  const combined = (title + ' ' + location + ' ' + description).toLowerCase();
  return /\b(remote|wfh|work from home|distributed|anywhere|fully remote|100% remote)\b/.test(combined);
}

export function detectExperienceLevel(title: string): 'entry' | 'internship' | 'coop' {
  const t = title.toLowerCase();
  if (/\bco-?op\b/.test(t)) return 'coop';
  if (/\bintern\b|\binternship\b/.test(t)) return 'internship';
  return 'entry';
}

/** Check if title indicates an entry-level role (intern, junior, new grad, etc.) */
export function isEntryTitle(title: string): boolean {
  const t = (title || '').toLowerCase();
  return /\bintern\b|\binternship\b|\bco-?op\b|\bjunior\b|\bjr\.?\b|\bnew\s+grads?\b|\bentry[\s-]level\b|\bapprentice\b|\bearly\s+career\b|\bgraduates?\b|\bassociate\b|\bfellow\b|\bstudent\b/.test(t);
}

/**
 * Parse the minimum experience-years requirement from a job description.
 * Returns the lowest "X+ years" / "X years" number found, or null if none.
 */
export function parseExperienceYears(text: string): number | null {
  if (!text) return null;
  const plain = text.replace(/<[^>]+>/g, ' ').toLowerCase();

  // Match patterns like: "3+ years", "3-5 years", "minimum 3 years", "at least 3 years",
  // "3 years of experience", "3 yrs", "three years"
  const WORD_NUMS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };

  const wordNumPattern = 'one|two|three|four|five|six|seven|eight|nine|ten';
  const patterns = [
    // "3+ years", "3-5 years", "3 to 5 years"
    /(\d{1,2})\s*(?:\+|\-\s*\d{1,2}|\s+to\s+\d{1,2})?\s*(?:years?|yrs?)\b/g,
    // "minimum three years", "at least three years"
    /(?:minimum|at\s+least|requires?)\s+(\w+)\s+(?:years?|yrs?)\b/g,
    // "three years", "five to seven years" (standalone word numbers)
    new RegExp(`\\b(${wordNumPattern})\\s*(?:\\+|\\s*(?:-|to)\\s*(?:${wordNumPattern}|\\d{1,2}))?\\s*(?:years?|yrs?)\\b`, 'g'),
  ];

  const found: number[] = [];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(plain)) !== null) {
      const raw = m[1];
      const n = WORD_NUMS[raw] ?? parseInt(raw, 10);
      if (!isNaN(n) && n >= 0 && n <= 20) found.push(n);
    }
  }

  if (found.length === 0) return null;
  // Return the minimum years number found (the lowest requirement mentioned)
  return Math.min(...found);
}

export interface FilterResult {
  job_type: 'fulltime' | 'internship' | 'coop';
  experience_level: 'entry' | 'internship' | 'coop';
  remote: boolean;
}

export function filterJob(
  title: string,
  location: string,
  description: string
): FilterResult | null {
  if (!isRelevantTitle(title)) return null;
  if (!isEntryLevel(title, description)) return null;
  if (!isUSOrRemote(location)) return null;
  if (requiresUsCitizenship(title, description)) return null;

  return {
    job_type: detectJobType(title),
    experience_level: detectExperienceLevel(title),
    remote: detectRemote(title, location, description),
  };
}

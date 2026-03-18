/**
 * OPT/H1B Sponsor List — Tiered by sponsorship volume
 * Companies with documented history of sponsoring OPT, H1B, or international workers.
 * Sources: myvisajobs.com top H1B sponsors, H1BGrader.com, public USCIS LCA data (FY2020-2024).
 *
 * Tiers:
 *   'top'     — 100+ H1B LCAs per year consistently (most reliable)
 *   'regular' — Documented sponsors with 10-100 LCAs/year
 *   'known'   — Have sponsored before, lower volume or less consistent
 *
 * Matching is case-insensitive substring: "Google" matches "Google LLC", "Google Inc", etc.
 */

interface SponsorEntry {
  name: string;
  tier: 'top' | 'regular' | 'known';
}

export const SPONSOR_DATABASE: SponsorEntry[] = [
  // ── Top Tier: Heavy H1B sponsors (100+ LCAs/year) ────────────────────────
  // Big Tech
  { name: 'google', tier: 'top' },
  { name: 'alphabet', tier: 'top' },
  { name: 'microsoft', tier: 'top' },
  { name: 'amazon', tier: 'top' },
  { name: 'meta', tier: 'top' },
  { name: 'apple', tier: 'top' },
  { name: 'nvidia', tier: 'top' },
  { name: 'intel', tier: 'top' },
  { name: 'qualcomm', tier: 'top' },
  { name: 'cisco', tier: 'top' },
  { name: 'oracle', tier: 'top' },
  { name: 'ibm', tier: 'top' },
  { name: 'salesforce', tier: 'top' },
  { name: 'adobe', tier: 'top' },
  { name: 'servicenow', tier: 'top' },
  { name: 'workday', tier: 'top' },
  { name: 'vmware', tier: 'top' },
  { name: 'dell', tier: 'top' },
  { name: 'uber', tier: 'top' },
  { name: 'lyft', tier: 'top' },
  { name: 'linkedin', tier: 'top' },
  { name: 'bytedance', tier: 'top' },
  { name: 'tiktok', tier: 'top' },

  // Consulting — heaviest H1B sponsors by volume
  { name: 'deloitte', tier: 'top' },
  { name: 'accenture', tier: 'top' },
  { name: 'cognizant', tier: 'top' },
  { name: 'tata', tier: 'top' },
  { name: 'infosys', tier: 'top' },
  { name: 'wipro', tier: 'top' },
  { name: 'hcl', tier: 'top' },
  { name: 'capgemini', tier: 'top' },
  { name: 'tech mahindra', tier: 'top' },
  { name: 'mphasis', tier: 'top' },
  { name: 'l&t infotech', tier: 'top' },
  { name: 'lti mindtree', tier: 'top' },

  // Finance — heavy tech hiring
  { name: 'jpmorgan', tier: 'top' },
  { name: 'jp morgan', tier: 'top' },
  { name: 'goldman sachs', tier: 'top' },
  { name: 'morgan stanley', tier: 'top' },
  { name: 'capital one', tier: 'top' },
  { name: 'citibank', tier: 'top' },
  { name: 'citi', tier: 'top' },
  { name: 'bank of america', tier: 'top' },
  { name: 'wells fargo', tier: 'top' },

  // ── Regular Tier: Consistent sponsors (10-100 LCAs/year) ─────────────────
  // Cloud & Infrastructure
  { name: 'aws', tier: 'regular' },
  { name: 'cloudflare', tier: 'regular' },
  { name: 'datadog', tier: 'regular' },
  { name: 'splunk', tier: 'regular' },
  { name: 'elastic', tier: 'regular' },
  { name: 'mongodb', tier: 'regular' },
  { name: 'databricks', tier: 'regular' },
  { name: 'snowflake', tier: 'regular' },
  { name: 'hashicorp', tier: 'regular' },
  { name: 'confluent', tier: 'regular' },
  { name: 'redis', tier: 'regular' },
  { name: 'digitalocean', tier: 'regular' },
  { name: 'akamai', tier: 'regular' },

  // Fintech
  { name: 'stripe', tier: 'regular' },
  { name: 'square', tier: 'regular' },
  { name: 'block', tier: 'regular' },
  { name: 'paypal', tier: 'regular' },
  { name: 'affirm', tier: 'regular' },
  { name: 'klarna', tier: 'regular' },
  { name: 'robinhood', tier: 'regular' },
  { name: 'coinbase', tier: 'regular' },
  { name: 'plaid', tier: 'regular' },
  { name: 'marqeta', tier: 'regular' },
  { name: 'mastercard', tier: 'regular' },
  { name: 'visa inc', tier: 'regular' },
  { name: 'american express', tier: 'regular' },
  { name: 'amex', tier: 'regular' },
  { name: 'fidelity', tier: 'regular' },
  { name: 'blackrock', tier: 'regular' },
  { name: 'two sigma', tier: 'regular' },
  { name: 'jane street', tier: 'regular' },
  { name: 'citadel', tier: 'regular' },
  { name: 'de shaw', tier: 'regular' },
  { name: 'palantir', tier: 'regular' },
  { name: 'sofi', tier: 'regular' },
  { name: 'brex', tier: 'regular' },
  { name: 'toast', tier: 'regular' },
  { name: 'bill.com', tier: 'regular' },
  { name: 'green dot', tier: 'regular' },
  { name: 'wise', tier: 'regular' },

  // Growth-stage tech
  { name: 'netflix', tier: 'regular' },
  { name: 'airbnb', tier: 'regular' },
  { name: 'doordash', tier: 'regular' },
  { name: 'instacart', tier: 'regular' },
  { name: 'pinterest', tier: 'regular' },
  { name: 'snap', tier: 'regular' },
  { name: 'twitter', tier: 'regular' },
  { name: 'x corp', tier: 'regular' },
  { name: 'roblox', tier: 'regular' },
  { name: 'figma', tier: 'regular' },
  { name: 'notion', tier: 'regular' },
  { name: 'airtable', tier: 'regular' },
  { name: 'asana', tier: 'regular' },
  { name: 'atlassian', tier: 'regular' },
  { name: 'hubspot', tier: 'regular' },
  { name: 'dropbox', tier: 'regular' },
  { name: 'twilio', tier: 'regular' },
  { name: 'okta', tier: 'regular' },
  { name: 'palo alto networks', tier: 'regular' },
  { name: 'crowdstrike', tier: 'regular' },
  { name: 'fortinet', tier: 'regular' },
  { name: 'zscaler', tier: 'regular' },
  { name: 'veeva', tier: 'regular' },
  { name: 'zoom', tier: 'regular' },
  { name: 'slack', tier: 'regular' },
  { name: 'docusign', tier: 'regular' },
  { name: 'gitlab', tier: 'regular' },
  { name: 'github', tier: 'regular' },

  // Semiconductors
  { name: 'amd', tier: 'regular' },
  { name: 'broadcom', tier: 'regular' },
  { name: 'arm', tier: 'regular' },
  { name: 'marvell', tier: 'regular' },
  { name: 'micron', tier: 'regular' },
  { name: 'texas instruments', tier: 'regular' },
  { name: 'analog devices', tier: 'regular' },
  { name: 'synopsys', tier: 'regular' },
  { name: 'cadence', tier: 'regular' },
  { name: 'lattice semiconductor', tier: 'regular' },

  // Enterprise SaaS
  { name: 'sap', tier: 'regular' },
  { name: 'intuit', tier: 'regular' },
  { name: 'autodesk', tier: 'regular' },
  { name: 'ansys', tier: 'regular' },
  { name: 'bentley systems', tier: 'regular' },
  { name: 'pega', tier: 'regular' },
  { name: 'pegasystems', tier: 'regular' },
  { name: 'appian', tier: 'regular' },
  { name: 'coupa', tier: 'regular' },
  { name: 'zuora', tier: 'regular' },

  // Healthcare tech
  { name: 'epic systems', tier: 'regular' },
  { name: 'cerner', tier: 'regular' },
  { name: 'athenahealth', tier: 'regular' },
  { name: 'optum', tier: 'regular' },
  { name: 'unitedhealth', tier: 'regular' },
  { name: 'change healthcare', tier: 'regular' },
  { name: 'cardinal health', tier: 'regular' },
  { name: 'mckesson', tier: 'regular' },

  // Consulting / Professional Services
  { name: 'pwc', tier: 'regular' },
  { name: 'kpmg', tier: 'regular' },
  { name: 'ernst young', tier: 'regular' },
  { name: 'ey ', tier: 'regular' },
  { name: 'mckinsey', tier: 'regular' },
  { name: 'bcg', tier: 'regular' },
  { name: 'bain', tier: 'regular' },
  { name: 'booz allen', tier: 'regular' },
  { name: 'atos', tier: 'regular' },

  // ── Known Tier: Have sponsored, lower volume ──────────────────────────────
  // Mid-size tech
  { name: 'braintree', tier: 'known' },
  { name: 'chime', tier: 'known' },
  { name: 'ripple', tier: 'known' },
  { name: 'blend', tier: 'known' },
  { name: 'unity', tier: 'known' },
  { name: 'epic games', tier: 'known' },
  { name: 'riot games', tier: 'known' },
  { name: 'activision', tier: 'known' },
  { name: 'blizzard', tier: 'known' },
  { name: 'canva', tier: 'known' },
  { name: 'monday.com', tier: 'known' },
  { name: 'jira', tier: 'known' },
  { name: 'zendesk', tier: 'known' },
  { name: 'intercom', tier: 'known' },
  { name: 'box', tier: 'known' },
  { name: 'sendgrid', tier: 'known' },
  { name: 'auth0', tier: 'known' },
  { name: 'duo security', tier: 'known' },
  { name: 'medallia', tier: 'known' },
  { name: 'qualtrics', tier: 'known' },
  { name: 'freshworks', tier: 'known' },
  { name: 'fivetran', tier: 'known' },
  { name: 'dbt labs', tier: 'known' },
  { name: 'starburst', tier: 'known' },
  { name: 'airbyte', tier: 'known' },

  // Hardware & Storage
  { name: 'hp', tier: 'known' },
  { name: 'lenovo', tier: 'known' },
  { name: 'western digital', tier: 'known' },
  { name: 'seagate', tier: 'known' },
  { name: 'microchip technology', tier: 'known' },
  { name: 'rambus', tier: 'known' },
  { name: 'xilinx', tier: 'known' },

  // Aerospace (selective sponsors)
  { name: 'spacex', tier: 'known' },
  { name: 'boeing', tier: 'known' },
  { name: 'lockheed', tier: 'known' },
  { name: 'northrop', tier: 'known' },
  { name: 'raytheon', tier: 'known' },
  { name: 'l3 technologies', tier: 'known' },
  { name: 'general dynamics', tier: 'known' },
  { name: 'leidos', tier: 'known' },
  { name: 'saic', tier: 'known' },

  // Healthcare / Biotech
  { name: 'veracyte', tier: 'known' },
  { name: 'tempus', tier: 'known' },
  { name: 'flatiron', tier: 'known' },
  { name: 'r1 rcm', tier: 'known' },
  { name: 'moderna', tier: 'known' },
  { name: 'illumina', tier: 'known' },
  { name: 'genentech', tier: 'known' },
  { name: 'amgen', tier: 'known' },
  { name: 'gilead', tier: 'known' },
  { name: 'regeneron', tier: 'known' },
  { name: 'pfizer', tier: 'known' },
  { name: 'johnson & johnson', tier: 'known' },
  { name: 'abbvie', tier: 'known' },
  { name: 'merck', tier: 'known' },
  { name: 'eli lilly', tier: 'known' },
  { name: 'bristol-myers', tier: 'known' },
  { name: 'medtronic', tier: 'known' },

  // E-commerce & Retail
  { name: 'shopify', tier: 'known' },
  { name: 'etsy', tier: 'known' },
  { name: 'ebay', tier: 'known' },
  { name: 'wayfair', tier: 'known' },
  { name: 'chewy', tier: 'known' },
  { name: 'carvana', tier: 'known' },
  { name: 'poshmark', tier: 'known' },
  { name: 'target', tier: 'known' },
  { name: 'walmart', tier: 'known' },
  { name: 'costco', tier: 'known' },

  // DevOps & Security
  { name: 'pagerduty', tier: 'known' },
  { name: 'new relic', tier: 'known' },
  { name: 'sumo logic', tier: 'known' },
  { name: 'tenable', tier: 'known' },
  { name: 'rapid7', tier: 'known' },
  { name: 'qualys', tier: 'known' },
  { name: 'checkmarx', tier: 'known' },
  { name: 'snyk', tier: 'known' },
  { name: 'wiz', tier: 'known' },
  { name: 'sysdig', tier: 'known' },
  { name: 'grafana', tier: 'known' },
  { name: 'harness', tier: 'known' },
  { name: 'circleci', tier: 'known' },
  { name: 'jetbrains', tier: 'known' },
  { name: 'jfrog', tier: 'known' },

  // Telecom
  { name: 'verizon', tier: 'known' },
  { name: 'at&t', tier: 'known' },
  { name: 't-mobile', tier: 'known' },
  { name: 'comcast', tier: 'known' },
  { name: 'charter', tier: 'known' },

  // Media & Entertainment
  { name: 'spotify', tier: 'known' },
  { name: 'disney', tier: 'known' },
  { name: 'warner bros', tier: 'known' },
  { name: 'paramount', tier: 'known' },
  { name: 'sony', tier: 'known' },
  { name: 'ea', tier: 'known' },
  { name: 'electronic arts', tier: 'known' },
  { name: 'zynga', tier: 'known' },
  { name: 'supercell', tier: 'known' },

  // AI/ML Companies
  { name: 'openai', tier: 'known' },
  { name: 'anthropic', tier: 'known' },
  { name: 'deepmind', tier: 'known' },
  { name: 'cohere', tier: 'known' },
  { name: 'hugging face', tier: 'known' },
  { name: 'scale ai', tier: 'known' },
  { name: 'anyscale', tier: 'known' },
  { name: 'weights & biases', tier: 'known' },
  { name: 'wandb', tier: 'known' },
  { name: 'labelbox', tier: 'known' },
  { name: 'c3.ai', tier: 'known' },
  { name: 'h2o.ai', tier: 'known' },
  { name: 'datarobot', tier: 'known' },

  // Additional known sponsors from USCIS data
  { name: 'sysco', tier: 'known' },
  { name: 'expedia', tier: 'known' },
  { name: 'booking.com', tier: 'known' },
  { name: 'tripadvisor', tier: 'known' },
  { name: 'zillow', tier: 'known' },
  { name: 'redfin', tier: 'known' },
  { name: 'compass', tier: 'known' },
  { name: 'opendoor', tier: 'known' },
  { name: 'procore', tier: 'known' },
  { name: 'relativity', tier: 'known' },
  { name: 'alteryx', tier: 'known' },
  { name: 'tableau', tier: 'known' },
  { name: 'qlik', tier: 'known' },
  { name: 'thoughtspot', tier: 'known' },
  { name: 'amplitude', tier: 'known' },
  { name: 'mixpanel', tier: 'known' },
  { name: 'segment', tier: 'known' },
  { name: 'braze', tier: 'known' },
  { name: 'iterable', tier: 'known' },
  { name: 'contentful', tier: 'known' },
  { name: 'sanity', tier: 'known' },
  { name: 'vercel', tier: 'known' },
  { name: 'netlify', tier: 'known' },
  { name: 'supabase', tier: 'known' },
  { name: 'planetscale', tier: 'known' },
  { name: 'cockroachdb', tier: 'known' },
  { name: 'cockroach labs', tier: 'known' },
  { name: 'yugabyte', tier: 'known' },
  { name: 'timescale', tier: 'known' },
  { name: 'neon', tier: 'known' },
  { name: 'retool', tier: 'known' },
  { name: 'postman', tier: 'known' },
  { name: 'insomnia', tier: 'known' },
  { name: 'kong', tier: 'known' },
  { name: 'mulesoft', tier: 'known' },
  { name: 'apigee', tier: 'known' },
  { name: 'twitch', tier: 'known' },
  { name: 'discord', tier: 'known' },
  { name: 'reddit', tier: 'known' },
  { name: 'quora', tier: 'known' },
  { name: 'yelp', tier: 'known' },
  { name: 'glassdoor', tier: 'known' },
  { name: 'indeed', tier: 'known' },
  { name: 'grammarly', tier: 'known' },
  { name: 'duolingo', tier: 'known' },
  { name: 'coursera', tier: 'known' },
  { name: 'khan academy', tier: 'known' },
  { name: 'chegg', tier: 'known' },
  { name: 'pearson', tier: 'known' },
  { name: 'mcgraw-hill', tier: 'known' },
  { name: 'cruise', tier: 'known' },
  { name: 'waymo', tier: 'known' },
  { name: 'aurora', tier: 'known' },
  { name: 'nuro', tier: 'known' },
  { name: 'rivian', tier: 'known' },
  { name: 'lucid motors', tier: 'known' },
  { name: 'tesla', tier: 'known' },
  { name: 'ford', tier: 'known' },
  { name: 'gm', tier: 'known' },
  { name: 'general motors', tier: 'known' },
  { name: 'toyota', tier: 'known' },
  { name: 'samsara', tier: 'known' },
  { name: 'flexport', tier: 'known' },
  { name: 'project44', tier: 'known' },
  { name: 'launchdarkly', tier: 'known' },
  { name: 'split.io', tier: 'known' },
  { name: 'optimizely', tier: 'known' },
  { name: 'twilio', tier: 'known' },
  { name: 'vonage', tier: 'known' },
  { name: 'bandwidth', tier: 'known' },
  { name: 'plivo', tier: 'known' },
  { name: 'gong', tier: 'known' },
  { name: 'clari', tier: 'known' },
  { name: 'outreach', tier: 'known' },
  { name: 'salesloft', tier: 'known' },
  { name: 'zoominfo', tier: 'known' },
  { name: 'elastic', tier: 'known' },
  { name: 'couchbase', tier: 'known' },
  { name: 'neo4j', tier: 'known' },
  { name: 'datastax', tier: 'known' },
  { name: 'cloudera', tier: 'known' },
  { name: 'hortonworks', tier: 'known' },
  { name: 'mapbox', tier: 'known' },
  { name: 'esri', tier: 'known' },
  { name: 'trimble', tier: 'known' },
  { name: 'teradata', tier: 'known' },
  { name: 'informatica', tier: 'known' },
  { name: 'talend', tier: 'known' },
  { name: 'matillion', tier: 'known' },
  { name: 'dremio', tier: 'known' },
  { name: 'trino', tier: 'known' },
  { name: 'preset', tier: 'known' },
  { name: 'hex', tier: 'known' },
  { name: 'observable', tier: 'known' },
  { name: 'mode analytics', tier: 'known' },
];

// Build lookup structures for fast matching
const tierMap = new Map<string, 'top' | 'regular' | 'known'>();
for (const entry of SPONSOR_DATABASE) {
  tierMap.set(entry.name, entry.tier);
}

// Flat list for backwards compatibility
export const OPT_FRIENDLY_COMPANIES: string[] = SPONSOR_DATABASE.map(e => e.name);

/**
 * Check if a company name matches the OPT-friendly list.
 * Returns true if the company is a known H1B/OPT sponsor.
 */
export function isOptFriendly(companyName: string): boolean {
  const lower = companyName.toLowerCase().trim();
  return OPT_FRIENDLY_COMPANIES.some(c => lower.includes(c));
}

/**
 * Get the sponsor tier for a company.
 * Returns 'top', 'regular', 'known', or null if not in the database.
 */
export function getSponsorTier(companyName: string): 'top' | 'regular' | 'known' | null {
  const lower = companyName.toLowerCase().trim();
  for (const entry of SPONSOR_DATABASE) {
    if (lower.includes(entry.name)) {
      return entry.tier;
    }
  }
  return null;
}

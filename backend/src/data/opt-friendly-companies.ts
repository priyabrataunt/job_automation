/**
 * OPT/H1B Sponsor List
 * Companies with documented history of sponsoring OPT, H1B, or international workers.
 * Sources: myvisajobs.com top H1B sponsors, H1BGrader.com, public USCIS data.
 *
 * Matching is case-insensitive substring: "Google" matches "Google LLC", "Google Inc", etc.
 */
export const OPT_FRIENDLY_COMPANIES: string[] = [
  // Big Tech — consistently sponsor
  'google', 'alphabet', 'microsoft', 'amazon', 'meta', 'apple', 'netflix',
  'nvidia', 'intel', 'qualcomm', 'amd', 'broadcom', 'cisco', 'oracle',
  'ibm', 'salesforce', 'adobe', 'servicenow', 'workday', 'palo alto networks',
  'crowdstrike', 'fortinet', 'zscaler', 'vmware', 'dell', 'hp', 'lenovo',

  // Cloud & Infrastructure
  'aws', 'azure', 'gcp', 'cloudflare', 'datadog', 'splunk', 'elastic',
  'mongodb', 'databricks', 'snowflake', 'hashicorp', 'confluent', 'redis',
  'digitalocean', 'linode', 'rackspace',

  // Fintech & Finance
  'stripe', 'square', 'block', 'paypal', 'braintree', 'affirm', 'klarna',
  'chime', 'robinhood', 'coinbase', 'ripple', 'plaid', 'blend', 'marqeta',
  'mastercard', 'visa', 'american express', 'amex', 'capital one',
  'jpmorgan', 'jp morgan', 'goldman sachs', 'morgan stanley', 'citibank',
  'citi', 'bank of america', 'wells fargo', 'fidelity', 'blackrock',
  'two sigma', 'jane street', 'citadel', 'de shaw', 'palantir',

  // Startups / Growth Stage — known sponsors
  'airbnb', 'doordash', 'uber', 'lyft', 'instacart', 'pinterest', 'snap',
  'twitter', 'x corp', 'linkedin', 'tiktok', 'bytedance', 'roblox',
  'unity', 'epic games', 'riot games', 'activision', 'blizzard',
  'figma', 'canva', 'notion', 'airtable', 'asana', 'monday.com',
  'atlassian', 'jira', 'zendesk', 'intercom', 'hubspot', 'dropbox',
  'box', 'twilio', 'sendgrid', 'okta', 'auth0', 'duo security',
  'veeva', 'medallia', 'qualtrics', 'zendesk', 'freshworks',
  'toast', 'fivetran', 'dbt labs', 'airbyte', 'starburst',

  // Semiconductors & Hardware
  'arm', 'marvell', 'micron', 'western digital', 'seagate', 'maxim',
  'texas instruments', 'analog devices', 'microchip technology', 'lattice',
  'rambus', 'synopsys', 'cadence', 'mentor graphics', 'xilinx',

  // Defense / Aerospace (some do sponsor)
  'spacex', 'boeing', 'lockheed', 'northrop', 'raytheon', 'l3 technologies',

  // Healthcare Tech
  'epic systems', 'cerner', 'athenahealth', 'veracyte', 'tempus',
  'flatiron', 'r1 rcm', 'optum', 'change healthcare',

  // Consulting (big sponsors)
  'deloitte', 'accenture', 'cognizant', 'tata', 'infosys', 'wipro',
  'hcl', 'capgemini', 'atos', 'pwc', 'kpmg', 'ernst young', 'ey ',
  'mckinsey', 'bcg', 'bain',

  // E-commerce & Retail Tech
  'shopify', 'etsy', 'ebay', 'wayfair', 'chewy', 'carvana',
  'poshmark', 'depop', 'mercari',

  // Other known tech sponsors
  'zoom', 'slack', 'docusign', 'coupa', 'verint', 'genesys',
  'pagerduty', 'new relic', 'sumo logic', 'logrhythm',
  'tenable', 'rapid7', 'qualys', 'checkmarx', 'snyk',
  'lacework', 'orca security', 'wiz', 'sysdig',
  'grafana', 'influxdata', 'harness', 'gitlab', 'github',
  'circleci', 'jetbrains', 'hashicorp', 'puppet', 'chef',
  'anchore', 'sonatype', 'jfrog', 'nexus',
];

/**
 * Check if a company name matches the OPT-friendly list.
 * Returns true if the company is a known H1B/OPT sponsor.
 */
export function isOptFriendly(companyName: string): boolean {
  const lower = companyName.toLowerCase().trim();
  return OPT_FRIENDLY_COMPANIES.some(c => lower.includes(c));
}

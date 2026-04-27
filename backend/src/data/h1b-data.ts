/**
 * H-1B Historical LCA Data
 *
 * Sources: USCIS H-1B Employer Data Hub (FY2023-2024) + DOL LCA disclosures
 * via myvisajobs.com top 250 H1B sponsors (public data).
 *
 * Numbers are approximate annual LCA volumes (rounded). They're used to
 * compute a "Sponsorship Probability" tier that the UI surfaces alongside
 * the curated SPONSOR_DATABASE in opt-friendly-companies.ts.
 *
 * Probability bands (annual LCA volume):
 *   High   — 1,000+ LCAs/yr  (heavy sponsors, very likely to sponsor again)
 *   Medium — 100–999 LCAs/yr (regular sponsors)
 *   Low    — 1–99 LCAs/yr    (occasional sponsors)
 *   None   — no historical LCAs on record
 */
import { getSponsorTier } from './opt-friendly-companies';

export type SponsorshipProbability = 'High' | 'Medium' | 'Low' | 'None';

export interface H1bData {
  sponsorshipProbability: SponsorshipProbability;
  historicalLcaCount: number;
}

// Approximate FY2023-2024 LCA counts (rounded, public DOL/USCIS data).
// Substring match — "amazon" matches "Amazon Web Services", "Amazon.com Inc", etc.
const LCA_COUNTS: ReadonlyArray<readonly [string, number]> = [
  // Big Tech
  ['amazon', 14000],
  ['google', 7500],
  ['alphabet', 7500],
  ['microsoft', 6500],
  ['meta', 4500],
  ['facebook', 4500],
  ['apple', 4200],
  ['nvidia', 1800],
  ['intel', 3200],
  ['qualcomm', 2400],
  ['cisco', 2300],
  ['oracle', 2200],
  ['ibm', 5500],
  ['salesforce', 1700],
  ['adobe', 1100],
  ['servicenow', 600],
  ['workday', 450],
  ['vmware', 1200],
  ['dell', 800],
  ['uber', 900],
  ['lyft', 250],
  ['linkedin', 700],
  ['bytedance', 1500],
  ['tiktok', 1500],
  ['stripe', 700],
  ['airbnb', 500],
  ['doordash', 600],
  ['snap', 400],
  ['snapchat', 400],
  ['twitter', 250],
  ['x corp', 250],
  ['pinterest', 200],
  ['reddit', 120],
  ['twilio', 250],
  ['atlassian', 400],
  ['shopify', 150],
  ['datadog', 250],
  ['snowflake', 600],
  ['databricks', 700],
  ['palantir', 350],
  ['openai', 200],
  ['anthropic', 100],

  // Consulting (highest volume H1B sponsors by far)
  ['deloitte', 8500],
  ['accenture', 9500],
  ['cognizant', 12000],
  ['tata consultancy', 12000],
  ['infosys', 13500],
  ['wipro', 7000],
  ['hcl', 6500],
  ['capgemini', 7500],
  ['tech mahindra', 5800],
  ['mphasis', 3200],
  ['l&t infotech', 1800],
  ['lti mindtree', 2400],
  ['ltimindtree', 2400],
  ['ernst & young', 4000],
  ['kpmg', 3500],
  ['pwc', 4200],
  ['pricewaterhousecoopers', 4200],
  ['mckinsey', 1200],
  ['bain', 600],
  ['boston consulting', 800],

  // Finance (heavy tech hiring)
  ['jpmorgan', 4500],
  ['jp morgan', 4500],
  ['goldman sachs', 1800],
  ['morgan stanley', 1500],
  ['bank of america', 2200],
  ['citigroup', 2500],
  ['citi', 2500],
  ['wells fargo', 1800],
  ['blackrock', 600],
  ['capital one', 1100],
  ['american express', 800],
  ['mastercard', 600],
  ['visa', 700],
  ['paypal', 500],
  ['coinbase', 250],
  ['robinhood', 150],
  ['fidelity', 700],

  // Semiconductors / hardware
  ['amd', 900],
  ['micron', 1500],
  ['broadcom', 700],
  ['arm', 250],
  ['western digital', 400],
  ['analog devices', 300],
  ['marvell', 400],
  ['samsung', 600],
  ['lg electronics', 200],

  // Pharma / biotech (entry-level data scientist roles)
  ['pfizer', 600],
  ['merck', 500],
  ['johnson & johnson', 700],
  ['novartis', 350],
  ['eli lilly', 300],
  ['bristol-myers', 200],
  ['gilead', 200],
  ['moderna', 150],
  ['regeneron', 200],

  // Auto / industrial
  ['tesla', 1100],
  ['rivian', 200],
  ['ford', 800],
  ['general motors', 700],
  ['gm cruise', 250],
  ['waymo', 250],

  // Retail / e-commerce
  ['walmart', 2200],
  ['target', 800],
  ['ebay', 400],
  ['etsy', 100],
  ['wayfair', 200],
  ['instacart', 150],

  // Media / streaming
  ['netflix', 350],
  ['disney', 400],
  ['warner', 200],
  ['paramount', 150],
  ['comcast', 600],
  ['nbcuniversal', 250],
  ['spotify', 200],

  // Telecom
  ['at&t', 1500],
  ['verizon', 1200],
  ['t-mobile', 700],

  // Travel / hospitality
  ['expedia', 350],
  ['booking', 200],
  ['marriott', 250],

  // Healthcare / insurance tech
  ['unitedhealth', 1800],
  ['optum', 1500],
  ['anthem', 800],
  ['cvs', 700],
  ['humana', 400],
  ['epic systems', 300],
  ['cerner', 400],

  // Others worth knowing
  ['fedex', 350],
  ['ups', 250],
  ['boeing', 600],
  ['lockheed martin', 200],
  ['raytheon', 250],
  ['ge', 800],
  ['general electric', 800],
  ['siemens', 500],
  ['honeywell', 500],
];

function probabilityFromCount(count: number): SponsorshipProbability {
  if (count >= 1000) return 'High';
  if (count >= 100) return 'Medium';
  if (count > 0) return 'Low';
  return 'None';
}

/**
 * Look up historical H-1B sponsorship data for a company.
 * Falls back to inferring from the curated sponsor tier list when no direct
 * LCA count is on record.
 */
export async function fetchH1bHistoricalData(companyName: string): Promise<H1bData> {
  const lower = companyName.toLowerCase();

  for (const [needle, count] of LCA_COUNTS) {
    if (lower.includes(needle)) {
      return { sponsorshipProbability: probabilityFromCount(count), historicalLcaCount: count };
    }
  }

  // Fall back to the curated tier list — gives a coarser estimate
  const tier = getSponsorTier(companyName);
  if (tier === 'top') return { sponsorshipProbability: 'High', historicalLcaCount: 1500 };
  if (tier === 'regular') return { sponsorshipProbability: 'Medium', historicalLcaCount: 250 };
  if (tier === 'known') return { sponsorshipProbability: 'Low', historicalLcaCount: 25 };

  return { sponsorshipProbability: 'None', historicalLcaCount: 0 };
}

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

function slugToName(slug: string): string {
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

interface CompanyEntry {
  slug: string;
  name: string;
  ats: 'greenhouse' | 'ashby' | 'lever';
}

async function fetchSlugs(url: string): Promise<string[]> {
  const { data } = await axios.get<string[]>(url, { timeout: 15000 });
  return Array.isArray(data) ? data : [];
}

async function main() {
  console.log('Fetching company slugs from Feashliaa/job-board-aggregator...');

  const [greenhouse, ashby, lever] = await Promise.all([
    fetchSlugs('https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/master/data/greenhouse_companies.json'),
    fetchSlugs('https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/master/data/ashby_companies.json'),
    fetchSlugs('https://raw.githubusercontent.com/Feashliaa/job-board-aggregator/master/data/lever_companies.json'),
  ]);

  console.log(`Fetched: ${greenhouse.length} greenhouse, ${ashby.length} ashby, ${lever.length} lever`);

  const seen = new Set<string>();
  const companies: CompanyEntry[] = [];

  // Greenhouse: cap at 700 (5000 total is too many for each collection cycle)
  for (const slug of greenhouse.slice(0, 700)) {
    if (!seen.has(slug)) {
      seen.add(slug);
      companies.push({ slug, name: slugToName(slug), ats: 'greenhouse' });
    }
  }

  // Ashby: all (~1000)
  for (const slug of ashby) {
    if (!seen.has(slug)) {
      seen.add(slug);
      companies.push({ slug, name: slugToName(slug), ats: 'ashby' });
    }
  }

  // Lever: all (~1000)
  for (const slug of lever) {
    if (!seen.has(slug)) {
      seen.add(slug);
      companies.push({ slug, name: slugToName(slug), ats: 'lever' });
    }
  }

  const outPath = path.join(__dirname, '../data/companies.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(companies, null, 2));

  const ghCount = companies.filter(c => c.ats === 'greenhouse').length;
  const ashbyCount = companies.filter(c => c.ats === 'ashby').length;
  const leverCount = companies.filter(c => c.ats === 'lever').length;

  console.log(`\nWritten ${companies.length} companies to ${outPath}`);
  console.log(`  Greenhouse: ${ghCount}`);
  console.log(`  Ashby:      ${ashbyCount}`);
  console.log(`  Lever:      ${leverCount}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

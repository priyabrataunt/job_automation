import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(__dirname, '../../jobs.db'));

const US_STATES = [
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
  'minnesota','mississippi','missouri','montana','nebraska','nevada',
  'new hampshire','new jersey','new mexico','new york','north carolina',
  'north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island',
  'south carolina','south dakota','tennessee','texas','utah','vermont',
  'virginia','washington','west virginia','wisconsin','wyoming',
  'district of columbia',
];
const US_STATE_ABBRS = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];
const US_CITIES = [
  'new york','nyc','manhattan','brooklyn','san francisco','sf','los angeles',
  'chicago','houston','phoenix','philadelphia','san antonio','san diego',
  'dallas','austin','san jose','jacksonville','columbus','charlotte',
  'indianapolis','seattle','denver','nashville','boston','el paso','detroit',
  'memphis','portland','las vegas','louisville','baltimore','milwaukee',
  'albuquerque','tucson','fresno','sacramento','mesa','kansas city','atlanta',
  'omaha','raleigh','long beach','colorado springs','miami','tampa','tulsa',
  'minneapolis','arlington','pittsburgh','palo alto','mountain view',
  'sunnyvale','santa clara','cupertino','menlo park','redwood city',
  'foster city','san mateo','fremont','irvine','bellevue','redmond','kirkland',
  'reston','mclean','herndon','tysons','cambridge','somerville','boulder',
  'fort collins','durham','chapel hill','ann arbor','madison','salt lake city',
  'provo','scottsdale','tempe','plano','frisco','irving','huntsville',
  'huntington beach','oakland','berkeley','pasadena','burbank','glendale',
  'santa monica','venice','culver city','torrance','scotts valley',
  'concord','walnut creek','pleasanton','loveland','nampa','stennis',
];
function isUSLocation(location: string): boolean {
  if (!location || !location.trim()) return true;
  const l = location.toLowerCase().trim();
  if (/\bunited states\b|\busa\b|\bu\.s\.a\b|\bu\.s\b/.test(l)) return true;
  if (/(?:^|[\s,\-/|;])us(?:$|[\s,\-/|;])/.test(l)) return true;
  if (US_STATES.some(s => l.includes(s))) return true;
  if (US_STATE_ABBRS.some(a => new RegExp(`(?:^|[\\s,\\-/|;(])${a}(?:$|[\\s,\\-/|;)])`).test(location))) return true;
  if (US_CITIES.some(c => l.includes(c))) return true;
  if (/\bremote\b/i.test(l) && !/remote\s*[-–]\s*(?!us\b|sf\b|bay\b|nyc\b)/i.test(l)) return true;
  if (l.includes('north america')) return true;
  return false;
}

// Get all distinct locations
const rows = db.prepare('SELECT DISTINCT location, COUNT(*) as c FROM jobs GROUP BY location ORDER BY c DESC').all() as any[];

const usJobs = rows.filter(r => isUSLocation(r.location || ''));
const nonUS = rows.filter(r => !isUSLocation(r.location || ''));

console.log(`Total distinct locations: ${rows.length}`);
console.log(`US locations: ${usJobs.length}`);
console.log(`Non-US locations: ${nonUS.length}\n`);

console.log('=== NON-US (will be deleted) ===');
nonUS.forEach((r: any) => console.log(`  ${r.c} jobs: "${r.location}"`));
const totalNonUS = nonUS.reduce((s: number, r: any) => s + r.c, 0);
console.log(`\nTotal non-US jobs to delete: ${totalNonUS}`);

// Actually delete them
if (process.argv.includes('--delete')) {
  let deleted = 0;
  for (const r of nonUS) {
    const res = db.prepare('DELETE FROM jobs WHERE location = ?').run(r.location);
    deleted += res.changes;
  }
  console.log(`\nDeleted ${deleted} non-US jobs from database.`);
} else {
  console.log('\nRun with --delete to actually remove them.');
}

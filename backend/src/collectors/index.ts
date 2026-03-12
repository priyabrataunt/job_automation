import { collectGreenhouse } from './greenhouse';
import { collectAshby } from './ashby';
import { collectLever } from './lever';
import { collectWorkday } from './workday';
import { collectSmartRecruiters } from './smartrecruiters';
import { collectWorkable } from './workable';
import { collectSimplifyJobs } from './simplifyjobs';
import { Job } from '../db/schema';

export async function runAllCollectors(hoursBack: number): Promise<Job[]> {
  console.log(`[Collectors] Starting all collectors (${hoursBack}h back)...`);

  const results = await Promise.allSettled([
    collectGreenhouse(hoursBack),
    collectAshby(hoursBack),
    collectLever(hoursBack),
    collectWorkday(hoursBack),
    collectSmartRecruiters(hoursBack),
    collectWorkable(hoursBack),
    collectSimplifyJobs(hoursBack),
  ]);

  const allJobs: Job[] = [];
  const names = ['Greenhouse', 'Ashby', 'Lever', 'Workday', 'SmartRecruiters', 'Workable', 'SimplifyJobs'];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(`[${names[i]}] Found ${result.value.length} matching jobs`);
      allJobs.push(...result.value);
    } else {
      console.error(`[${names[i]}] Collector failed:`, result.reason?.message);
    }
  });

  console.log(`[Collectors] Total: ${allJobs.length} jobs collected`);
  return allJobs;
}

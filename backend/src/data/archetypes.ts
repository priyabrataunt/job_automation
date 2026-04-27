/**
 * Job archetype classifier — buckets a job title into a coarse role family.
 * Used to filter Story Bank entries and surface relevant interview prep.
 */

export type Archetype =
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'mobile'
  | 'devops'
  | 'data'
  | 'ml'
  | 'security'
  | 'qa'
  | 'pm'
  | 'design'
  | 'embedded'
  | 'other';

const RULES: ReadonlyArray<readonly [Archetype, RegExp]> = [
  ['ml',        /\b(machine learning|ml|nlp|computer vision|cv engineer|ai engineer|applied scientist|deep learning|llm)\b/i],
  ['data',      /\b(data scientist|data engineer|analytics engineer|data analyst|bi engineer|business intelligence)\b/i],
  ['security',  /\b(security|infosec|appsec|pentest|red team|blue team|cyber)\b/i],
  ['devops',    /\b(devops|sre|site reliability|platform engineer|infrastructure|cloud engineer|kubernetes|systems engineer)\b/i],
  ['mobile',    /\b(ios|android|mobile|react native|flutter|swift|kotlin engineer)\b/i],
  ['fullstack', /\b(full[\s-]?stack|fullstack)\b/i],
  ['frontend',  /\b(frontend|front[\s-]end|ui engineer|web developer|react engineer)\b/i],
  ['backend',   /\b(backend|back[\s-]end|server|api engineer|distributed systems)\b/i],
  ['embedded',  /\b(embedded|firmware|hardware engineer|fpga|asic|robotics)\b/i],
  ['qa',        /\b(qa|sdet|test engineer|quality engineer|automation engineer)\b/i],
  ['pm',        /\b(product manager|pm intern|tpm|technical program manager)\b/i],
  ['design',    /\b(designer|ux|ui designer|product design)\b/i],
];

export function classifyArchetype(title: string, description: string = ''): Archetype {
  const haystack = `${title} ${description.slice(0, 500)}`;
  for (const [arch, re] of RULES) {
    if (re.test(haystack)) return arch;
  }
  return 'other';
}

export const ALL_ARCHETYPES: Archetype[] = [
  'frontend', 'backend', 'fullstack', 'mobile', 'devops',
  'data', 'ml', 'security', 'qa', 'pm', 'design', 'embedded', 'other',
];

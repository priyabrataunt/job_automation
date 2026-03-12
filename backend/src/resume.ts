// ── Local Resume Scorer ─────────────────────────────────────────────────────
// Scores a resume against a job description using four metrics:
//   1. Skills Match  — required vs preferred skills split (40%)
//   2. Relevance     — weighted term overlap (TF-IDF inspired) (30%)
//   3. Visa Signal   — sponsorship detection (15%)
//   4. Impact        — JD-aligned action theme comparison (15%)
// No external API calls. Pure computation.

// ── Types ───────────────────────────────────────────────────────────────────

export interface MetricResult {
  score: number;    // 0-100
  label: string;    // Excellent | Good | Fair | Poor (or Sponsors | Ambiguous | No Sponsor)
  details: string;  // human-readable explanation
}

export interface ResumeScoreResult {
  skillsMatch: MetricResult;
  relevance: MetricResult;
  visaSignal: MetricResult;
  impact: MetricResult;
  overall: number;       // weighted average 0-100
  overallLabel: string;
  matchedKeywords: string[];
  missingKeywords: string[];
}

function getLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Poor';
}

// ── Stop Words ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','about','above','after','again','against','all','am','an','and','any','are',
  'as','at','be','because','been','before','being','below','between','both','but',
  'by','can','could','did','do','does','doing','down','during','each','few','for',
  'from','further','get','got','had','has','have','having','he','her','here','hers',
  'herself','him','himself','his','how','i','if','in','into','is','it','its','itself',
  'just','know','let','like','ll','may','me','might','more','most','must','my',
  'myself','need','no','nor','not','now','of','off','on','once','only','or','other',
  'our','ours','ourselves','out','over','own','re','s','same','shall','she','should',
  'so','some','such','t','than','that','the','their','theirs','them','themselves',
  'then','there','these','they','this','those','through','to','too','under','until',
  'up','us','ve','very','was','we','were','what','when','where','which','while',
  'who','whom','why','will','with','would','you','your','yours','yourself','yourselves',
  'also','able','using','use','used','work','working','well','new','one','two',
  'including','within','across','along','among','around','based','ensure','etc',
  'following','great','help','high','ideal','join','look','looking','make','making',
  'part','provide','role','strong','take','team','way','years','year','experience',
  'required','preferred','requirements','qualifications','responsibilities','ability',
  'skills','knowledge','understanding','excellent','minimum','plus','bonus',
]);

// ── Skills Dictionary ───────────────────────────────────────────────────────

const SKILLS_SET = new Set([
  // Languages
  'python','java','javascript','typescript','c++','c#','go','golang','rust','ruby',
  'swift','kotlin','scala','sql','r','matlab','bash','perl','php','dart','lua',
  'haskell','elixir','clojure','groovy','assembly','objective-c','fortran','cobol',
  'julia','erlang','ocaml','f#','vba','powershell','shell','zsh',
  // Frontend
  'react','reactjs','react.js','angular','angularjs','vue','vuejs','vue.js','svelte',
  'next.js','nextjs','nuxt','nuxtjs','gatsby','html','html5','css','css3','sass',
  'scss','less','tailwind','tailwindcss','bootstrap','material-ui','mui','chakra-ui',
  'webpack','vite','babel','redux','zustand','mobx','jquery','ember','backbone',
  'storybook','styled-components','emotion','ant-design','shadcn',
  // Backend
  'node.js','nodejs','node','express','expressjs','fastify','django','flask',
  'fastapi','spring','spring-boot','springboot','rails','ruby-on-rails','laravel',
  'asp.net','.net','dotnet','gin','echo','actix','rocket','nestjs','nest.js','koa',
  'hapi','sinatra','phoenix','fiber',
  // Cloud & DevOps
  'aws','amazon-web-services','azure','gcp','google-cloud','docker','kubernetes',
  'k8s','terraform','ansible','puppet','chef','jenkins','github-actions','gitlab-ci',
  'circleci','travis-ci','cloudformation','helm','istio','prometheus','grafana',
  'datadog','splunk','elk','new-relic','nagios','pagerduty','vercel','netlify',
  'heroku','digitalocean','linode','openstack','vagrant','consul','vault',
  'lambda','ec2','s3','ecs','eks','fargate','cloudwatch','sns','sqs','kinesis',
  'api-gateway','route53','cloudfront','iam',
  // Databases
  'postgresql','postgres','mysql','mariadb','sqlite','sql-server','mssql','oracle',
  'mongodb','mongoose','redis','memcached','elasticsearch','cassandra','dynamodb',
  'couchdb','couchbase','neo4j','influxdb','timescaledb','cockroachdb','firebase',
  'firestore','supabase','planetscale','prisma','sequelize','typeorm','drizzle',
  'knex','hibernate','mybatis',
  // Data & ML
  'tensorflow','pytorch','scikit-learn','sklearn','pandas','numpy','scipy','keras',
  'spark','pyspark','hadoop','mapreduce','kafka','airflow','dbt','snowflake',
  'bigquery','redshift','tableau','power-bi','powerbi','looker','metabase',
  'mlflow','kubeflow','sagemaker','databricks','jupyter','matplotlib','seaborn',
  'plotly','d3','d3.js','opencv','nltk','spacy','huggingface','transformers',
  'langchain','openai','llm','nlp','computer-vision','deep-learning',
  'machine-learning','data-science','data-engineering','etl','elt','data-pipeline',
  'feature-engineering','model-training','a/b-testing','ab-testing',
  // Mobile
  'react-native','flutter','ios','android','swiftui','jetpack-compose','xamarin',
  'cordova','ionic','expo',
  // Testing
  'jest','mocha','chai','pytest','junit','cypress','playwright','selenium',
  'puppeteer','vitest','testing-library','enzyme','rspec','minitest','testng',
  'cucumber','postman','k6','locust','jmeter',
  // Tools & Practices
  'git','github','gitlab','bitbucket','jira','confluence','figma','sketch',
  'adobe-xd','invision','zeplin','notion','slack','trello','asana','linear',
  'agile','scrum','kanban','lean','waterfall','devops','sre','ci/cd','cicd',
  'tdd','bdd','pair-programming','code-review','design-patterns',
  'rest','restful','graphql','grpc','protobuf','websocket','websockets',
  'soap','openapi','swagger',
  'microservices','monolith','serverless','event-driven','cqrs','ddd',
  'domain-driven-design','clean-architecture','hexagonal','mvc','mvvm',
  'oauth','oauth2','jwt','saml','sso','openid','ldap','rbac',
  'linux','unix','macos','windows','wsl',
  // Infra & Networking
  'nginx','apache','caddy','haproxy','load-balancing','cdn','dns',
  'tcp','udp','http','https','ssl','tls','vpn','firewall',
  // Messaging & Streaming
  'rabbitmq','activemq','nats','pulsar','celery','sidekiq','bull',
  // Monitoring & Observability
  'logging','monitoring','tracing','opentelemetry','jaeger','zipkin','sentry',
  // Certifications (keyword form)
  'aws-certified','azure-certified','gcp-certified','pmp','scrum-master',
  'cissp','comptia','cka','ckad','ccna','ccnp','ceh',
  // Misc buzzwords that appear in JDs
  'blockchain','web3','solidity','smart-contracts','nft',
  'ar','vr','iot','edge-computing','quantum',
  'accessibility','a11y','i18n','l10n','seo',
  'webpack','rollup','esbuild','parcel','turbopack',
]);

// ── Text Preprocessing ─────────────────────────────────────────────────────

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ');
}

function normalize(text: string): string {
  return stripHtml(text)
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s./#+-]/g, ' ')   // keep dots, slashes, #, +, - for tech terms
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  const normalized = normalize(text);
  return normalized
    .split(/\s+/)
    .map(t => t.replace(/^[.\-]+|[.\-]+$/g, '')) // trim leading/trailing dots/hyphens
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

function bigrams(tokens: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    result.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return result;
}

// ── Skill Extraction ────────────────────────────────────────────────────────

function extractSkills(text: string): Set<string> {
  const found = new Set<string>();
  const lower = normalize(text);

  for (const skill of SKILLS_SET) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[\\s,;(/"'])${escaped}(?:[\\s,;)/"'.]|$)`, 'i');
    if (regex.test(lower) || regex.test(` ${lower} `)) {
      found.add(skill);
    }
  }

  const abbrevPatterns = [
    /\bML\b/, /\bAI\b/, /\bNLP\b/, /\bCV\b/, /\bETL\b/, /\bELT\b/,
    /\bCI\/CD\b/i, /\bCI CD\b/i, /\bSRE\b/, /\bDNS\b/, /\bCDN\b/,
    /\bAPI\b/, /\bSDK\b/, /\bIDE\b/, /\bORM\b/, /\bCMS\b/, /\bCRUD\b/,
    /\bUI\b/, /\bUX\b/, /\bQA\b/, /\bRDBMS\b/,
  ];
  for (const pat of abbrevPatterns) {
    if (pat.test(text)) {
      const match = text.match(pat);
      if (match) found.add(match[0].toLowerCase().replace(/\s+/g, '/'));
    }
  }

  return found;
}

// ── JD Section Splitter (required vs preferred) ─────────────────────────────

function splitJdSections(jdText: string): { required: string; preferred: string } {
  const lower = jdText.toLowerCase();
  const preferredMarkers = [
    'preferred qualifications',
    'preferred skills',
    'preferred experience',
    'nice to have',
    'nice-to-have',
    'bonus points',
    'bonus qualifications',
    'bonus skills',
    'it would be great',
    'it would be a plus',
    'would be a plus',
    'would be nice',
    'ideally you',
    'additional qualifications',
    'not required but',
  ];

  let splitIdx = jdText.length;
  for (const marker of preferredMarkers) {
    const idx = lower.indexOf(marker);
    if (idx !== -1 && idx < splitIdx) splitIdx = idx;
  }

  return {
    required: jdText.slice(0, splitIdx),
    preferred: jdText.slice(splitIdx),
  };
}

// ── Metric 1: Skills Match (required 70% + preferred 30%) ──────────────────

function calcSkillsMatch(
  resumeText: string,
  jdText: string,
): { score: number; matched: string[]; missing: string[] } {
  const { required: requiredSection, preferred: preferredSection } = splitJdSections(jdText);

  const requiredSkills = extractSkills(requiredSection);
  const preferredSkills = extractSkills(preferredSection);

  // Remove skills from preferred that are also listed in required
  for (const s of requiredSkills) preferredSkills.delete(s);

  const resumeSkills = extractSkills(resumeText);
  const allJdSkills = new Set([...requiredSkills, ...preferredSkills]);

  if (allJdSkills.size === 0) {
    return { score: 50, matched: [], missing: [] };
  }

  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of allJdSkills) {
    if (resumeSkills.has(skill)) matched.push(skill);
    else missing.push(skill);
  }

  const matchedRequired = [...requiredSkills].filter(s => resumeSkills.has(s)).length;
  const matchedPreferred = [...preferredSkills].filter(s => resumeSkills.has(s)).length;

  let score: number;
  if (preferredSkills.size === 0) {
    // No preferred section detected — score purely on required
    score = Math.round((matchedRequired / Math.max(requiredSkills.size, 1)) * 100);
  } else {
    score = Math.round((
      (matchedRequired / Math.max(requiredSkills.size, 1)) * 0.7 +
      (matchedPreferred / Math.max(preferredSkills.size, 1)) * 0.3
    ) * 100);
  }

  return { score, matched: matched.sort(), missing: missing.sort() };
}

// ── Metric 2: Relevance (TF-IDF inspired) ───────────────────────────────────

function calcRelevance(resumeText: string, jdText: string): number {
  const jdTokens = tokenize(jdText);
  const resumeTokens = tokenize(resumeText);

  if (jdTokens.length === 0) return 50;

  const resumeSet = new Set(resumeTokens);
  const resumeBigrams = new Set(bigrams(resumeTokens));
  const jdBigrams = bigrams(jdTokens);

  const jdFreq = new Map<string, number>();
  for (const t of jdTokens) {
    jdFreq.set(t, (jdFreq.get(t) || 0) + 1);
  }

  function weight(term: string): number {
    let w = 1.0;
    if (term.length >= 7) w = 1.5;
    else if (term.length >= 4) w = 1.0;
    else w = 0.5;

    if (SKILLS_SET.has(term)) w *= 1.5;

    const freq = jdFreq.get(term) || 1;
    if (freq >= 3) w *= 1.3;
    else if (freq >= 2) w *= 1.15;

    return w;
  }

  const uniqueJdTerms = [...new Set(jdTokens)];
  let totalWeight = 0;
  let matchedWeight = 0;

  for (const term of uniqueJdTerms) {
    const w = weight(term);
    totalWeight += w;
    if (resumeSet.has(term)) matchedWeight += w;
  }

  let bigramMatches = 0;
  const uniqueJdBigrams = [...new Set(jdBigrams)];
  for (const bg of uniqueJdBigrams) {
    if (resumeBigrams.has(bg)) bigramMatches++;
  }
  if (uniqueJdBigrams.length > 0) {
    const bigramRatio = bigramMatches / uniqueJdBigrams.length;
    const unigramScore = totalWeight > 0 ? (matchedWeight / totalWeight) * 100 : 50;
    const bigramScore = bigramRatio * 100;
    return Math.round(unigramScore * 0.8 + bigramScore * 0.2);
  }

  return totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 50;
}

// ── Metric 3: Visa Signal ────────────────────────────────────────────────────

const SPONSOR_POSITIVE = [
  'will sponsor', 'visa sponsorship', 'h1b', 'h-1b', 'opt eligible', 'cpt eligible',
  'work authorization provided', 'sponsorship available', 'sponsorship provided',
  'sponsorship is available', 'we sponsor', 'we will sponsor', 'open to sponsoring',
  'supports visa', 'sponsor work', 'visa support',
];

const SPONSOR_NEGATIVE = [
  'no sponsorship', 'will not sponsor', 'cannot sponsor', 'unable to sponsor',
  'does not sponsor', 'not able to sponsor', 'not sponsoring',
  'must be authorized', 'must be legally authorized', 'authorized to work in the us',
  'citizen or permanent resident', 'us citizen', 'u.s. citizen',
  'permanent resident only', 'gc holder', 'green card holder',
  'security clearance required', 'require security clearance', 'active clearance',
  'no work visa', 'no visa sponsorship',
];

function calcVisaSignal(jdText: string): { score: number; status: 'positive' | 'negative' | 'ambiguous' } {
  const text = jdText.toLowerCase();
  if (SPONSOR_NEGATIVE.some(p => text.includes(p))) {
    return { score: 0, status: 'negative' };
  }
  if (SPONSOR_POSITIVE.some(p => text.includes(p))) {
    return { score: 100, status: 'positive' };
  }
  return { score: 50, status: 'ambiguous' };
}

// ── Metric 4: Impact (JD-aligned) ───────────────────────────────────────────

const ACTION_VERBS = new Set([
  'led','developed','implemented','designed','built','architected','optimized',
  'automated','delivered','launched','managed','mentored','established','pioneered',
  'spearheaded','streamlined','transformed','orchestrated','consolidated','migrated',
  'refactored','scaled','deployed','integrated','engineered','configured','maintained',
  'resolved','collaborated','facilitated','drove','accelerated','contributed',
  'created','analyzed','evaluated','researched','published','presented','trained',
  'coached','recruited','negotiated','secured','reduced','increased','improved',
  'achieved','exceeded','earned','won','completed','initiated','proposed','defined',
  'documented','overhauled','revamped','restructured','modernized','introduced',
  'coordinated','supervised','directed','founded','influenced','advocated',
]);

const RESULTS_KEYWORDS = new Set([
  'revenue','growth','efficiency','performance','scalability','reliability',
  'adoption','retention','conversion','throughput','latency','uptime','accuracy',
  'coverage','roi','cost','savings','profit','margin','engagement','satisfaction',
  'productivity','quality','availability','speed','reduction','improvement',
  'increase','decrease','outcome','result','impact','success','milestone',
]);

function extractActionThemes(text: string): Set<string> {
  const themes = new Set<string>();
  const tokens = text.toLowerCase().split(/\s+/);
  for (const token of tokens) {
    const clean = token.replace(/[^a-z]/g, '');
    if (ACTION_VERBS.has(clean)) themes.add(clean);
    if (RESULTS_KEYWORDS.has(clean)) themes.add(clean);
  }
  return themes;
}

function calcImpact(
  resumeText: string,
  jdText: string,
): { score: number; quantified: number; verbs: number; results: number; alignment: number } {
  const text = resumeText;

  // 1. Quantified achievements (up to 40 pts)
  const quantPatterns = [
    /\d+\.?\d*\s*%/g,
    /\$[\d,.]+[KkMmBb]?/g,
    /\d+x\b/g,
    /\b\d{2,}\+?\s*(users|clients|customers|engineers|developers|members|people|projects|applications|services|servers|endpoints|requests|transactions|records|databases)/gi,
  ];
  let quantifiedCount = 0;
  for (const pat of quantPatterns) {
    const matches = text.match(pat);
    if (matches) quantifiedCount += matches.length;
  }
  const quantScore = Math.min(40, quantifiedCount * 7);

  // 2. Action verbs (up to 30 pts)
  const tokens = text.toLowerCase().split(/\s+/);
  const foundVerbs = new Set<string>();
  for (const token of tokens) {
    const clean = token.replace(/[^a-z]/g, '');
    if (ACTION_VERBS.has(clean)) foundVerbs.add(clean);
  }
  const verbScore = Math.min(30, foundVerbs.size * 3);

  // 3. Results-oriented language (up to 30 pts)
  let resultsCount = 0;
  for (const kw of RESULTS_KEYWORDS) {
    if (text.toLowerCase().includes(kw)) resultsCount++;
  }
  const resultsPhrases = [
    /resulting in/gi, /which led to/gi, /leading to/gi, /contributing to/gi,
    /enabling/gi, /achieving/gi, /improved by/gi, /reduced by/gi,
    /increased by/gi, /decreased by/gi, /saving/gi, /generating/gi,
  ];
  for (const pat of resultsPhrases) {
    if (pat.test(text)) resultsCount++;
  }
  const resultsScore = Math.min(30, resultsCount * 4);

  const baseScore = Math.min(100, quantScore + verbScore + resultsScore);

  // 4. JD theme alignment — compare action/results themes between JD and resume
  const jdThemes = extractActionThemes(jdText);
  const resumeThemes = extractActionThemes(resumeText);
  const overlap = [...jdThemes].filter(t => resumeThemes.has(t)).length;
  const alignment = Math.round((overlap / Math.max(jdThemes.size, 1)) * 100);

  // Blend: 60% standalone quality + 40% JD theme alignment
  const score = Math.round(baseScore * 0.6 + alignment * 0.4);

  return { score, quantified: quantifiedCount, verbs: foundVerbs.size, results: resultsCount, alignment };
}

// ── Main Scorer ─────────────────────────────────────────────────────────────

export function scoreResume(
  resumeText: string,
  jobDescription: string,
): ResumeScoreResult {
  // 1. Skills Match (required 70% / preferred 30%)
  const skills = calcSkillsMatch(resumeText, jobDescription);
  const skillsMetric: MetricResult = {
    score: skills.score,
    label: getLabel(skills.score),
    details: skills.matched.length + skills.missing.length > 0
      ? `Matched ${skills.matched.length} of ${skills.matched.length + skills.missing.length} skills from job description (${skills.score}%)`
      : 'No specific skills detected in job description',
  };

  // 2. Relevance
  const relevanceScore = calcRelevance(resumeText, jobDescription);
  const relevanceMetric: MetricResult = {
    score: relevanceScore,
    label: getLabel(relevanceScore),
    details: relevanceScore >= 70
      ? `Strong alignment with job description content (${relevanceScore}%)`
      : relevanceScore >= 45
        ? `Moderate alignment — consider tailoring language to match the JD (${relevanceScore}%)`
        : `Low alignment — resume content diverges significantly from job requirements (${relevanceScore}%)`,
  };

  // 3. Visa Signal
  const visa = calcVisaSignal(jobDescription);
  const visaLabel = visa.status === 'positive' ? 'Sponsors' : visa.status === 'negative' ? 'No Sponsor' : 'Ambiguous';
  const visaMetric: MetricResult = {
    score: visa.score,
    label: visaLabel,
    details: visa.status === 'positive'
      ? 'Employer indicates visa sponsorship is available'
      : visa.status === 'negative'
        ? 'Employer likely does not sponsor visas — consider skipping this application'
        : 'No explicit visa sponsorship mentioned — apply with caution',
  };

  // 4. Impact (JD-aligned)
  const impact = calcImpact(resumeText, jobDescription);
  const impactMetric: MetricResult = {
    score: impact.score,
    label: getLabel(impact.score),
    details: `${impact.quantified} quantified achievement${impact.quantified !== 1 ? 's' : ''}, ${impact.verbs} action verb${impact.verbs !== 1 ? 's' : ''}, ${impact.results} results phrase${impact.results !== 1 ? 's' : ''} — ${impact.alignment}% JD theme alignment`,
  };

  // Overall weighted score: Skills 40% | Relevance 30% | Visa 15% | Impact 15%
  const overall = Math.round(
    skillsMetric.score * 0.40 +
    relevanceMetric.score * 0.30 +
    visaMetric.score * 0.15 +
    impactMetric.score * 0.15,
  );

  return {
    skillsMatch: skillsMetric,
    relevance: relevanceMetric,
    visaSignal: visaMetric,
    impact: impactMetric,
    overall,
    overallLabel: getLabel(overall),
    matchedKeywords: skills.matched,
    missingKeywords: skills.missing,
  };
}

// ── Recency Decay Multiplier ─────────────────────────────────────────────────
// Apply to final score before sorting. A 75% match posted today beats an 85%
// match posted 12 days ago in practice.

export function recencyMultiplier(daysPosted: number): number {
  if (daysPosted <= 2) return 1.0;
  if (daysPosted <= 5) return 0.85;
  if (daysPosted <= 10) return 0.65;
  return 0.40;
}

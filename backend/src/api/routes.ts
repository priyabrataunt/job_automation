import { FastifyInstance } from 'fastify';
import db from '../db/database';
import { runCollection, isCollectionRunning } from '../orchestrator';
import { getPreferences, rescoreAllJobs } from '../scoring';
import { scoreResume, recencyMultiplier } from '../resume';
import { PDFParse } from 'pdf-parse';
import axios from 'axios';
import OpenAI from 'openai';

const SPONSOR_POSITIVE = [
  'will sponsor', 'visa sponsorship', 'h1b', 'h-1b', 'opt eligible', 'cpt eligible',
  'work authorization provided', 'sponsorship available', 'sponsorship provided',
  'we sponsor', 'we will sponsor', 'open to sponsoring', 'supports visa', 'visa support',
];
const SPONSOR_NEGATIVE = [
  'no sponsorship', 'will not sponsor', 'cannot sponsor', 'unable to sponsor',
  'does not sponsor', 'not able to sponsor', 'not sponsoring',
  'must be authorized', 'must be legally authorized',
  'citizen or permanent resident', 'us citizen', 'u.s. citizen',
  'permanent resident only', 'security clearance required', 'no visa sponsorship',
];

function quickVisaSignal(text: string): number {
  const t = text.toLowerCase();
  if (SPONSOR_NEGATIVE.some(p => t.includes(p))) return 0;
  if (SPONSOR_POSITIVE.some(p => t.includes(p))) return 100;
  return 50;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchWorkdayDescription(applyUrl: string): Promise<string> {
  try {
    // Parse the Workday apply URL to construct the detail API URL
    // Format: https://{id}.{wd}.myworkdayjobs.com/en-US/{board}{externalPath}
    const match = applyUrl.match(/https:\/\/([^.]+)\.([^.]+)\.myworkdayjobs\.com\/(?:en-US\/)?([^/]+)(\/job\/.+)/);
    if (!match) return '';
    const [, id, wd, board, jobPath] = match;
    const detailUrl = `https://${id}.${wd}.myworkdayjobs.com/wday/cxs/${id}/${board}${jobPath}`;
    const { data } = await axios.get(detailUrl, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    const desc = data?.jobPostingInfo?.jobDescription || '';
    return stripHtml(desc);
  } catch {
    return '';
  }
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {

  // GET /api/jobs
  app.get('/api/jobs', async (request, reply) => {
    const {
      status,
      ats_source,
      job_type,
      remote,
      search,
      hours,
      sort,
      entry_only,
      limit = '50',
      offset = '0',
    } = request.query as Record<string, string>;

    const conditions: string[] = ['is_us_job(location) = 1'];
    const params: any[] = [];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (ats_source) { conditions.push('ats_source = ?'); params.push(ats_source); }
    if (job_type) { conditions.push('job_type = ?'); params.push(job_type); }
    if (remote !== undefined && remote !== '') {
      conditions.push('remote = ?');
      params.push(remote === 'true' || remote === '1' ? 1 : 0);
    }
    if (entry_only === 'true') {
      conditions.push('((max_experience_years IS NOT NULL AND max_experience_years < 2) OR is_entry_title(title) = 1)');
    }
    if (search) {
      conditions.push('(title LIKE ? OR company LIKE ? OR description_snippet LIKE ?)');
      const q = `%${search}%`;
      params.push(q, q, q);
    }
    if (hours) {
      const cutoff = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000).toISOString();
      conditions.push('posted_at >= ?');
      params.push(cutoff);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = parseInt(offset) || 0;

    const total = (db.prepare(`SELECT COUNT(*) as count FROM jobs ${where}`).get(...params) as any).count;

    let orderBy = 'ORDER BY posted_at DESC';
    if (sort === 'hired_score_desc') orderBy = 'ORDER BY hired_score DESC NULLS LAST, posted_at DESC';
    else if (sort === 'hired_score_asc') orderBy = 'ORDER BY hired_score ASC NULLS LAST, posted_at DESC';

    const jobs = db.prepare(`SELECT * FROM jobs ${where} ${orderBy} LIMIT ? OFFSET ?`).all(...params, lim, off);

    return reply.send({ jobs, total });
  });

  // POST /api/jobs/manual — add a job manually (e.g. applied outside the tracker)
  app.post('/api/jobs/manual', async (request, reply) => {
    const { title, company, apply_url, location, notes } = request.body as {
      title: string; company: string; apply_url?: string; location?: string; notes?: string;
    };

    if (!title?.trim() || !company?.trim()) {
      return reply.code(400).send({ error: 'title and company are required' });
    }

    const externalId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const result = db.prepare(`
      INSERT INTO jobs (external_id, title, company, ats_source, location, remote, apply_url,
        job_type, experience_level, department, description_snippet, status, raw_json, first_seen_at)
      VALUES (?, ?, ?, 'manual', ?, 0, ?, 'fulltime', 'entry', '', ?, 'applied', '{}', datetime('now'))
    `).run(externalId, title.trim(), company.trim(), location?.trim() || '', apply_url?.trim() || '', notes?.trim() || '');

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid) as any;
    return reply.code(201).send({ job });
  });

  // PATCH /api/jobs/:id/status
  app.patch('/api/jobs/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    const valid = ['new', 'saved', 'queued', 'applied', 'followed_up', 'response', 'rejected', 'archived'];
    if (!valid.includes(status)) {
      return reply.code(400).send({ error: `Invalid status. Must be one of: ${valid.join(', ')}` });
    }

    db.prepare("UPDATE jobs SET status = ?, status_updated_at = datetime('now') WHERE id = ?").run(status, parseInt(id));
    return reply.send({ ok: true });
  });

  // GET /api/follow-up — jobs applied 5+ days ago with no response
  app.get('/api/follow-up', async (request, reply) => {
    const { days = '5' } = request.query as { days?: string };
    const daysBack = parseInt(days) || 5;
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    // Jobs that are 'applied' and status was updated more than N days ago
    // Fall back to first_seen_at if status_updated_at is null (legacy data)
    const jobs = db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'applied'
        AND is_us_job(location) = 1
        AND COALESCE(status_updated_at, first_seen_at) < ?
      ORDER BY COALESCE(status_updated_at, first_seen_at) ASC
    `).all(cutoff);

    return reply.send({ jobs, total: jobs.length, days: daysBack });
  });

  // GET /api/stats
  app.get('/api/stats', async (_request, reply) => {
    const statusCounts = db.prepare(`SELECT status, COUNT(*) as count FROM jobs WHERE is_us_job(location) = 1 GROUP BY status`).all() as any[];
    const sourceCounts = db.prepare(`SELECT ats_source, COUNT(*) as count FROM jobs WHERE is_us_job(location) = 1 GROUP BY ats_source`).all() as any[];
    const typeCounts = db.prepare(`SELECT job_type, COUNT(*) as count FROM jobs WHERE is_us_job(location) = 1 GROUP BY job_type`).all() as any[];

    const now = new Date();
    const h6 = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
    const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const new6h = (db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE is_us_job(location) = 1 AND posted_at >= ?`).get(h6) as any).c;
    const new24h = (db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE is_us_job(location) = 1 AND posted_at >= ?`).get(h24) as any).c;

    const lastRun = db.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT 1`).get();

    return reply.send({
      by_status: Object.fromEntries(statusCounts.map(r => [r.status, r.count])),
      by_source: Object.fromEntries(sourceCounts.map(r => [r.ats_source, r.count])),
      by_type: Object.fromEntries(typeCounts.map(r => [r.job_type, r.count])),
      new_6h: new6h,
      new_24h: new24h,
      last_run: lastRun || null,
    });
  });

  // GET /api/runs
  app.get('/api/runs', async (_request, reply) => {
    const runs = db.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT 10`).all();
    return reply.send({ runs });
  });

  // POST /api/collect
  app.post('/api/collect', async (request, reply) => {
    const { hours = '24' } = request.query as { hours?: string };
    const hoursBack = parseInt(hours) || 24;

    // Run in background
    setImmediate(() => {
      runCollection(hoursBack).catch(err => console.error('[API] collect error:', err));
    });

    return reply.send({ message: `Collection started (${hoursBack}h back)` });
  });

  // GET /api/collect/status
  app.get('/api/collect/status', async (_request, reply) => {
    return reply.send({ running: isCollectionRunning() });
  });

  // GET /api/digest — top jobs from last 24h sorted by relevance
  app.get('/api/digest', async (request, reply) => {
    const { limit = '50' } = request.query as Record<string, string>;
    const lim = Math.min(parseInt(limit) || 50, 200);
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const jobs = db.prepare(
      `SELECT * FROM jobs WHERE is_us_job(location) = 1 AND posted_at >= ? ORDER BY relevance_score DESC, posted_at DESC LIMIT ?`
    ).all(cutoff, lim);

    const total = (db.prepare(
      `SELECT COUNT(*) as count FROM jobs WHERE is_us_job(location) = 1 AND posted_at >= ?`
    ).get(cutoff) as any).count;

    return reply.send({ jobs, total });
  });

  // GET /api/preferences
  app.get('/api/preferences', async (_request, reply) => {
    const prefs = getPreferences();
    return reply.send(prefs);
  });

  // POST /api/preferences
  app.post('/api/preferences', async (request, reply) => {
    const body = request.body as Partial<{
      keywords: string[];
      company_allowlist: string[];
      company_blocklist: string[];
    }>;

    const current = getPreferences();
    const keywords = Array.isArray(body.keywords) ? body.keywords.map(String) : current.keywords;
    const allowlist = Array.isArray(body.company_allowlist) ? body.company_allowlist.map(String) : current.company_allowlist;
    const blocklist = Array.isArray(body.company_blocklist) ? body.company_blocklist.map(String) : current.company_blocklist;

    db.prepare(
      `INSERT INTO user_preferences (id, keywords, company_allowlist, company_blocklist)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         keywords = excluded.keywords,
         company_allowlist = excluded.company_allowlist,
         company_blocklist = excluded.company_blocklist`
    ).run(JSON.stringify(keywords), JSON.stringify(allowlist), JSON.stringify(blocklist));

    const rescored = rescoreAllJobs();
    return reply.send({ ok: true, rescored });
  });

  // POST /api/subscribe — save browser push subscription
  app.post('/api/subscribe', async (request, reply) => {
    const sub = request.body as { endpoint: string; keys: { p256dh: string; auth: string } };
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return reply.code(400).send({ error: 'Invalid push subscription' });
    }

    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET keys_p256dh = excluded.keys_p256dh, keys_auth = excluded.keys_auth`
    ).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth);

    return reply.send({ ok: true });
  });

  // DELETE /api/subscribe — remove push subscription
  app.delete('/api/subscribe', async (request, reply) => {
    const { endpoint } = request.body as { endpoint: string };
    if (!endpoint) return reply.code(400).send({ error: 'Missing endpoint' });
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    return reply.send({ ok: true });
  });

  // GET /api/vapid-public-key
  app.get('/api/vapid-public-key', async (_request, reply) => {
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || '';
    return reply.send({ key: vapidPublicKey });
  });

  // ── Resume Optimizer ──────────────────────────────────────────────────────

  // POST /api/resume/upload — upload PDF, parse text, store in DB
  app.post('/api/resume/upload', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });

    const buffer = await file.toBuffer();
    let text = '';

    if (file.mimetype === 'application/pdf') {
      const pdf = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await pdf.getText();
      text = result.text;
      await pdf.destroy();
    } else if (file.mimetype === 'text/plain' || file.filename.endsWith('.tex')) {
      text = buffer.toString('utf-8');
    } else {
      return reply.code(400).send({ error: 'Only PDF, TXT, and .tex files are supported' });
    }

    if (!text.trim()) {
      return reply.code(400).send({ error: 'Could not extract text from file' });
    }

    db.prepare(
      `INSERT INTO user_resume (id, filename, resume_text, uploaded_at)
       VALUES (1, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         filename = excluded.filename,
         resume_text = excluded.resume_text,
         uploaded_at = excluded.uploaded_at`
    ).run(file.filename, text.trim());

    return reply.send({ ok: true, filename: file.filename, length: text.length });
  });

  // GET /api/resume — get stored resume
  app.get('/api/resume', async (_request, reply) => {
    const row = db.prepare('SELECT * FROM user_resume WHERE id = 1').get() as any;
    if (!row || !row.resume_text) {
      return reply.send({ uploaded: false });
    }
    return reply.send({
      uploaded: true,
      filename: row.filename,
      resumeText: row.resume_text,
      uploadedAt: row.uploaded_at,
    });
  });

  // POST /api/resume/analyze — score resume against a specific job
  app.post('/api/resume/analyze', async (request, reply) => {
    const { jobId } = request.body as { jobId: number };

    const resume = db.prepare('SELECT resume_text FROM user_resume WHERE id = 1').get() as any;
    if (!resume?.resume_text) {
      return reply.code(400).send({ error: 'No resume uploaded. Upload your resume first.' });
    }

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job) {
      return reply.code(404).send({ error: 'Job not found' });
    }

    // Use full description from raw_json if available, else snippet
    let description = job.description_snippet || '';
    if (job.raw_json) {
      try {
        const raw = JSON.parse(job.raw_json);
        description = raw.description || raw.content || raw.jobDescription || description;
      } catch { /* use snippet */ }
    }

    // For Workday jobs, fetch full description from detail API if we don't have one
    if ((!description || description === job.description_snippet) && job.ats_source === 'workday' && job.apply_url) {
      const wdDesc = await fetchWorkdayDescription(job.apply_url);
      if (wdDesc) description = wdDesc;
    }

    if (!description) {
      return reply.code(400).send({ error: 'Job has no description to analyze against' });
    }

    const result = scoreResume(resume.resume_text, description);

    return reply.send(result);
  });

  // POST /api/resume/score-all — batch score all jobs against uploaded resume
  app.post('/api/resume/score-all', async (_request, reply) => {
    const resume = db.prepare('SELECT resume_text FROM user_resume WHERE id = 1').get() as any;
    if (!resume?.resume_text) {
      return reply.code(400).send({ error: 'No resume uploaded. Upload your resume first.' });
    }

    const jobs = db.prepare(
      `SELECT id, ats_source, apply_url, description_snippet, raw_json, posted_at FROM jobs WHERE is_us_job(location) = 1`
    ).all() as any[];

    const updateStmt = db.prepare('UPDATE jobs SET hired_score = ?, hired_score_details = ? WHERE id = ?');

    let scored = 0;
    let skipped = 0;

    for (const job of jobs) {
      let description = job.description_snippet || '';
      if (job.raw_json) {
        try {
          const raw = JSON.parse(job.raw_json);
          description = raw.description || raw.content || raw.jobDescription || description;
        } catch { /* use snippet */ }
      }

      // For Workday jobs, try fetching full description
      if ((!description || description === job.description_snippet) && job.ats_source === 'workday' && job.apply_url) {
        const wdDesc = await fetchWorkdayDescription(job.apply_url);
        if (wdDesc) description = wdDesc;
      }

      if (!description) {
        skipped++;
        continue;
      }

      const result = scoreResume(resume.resume_text, description);

      const daysPosted = Math.floor(
        (Date.now() - new Date(job.posted_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      const decayedScore = Math.round(result.overall * recencyMultiplier(daysPosted));

      const details = JSON.stringify({
        skillsMatch: result.skillsMatch,
        relevance: result.relevance,
        visaSignal: result.visaSignal,
        impact: result.impact,
        matchedKeywords: result.matchedKeywords,
        missingKeywords: result.missingKeywords,
      });
      const visaSignal = quickVisaSignal(description);
      updateStmt.run(decayedScore, details, job.id);
      db.prepare('UPDATE jobs SET visa_signal = ? WHERE id = ?').run(visaSignal, job.id);
      scored++;
    }

    return reply.send({ ok: true, scored, skipped, total: jobs.length });
  });

  // POST /api/visa-scan — compute visa_signal for all jobs that lack it
  app.post('/api/visa-scan', async (_request, reply) => {
    const jobs = db.prepare(
      `SELECT id, description_snippet, raw_json FROM jobs WHERE visa_signal IS NULL`
    ).all() as any[];

    const update = db.prepare('UPDATE jobs SET visa_signal = ? WHERE id = ?');
    let updated = 0;
    const run = db.transaction(() => {
      for (const job of jobs) {
        let desc = job.description_snippet || '';
        if (job.raw_json) {
          try {
            const raw = JSON.parse(job.raw_json);
            desc = raw.description || raw.content || raw.jobDescription || desc;
          } catch { /* use snippet */ }
        }
        if (!desc) continue;
        update.run(quickVisaSignal(desc), job.id);
        updated++;
      }
    });
    run();
    return reply.send({ ok: true, updated });
  });

  // POST /api/cover-letter — generate a personalized cover letter via OpenAI
  app.post('/api/cover-letter', async (request, reply) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your_api_key_here') {
      return reply.code(503).send({ error: 'OPENAI_API_KEY not configured. Add it to backend/.env' });
    }

    const { jobId } = request.body as { jobId: number };

    const resume = db.prepare('SELECT resume_text FROM user_resume WHERE id = 1').get() as any;
    if (!resume?.resume_text) {
      return reply.code(400).send({ error: 'No resume uploaded. Upload your resume first.' });
    }

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job) return reply.code(404).send({ error: 'Job not found' });

    let description = job.description_snippet || '';
    if (job.raw_json) {
      try {
        const raw = JSON.parse(job.raw_json);
        description = raw.description || raw.content || raw.jobDescription || description;
      } catch { /* use snippet */ }
    }
    if (job.ats_source === 'workday' && job.apply_url && (!description || description === job.description_snippet)) {
      const wdDesc = await fetchWorkdayDescription(job.apply_url);
      if (wdDesc) description = wdDesc;
    }

    const client = new OpenAI({ apiKey });

    const prompt = `You are an expert cover letter writer for software engineers seeking jobs in the US.

Write a concise, personalized cover letter (3–4 paragraphs, ~250 words) for this candidate applying to this role.

## Candidate Resume
${resume.resume_text.slice(0, 3000)}

## Job Details
Company: ${job.company}
Title: ${job.title}
Location: ${job.location || 'Not specified'}

## Job Description
${stripHtml(description).slice(0, 3000)}

## Instructions
- Start with a strong opening that names the role and company
- Highlight 2–3 specific skills from the resume that directly match the JD
- Include one concrete quantified achievement from the resume
- End with a confident call to action
- Do NOT include placeholder text like [Your Name] — write it as if ready to send
- Keep it professional but not robotic — show personality
- Output only the cover letter text, no headers or meta-commentary`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = completion.choices[0]?.message?.content || '';
    return reply.send({ ok: true, coverLetter: text, jobTitle: job.title, company: job.company });
  });

  // POST /api/ai-fill — fill unknown form fields via OpenAI
  app.post('/api/ai-fill', async (request, reply) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your_api_key_here') {
      return reply.code(503).send({ error: 'OPENAI_API_KEY not configured. Add it to backend/.env' });
    }

    const { fields, profile } = request.body as {
      fields: Array<{ label: string; type: string; options?: string[] }>;
      profile: Record<string, any>;
    };

    if (!fields?.length) {
      return reply.send({ answers: {} });
    }

    const cappedFields = fields.slice(0, 50);
    const p = profile || {};
    const personal = p.personal || {};
    const addr = personal.address || {};
    const visa = p.visa || {};
    const workAuth = p.work_auth_answers || {};
    const answers = p.answers || {};

    // Include uploaded resume for richer context (skills, experience, projects)
    const resumeRow = db.prepare('SELECT resume_text FROM user_resume WHERE id = 1').get() as any;
    const resumeSection = resumeRow?.resume_text
      ? `\n## Candidate Resume\n${resumeRow.resume_text.slice(0, 3000)}\n`
      : '';

    const prompt = `You are filling out a job application form on behalf of a candidate.
Given the candidate's profile and a list of form fields, provide the best answer for each field.

## Candidate Profile
Name: ${personal.name || ''}
Email: ${personal.email || ''}
Phone: ${personal.phone || ''}
Location: ${addr.city || ''}, ${addr.state || ''}, ${addr.country || ''}
LinkedIn: ${personal.linkedin || ''}
GitHub: ${personal.github || ''}
Portfolio: ${personal.portfolio || ''}
Visa Status: ${visa.status || ''} (OPT expiry: ${visa.opt_expiry || 'N/A'})
Authorized to work in US: ${workAuth.authorized_to_work || ''}
Requires sponsorship now: ${workAuth.require_sponsorship_now || ''}
Requires sponsorship in future: ${workAuth.require_sponsorship_future || ''}
Years of experience: ${answers.years_experience || ''}
Highest education: ${answers.highest_education || ''} in ${answers.degree_field || ''}
Salary expectation: $${answers.salary_expectation || ''}
Notice period: ${answers.notice_period || ''}
Pronouns: ${answers.pronouns || ''}
${resumeSection}
## Form Fields to Fill
${JSON.stringify(cappedFields, null, 2)}

## Instructions
- For "select" or "radio" fields, you MUST choose one of the provided options exactly as written.
- For "text" or "textarea" fields, write a concise, professional answer based on the profile and resume.
- For yes/no questions not in the profile, use the profile context to infer the best answer.
- If you cannot determine a good answer, use an empty string "".
- Output ONLY valid JSON in this exact format, no prose, no markdown code fences:
{"answers": {"<label text>": "<answer>", ...}}`;

    try {
      const client = new OpenAI({ apiKey });
      const completion = await client.chat.completions.create({
        model: 'gpt-5-mini',
        max_completion_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = completion.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw);
      return reply.send({ answers: parsed.answers || {} });
    } catch (err: any) {
      console.error('[ai-fill] error:', err);
      const aiError = err?.message || 'OpenAI request failed';
      return reply.send({ answers: {}, aiError });
    }
  });

  // GET /health
  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });
}

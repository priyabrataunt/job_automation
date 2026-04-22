import { FastifyInstance } from 'fastify';
import db from '../db/database';
import { runCollection, runJSearchCollection, isCollectionRunning } from '../orchestrator';
import { getPreferences, rescoreAllJobs } from '../scoring';
import { scoreResume, recencyMultiplier } from '../resume';
import { PDFParse } from 'pdf-parse';
import axios from 'axios';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
// Load writing-style reference so AI outputs sound like the user
let writingStylePrompt = '';
try {
    const personaDir = resolve(__dirname, '../../../Priyabrata_persona');
    const writing = JSON.parse(readFileSync(resolve(personaDir, 'Priyabrata_Writing.json'), 'utf-8'));
    const questions: string[] = JSON.parse(readFileSync(resolve(personaDir, 'user_questions.json'), 'utf-8'));
    // Pick a representative sample of questions (first 20) to keep token count reasonable
    const questionSample = questions.slice(0, 20).map((q, i) => `${i + 1}. ${q}`).join('\n');
    writingStylePrompt = `## Persona & Writing Style Reference
You are writing on behalf of this specific person. Study the samples below carefully and match their exact voice — informal phrasing, sentence rhythm, directness, and energy. Do NOT produce polished corporate text. Write the way this person actually writes.

### Diary / Personal Writing
${writing.diary_entry}

### Social Media Posts
${writing.social_media_posts.map((p: string, i: number) => `${i + 1}. ${p}`).join('\n')}

### Outreach / Approach Messages
${writing.approach_messages.map((m: string, i: number) => `${i + 1}. ${m}`).join('\n')}

### Email Messages
${writing.email_messages.map((e: string, i: number) => `${i + 1}. ${e}`).join('\n')}

### Questions This Person Asks (captures their curiosity, phrasing, and thought style)
${questionSample}

IMPORTANT: Write ONLY in this person's voice. Keep it natural, direct, and human — not overly polished or robotic. Mirror their sentence structure and word choices.`;
    console.log('[routes] Loaded persona from Priyabrata_persona/ folder');
}
catch (err) {
    console.warn('[routes] Could not load Priyabrata_persona/ — AI will use default voice', err);
}
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
    if (SPONSOR_NEGATIVE.some(p => t.includes(p)))
        return 0;
    if (SPONSOR_POSITIVE.some(p => t.includes(p)))
        return 100;
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
        if (!match)
            return '';
        const [, id, wd, board, jobPath] = match;
        const detailUrl = `https://${id}.${wd}.myworkdayjobs.com/wday/cxs/${id}/${board}${jobPath}`;
        const { data } = await axios.get(detailUrl, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
        });
        const desc = data?.jobPostingInfo?.jobDescription || '';
        return stripHtml(desc);
    }
    catch {
        return '';
    }
}
export async function registerRoutes(app: FastifyInstance): Promise<void> {
    // GET /api/jobs
    app.get('/api/jobs', async (request, reply) => {
        const { status, ats_source, job_type, remote, search, hours, sort, entry_only, limit = '50', offset = '0', } = request.query as Record<string, string>;
        const conditions: string[] = ['(is_us_job(location) = 1 OR ats_source = \'manual\')'];
        const params: any[] = [];
        if (status) {
            conditions.push('status = ?');
            params.push(status);
        }
        if (ats_source) {
            conditions.push('ats_source = ?');
            params.push(ats_source);
        }
        if (job_type) {
            conditions.push('job_type = ?');
            params.push(job_type);
        }
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
        const lim = Math.min(parseInt(limit) || 50, 1000);
        const off = parseInt(offset) || 0;
        const total = (await db.prepare(`SELECT COUNT(*) as count FROM jobs ${where}`).get(...params) as any).count;
        let orderBy = 'ORDER BY posted_at DESC';
        if (sort === 'hired_score_desc')
            orderBy = 'ORDER BY hired_score DESC NULLS LAST, posted_at DESC';
        else if (sort === 'hired_score_asc')
            orderBy = 'ORDER BY hired_score ASC NULLS LAST, posted_at DESC';
        const jobs = await db.prepare(`SELECT * FROM jobs ${where} ${orderBy} LIMIT ? OFFSET ?`).all(...params, lim, off);
        return reply.send({ jobs, total });
    });
    // POST /api/jobs/manual — add a job manually (e.g. applied outside the tracker)
    app.post('/api/jobs/manual', async (request, reply) => {
        const { title, company, apply_url, location, notes, description_snippet, raw_json, job_type } = request.body as {
            title: string;
            company: string;
            apply_url?: string;
            location?: string;
            notes?: string;
            description_snippet?: string;
            raw_json?: string;
            job_type?: string;
        };
        if (!title?.trim() || !company?.trim()) {
            return reply.code(400).send({ error: 'title and company are required' });
        }
        const snippet = (description_snippet || notes || '').trim();
        const safeJobType = ['fulltime', 'internship', 'coop'].includes(job_type || '') ? job_type : 'fulltime';
        const externalId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const result = await db.prepare(`
      INSERT INTO jobs (external_id, title, company, ats_source, location, remote, apply_url,
        job_type, experience_level, department, description_snippet, status, raw_json, first_seen_at, status_updated_at)
      VALUES (?, ?, ?, 'manual', ?, 0, ?, ?, 'entry', '', ?, 'applied', ?, datetime('now'), datetime('now'))
      RETURNING id
    `).run(externalId, title.trim(), company.trim(), location?.trim() || '', apply_url?.trim() || '', safeJobType, snippet, raw_json?.trim() || '{}');
        const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid) as any;
        return reply.code(201).send({ job });
    });
    // PATCH /api/jobs/:id/status
    app.patch('/api/jobs/:id/status', async (request, reply) => {
        const { id } = request.params as {
            id: string;
        };
        const { status, title, company, apply_url, location, description_snippet, raw_json, job_type, } = request.body as {
            status: string;
            title?: string;
            company?: string;
            apply_url?: string;
            location?: string;
            description_snippet?: string;
            raw_json?: string;
            job_type?: string;
        };
        const valid = ['new', 'saved', 'queued', 'applied', 'followed_up', 'response', 'rejected', 'archived'];
        if (!valid.includes(status)) {
            return reply.code(400).send({ error: `Invalid status. Must be one of: ${valid.join(', ')}` });
        }
        const updates = ['status = ?', "status_updated_at = datetime('now')"];
        const params: any[] = [status];
        if (title?.trim()) {
            updates.push('title = ?');
            params.push(title.trim());
        }
        if (company?.trim()) {
            updates.push('company = ?');
            params.push(company.trim());
        }
        if (apply_url?.trim()) {
            updates.push('apply_url = ?');
            params.push(apply_url.trim());
        }
        if (location?.trim()) {
            updates.push('location = ?');
            params.push(location.trim());
        }
        if (description_snippet?.trim()) {
            updates.push('description_snippet = ?');
            params.push(description_snippet.trim());
        }
        if (raw_json?.trim()) {
            updates.push('raw_json = ?');
            params.push(raw_json.trim());
        }
        if (['fulltime', 'internship', 'coop'].includes(job_type || '')) {
            updates.push('job_type = ?');
            params.push(job_type);
        }
        params.push(parseInt(id));
        await db.prepare(`UPDATE jobs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        return reply.send({ ok: true });
    });
    // GET /api/follow-up — jobs applied 5+ days ago with no response
    app.get('/api/follow-up', async (request, reply) => {
        const { days = '5' } = request.query as {
            days?: string;
        };
        const daysBack = parseInt(days) || 5;
        const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
        // Jobs that are 'applied' and status was updated more than N days ago
        // Fall back to first_seen_at if status_updated_at is null (legacy data)
        const jobs = await db.prepare(`
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
        const statusCounts = await db.prepare(`SELECT status, COUNT(*) as count FROM jobs WHERE is_us_job(location) = 1 GROUP BY status`).all() as any[];
        const sourceCounts = await db.prepare(`SELECT ats_source, COUNT(*) as count FROM jobs WHERE is_us_job(location) = 1 GROUP BY ats_source`).all() as any[];
        const typeCounts = await db.prepare(`SELECT job_type, COUNT(*) as count FROM jobs WHERE is_us_job(location) = 1 GROUP BY job_type`).all() as any[];
        const now = new Date();
        const h6 = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
        const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const new6h = (await db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE is_us_job(location) = 1 AND posted_at >= ?`).get(h6) as any).c;
        const new24h = (await db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE is_us_job(location) = 1 AND posted_at >= ?`).get(h24) as any).c;
        const lastRun = await db.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT 1`).get();
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
        const runs = await db.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT 10`).all();
        return reply.send({ runs });
    });
    // POST /api/collect
    app.post('/api/collect', async (request, reply) => {
        const { hours = '24' } = request.query as {
            hours?: string;
        };
        const hoursBack = parseInt(hours) || 24;
        // Run in background
        setImmediate(() => {
            runCollection(hoursBack).catch(err => console.error('[API] collect error:', err));
        });
        return reply.send({ message: `Collection started (${hoursBack}h back)` });
    });
    // POST /api/collect/jsearch — manual-only JSearch (LinkedIn/Indeed/Glassdoor)
    app.post('/api/collect/jsearch', async (request, reply) => {
        const { hours = '48' } = request.query as {
            hours?: string;
        };
        const hoursBack = parseInt(hours) || 48;
        setImmediate(() => {
            runJSearchCollection(hoursBack).catch(err => console.error('[API] JSearch error:', err));
        });
        return reply.send({ message: `JSearch collection started (${hoursBack}h back)` });
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
        const jobs = await db.prepare(`SELECT * FROM jobs WHERE is_us_job(location) = 1 AND posted_at >= ? ORDER BY relevance_score DESC, posted_at DESC LIMIT ?`).all(cutoff, lim);
        const total = (await db.prepare(`SELECT COUNT(*) as count FROM jobs WHERE is_us_job(location) = 1 AND posted_at >= ?`).get(cutoff) as any).count;
        return reply.send({ jobs, total });
    });
    // GET /api/preferences
    app.get('/api/preferences', async (_request, reply) => {
        const prefs = await getPreferences();
        return reply.send(prefs);
    });
    // POST /api/preferences
    app.post('/api/preferences', async (request, reply) => {
        const body = request.body as Partial<{
            keywords: string[];
            company_allowlist: string[];
            company_blocklist: string[];
        }>;
        const current = await getPreferences();
        const keywords = Array.isArray(body.keywords) ? body.keywords.map(String) : current.keywords;
        const allowlist = Array.isArray(body.company_allowlist) ? body.company_allowlist.map(String) : current.company_allowlist;
        const blocklist = Array.isArray(body.company_blocklist) ? body.company_blocklist.map(String) : current.company_blocklist;
        await db.prepare(`INSERT INTO user_preferences (id, keywords, company_allowlist, company_blocklist)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         keywords = excluded.keywords,
         company_allowlist = excluded.company_allowlist,
         company_blocklist = excluded.company_blocklist`).run(JSON.stringify(keywords), JSON.stringify(allowlist), JSON.stringify(blocklist));
        const rescored = await rescoreAllJobs();
        return reply.send({ ok: true, rescored });
    });
    // POST /api/subscribe — save browser push subscription
    app.post('/api/subscribe', async (request, reply) => {
        const sub = request.body as {
            endpoint: string;
            keys: {
                p256dh: string;
                auth: string;
            };
        };
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
            return reply.code(400).send({ error: 'Invalid push subscription' });
        }
        await db.prepare(`INSERT INTO push_subscriptions (endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET keys_p256dh = excluded.keys_p256dh, keys_auth = excluded.keys_auth`).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth);
        return reply.send({ ok: true });
    });
    // DELETE /api/subscribe — remove push subscription
    app.delete('/api/subscribe', async (request, reply) => {
        const { endpoint } = request.body as {
            endpoint: string;
        };
        if (!endpoint)
            return reply.code(400).send({ error: 'Missing endpoint' });
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
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
        if (!file)
            return reply.code(400).send({ error: 'No file uploaded' });
        const buffer = await file.toBuffer();
        let text = '';
        if (file.mimetype === 'application/pdf') {
            const pdf = new PDFParse({ data: new Uint8Array(buffer) });
            const result = await pdf.getText();
            text = result.text;
            await pdf.destroy();
        }
        else if (file.mimetype === 'text/plain' || file.filename.endsWith('.tex')) {
            text = buffer.toString('utf-8');
        }
        else {
            return reply.code(400).send({ error: 'Only PDF, TXT, and .tex files are supported' });
        }
        if (!text.trim()) {
            return reply.code(400).send({ error: 'Could not extract text from file' });
        }
        await db.prepare(`INSERT INTO user_resume (id, filename, resume_text, uploaded_at)
       VALUES (1, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         filename = excluded.filename,
         resume_text = excluded.resume_text,
         uploaded_at = excluded.uploaded_at`).run(file.filename, text.trim());
        return reply.send({ ok: true, filename: file.filename, length: text.length });
    });
    // GET /api/resume — get stored resume
    app.get('/api/resume', async (_request, reply) => {
        const row = await db.prepare('SELECT * FROM user_resume WHERE id = 1').get() as any;
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
        const { jobId } = request.body as {
            jobId: number;
        };
        const resume = await db.prepare('SELECT resume_text FROM user_resume WHERE id = 1').get() as any;
        if (!resume?.resume_text) {
            return reply.code(400).send({ error: 'No resume uploaded. Upload your resume first.' });
        }
        const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
        if (!job) {
            return reply.code(404).send({ error: 'Job not found' });
        }
        // Use full description from raw_json if available, else snippet
        let description = job.description_snippet || '';
        if (job.raw_json) {
            try {
                const raw = JSON.parse(job.raw_json);
                description = raw.description || raw.content || raw.jobDescription || description;
            }
            catch { /* use snippet */ }
        }
        // For Workday jobs, fetch full description from detail API if we don't have one
        if ((!description || description === job.description_snippet) && job.ats_source === 'workday' && job.apply_url) {
            const wdDesc = await fetchWorkdayDescription(job.apply_url);
            if (wdDesc)
                description = wdDesc;
        }
        if (!description) {
            return reply.code(400).send({ error: 'Job has no description to analyze against' });
        }
        const result = scoreResume(resume.resume_text, description);
        return reply.send(result);
    });
    // POST /api/resume/score-all — batch score all jobs against uploaded resume
    app.post('/api/resume/score-all', async (_request, reply) => {
        const resume = await db.prepare('SELECT resume_text FROM user_resume WHERE id = 1').get() as any;
        if (!resume?.resume_text) {
            return reply.code(400).send({ error: 'No resume uploaded. Upload your resume first.' });
        }
        const jobs = await db.prepare(`SELECT id, ats_source, apply_url, description_snippet, raw_json, posted_at FROM jobs WHERE is_us_job(location) = 1`).all() as any[];
        const updateStmt = db.prepare('UPDATE jobs SET hired_score = ?, hired_score_details = ? WHERE id = ?');
        let scored = 0;
        let skipped = 0;
        for (const job of jobs) {
            let description = job.description_snippet || '';
            if (job.raw_json) {
                try {
                    const raw = JSON.parse(job.raw_json);
                    description = raw.description || raw.content || raw.jobDescription || description;
                }
                catch { /* use snippet */ }
            }
            // For Workday jobs, try fetching full description
            if ((!description || description === job.description_snippet) && job.ats_source === 'workday' && job.apply_url) {
                const wdDesc = await fetchWorkdayDescription(job.apply_url);
                if (wdDesc)
                    description = wdDesc;
            }
            if (!description) {
                skipped++;
                continue;
            }
            const result = scoreResume(resume.resume_text, description);
            const daysPosted = Math.floor((Date.now() - new Date(job.posted_at).getTime()) / (1000 * 60 * 60 * 24));
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
            await updateStmt.run(decayedScore, details, job.id);
            await db.prepare('UPDATE jobs SET visa_signal = ? WHERE id = ?').run(visaSignal, job.id);
            scored++;
        }
        return reply.send({ ok: true, scored, skipped, total: jobs.length });
    });
    // POST /api/visa-scan — compute visa_signal for all jobs that lack it
    app.post('/api/visa-scan', async (_request, reply) => {
        const jobs = await db.prepare(`SELECT id, description_snippet, raw_json FROM jobs WHERE visa_signal IS NULL`).all() as any[];
        const update = db.prepare('UPDATE jobs SET visa_signal = ? WHERE id = ?');
        let updated = 0;
        for (const job of jobs) {
            let desc = job.description_snippet || '';
            if (job.raw_json) {
                try {
                    const raw = JSON.parse(job.raw_json);
                    desc = raw.description || raw.content || raw.jobDescription || desc;
                }
                catch { /* use snippet */ }
            }
            if (!desc)
                continue;
            await update.run(quickVisaSignal(desc), job.id);
            updated++;
        }
        return reply.send({ ok: true, updated });
    });
    // POST /api/cover-letter — generate a personalized cover letter via OpenAI
    app.post('/api/cover-letter', async (request, reply) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || apiKey === 'your_api_key_here') {
            return reply.code(503).send({ error: 'OPENAI_API_KEY not configured. Add it to backend/.env' });
        }
        const { jobId, jobDescription } = request.body as {
            jobId?: number;
            jobDescription?: string;
        };
        if (!jobId && !jobDescription?.trim()) {
            return reply.code(400).send({ error: 'Either jobId or jobDescription is required' });
        }
        const resume = await db.prepare('SELECT resume_text FROM user_resume WHERE id = 1').get() as any;
        if (!resume?.resume_text) {
            return reply.code(400).send({ error: 'No resume uploaded. Upload your resume first.' });
        }
        let description = '';
        let jobTitle = 'the role';
        let jobCompany = 'the company';
        let jobLocation = 'Not specified';
        if (jobId) {
            const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
            if (!job)
                return reply.code(404).send({ error: 'Job not found' });
            jobTitle = job.title;
            jobCompany = job.company;
            jobLocation = job.location || 'Not specified';
            description = job.description_snippet || '';
            if (job.raw_json) {
                try {
                    const raw = JSON.parse(job.raw_json);
                    description = raw.description || raw.content || raw.jobDescription || description;
                }
                catch { /* use snippet */ }
            }
            if (job.ats_source === 'workday' && job.apply_url && (!description || description === job.description_snippet)) {
                const wdDesc = await fetchWorkdayDescription(job.apply_url);
                if (wdDesc)
                    description = wdDesc;
            }
        }
        else {
            description = jobDescription!;
        }
        const client = new OpenAI({ apiKey });
        const prompt = `You are an expert cover letter writer for software engineers seeking jobs in the US.

Write a concise, personalized cover letter (3–4 paragraphs, ~250 words) for this candidate applying to this role.

## Candidate Resume
${resume.resume_text.slice(0, 3000)}

## Job Details
Company: ${jobCompany}
Title: ${jobTitle}
Location: ${jobLocation}

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
        const messages: Array<{
            role: 'system' | 'user';
            content: string;
        }> = [];
        if (writingStylePrompt)
            messages.push({ role: 'system', content: writingStylePrompt });
        messages.push({ role: 'user', content: prompt });
        const completion = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 600,
            messages,
        });
        const text = completion.choices[0]?.message?.content || '';
        return reply.send({ ok: true, coverLetter: text, jobTitle, company: jobCompany });
    });
    // POST /api/jobs/from-jd — extract job details from pasted JD and add to tracker
    app.post('/api/jobs/from-jd', async (request, reply) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || apiKey === 'your_api_key_here') {
            return reply.code(503).send({ error: 'OPENAI_API_KEY not configured.' });
        }
        const { jdText } = request.body as {
            jdText: string;
        };
        if (!jdText?.trim()) {
            return reply.code(400).send({ error: 'jdText is required' });
        }
        const client = new OpenAI({ apiKey });
        const extraction = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 200,
            response_format: { type: 'json_object' },
            messages: [{
                    role: 'user',
                    content: `Extract these fields from the job description as JSON:
- company (string, company name only)
- title (string, job title only)
- location (string, city/state or "Remote", empty string if not found)
- description_snippet (string, first 300 chars summarising key responsibilities)

Output ONLY valid JSON: {"company":"...","title":"...","location":"...","description_snippet":"..."}

Job Description:
${jdText.slice(0, 4000)}`,
                }],
        });
        let extracted: {
            company?: string;
            title?: string;
            location?: string;
            description_snippet?: string;
        } = {};
        try {
            extracted = JSON.parse(extraction.choices[0]?.message?.content || '{}');
        }
        catch {
            return reply.code(500).send({ error: 'Failed to parse job details from JD' });
        }
        const company = (extracted.company || 'Unknown Company').trim();
        const title = (extracted.title || 'Unknown Role').trim();
        const location = (extracted.location || '').trim();
        const snippet = (extracted.description_snippet || jdText.slice(0, 300)).trim();
        const externalId = `jd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const rawJson = JSON.stringify({ jobDescription: jdText.trim() });
        const result = await db.prepare(`
      INSERT INTO jobs (external_id, title, company, ats_source, location, remote, apply_url,
        job_type, experience_level, department, description_snippet, status, raw_json, first_seen_at)
      VALUES (?, ?, ?, 'manual', ?, 0, '', 'fulltime', 'entry', '', ?, 'saved', ?, datetime('now'))
      RETURNING id
    `).run(externalId, title, company, location, snippet, rawJson);
        return reply.send({ jobId: result.lastInsertRowid, company, title, location, descriptionSnippet: snippet });
    });
    // POST /api/ai-fill — fill unknown form fields via OpenAI
    app.post('/api/ai-fill', async (request, reply) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || apiKey === 'your_api_key_here') {
            return reply.code(503).send({ error: 'OPENAI_API_KEY not configured. Add it to backend/.env' });
        }
        const { fields, profile, jobDescription } = request.body as {
            fields: Array<{
                label: string;
                type: string;
                options?: string[];
            }>;
            profile: Record<string, any>;
            jobDescription?: string;
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
        const resumeRow = await db.prepare('SELECT resume_text FROM user_resume WHERE id = 1').get() as any;
        const resumeSection = resumeRow?.resume_text
            ? `\n## Candidate Resume\n${resumeRow.resume_text.slice(0, 3000)}\n`
            : '';
        const jdSection = jobDescription?.trim()
            ? `\n## Job Description\n${jobDescription.slice(0, 2000)}\n`
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
${resumeSection}${jdSection}
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
            const aiFillMessages: Array<{
                role: 'system' | 'user';
                content: string;
            }> = [];
            if (writingStylePrompt)
                aiFillMessages.push({ role: 'system', content: writingStylePrompt });
            aiFillMessages.push({ role: 'user', content: prompt });
            const completion = await client.chat.completions.create({
                model: 'gpt-4o-mini',
                max_completion_tokens: 1200,
                response_format: { type: 'json_object' },
                messages: aiFillMessages,
            });
            const raw = completion.choices[0]?.message?.content || '{}';
            const parsed = JSON.parse(raw);
            return reply.send({ answers: parsed.answers || {} });
        }
        catch (err: any) {
            console.error('[ai-fill] error:', err);
            const aiError = err?.message || 'OpenAI request failed';
            return reply.send({ answers: {}, aiError });
        }
    });
    // POST /api/follow-up/draft — generate a follow-up message for a job
    app.post('/api/follow-up/draft', async (request, reply) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey || apiKey === 'your_api_key_here') {
            // Return a template if no API key configured
            const { jobId } = request.body as {
                jobId: number;
            };
            const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
            if (!job)
                return reply.code(404).send({ error: 'Job not found' });
            const daysAgo = Math.floor((Date.now() - new Date(job.status_updated_at || job.first_seen_at).getTime()) / (1000 * 60 * 60 * 24));
            const template = `Hi,\n\nI recently applied for the ${job.title} position at ${job.company} about ${daysAgo} days ago and wanted to express my continued interest in the role.\n\nI believe my background in software engineering aligns well with what you're looking for, and I'd welcome the opportunity to discuss how I can contribute to your team.\n\nWould you have a few minutes to chat this week?\n\nBest regards`;
            return reply.send({ ok: true, message: template, source: 'template' });
        }
        const { jobId } = request.body as {
            jobId: number;
        };
        const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
        if (!job)
            return reply.code(404).send({ error: 'Job not found' });
        const resume = await db.prepare('SELECT resume_text FROM user_resume WHERE id = 1').get() as any;
        const daysAgo = Math.floor((Date.now() - new Date(job.status_updated_at || job.first_seen_at).getTime()) / (1000 * 60 * 60 * 24));
        const client = new OpenAI({ apiKey });
        const prompt = `Write a brief, professional LinkedIn follow-up message (3-4 sentences, ~60 words) for someone who applied to a job ${daysAgo} days ago with no response.

Job: ${job.title} at ${job.company}
Location: ${job.location || 'Not specified'}
${resume?.resume_text ? `\nCandidate highlights: ${resume.resume_text.slice(0, 500)}` : ''}

Guidelines:
- Mention the specific role and company
- Express continued interest without being pushy
- Reference one relevant skill/experience if resume is available
- End with a soft ask (open to a brief chat, happy to share more details, etc.)
- Do NOT include subject line, greeting name, or sign-off name
- Do NOT use placeholder text like [Your Name] or [Recruiter Name]
- Keep it concise and ready to paste into LinkedIn
- Output only the message text, nothing else`;
        try {
            const followUpMessages: Array<{
                role: 'system' | 'user';
                content: string;
            }> = [];
            if (writingStylePrompt)
                followUpMessages.push({ role: 'system', content: writingStylePrompt });
            followUpMessages.push({ role: 'user', content: prompt });
            const completion = await client.chat.completions.create({
                model: 'gpt-4o-mini',
                max_tokens: 200,
                messages: followUpMessages,
            });
            const text = completion.choices[0]?.message?.content || '';
            return reply.send({ ok: true, message: text.trim(), source: 'ai' });
        }
        catch (err: any) {
            return reply.code(500).send({ error: err.message || 'AI generation failed' });
        }
    });
    // GET /api/analytics — application velocity & conversion analytics
    app.get('/api/analytics', async (request, reply) => {
        const { days = '30' } = request.query as {
            days?: string;
        };
        const daysBack = Math.min(parseInt(days) || 30, 90);
        const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
        // 1. Conversion funnel: count jobs in each meaningful status
        const funnel = await db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('saved','queued','applied','followed_up','response','rejected') THEN 1 ELSE 0 END) as saved,
        SUM(CASE WHEN status IN ('applied','followed_up','response','rejected') THEN 1 ELSE 0 END) as applied,
        SUM(CASE WHEN status = 'followed_up' THEN 1 ELSE 0 END) as followed_up,
        SUM(CASE WHEN status = 'response' THEN 1 ELSE 0 END) as response,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM jobs WHERE is_us_job(location) = 1
    `).get() as any;
        // 2. Applications per day (last N days)
        const appsPerDay = await db.prepare(`
      SELECT DATE(status_updated_at) as day, COUNT(*) as count
      FROM jobs
      WHERE status IN ('applied','followed_up','response','rejected')
        AND status_updated_at IS NOT NULL
        AND status_updated_at >= ?
      GROUP BY DATE(status_updated_at)
      ORDER BY day ASC
    `).all(cutoff) as any[];
        // 3. Response rate by ATS source
        const bySource = await db.prepare(`
      SELECT
        ats_source,
        COUNT(*) as applied,
        SUM(CASE WHEN status = 'response' THEN 1 ELSE 0 END) as responses,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejections
      FROM jobs
      WHERE status IN ('applied','followed_up','response','rejected')
        AND is_us_job(location) = 1
      GROUP BY ats_source
      ORDER BY applied DESC
    `).all() as any[];
        // 4. Response rate by job title keyword
        const titleRows = await db.prepare(`
      SELECT title, status
      FROM jobs
      WHERE status IN ('applied','followed_up','response','rejected')
        AND is_us_job(location) = 1
    `).all() as any[];
        // Bucket titles into keywords
        const titleKeywords: Record<string, {
            applied: number;
            responses: number;
        }> = {};
        const TITLE_BUCKETS = [
            'Software Engineer', 'Frontend', 'Backend', 'Full Stack', 'Fullstack',
            'Data Engineer', 'Data Scientist', 'ML Engineer', 'Machine Learning',
            'DevOps', 'SRE', 'Platform', 'Cloud', 'QA', 'Security', 'Intern',
        ];
        for (const row of titleRows) {
            const t = (row.title || '').toLowerCase();
            let matched = false;
            for (const bucket of TITLE_BUCKETS) {
                if (t.includes(bucket.toLowerCase())) {
                    if (!titleKeywords[bucket])
                        titleKeywords[bucket] = { applied: 0, responses: 0 };
                    titleKeywords[bucket].applied++;
                    if (row.status === 'response')
                        titleKeywords[bucket].responses++;
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                if (!titleKeywords['Other'])
                    titleKeywords['Other'] = { applied: 0, responses: 0 };
                titleKeywords['Other'].applied++;
                if (row.status === 'response')
                    titleKeywords['Other'].responses++;
            }
        }
        const byTitle = Object.entries(titleKeywords)
            .map(([title, data]) => ({ title, ...data, rate: data.applied > 0 ? Math.round((data.responses / data.applied) * 100) : 0 }))
            .sort((a, b) => b.applied - a.applied);
        // 5. Average days to response (for jobs that got a response)
        const responseTimeRows = await db.prepare(`
      SELECT
        EXTRACT(EPOCH FROM (status_updated_at - first_seen_at)) / 86400.0 AS days_to_response
      FROM jobs
      WHERE status = 'response'
        AND status_updated_at IS NOT NULL
        AND first_seen_at IS NOT NULL
    `).all() as any[];
        const avgDaysToResponse = responseTimeRows.length > 0
            ? Math.round(responseTimeRows.reduce((sum: number, r: any) => sum + (r.days_to_response || 0), 0) / responseTimeRows.length * 10) / 10
            : null;
        // 6. Weekly application velocity (apps per week over last N weeks)
        const weeksBack = Math.ceil(daysBack / 7);
        const weeklyVelocity = await db.prepare(`
      SELECT
        TO_CHAR(status_updated_at, 'IYYY-\"W\"IW') AS week,
        COUNT(*) as count
      FROM jobs
      WHERE status IN ('applied','followed_up','response','rejected')
        AND status_updated_at IS NOT NULL
        AND status_updated_at >= ?
      GROUP BY TO_CHAR(status_updated_at, 'IYYY-\"W\"IW')
      ORDER BY week ASC
    `).all(cutoff) as any[];
        // 7. OPT-friendly vs non-OPT response rates
        const optAnalysis = await db.prepare(`
      SELECT
        opt_friendly,
        COUNT(*) as applied,
        SUM(CASE WHEN status = 'response' THEN 1 ELSE 0 END) as responses
      FROM jobs
      WHERE status IN ('applied','followed_up','response','rejected')
        AND is_us_job(location) = 1
      GROUP BY opt_friendly
    `).all() as any[];
        // 8. Easy apply (Greenhouse/Lever/Ashby) vs hard apply (Workday etc.) response rates
        const difficultyAnalysis = await db.prepare(`
      SELECT
        CASE WHEN ats_source IN ('greenhouse','lever','ashby') THEN 'easy' ELSE 'hard' END as difficulty,
        COUNT(*) as applied,
        SUM(CASE WHEN status = 'response' THEN 1 ELSE 0 END) as responses
      FROM jobs
      WHERE status IN ('applied','followed_up','response','rejected')
        AND is_us_job(location) = 1
      GROUP BY CASE WHEN ats_source IN ('greenhouse','lever','ashby') THEN 'easy' ELSE 'hard' END
    `).all() as any[];
        return reply.send({
            funnel,
            apps_per_day: appsPerDay,
            weekly_velocity: weeklyVelocity,
            by_source: bySource.map(r => ({
                ...r,
                rate: r.applied > 0 ? Math.round((r.responses / r.applied) * 100) : 0,
            })),
            by_title: byTitle,
            avg_days_to_response: avgDaysToResponse,
            opt_analysis: optAnalysis.map(r => ({
                opt_friendly: !!r.opt_friendly,
                applied: r.applied,
                responses: r.responses,
                rate: r.applied > 0 ? Math.round((r.responses / r.applied) * 100) : 0,
            })),
            difficulty_analysis: difficultyAnalysis.map(r => ({
                ...r,
                rate: r.applied > 0 ? Math.round((r.responses / r.applied) * 100) : 0,
            })),
            period_days: daysBack,
        });
    });
    // GET /health
    app.get('/health', async (_request, reply) => {
        return reply.send({ status: 'ok' });
    });
}

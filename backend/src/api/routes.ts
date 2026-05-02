import { FastifyInstance } from 'fastify';
import db from '../db/database';
import { runCollection, isCollectionRunning } from '../orchestrator';
import { getPreferences, rescoreAllJobs } from '../scoring';
import { scoreResume, recencyMultiplier } from '../resume';
import { PDFParse } from 'pdf-parse';
import axios from 'axios';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { classifyUrl } from '../router/classifier';
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
type AiFillField = {
    label: string;
    type: string;
    options?: string[];
};
function isOpenEndedField(field: AiFillField): boolean {
    const label = field.label.toLowerCase();
    if (field.type === 'textarea') {
        return true;
    }
    if (field.type === 'select' || field.type === 'radio' || field.type === 'checkbox') {
        return false;
    }
    return [
        'why ',
        'why?',
        'tell us',
        'describe',
        'explain',
        'share',
        'interested',
        'motivation',
        'about yourself',
        'cover letter',
        'projects',
        'experience working',
        'what makes you',
        'how do you',
    ].some(pattern => label.includes(pattern)) || label.endsWith('?') || label.length > 80;
}
function chooseAiFillModel(field: AiFillField): 'gpt-5-nano' | 'gpt-5.1' {
    return isOpenEndedField(field) ? 'gpt-5.1' : 'gpt-5-nano';
}
async function buildAiFillPrompt(
    client: OpenAI,
    prompt: string,
    model: 'gpt-5-nano' | 'gpt-5.1',
): Promise<Record<string, string>> {
    const messages: Array<{
        role: 'system' | 'user';
        content: string;
    }> = [];
    if (writingStylePrompt)
        messages.push({ role: 'system', content: writingStylePrompt });
    messages.push({ role: 'user', content: prompt });
    const completion = await client.chat.completions.create({
        model,
        max_tokens: model === 'gpt-5.1' ? 1200 : 800,
        response_format: { type: 'json_object' },
        messages,
    });
    const raw = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    return parsed.answers || {};
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
async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    const queue = [...items];
    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
        while (queue.length > 0) {
            const item = queue.shift();
            if (item === undefined) return;
            await worker(item);
        }
    });
    await Promise.all(workers);
}
type StoredResumeRow = {
    id: number;
    label: string;
    filename: string;
    resume_text: string;
    is_default: boolean;
    uploaded_at: string;
};
function isSupportedResumeFile(file: { mimetype?: string; filename?: string }): boolean {
    const name = (file.filename || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (name.endsWith('.pdf') || name.endsWith('.txt') || name.endsWith('.tex')) return true;
    if (mime === 'application/pdf' || mime === 'text/plain') return true;
    if (mime.includes('tex') || mime === 'application/octet-stream') return true;
    return false;
}
async function parseUploadedResumeText(file: any): Promise<string> {
    const buffer = await file.toBuffer();
    const name = (file.filename || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    if (name.endsWith('.pdf') || mime === 'application/pdf') {
        const pdf = new PDFParse({ data: new Uint8Array(buffer) });
        const result = await pdf.getText();
        await pdf.destroy();
        return (result.text || '').trim();
    }

    return buffer.toString('utf-8').trim();
}
async function listStoredResumes(): Promise<StoredResumeRow[]> {
    let rows = await db.prepare(
        `SELECT id, label, filename, resume_text, is_default, uploaded_at
         FROM user_resumes
         ORDER BY is_default DESC, uploaded_at DESC`
    ).all() as StoredResumeRow[];
    if (rows.length > 0) return rows;

    // Backward-compat fallback for instances that still only have user_resume.
    const legacy = await db.prepare(
        `SELECT id, filename, resume_text, uploaded_at FROM user_resume WHERE id = 1`
    ).get() as any;
    if (legacy?.resume_text) {
        const inserted = await db.prepare(
            `INSERT INTO user_resumes (label, filename, resume_text, is_default, uploaded_at)
             VALUES ('Default', ?, ?, TRUE, COALESCE(?, NOW()))
             RETURNING id`
        ).run(
            legacy.filename || 'resume',
            legacy.resume_text,
            legacy.uploaded_at || null,
        );
        rows = await db.prepare(
            `SELECT id, label, filename, resume_text, is_default, uploaded_at
             FROM user_resumes
             WHERE id = ?`
        ).all(inserted.lastInsertRowid) as StoredResumeRow[];
    }
    return rows;
}
async function getDefaultResume(): Promise<StoredResumeRow | null> {
    const rows = await listStoredResumes();
    if (!rows.length) return null;
    return rows.find((r) => r.is_default) || rows[0];
}
async function getResumeForJob(jobId: number, resumeId?: number): Promise<StoredResumeRow | null> {
    if (resumeId) {
        const explicit = await db.prepare(
            `SELECT id, label, filename, resume_text, is_default, uploaded_at
             FROM user_resumes
             WHERE id = ?`
        ).get(resumeId) as StoredResumeRow | undefined;
        if (explicit) return explicit;
    }

    const scored = await db.prepare(
        `SELECT r.id, r.label, r.filename, r.resume_text, r.is_default, r.uploaded_at
         FROM job_resume_scores s
         JOIN user_resumes r ON r.id = s.resume_id
         WHERE s.job_id = ?
         ORDER BY s.score DESC, r.is_default DESC, r.uploaded_at DESC
         LIMIT 1`
    ).get(jobId) as StoredResumeRow | undefined;
    if (scored) return scored;
    return getDefaultResume();
}
function getFullJobDescription(job: any): string {
    let description = job.description_snippet || '';
    if (job.raw_json) {
        try {
            const raw = JSON.parse(job.raw_json);
            description = raw.description || raw.content || raw.descriptionPlain || raw.jobDescription || description;
        }
        catch { /* use snippet */ }
    }
    if (typeof description !== 'string') return '';
    return description;
}
export async function registerRoutes(app: FastifyInstance): Promise<void> {
    // GET /api/jobs
    app.get('/api/jobs', async (request, reply) => {
        const { status, ats_source, job_type, remote, search, hours, sort, entry_only, junior_only, limit = '50', offset = '0', } = request.query as Record<string, string>;
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
        // Junior filter: include all entry-level roles plus jobs requiring up
        // to 3 years of experience. `entry_only` kept as an alias for backward
        // compatibility with any saved links.
        if (junior_only === 'true' || entry_only === 'true') {
            conditions.push('((max_experience_years IS NOT NULL AND max_experience_years <= 3) OR is_entry_title(title) = 1)');
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
    // POST /api/priority-scan — rank top jobs across all resumes
    app.post('/api/priority-scan', async (request, reply) => {
        const { hours = '48', limit = '15' } = request.query as Record<string, string>;
        const hoursBack = Math.max(1, parseInt(hours) || 48);
        const lim = Math.min(Math.max(1, parseInt(limit) || 15), 50);
        const resumes = await listStoredResumes();
        if (!resumes.length) {
            return reply.code(400).send({ error: 'Upload at least one resume first.' });
        }

        const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
        const jobs = await db.prepare(
            `SELECT id, title, company, location, posted_at, status, apply_url, ats_source, description_snippet, raw_json,
                    opt_friendly, sponsor_tier, visa_signal
             FROM jobs
             WHERE is_us_job(location) = 1
               AND posted_at >= ?
               AND status IN ('new', 'saved', 'queued')
             ORDER BY posted_at DESC`
        ).all(cutoff) as any[];

        const upsertPairStmt = db.prepare(
            `INSERT INTO job_resume_scores (job_id, resume_id, score, details, scored_at)
             VALUES (?, ?, ?, ?::jsonb, NOW())
             ON CONFLICT (job_id, resume_id)
             DO UPDATE SET score = EXCLUDED.score, details = EXCLUDED.details, scored_at = NOW()`
        );
        const scoredByJob = new Map<number, Array<{
            resume_id: number;
            resume_label: string;
            raw_score: number;
            decayed_score: number;
            details: any;
            description: string;
        }>>();

        await runWithConcurrency(jobs, 5, async (job) => {
            let description = getFullJobDescription(job);
            if ((description || '').trim().length < 300 && job.ats_source === 'workday' && job.apply_url) {
                const wdDesc = await fetchWorkdayDescription(job.apply_url);
                if (wdDesc) description = wdDesc;
            }
            if (!description) return;

            const daysPosted = Math.floor((Date.now() - new Date(job.posted_at).getTime()) / (1000 * 60 * 60 * 24));
            const recency = recencyMultiplier(daysPosted);

            for (const resume of resumes) {
                const result = scoreResume(resume.resume_text, description);
                const decayedScore = Math.round(result.overall * recency);
                const details = {
                    skillsMatch: result.skillsMatch,
                    relevance: result.relevance,
                    visaSignal: result.visaSignal,
                    impact: result.impact,
                    matchedKeywords: result.matchedKeywords,
                    missingKeywords: result.missingKeywords,
                    resumeId: resume.id,
                    resumeLabel: resume.label,
                };
                await upsertPairStmt.run(job.id, resume.id, decayedScore, JSON.stringify(details));
                const prior = scoredByJob.get(job.id) || [];
                prior.push({
                    resume_id: resume.id,
                    resume_label: resume.label,
                    raw_score: result.overall,
                    decayed_score: decayedScore,
                    details,
                    description,
                });
                scoredByJob.set(job.id, prior);
            }
        });

        await db.prepare(
            `UPDATE jobs j
             SET hired_score = t.max_score
             FROM (
               SELECT job_id, MAX(score) AS max_score
               FROM job_resume_scores
               GROUP BY job_id
             ) t
             WHERE j.id = t.job_id`
        ).run();
        await db.prepare(
            `UPDATE jobs j
             SET hired_score_details = s.details::text
             FROM (
               SELECT DISTINCT ON (job_id) job_id, details, score
               FROM job_resume_scores
               ORDER BY job_id, score DESC, scored_at DESC
             ) s
             WHERE j.id = s.job_id`
        ).run();

        const ranked = jobs
            .map((job) => {
                const entries = scoredByJob.get(job.id) || [];
                if (!entries.length) return null;
                const best = entries.sort((a, b) => b.raw_score - a.raw_score)[0];
                const daysPosted = Math.floor((Date.now() - new Date(job.posted_at).getTime()) / (1000 * 60 * 60 * 24));
                const recency = recencyMultiplier(daysPosted);
                const optBoost = job.opt_friendly ? 1.10 : 1.0;
                const sponsorBoost = ['high', 'medium'].includes((job.sponsor_tier || '').toLowerCase()) ? 1.10 : 1.0;
                const visaPenalty = job.visa_signal === 0 ? 0.5 : 1.0;
                const titleBoost = /\b(intern|internship|co-?op|junior|entry|new grad|graduate|associate)\b/i.test(job.title || '') ? 1.05 : 1.0;
                const priority = Math.round(best.raw_score * recency * optBoost * sponsorBoost * visaPenalty * titleBoost);

                const why: string[] = [];
                why.push(`${best.raw_score}% resume match (${best.resume_label})`);
                if (job.opt_friendly) why.push('OPT friendly');
                if (job.sponsor_tier) why.push(`Sponsor tier: ${job.sponsor_tier}`);
                if (job.visa_signal === 0) why.push('No-sponsor language detected');
                why.push(`Posted ${Math.max(0, daysPosted)}d ago`);

                return {
                    ...job,
                    priority,
                    best_resume: {
                        id: best.resume_id,
                        label: best.resume_label,
                    },
                    best_score: best.raw_score,
                    why: why.slice(0, 4),
                };
            })
            .filter(Boolean)
            .sort((a: any, b: any) => b.priority - a.priority)
            .slice(0, lim);

        await db.prepare(
            `INSERT INTO priority_scan_runs (scanned_at, hours, limit_count, total_jobs_considered)
             VALUES (NOW(), ?, ?, ?)`
        ).run(hoursBack, lim, jobs.length);

        const lastScan = await db.prepare(
            `SELECT scanned_at, hours, limit_count, total_jobs_considered
             FROM priority_scan_runs
             ORDER BY id DESC
             LIMIT 1`
        ).get();

        return reply.send({
            jobs: ranked,
            total_considered: jobs.length,
            resumes_used: resumes.length,
            last_scan: lastScan,
        });
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
    // GET /api/resumes — list all stored resumes (without resume text)
    app.get('/api/resumes', async (_request, reply) => {
        const resumes = await listStoredResumes();
        return reply.send({
            resumes: resumes.map((r) => ({
                id: r.id,
                label: r.label,
                filename: r.filename,
                is_default: !!r.is_default,
                uploaded_at: r.uploaded_at,
            })),
        });
    });
    // POST /api/resumes — upload a labeled resume
    app.post('/api/resumes', async (request, reply) => {
        const existing = await listStoredResumes();
        if (existing.length >= 10) {
            return reply.code(400).send({ error: 'Maximum 10 resumes allowed' });
        }
        const file = await request.file();
        if (!file)
            return reply.code(400).send({ error: 'No file uploaded' });
        if (!isSupportedResumeFile(file)) {
            return reply.code(400).send({ error: 'Only PDF, TXT, and .tex files are supported' });
        }
        const text = await parseUploadedResumeText(file);
        if (!text.trim()) {
            return reply.code(400).send({ error: 'Could not extract text from file' });
        }
        const rawLabelField = (file as any).fields?.label;
        const fieldLabel = typeof rawLabelField === 'string'
            ? rawLabelField
            : typeof rawLabelField?.value === 'string'
                ? rawLabelField.value
                : '';
        const label = (fieldLabel || file.filename.replace(/\.[^.]+$/, '') || 'Resume').trim().slice(0, 80);
        const hasDefault = existing.some((r) => r.is_default);
        const inserted = await db.prepare(
            `INSERT INTO user_resumes (label, filename, resume_text, is_default, uploaded_at)
             VALUES (?, ?, ?, ?, NOW())
             RETURNING id`
        ).run(label || 'Resume', file.filename, text.trim(), hasDefault ? 0 : 1);
        return reply.send({
            ok: true,
            resume: {
                id: inserted.lastInsertRowid,
                label: label || 'Resume',
                filename: file.filename,
                is_default: !hasDefault,
            },
        });
    });
    // PATCH /api/resumes/:id — rename or set default
    app.patch('/api/resumes/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const resumeId = parseInt(id);
        if (isNaN(resumeId)) return reply.code(400).send({ error: 'Invalid resume id' });
        const { label, is_default } = request.body as { label?: string; is_default?: boolean };

        const existing = await db.prepare(
            `SELECT id FROM user_resumes WHERE id = ?`
        ).get(resumeId) as { id: number } | undefined;
        if (!existing) return reply.code(404).send({ error: 'Resume not found' });

        if (typeof label === 'string') {
            await db.prepare(`UPDATE user_resumes SET label = ? WHERE id = ?`).run(label.trim().slice(0, 80) || 'Resume', resumeId);
        }
        if (is_default === true) {
            await db.prepare(`UPDATE user_resumes SET is_default = FALSE`).run();
            await db.prepare(`UPDATE user_resumes SET is_default = TRUE WHERE id = ?`).run(resumeId);
        }
        return reply.send({ ok: true });
    });
    // DELETE /api/resumes/:id — remove one resume
    app.delete('/api/resumes/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const resumeId = parseInt(id);
        if (isNaN(resumeId)) return reply.code(400).send({ error: 'Invalid resume id' });
        const current = await db.prepare(
            `SELECT id, is_default FROM user_resumes WHERE id = ?`
        ).get(resumeId) as { id: number; is_default: boolean } | undefined;
        if (!current) return reply.code(404).send({ error: 'Resume not found' });

        await db.prepare(`DELETE FROM user_resumes WHERE id = ?`).run(resumeId);
        if (current.is_default) {
            const next = await db.prepare(`SELECT id FROM user_resumes ORDER BY uploaded_at DESC LIMIT 1`).get() as { id: number } | undefined;
            if (next) {
                await db.prepare(`UPDATE user_resumes SET is_default = TRUE WHERE id = ?`).run(next.id);
            }
        }
        return reply.send({ ok: true });
    });
    // POST /api/resume/upload — compatibility shim (writes default resume)
    app.post('/api/resume/upload', async (request, reply) => {
        const file = await request.file();
        if (!file)
            return reply.code(400).send({ error: 'No file uploaded' });
        if (!isSupportedResumeFile(file)) {
            return reply.code(400).send({ error: 'Only PDF, TXT, and .tex files are supported' });
        }
        const text = await parseUploadedResumeText(file);
        if (!text.trim()) {
            return reply.code(400).send({ error: 'Could not extract text from file' });
        }

        const defaultResume = await getDefaultResume();
        if (defaultResume) {
            await db.prepare(
                `UPDATE user_resumes
                 SET filename = ?, resume_text = ?, uploaded_at = NOW()
                 WHERE id = ?`
            ).run(file.filename, text.trim(), defaultResume.id);
        } else {
            await db.prepare(
                `INSERT INTO user_resumes (label, filename, resume_text, is_default, uploaded_at)
                 VALUES ('Default', ?, ?, TRUE, NOW())`
            ).run(file.filename, text.trim());
        }

        // Keep legacy single-resume table in sync for extension compatibility.
        await db.prepare(`INSERT INTO user_resume (id, filename, resume_text, uploaded_at)
       VALUES (1, ?, ?, NOW())
       ON CONFLICT(id) DO UPDATE SET
         filename = excluded.filename,
         resume_text = excluded.resume_text,
         uploaded_at = excluded.uploaded_at`).run(file.filename, text.trim());
        return reply.send({ ok: true, filename: file.filename, length: text.length });
    });
    // GET /api/resume — get stored resume
    app.get('/api/resume', async (_request, reply) => {
        const row = await getDefaultResume();
        if (!row || !row.resume_text) {
            return reply.send({ uploaded: false });
        }
        return reply.send({
            uploaded: true,
            resumeId: row.id,
            label: row.label,
            filename: row.filename,
            resumeText: row.resume_text,
            uploadedAt: row.uploaded_at,
        });
    });
    async function scoreAllJobsForResume(resume: StoredResumeRow): Promise<{ scored: number; skipped: number; total: number }> {
        const jobs = await db.prepare(
            `SELECT id, ats_source, apply_url, description_snippet, raw_json, posted_at
             FROM jobs
             WHERE is_us_job(location) = 1`
        ).all() as any[];
        const upsertPairStmt = db.prepare(
            `INSERT INTO job_resume_scores (job_id, resume_id, score, details, scored_at)
             VALUES (?, ?, ?, ?::jsonb, NOW())
             ON CONFLICT (job_id, resume_id)
             DO UPDATE SET score = EXCLUDED.score, details = EXCLUDED.details, scored_at = NOW()`
        );
        const visaUpdateStmt = db.prepare('UPDATE jobs SET visa_signal = ? WHERE id = ?');
        let scored = 0;
        let skipped = 0;

        await runWithConcurrency(jobs, 6, async (job) => {
            let description = getFullJobDescription(job);
            if ((description || '').trim().length < 300 && job.ats_source === 'workday' && job.apply_url) {
                const wdDesc = await fetchWorkdayDescription(job.apply_url);
                if (wdDesc)
                    description = wdDesc;
            }
            if (!description) {
                skipped++;
                return;
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
                resumeId: resume.id,
                resumeLabel: resume.label,
            });
            const visaSignal = quickVisaSignal(description);
            await upsertPairStmt.run(job.id, resume.id, decayedScore, details);
            await visaUpdateStmt.run(visaSignal, job.id);
            scored++;
        });

        await db.prepare(
            `UPDATE jobs j
             SET hired_score = t.max_score
             FROM (
               SELECT job_id, MAX(score) AS max_score
               FROM job_resume_scores
               GROUP BY job_id
             ) t
             WHERE j.id = t.job_id`
        ).run();
        await db.prepare(
            `UPDATE jobs j
             SET hired_score_details = s.details::text
             FROM (
               SELECT DISTINCT ON (job_id) job_id, details, score
               FROM job_resume_scores
               ORDER BY job_id, score DESC, scored_at DESC
             ) s
             WHERE j.id = s.job_id`
        ).run();

        return { scored, skipped, total: jobs.length };
    }
    // POST /api/resume/analyze — score resume against a specific job
    app.post('/api/resume/analyze', async (request, reply) => {
        const { jobId, resumeId } = request.body as {
            jobId: number;
            resumeId?: number;
        };
        const resume = await getResumeForJob(jobId, resumeId);
        if (!resume?.resume_text) {
            return reply.code(400).send({ error: 'No resume uploaded. Upload your resume first.' });
        }
        const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
        if (!job) {
            return reply.code(404).send({ error: 'Job not found' });
        }
        // Use full description from raw_json if available, else snippet
        let description = getFullJobDescription(job);
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
        return reply.send({
            ...result,
            resume: {
                id: resume.id,
                label: resume.label,
                filename: resume.filename,
            },
        });
    });
    // POST /api/resumes/:id/score-all — score all jobs for one resume
    app.post('/api/resumes/:id/score-all', async (request, reply) => {
        const { id } = request.params as { id: string };
        const resumeId = parseInt(id);
        if (isNaN(resumeId)) return reply.code(400).send({ error: 'Invalid resume id' });
        const resume = await db.prepare(
            `SELECT id, label, filename, resume_text, is_default, uploaded_at FROM user_resumes WHERE id = ?`
        ).get(resumeId) as StoredResumeRow | undefined;
        if (!resume) return reply.code(404).send({ error: 'Resume not found' });
        const result = await scoreAllJobsForResume(resume);
        return reply.send({ ok: true, resumeId, ...result });
    });
    // POST /api/resume/score-all — batch score all jobs against uploaded resume
    app.post('/api/resume/score-all', async (_request, reply) => {
        const resume = await getDefaultResume();
        if (!resume?.resume_text) {
            return reply.code(400).send({ error: 'No resume uploaded. Upload your resume first.' });
        }
        const result = await scoreAllJobsForResume(resume);
        return reply.send({ ok: true, ...result });
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
        const { jobId, jobDescription, resumeId } = request.body as {
            jobId?: number;
            jobDescription?: string;
            resumeId?: number;
        };
        if (!jobId && !jobDescription?.trim()) {
            return reply.code(400).send({ error: 'Either jobId or jobDescription is required' });
        }
        const resume = await getResumeForJob(jobId || -1, resumeId);
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
            model: 'gpt-5',
            max_tokens: 600,
            messages,
        });
        const text = completion.choices[0]?.message?.content || '';
        return reply.send({
            ok: true,
            coverLetter: text,
            jobTitle,
            company: jobCompany,
            resume: {
                id: resume.id,
                label: resume.label,
                filename: resume.filename,
            },
        });
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
            model: 'gpt-5',
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
        const { fields, profile, jobDescription, jobId, resumeId } = request.body as {
            fields: AiFillField[];
            profile: Record<string, any>;
            jobDescription?: string;
            jobId?: number;
            resumeId?: number;
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
        const profileAnswers = p.answers || {};
        // Include uploaded resume for richer context (skills, experience, projects)
        const resumeRow = await getResumeForJob(jobId || -1, resumeId);
        const resumeSection = resumeRow?.resume_text
            ? `\n## Candidate Resume\n${resumeRow.resume_text.slice(0, 3000)}\n`
            : '';
        const jdSection = jobDescription?.trim()
            ? `\n## Job Description\n${jobDescription.slice(0, 2000)}\n`
            : '';
        try {
            const client = new OpenAI({ apiKey });
            const aiAnswers: Record<string, string> = {};
            const groupedFields = {
                'gpt-5-nano': cappedFields.filter(field => chooseAiFillModel(field) === 'gpt-5-nano'),
                'gpt-5.1': cappedFields.filter(field => chooseAiFillModel(field) === 'gpt-5.1'),
            } as const;
            for (const [model, modelFields] of Object.entries(groupedFields) as Array<['gpt-5-nano' | 'gpt-5.1', AiFillField[]]>) {
                if (!modelFields.length) continue;
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
Years of experience: ${profileAnswers.years_experience || ''}
Highest education: ${profileAnswers.highest_education || ''} in ${profileAnswers.degree_field || ''}
Salary expectation: $${profileAnswers.salary_expectation || ''}
Notice period: ${profileAnswers.notice_period || ''}
Pronouns: ${profileAnswers.pronouns || ''}
${resumeSection}${jdSection}
## Form Fields to Fill
${JSON.stringify(modelFields, null, 2)}

## Instructions
- For "select" or "radio" fields, you MUST choose one of the provided options exactly as written.
- For "text" or "textarea" fields, write a concise, professional answer based on the profile and resume.
- For yes/no questions not in the profile, use the profile context to infer the best answer.
- If you cannot determine a good answer, use an empty string "".
- Output ONLY valid JSON in this exact format, no prose, no markdown code fences:
{"answers": {"<label text>": "<answer>", ...}}`;
                const modelAnswers = await buildAiFillPrompt(client, prompt, model);
                Object.assign(aiAnswers, modelAnswers);
            }
            return reply.send({ answers: aiAnswers });
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
                model: 'gpt-5',
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

    // ── Queue Endpoints ────────────────────────────────────────────────────────
    // GET /api/jobs/queue — return queued jobs ordered by queue_position
    app.get('/api/jobs/queue', async (request, reply) => {
        const { mode } = request.query as { mode?: string };
        let query = `SELECT * FROM jobs WHERE status = 'queued' AND queue_position IS NOT NULL`;
        const params: any[] = [];
        if (mode === 'bulk' || mode === 'assisted') {
            query += ` AND mode = ?`;
            params.push(mode);
        }
        query += ` ORDER BY queue_position ASC`;
        const jobs = await db.prepare(query).all(...params);
        return reply.send({ jobs, total: jobs.length });
    });

    // POST /api/jobs/:id/queue — add job to queue (assign next queue_position)
    // Uses a subquery so the MAX read and the UPDATE are a single atomic statement,
    // eliminating the race condition that existed with a separate SELECT + UPDATE.
    app.post('/api/jobs/:id/queue', async (request, reply) => {
        const { id } = request.params as { id: string };
        const jobId = parseInt(id);
        // Get apply_url for classification
        const job = await db.prepare('SELECT apply_url FROM jobs WHERE id = ?').get<{ apply_url: string }>(jobId);
        if (!job) return reply.code(404).send({ error: 'job not found' });
        const mode = classifyUrl(job.apply_url);
        const row = await db.prepare(
            `UPDATE jobs
             SET status = 'queued',
                 mode = ?,
                 queue_position = (
                   SELECT COALESCE(MAX(q.queue_position), 0) + 1
                   FROM jobs q
                   WHERE q.status = 'queued' AND q.id != ?
                 ),
                 status_updated_at = NOW()
             WHERE id = ?
             RETURNING queue_position`
        ).get<{ queue_position: number }>(mode, jobId, jobId);
        return reply.send({ ok: true, queue_position: row?.queue_position ?? 1 });
    });

    // DELETE /api/jobs/:id/queue — remove from queue (restore to saved)
    app.delete('/api/jobs/:id/queue', async (request, reply) => {
        const { id } = request.params as { id: string };
        await db.prepare(
            `UPDATE jobs SET status = 'saved', queue_position = NULL, status_updated_at = NOW() WHERE id = ?`
        ).run(parseInt(id));
        return reply.send({ ok: true });
    });

    // PATCH /api/jobs/:id/queue-mode — override mode (bulk|assisted) or auto-demote
    app.patch('/api/jobs/:id/queue-mode', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { mode, mode_reason } = request.body as { mode: string; mode_reason?: string };
        if (mode !== 'bulk' && mode !== 'assisted') {
            return reply.code(400).send({ error: "mode must be 'bulk' or 'assisted'" });
        }
        const sets = ['mode = ?'];
        const params: any[] = [mode];
        if (mode_reason !== undefined) { sets.push('mode_reason = ?'); params.push(mode_reason); }
        params.push(parseInt(id));
        const result = await db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        if (result.changes === 0) return reply.code(404).send({ error: 'job not found' });
        return reply.send({ ok: true });
    });

    // PATCH /api/jobs/:id/queue-position — reorder within queue
    // Shifts the surrounding jobs to keep positions contiguous and unique.
    app.patch('/api/jobs/:id/queue-position', async (request, reply) => {
        const { id } = request.params as { id: string };
        const { position } = request.body as { position: number };
        if (typeof position !== 'number' || position < 1) {
            return reply.code(400).send({ error: 'position must be a positive number' });
        }
        const jobId = parseInt(id);
        const current = await db.prepare(
            `SELECT queue_position FROM jobs WHERE id = ? AND status = 'queued'`
        ).get<{ queue_position: number }>(jobId);
        if (!current) return reply.code(404).send({ error: 'job not found in queue' });
        const currentPos = current.queue_position;
        if (currentPos !== position) {
            if (position < currentPos) {
                // Moving up: push jobs in [newPos, currentPos) down by one
                await db.prepare(
                    `UPDATE jobs SET queue_position = queue_position + 1
                     WHERE status = 'queued' AND id != ? AND queue_position >= ? AND queue_position < ?`
                ).run(jobId, position, currentPos);
            } else {
                // Moving down: pull jobs in (currentPos, newPos] up by one
                await db.prepare(
                    `UPDATE jobs SET queue_position = queue_position - 1
                     WHERE status = 'queued' AND id != ? AND queue_position > ? AND queue_position <= ?`
                ).run(jobId, currentPos, position);
            }
            await db.prepare(
                `UPDATE jobs SET queue_position = ? WHERE id = ?`
            ).run(position, jobId);
        }
        return reply.send({ ok: true });
    });

    // POST /api/jobs/bulk-queue — queue multiple jobs at once
    app.post('/api/jobs/bulk-queue', async (request, reply) => {
        const { ids } = request.body as { ids: number[] };
        if (!Array.isArray(ids) || ids.length === 0) {
            return reply.code(400).send({ error: 'ids array is required' });
        }
        const maxRow = await db.prepare(
            `SELECT COALESCE(MAX(queue_position), 0) AS max_pos FROM jobs WHERE status = 'queued'`
        ).get() as any;
        let nextPos = (Number(maxRow?.max_pos) || 0) + 1;
        for (const id of ids) {
            await db.prepare(
                `UPDATE jobs SET status = 'queued', queue_position = ?, status_updated_at = NOW() WHERE id = ?`
            ).run(nextPos++, id);
        }
        return reply.send({ ok: true, queued: ids.length });
    });

    // ── Answer Cache Endpoints ─────────────────────────────────────────────────
    // GET /api/cache/lookup — look up a cached answer by question hash
    // Used by the Playwright form engine (playwright/src/form-engine.ts).
    app.get('/api/cache/lookup', async (request, reply) => {
        const { hash } = request.query as { hash?: string };
        if (!hash) return reply.code(400).send({ error: 'hash query param is required' });
        const row = await db.prepare(
            `SELECT answer, confidence FROM answer_cache
             WHERE question_hash = ?
             ORDER BY confidence DESC, last_used_at DESC NULLS LAST
             LIMIT 1`
        ).get<{ answer: string; confidence: number }>(hash);
        if (!row) return reply.code(404).send({ error: 'not found' });
        // Bump usage counter without blocking the response
        db.prepare(
            `UPDATE answer_cache SET times_used = times_used + 1, last_used_at = NOW()
             WHERE question_hash = ?`
        ).run(hash).catch(() => {});
        return reply.send({ answer: row.answer, confidence: row.confidence });
    });

    // GET /api/cache — list all cached answers
    app.get('/api/cache', async (request, reply) => {
        const { limit = '50', offset = '0', search } = request.query as {
            limit?: string;
            offset?: string;
            search?: string;
        };
        const lim = Math.min(parseInt(limit) || 50, 500);
        const off = parseInt(offset) || 0;
        const conditions: string[] = [];
        const params: any[] = [];
        if (search) {
            conditions.push('question_text ILIKE ?');
            params.push(`%${search}%`);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const totalRow = await db.prepare(
            `SELECT COUNT(*) AS count FROM answer_cache ${where}`
        ).get<{ count: number }>(...params);
        const total = Number(totalRow?.count ?? 0);
        const entries = await db.prepare(
            `SELECT id, question_text, answer, source, confidence, times_used, last_used_at, created_at
             FROM answer_cache ${where}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`
        ).all(...params, lim, off);
        return reply.send({ entries, total });
    });

    // POST /api/cache — create or update a cached answer
    app.post('/api/cache', async (request, reply) => {
        const { question_text, answer, source, confidence } = request.body as {
            question_text: string;
            answer: string;
            source: string;
            confidence?: number;
        };
        if (!question_text || !answer || !source) {
            return reply.code(400).send({ error: 'question_text, answer, and source are required' });
        }
        const hash = createHash('sha256').update(question_text.trim().toLowerCase()).digest('hex');
        const conf = confidence !== undefined ? confidence : (source === 'manual_correction' ? 1.0 : source === 'manual_first_fill' ? 0.9 : 0.5);
        const result = await db.prepare(
            `INSERT INTO answer_cache (question_text, question_hash, answer, source, confidence)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (question_hash) DO UPDATE SET
               answer = CASE
                 WHEN EXCLUDED.source = 'manual_correction' OR EXCLUDED.confidence >= answer_cache.confidence
                 THEN EXCLUDED.answer
                 ELSE answer_cache.answer
               END,
               source = CASE
                 WHEN EXCLUDED.source = 'manual_correction' OR EXCLUDED.confidence >= answer_cache.confidence
                 THEN EXCLUDED.source
                 ELSE answer_cache.source
               END,
               confidence = CASE
                 WHEN EXCLUDED.confidence >= answer_cache.confidence
                 THEN EXCLUDED.confidence
                 ELSE answer_cache.confidence
               END,
               last_used_at = NOW()
             RETURNING id`
        ).run(question_text.trim(), hash, answer, source, conf);
        return reply.send({ ok: true, id: result.lastInsertRowid });
    });

    // PATCH /api/cache/:id — update a specific cache entry
    app.patch('/api/cache/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const numId = parseInt(id);
        if (isNaN(numId)) return reply.code(400).send({ error: 'Invalid id' });
        const { answer, source, confidence } = request.body as {
            answer?: string;
            source?: string;
            confidence?: number;
        };
        const sets: string[] = [];
        const params: any[] = [];
        if (answer !== undefined) { sets.push('answer = ?'); params.push(answer); }
        if (source !== undefined) { sets.push('source = ?'); params.push(source); }
        if (confidence !== undefined) { sets.push('confidence = ?'); params.push(confidence); }
        if (sets.length === 0) {
            return reply.code(400).send({ error: 'No fields to update' });
        }
        sets.push('last_used_at = NOW()');
        params.push(numId);
        const result = await db.prepare(
            `UPDATE answer_cache SET ${sets.join(', ')} WHERE id = ?`
        ).run(...params);
        if (result.changes === 0) return reply.code(404).send({ error: 'not found' });
        return reply.send({ ok: true });
    });

    // DELETE /api/cache/:id — delete a cache entry
    app.delete('/api/cache/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const numId = parseInt(id);
        if (isNaN(numId)) return reply.code(400).send({ error: 'Invalid id' });
        await db.prepare('DELETE FROM answer_cache WHERE id = ?').run(numId);
        return reply.send({ ok: true });
    });

    // ── Application Session Endpoints ─────────────────────────────────────────
    // POST /api/sessions — save an application session from the Playwright engine
    app.post('/api/sessions', async (request, reply) => {
        const { jobId, adapterName, fillResults, appliedAt } = request.body as {
            jobId: number;
            adapterName?: string;
            fillResults?: Array<{ label: string; value: string; source: string }>;
            appliedAt?: string;
        };
        if (!jobId) return reply.code(400).send({ error: 'jobId is required' });

        const fieldsFilled = fillResults?.filter(f => f.source !== 'unfilled').length ?? 0;
        const fieldsTotal = fillResults?.length ?? 0;
        const fieldsCorrected = 0; // Updated later by correction detection

        const result = await db.prepare(
            `INSERT INTO application_sessions
             (job_id, status, fields_total, fields_filled, fields_corrected, adapter_used, completed_at, form_snapshot)
             VALUES (?, 'submitted', ?, ?, ?, ?, ?, ?)`
        ).run(
            jobId,
            fieldsTotal,
            fieldsFilled,
            fieldsCorrected,
            adapterName ?? 'unknown',
            appliedAt ?? new Date().toISOString(),
            JSON.stringify(fillResults ?? []),
        );

        return reply.send({ ok: true, id: result.lastInsertRowid });
    });

    // GET /api/sessions — list recent application sessions
    app.get('/api/sessions', async (request, reply) => {
        const { limit = '20', offset = '0' } = request.query as { limit?: string; offset?: string };
        const lim = Math.min(parseInt(limit) || 20, 100);
        const off = parseInt(offset) || 0;
        const sessions = await db.prepare(
            `SELECT s.*, j.title, j.company
             FROM application_sessions s
             LEFT JOIN jobs j ON j.id = s.job_id
             ORDER BY s.started_at DESC
             LIMIT ? OFFSET ?`
        ).all(lim, off);
        const totalRow = await db.prepare('SELECT COUNT(*) AS count FROM application_sessions').get<{ count: number }>();
        return reply.send({ sessions, total: Number(totalRow?.count ?? 0) });
    });

    // PATCH /api/sessions/:id — update session (e.g. after correction detection)
    app.patch('/api/sessions/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const numId = parseInt(id);
        if (isNaN(numId)) return reply.code(400).send({ error: 'Invalid id' });
        const { fields_corrected, form_snapshot } = request.body as {
            fields_corrected?: number;
            form_snapshot?: any;
        };
        const sets: string[] = [];
        const params: any[] = [];
        if (fields_corrected !== undefined) { sets.push('fields_corrected = ?'); params.push(fields_corrected); }
        if (form_snapshot !== undefined) { sets.push('form_snapshot = ?'); params.push(JSON.stringify(form_snapshot)); }
        if (sets.length === 0) return reply.code(400).send({ error: 'No fields to update' });
        params.push(numId);
        await db.prepare(`UPDATE application_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        return reply.send({ ok: true });
    });

    // POST /api/outreach — Cold Outreach / Referral Generator
    app.post('/api/outreach', async (request, reply) => {
        const { jobId, hiringManagerName } = request.body as { jobId: number, hiringManagerName: string };
        const job = await db.prepare('SELECT title, company, description_snippet FROM jobs WHERE id = ?').get(jobId) as any;
        if (!job) return reply.code(404).send({ error: 'Job not found' });

        if (!process.env.OPENAI_API_KEY) {
            return reply.code(400).send({ error: 'OPENAI_API_KEY not configured' });
        }

        try {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const prompt = `Write a short, professional LinkedIn cold outreach message to a hiring manager named ${hiringManagerName} at ${job.company} for the "${job.title}" role. Emphasize that I am an international student/professional looking for roles that support OPT/H1B, and express interest in an informational interview. Keep it under 100 words. Job snippet: ${job.description_snippet}`;
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }]
            });
            return reply.send({ message: completion.choices[0].message.content });
        } catch (err: any) {
            return reply.code(500).send({ error: err.message });
        }
    });

    // POST /api/storybank — "Job Archetype" & Story Bank Tracking
    app.post('/api/storybank', async (request, reply) => {
        const { title, archetype, situation, task, action, result, reflection } = request.body as any;
        if (!title || !archetype) return reply.code(400).send({ error: 'title and archetype are required' });
        
        // Note: In a full implementation, you'd add this table in schema.sql. For now, creating dynamically if missing.
        await db.exec(`CREATE TABLE IF NOT EXISTS story_bank (
            id SERIAL PRIMARY KEY, title TEXT, archetype TEXT, 
            situation TEXT, task TEXT, action TEXT, result TEXT, reflection TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
        )`);
        
        const stmt = db.prepare(`INSERT INTO story_bank (title, archetype, situation, task, action, result, reflection) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const info = await stmt.run(title, archetype, situation || '', task || '', action || '', result || '', reflection || '');
        return reply.send({ id: info.lastInsertRowid });
    });

    // GET /api/storybank — Get stories (optionally filter by archetype)
    app.get('/api/storybank', async (request, reply) => {
        const { archetype } = request.query as { archetype?: string };
        try {
            const rows = archetype
                ? await db.prepare('SELECT * FROM story_bank WHERE archetype = ? ORDER BY created_at DESC').all(archetype)
                : await db.prepare('SELECT * FROM story_bank ORDER BY created_at DESC').all();
            return reply.send(rows);
        } catch {
            return reply.send([]);
        }
    });

    // DELETE /api/storybank/:id — Remove a story
    app.delete('/api/storybank/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const numId = parseInt(id);
        if (isNaN(numId)) return reply.code(400).send({ error: 'Invalid id' });
        await db.prepare('DELETE FROM story_bank WHERE id = ?').run(numId);
        return reply.send({ ok: true });
    });

    // POST /api/jobs/:id/analyze-visa — Deep visa-clause analysis using OpenAI
    // Reads the full job description and extracts explicit sponsorship clauses,
    // citizenship requirements, clearance requirements. Result is cached on the job.
    app.post('/api/jobs/:id/analyze-visa', async (request, reply) => {
        const { id } = request.params as { id: string };
        const numId = parseInt(id);
        if (isNaN(numId)) return reply.code(400).send({ error: 'Invalid id' });

        const job = await db.prepare(
            'SELECT id, title, company, description_snippet, raw_json, visa_clauses FROM jobs WHERE id = ?'
        ).get(numId) as any;
        if (!job) return reply.code(404).send({ error: 'Job not found' });

        // Return cached result if available
        if (job.visa_clauses) {
            try {
                return reply.send({ ...JSON.parse(job.visa_clauses), cached: true });
            } catch { /* fall through to recompute */ }
        }

        if (!process.env.OPENAI_API_KEY) {
            return reply.code(400).send({ error: 'OPENAI_API_KEY not configured' });
        }

        // Reconstruct full description from raw_json when present
        let description = job.description_snippet || '';
        if (job.raw_json) {
            try {
                const raw = JSON.parse(job.raw_json);
                const full = raw.description || raw.content || raw.descriptionPlain || raw.jobDescription;
                if (typeof full === 'string' && full.length > description.length) {
                    description = stripHtml(full);
                }
            } catch { /* ignore */ }
        }
        description = description.slice(0, 8000);

        const prompt = `Analyze the following job description and extract any explicit visa/work-authorization clauses.
Return strict JSON with this shape:
{
  "sponsorship_offered": true | false | null,
  "sponsorship_denied": true | false | null,
  "citizenship_required": true | false | null,
  "clearance_required": true | false | null,
  "summary": "one-sentence plain-English summary",
  "evidence": ["short verbatim quote 1", "short verbatim quote 2"]
}

Rules:
- "sponsorship_offered": true only if the JD explicitly says they sponsor visas / H1B / OPT.
- "sponsorship_denied": true if they explicitly say they will NOT sponsor.
- "citizenship_required": true if it says US Citizen / permanent resident / green card required.
- "clearance_required": true if it mentions security clearance.
- Use null when the JD is silent — do not guess.
- evidence: up to 3 short verbatim quotes (max 25 words each) supporting your answers. Empty array if nothing relevant.

Job: ${job.title} @ ${job.company}
Description:
${description}`;

        try {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                response_format: { type: 'json_object' },
                messages: [{ role: 'user', content: prompt }],
            });
            const raw = completion.choices[0]?.message?.content || '{}';
            const parsed = JSON.parse(raw);

            await db.prepare('UPDATE jobs SET visa_clauses = ? WHERE id = ?').run(JSON.stringify(parsed), numId);

            // Auto-update visa_signal when the analyzer finds a definitive answer
            if (parsed.sponsorship_denied === true || parsed.citizenship_required === true) {
                await db.prepare('UPDATE jobs SET visa_signal = 0 WHERE id = ?').run(numId);
            } else if (parsed.sponsorship_offered === true) {
                await db.prepare('UPDATE jobs SET visa_signal = 100 WHERE id = ?').run(numId);
            }

            return reply.send({ ...parsed, cached: false });
        } catch (err: any) {
            return reply.code(500).send({ error: err.message });
        }
    });

    // POST /api/archetypes/backfill — One-shot backfill of archetype on existing jobs
    app.post('/api/archetypes/backfill', async (_request, reply) => {
        const { classifyArchetype } = await import('../data/archetypes');
        const rows = await db.prepare(
            'SELECT id, title, description_snippet FROM jobs WHERE archetype IS NULL'
        ).all() as { id: number; title: string; description_snippet: string }[];
        const stmt = db.prepare('UPDATE jobs SET archetype = ? WHERE id = ?');
        for (const row of rows) {
            await stmt.run(classifyArchetype(row.title, row.description_snippet || ''), row.id);
        }
        return reply.send({ ok: true, updated: rows.length });
    });
}

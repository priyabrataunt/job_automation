# JD Context Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Job Context" section to the chrome extension popup that lets users paste a JD for AI-fill context, cover letter generation, and auto-adding the job to the tracker — all persisted in `chrome.storage.local` until manually cleared.

**Architecture:** Three backend endpoints in `routes.ts` are added/modified; two extension files (`popup.html`, `popup.js`) get the new UI section and wiring; `content.js` is updated to forward `jobDescription` from the popup message to the backend AI-fill call.

**Tech Stack:** TypeScript + Fastify (backend), Vanilla JS + Chrome Extension APIs (frontend), better-sqlite3, OpenAI gpt-4o-mini

---

## File Map

| File | Change |
|------|--------|
| `backend/src/api/routes.ts` | Add `POST /api/jobs/from-jd`; modify `POST /api/ai-fill`; modify `POST /api/cover-letter` |
| `chrome-extension/popup.html` | Add "Job Context" section HTML + styles |
| `chrome-extension/src/popup.js` | Load/save JD state, wire all new buttons, pass context to autofill + cover letter |
| `chrome-extension/src/content.js` | Forward `jobDescription` from AUTOFILL message to backend POST body |

---

## Task 1: Add `POST /api/jobs/from-jd` endpoint

**Files:**
- Modify: `backend/src/api/routes.ts` (after the `POST /api/cover-letter` block, around line 582)

- [ ] **Step 1: Add the endpoint to routes.ts**

Insert this block directly after the closing `});` of `POST /api/cover-letter` (after line ~581):

```typescript
  // POST /api/jobs/from-jd — extract job details from pasted JD and add to tracker
  app.post('/api/jobs/from-jd', async (request, reply) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your_api_key_here') {
      return reply.code(503).send({ error: 'OPENAI_API_KEY not configured.' });
    }

    const { jdText } = request.body as { jdText: string };
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

    let extracted: { company?: string; title?: string; location?: string; description_snippet?: string } = {};
    try {
      extracted = JSON.parse(extraction.choices[0]?.message?.content || '{}');
    } catch {
      return reply.code(500).send({ error: 'Failed to parse job details from JD' });
    }

    const company = (extracted.company || 'Unknown Company').trim();
    const title = (extracted.title || 'Unknown Role').trim();
    const location = (extracted.location || '').trim();
    const snippet = (extracted.description_snippet || jdText.slice(0, 300)).trim();

    const externalId = `jd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const result = db.prepare(`
      INSERT INTO jobs (external_id, title, company, ats_source, location, remote, apply_url,
        job_type, experience_level, department, description_snippet, status, raw_json, first_seen_at)
      VALUES (?, ?, ?, 'manual', ?, 0, '', 'fulltime', 'entry', '', ?, 'saved', '{}', datetime('now'))
    `).run(externalId, title, company, location, snippet);

    return reply.send({ jobId: result.lastInsertRowid, company, title, location });
  });
```

- [ ] **Step 2: Restart the backend and test with curl**

```bash
curl -s -X POST http://localhost:8000/api/jobs/from-jd \
  -H 'Content-Type: application/json' \
  -d '{"jdText":"Software Engineer at Acme Corp in San Francisco, CA. We are looking for a backend engineer with 2+ years of Node.js experience to build scalable APIs. Responsibilities: design REST APIs, write tests, collaborate with product team."}' | jq .
```

Expected output (values will vary):
```json
{
  "jobId": 123,
  "company": "Acme Corp",
  "title": "Software Engineer",
  "location": "San Francisco, CA"
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/routes.ts
git commit -m "feat: add POST /api/jobs/from-jd endpoint to create tracker entry from pasted JD"
```

---

## Task 2: Modify `/api/ai-fill` to accept optional `jobDescription`

**Files:**
- Modify: `backend/src/api/routes.ts` (the `POST /api/ai-fill` block, around line 583–666)

- [ ] **Step 1: Update destructuring and prompt in the ai-fill endpoint**

Find this line in the `POST /api/ai-fill` handler:
```typescript
    const { fields, profile } = request.body as {
      fields: Array<{ label: string; type: string; options?: string[] }>;
      profile: Record<string, any>;
    };
```

Replace with:
```typescript
    const { fields, profile, jobDescription } = request.body as {
      fields: Array<{ label: string; type: string; options?: string[] }>;
      profile: Record<string, any>;
      jobDescription?: string;
    };
```

Then find this line (after `resumeSection` is defined):
```typescript
    const prompt = `You are filling out a job application form on behalf of a candidate.
Given the candidate's profile and a list of form fields, provide the best answer for each field.
```

And add a `jdSection` variable right before the `prompt` definition:
```typescript
    const jdSection = jobDescription?.trim()
      ? `\n## Job Description\n${jobDescription.slice(0, 2000)}\n`
      : '';
```

Then find `${resumeSection}` in the prompt string and change it to:
```typescript
${resumeSection}${jdSection}
```

- [ ] **Step 2: Restart backend and test with curl**

```bash
curl -s -X POST http://localhost:8000/api/ai-fill \
  -H 'Content-Type: application/json' \
  -d '{
    "fields": [{"label": "Why do you want to work here?", "type": "textarea"}],
    "profile": {"personal": {"name": "Test User"}},
    "jobDescription": "Software Engineer at Acme Corp. We build distributed systems and value engineers who care about reliability."
  }' | jq .
```

Expected: `{"answers": {"Why do you want to work here?": "... mentions Acme Corp or distributed systems ..."}}` — the answer should reference the JD context.

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/routes.ts
git commit -m "feat: pass optional jobDescription context to ai-fill prompt"
```

---

## Task 3: Modify `/api/cover-letter` to work without a tracked jobId

**Files:**
- Modify: `backend/src/api/routes.ts` (the `POST /api/cover-letter` block, lines ~514–581)

- [ ] **Step 1: Replace the cover-letter handler body**

Find the entire block from:
```typescript
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

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (writingStylePrompt) messages.push({ role: 'system', content: writingStylePrompt });
    messages.push({ role: 'user', content: prompt });

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 600,
      messages,
    });

    const text = completion.choices[0]?.message?.content || '';
    return reply.send({ ok: true, coverLetter: text, jobTitle: job.title, company: job.company });
```

Replace with:
```typescript
    const { jobId, jobDescription } = request.body as { jobId?: number; jobDescription?: string };

    if (!jobId && !jobDescription?.trim()) {
      return reply.code(400).send({ error: 'Either jobId or jobDescription is required' });
    }

    const resume = db.prepare('SELECT resume_text FROM user_resume WHERE id = 1').get() as any;
    if (!resume?.resume_text) {
      return reply.code(400).send({ error: 'No resume uploaded. Upload your resume first.' });
    }

    let description = '';
    let jobTitle = 'the role';
    let jobCompany = 'the company';
    let jobLocation = 'Not specified';

    if (jobId) {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
      if (!job) return reply.code(404).send({ error: 'Job not found' });
      jobTitle = job.title;
      jobCompany = job.company;
      jobLocation = job.location || 'Not specified';
      description = job.description_snippet || '';
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
    } else {
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

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (writingStylePrompt) messages.push({ role: 'system', content: writingStylePrompt });
    messages.push({ role: 'user', content: prompt });

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 600,
      messages,
    });

    const text = completion.choices[0]?.message?.content || '';
    return reply.send({ ok: true, coverLetter: text, jobTitle, company: jobCompany });
```

- [ ] **Step 2: Restart backend and test cover letter with direct JD (no jobId)**

```bash
curl -s -X POST http://localhost:8000/api/cover-letter \
  -H 'Content-Type: application/json' \
  -d '{"jobDescription":"Software Engineer at Acme Corp in San Francisco. We are building distributed systems. Looking for 2+ years Node.js, strong problem solving skills."}' | jq '.coverLetter' | head -5
```

Expected: a cover letter string mentioning "Acme Corp" that does NOT error with "Job not found".

- [ ] **Step 3: Commit**

```bash
git add backend/src/api/routes.ts
git commit -m "feat: allow cover-letter generation with raw jobDescription when no jobId available"
```

---

## Task 4: Add "Job Context" section to popup.html

**Files:**
- Modify: `chrome-extension/popup.html`

- [ ] **Step 1: Add styles for the JD textarea**

Inside the `<style>` block in `popup.html`, add after the `.field-tag.missed` rule (around line 123):

```css
    #jd-text {
      width: 100%;
      min-height: 100px;
      background: #181825;
      border: 1px solid #45475a;
      border-radius: 6px;
      color: #cdd6f4;
      font-size: 11px;
      line-height: 1.6;
      padding: 10px;
      resize: vertical;
      font-family: system-ui, sans-serif;
      margin-top: 8px;
    }
    .section-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    #jd-toggle {
      cursor: pointer;
      font-size: 11px;
      color: #89b4fa;
      font-weight: 600;
    }
    #jd-badge {
      display: none;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }
    #jd-clear {
      cursor: pointer;
      font-size: 10px;
      color: #f38ba8;
      font-weight: 600;
    }
    #jd-clear:hover { text-decoration: underline; }
```

- [ ] **Step 2: Add the Job Context section HTML**

In the `.body` div, insert this block between the "Page Detection" section and the "Auto-Fill" section (after line ~143, after the `</div>` that closes the page status section):

```html
    <!-- Job Context -->
    <div class="section">
      <div class="section-title-row">
        <div class="section-title" style="margin-bottom:0">Job Context</div>
        <span id="jd-toggle">▼ Paste JD</span>
      </div>
      <div id="jd-badge">
        <span class="badge badge-green" id="jd-badge-text">JD loaded ✓</span>
        <span id="jd-clear">✕ Clear</span>
      </div>
      <div id="jd-input-area" style="display:none">
        <textarea id="jd-text" placeholder="Paste job description here..."></textarea>
        <button class="btn btn-subtle" id="btn-add-tracker" style="margin-top:6px" disabled>📋 Add to Tracker</button>
      </div>
    </div>
```

- [ ] **Step 3: Verify HTML looks right**

Open `chrome-extension/popup.html` in a browser (`open chrome-extension/popup.html`) — the Job Context section should appear between Page Detection and Auto-Fill with the toggle link. No JS yet so buttons won't work.

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/popup.html
git commit -m "feat: add Job Context section HTML and styles to extension popup"
```

---

## Task 5: Wire up Job Context logic in popup.js

**Files:**
- Modify: `chrome-extension/src/popup.js`

- [ ] **Step 1: Add JD state variables and renderJdState function**

At the top of the `(async () => {` IIFE (after `const profile = await loadProfile();`), add:

```javascript
  // ── JD context state ────────────────────────────────────────────────────────
  const storedJd = await new Promise(resolve => {
    chrome.storage.local.get(['jdText', 'jdJobId', 'jdCompany', 'jdTitle'], data => resolve(data));
  });
  let jdText = storedJd.jdText || '';
  let jdJobId = storedJd.jdJobId || null;
  let jdCompany = storedJd.jdCompany || '';
  let jdTitle = storedJd.jdTitle || '';
  let jdExpanded = !!jdText;

  function renderJdState() {
    if (jdText) {
      $('jd-badge').style.display = 'flex';
      $('jd-badge-text').textContent = jdJobId && jdCompany
        ? `JD loaded ✓ — ${jdCompany} · ${jdTitle}`
        : 'JD loaded ✓';
      $('jd-input-area').style.display = 'block';
      $('jd-text').value = jdText;
      $('btn-add-tracker').disabled = !!jdJobId;
      $('btn-add-tracker').textContent = jdJobId ? '✓ Added to Tracker' : '📋 Add to Tracker';
      $('jd-toggle').textContent = '▲ Hide';
    } else {
      $('jd-badge').style.display = 'none';
      $('jd-input-area').style.display = jdExpanded ? 'block' : 'none';
      $('jd-toggle').textContent = jdExpanded ? '▲ Hide' : '▼ Paste JD';
      $('btn-add-tracker').disabled = true;
      $('btn-add-tracker').textContent = '📋 Add to Tracker';
    }
  }

  renderJdState();
```

- [ ] **Step 2: Wire the toggle button**

After `renderJdState();`, add:

```javascript
  // ── JD toggle ──
  $('jd-toggle').addEventListener('click', () => {
    jdExpanded = !jdExpanded;
    $('jd-input-area').style.display = jdExpanded ? 'block' : 'none';
    $('jd-toggle').textContent = jdExpanded ? '▲ Hide' : '▼ Paste JD';
  });
```

- [ ] **Step 3: Wire the JD textarea input**

```javascript
  // ── JD textarea ──
  $('jd-text').addEventListener('input', () => {
    jdText = $('jd-text').value;
    chrome.storage.local.set({ jdText });
    const hasText = !!jdText.trim();
    $('jd-badge').style.display = hasText ? 'flex' : 'none';
    if (hasText && !jdJobId) $('jd-badge-text').textContent = 'JD loaded ✓';
    $('btn-add-tracker').disabled = !hasText || !!jdJobId;
  });
```

- [ ] **Step 4: Wire the "Add to Tracker" button**

```javascript
  // ── Add to Tracker ──
  $('btn-add-tracker').addEventListener('click', async () => {
    if (!jdText.trim() || !profile?.job_tracker_url) return;
    $('btn-add-tracker').disabled = true;
    $('btn-add-tracker').textContent = 'Adding...';
    try {
      const res = await fetch(`${profile.job_tracker_url}/api/jobs/from-jd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jdText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add job');
      jdJobId = data.jobId;
      jdCompany = data.company;
      jdTitle = data.title;
      chrome.storage.local.set({ jdJobId, jdCompany, jdTitle });
      $('jd-badge-text').textContent = `JD loaded ✓ — ${jdCompany} · ${jdTitle}`;
      $('btn-add-tracker').textContent = '✓ Added to Tracker';
      showMsg(`Added "${jdTitle}" at ${jdCompany} to tracker!`);
    } catch (e) {
      $('btn-add-tracker').disabled = false;
      $('btn-add-tracker').textContent = '📋 Add to Tracker';
      showMsg(e.message || 'Failed to add to tracker', true);
    }
  });
```

- [ ] **Step 5: Wire the Clear button**

```javascript
  // ── Clear JD ──
  $('jd-clear').addEventListener('click', () => {
    jdText = '';
    jdJobId = null;
    jdCompany = '';
    jdTitle = '';
    jdExpanded = false;
    chrome.storage.local.remove(['jdText', 'jdJobId', 'jdCompany', 'jdTitle']);
    $('jd-text').value = '';
    $('jd-badge').style.display = 'none';
    $('jd-input-area').style.display = 'none';
    $('jd-toggle').textContent = '▼ Paste JD';
    $('btn-add-tracker').disabled = true;
    $('btn-add-tracker').textContent = '📋 Add to Tracker';
  });
```

- [ ] **Step 6: Pass `jobDescription` to auto-fill message**

Find this line in the autofill button handler:
```javascript
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL', profile });
```

Replace with:
```javascript
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL', profile, jobDescription: jdText || undefined });
```

- [ ] **Step 7: Update generateCoverLetter to accept jobDescription and update cover letter click handler**

Find the `generateCoverLetter` function:
```javascript
async function generateCoverLetter(profile, jobId) {
  if (!profile?.job_tracker_url) {
    showMsg('job_tracker_url not set in profile.json', true);
    return null;
  }
  const res = await fetch(`${profile.job_tracker_url}/api/cover-letter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Generation failed');
  return data.coverLetter;
}
```

Replace with:
```javascript
async function generateCoverLetter(profile, jobId, jobDescription) {
  if (!profile?.job_tracker_url) {
    showMsg('job_tracker_url not set in profile.json', true);
    return null;
  }
  if (!jobId && !jobDescription) {
    showMsg('Paste a job description first, or open the application from Job Tracker.', true);
    return null;
  }
  const res = await fetch(`${profile.job_tracker_url}/api/cover-letter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId: jobId || undefined,
      jobDescription: jobDescription || undefined,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Generation failed');
  return data.coverLetter;
}
```

Then find this block in the cover letter click handler:
```javascript
      const jobId = await getJobIdFromPage(profile, page?.url);
      if (!jobId) {
        showMsg('Could not match this page to a tracked job. Open it from Job Tracker first.', true);
        return;
      }
      const cl = await generateCoverLetter(profile, jobId);
```

Replace with:
```javascript
      const matchedJobId = jdJobId || await getJobIdFromPage(profile, page?.url);
      const cl = await generateCoverLetter(profile, matchedJobId, jdText || undefined);
      // cl will be null if no context available (generateCoverLetter already called showMsg)
      // the existing `if (cl)` block below handles the null case safely
```

- [ ] **Step 8: Commit**

```bash
git add chrome-extension/src/popup.js
git commit -m "feat: wire Job Context section — persist JD, add to tracker, pass to autofill and cover letter"
```

---

## Task 6: Forward jobDescription from content.js to backend

**Files:**
- Modify: `chrome-extension/src/content.js`

- [ ] **Step 1: Update autoFill signature to accept jobDescription**

Find:
```javascript
async function autoFill(profile) {
```

Replace with:
```javascript
async function autoFill(profile, jobDescription) {
```

- [ ] **Step 2: Pass jobDescription in the Phase 2 fetch body**

Find:
```javascript
            body: JSON.stringify({ fields, profile }),
```

Replace with:
```javascript
            body: JSON.stringify({ fields, profile, jobDescription }),
```

- [ ] **Step 3: Pass jobDescription from the message listener**

Find:
```javascript
  if (message.type === 'AUTOFILL') {
    autoFill(message.profile)
      .then(result => sendResponse(result))
```

Replace with:
```javascript
  if (message.type === 'AUTOFILL') {
    autoFill(message.profile, message.jobDescription)
      .then(result => sendResponse(result))
```

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/src/content.js
git commit -m "feat: forward jobDescription from autofill message to backend ai-fill endpoint"
```

---

## Task 7: End-to-end smoke test

- [ ] **Step 1: Reload the extension in Chrome**

1. Go to `chrome://extensions`
2. Click the reload button on "Job Tracker Auto-Fill"
3. Make sure the backend is running (`cd backend && npm run dev`)

- [ ] **Step 2: Test the JD paste + add to tracker flow**

1. Open the extension popup on any page
2. Click "▼ Paste JD" — textarea should expand
3. Paste a real job description
4. Badge "JD loaded ✓" should appear immediately
5. Click "📋 Add to Tracker" — should change to "✓ Added to Tracker" and badge should update to show company + title
6. Close and reopen the popup — badge and company/title should still be there (persisted in storage)

- [ ] **Step 3: Test cover letter without a tracked job**

1. Navigate to any page (e.g., a company's careers page)
2. With JD loaded, click "✉️ Generate Cover Letter"
3. Should generate successfully (no "Could not match this page" error)
4. Cover letter should reference the company/role from the pasted JD

- [ ] **Step 4: Test auto-fill with JD context**

1. Navigate to a job application form
2. With JD loaded, click "⚡ Auto-Fill This Form"
3. Open-ended text fields (like "Why do you want to work here?") should now reference the specific role from the JD

- [ ] **Step 5: Test clear**

1. Click "✕ Clear" in the Job Context section
2. JD badge disappears, textarea clears
3. Close and reopen popup — state is fully reset

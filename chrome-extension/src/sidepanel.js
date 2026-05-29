// ── Side Panel Script ─────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const DEFAULT_JOB_TRACKER_URL = 'http://localhost:8000';
const URL_SUFFIXES_TO_TRIM = new Set(['apply', 'application', 'apply-now', 'applynow']);
const HOST_PARTS_TO_IGNORE = new Set([
  'www', 'jobs', 'job', 'careers', 'boards', 'apply', 'myworkdayjobs',
  'greenhouse', 'lever', 'ashbyhq', 'workable', 'smartrecruiters',
  'com', 'io', 'co', 'ai', 'app', 'net', 'org',
]);

function showMsg(text, isErr = false) {
  $('msg').textContent = isErr ? '' : text;
  $('err').textContent = isErr ? text : '';
  if (text) setTimeout(() => { $('msg').textContent = ''; $('err').textContent = ''; }, 4000);
}

function setDot(color) {
  $('ats-dot').style.background = color;
}

function getTrackerBaseUrl(profile) {
  const rawUrl = typeof profile?.job_tracker_url === 'string'
    ? profile.job_tracker_url.trim()
    : '';
  return (rawUrl || DEFAULT_JOB_TRACKER_URL).replace(/\/$/, '');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(token => token.length > 2);
}

function toTitleCase(slug) {
  return String(slug || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function safeUrl(rawUrl) {
  try {
    return rawUrl ? new URL(rawUrl) : null;
  } catch {
    return null;
  }
}

function normalizeHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function buildUrlVariants(rawUrl) {
  const parsed = safeUrl(rawUrl);
  if (!parsed) return [];

  const host = normalizeHostname(parsed.hostname);
  const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';
  const segments = cleanPath.split('/').filter(Boolean);
  const variants = new Set();

  variants.add(`${host}${cleanPath.toLowerCase()}`);
  if (segments.length) {
    variants.add(`${host}/${segments.join('/').toLowerCase()}`);
  }

  while (segments.length && URL_SUFFIXES_TO_TRIM.has(segments[segments.length - 1].toLowerCase())) {
    segments.pop();
    const trimmedPath = segments.length ? `/${segments.join('/')}` : '/';
    variants.add(`${host}${trimmedPath.toLowerCase()}`);
  }

  return Array.from(variants);
}

function getHostTokens(rawUrl) {
  const parsed = safeUrl(rawUrl);
  if (!parsed) return [];

  return normalizeHostname(parsed.hostname)
    .split('.')
    .filter(part => part && !HOST_PARTS_TO_IGNORE.has(part));
}

function inferCompanyFromUrl(rawUrl) {
  const parsed = safeUrl(rawUrl);
  if (!parsed) return '';

  const host = normalizeHostname(parsed.hostname);
  const segments = parsed.pathname.split('/').filter(Boolean);
  const pathCompanyHosts = ['greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com'];
  if (pathCompanyHosts.some(domain => host.endsWith(domain)) && segments[0]) {
    return toTitleCase(segments[0]);
  }

  const hostTokens = getHostTokens(rawUrl);
  return hostTokens.length ? toTitleCase(hostTokens[0]) : '';
}

function inferTitleFromPageTitle(pageTitle, company) {
  const rawTitle = String(pageTitle || '').trim();
  if (!rawTitle) return 'External application';

  const parts = rawTitle
    .split(/\s(?:\||-|–|—|·|:|@)\s/)
    .map(part => part.trim())
    .filter(Boolean);

  let title = parts.find(part => {
    const normalized = normalizeText(part);
    return normalized
      && !normalized.includes('careers')
      && !normalized.includes('job application')
      && !normalized.includes('myworkdayjobs')
      && !normalized.includes('greenhouse')
      && !normalized.includes('lever')
      && !normalized.includes('workable')
      && !normalized.includes('smartrecruiters');
  }) || parts[0] || rawTitle;

  title = title
    .replace(/^apply\s+(for|to)\s+/i, '')
    .replace(/\s+job application$/i, '')
    .trim();

  if (company) {
    title = title.replace(new RegExp(`\\s+at\\s+${company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '').trim();
  }

  return title || rawTitle;
}

function getPageContext(page) {
  const pageUrl = page?.url || page?.tab?.url || '';
  const pageTitle = page?.title || page?.tab?.title || '';
  const company = inferCompanyFromUrl(pageUrl);
  const title = inferTitleFromPageTitle(pageTitle, company);

  return {
    pageUrl,
    pageTitle,
    inferredCompany: company,
    inferredTitle: title,
    pageUrlVariants: buildUrlVariants(pageUrl),
    pageTitleTokens: tokenize(pageTitle),
    hostTokens: getHostTokens(pageUrl),
  };
}

function buildDescriptionSnippet(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.slice(0, 500);
}

function normalizeJobType(value) {
  const lower = String(value || '').toLowerCase().trim();
  if (!lower) return '';
  if (lower.includes('intern')) return 'internship';
  if (lower.includes('coop') || lower.includes('co-op')) return 'coop';
  if (lower.includes('full')) return 'fulltime';
  if (lower.includes('contract')) return 'contract';
  if (lower.includes('part')) return 'parttime';
  return '';
}

function inferSourceFromUrl(url) {
  try {
    return new URL(url).hostname || 'manual';
  } catch {
    return 'manual';
  }
}

function toEditableExtracted(extracted, page) {
  const pageUrl = extracted?.url || page?.url || '';
  return {
    title: extracted?.title || '',
    company: extracted?.company || '',
    location: extracted?.location || '',
    jobType: normalizeJobType(extracted?.jobType),
    description: extracted?.description || '',
    url: pageUrl,
    source: extracted?.source || inferSourceFromUrl(pageUrl),
  };
}

function buildJobPayload(page, jdState = {}) {
  const context = getPageContext(page);
  const title = jdState.jdTitle || context.inferredTitle || 'External application';
  const company = jdState.jdCompany || context.inferredCompany || 'External Company';
  const location = jdState.jdLocation || '';
  const jobDescription = String(jdState.jdText || '').trim();
  const descriptionSnippet = jdState.jdDescriptionSnippet || buildDescriptionSnippet(jobDescription);
  const manualContext = jobDescription
    ? JSON.stringify({
        jobDescription,
        sourcePageTitle: context.pageTitle || '',
        sourcePageUrl: context.pageUrl || '',
      })
    : undefined;

  return {
    title,
    company,
    location,
    apply_url: context.pageUrl || undefined,
    description_snippet: descriptionSnippet || undefined,
    raw_json: manualContext,
  };
}

function scoreJobMatch(job, context) {
  const jobUrlVariants = buildUrlVariants(job.apply_url);
  let score = 0;

  for (const pageVariant of context.pageUrlVariants) {
    for (const jobVariant of jobUrlVariants) {
      if (!pageVariant || !jobVariant) continue;
      if (pageVariant === jobVariant) return 100;
      if (pageVariant.startsWith(jobVariant) || jobVariant.startsWith(pageVariant)) {
        score = Math.max(score, 85);
      }
    }
  }

  const companyTokens = tokenize(job.company);
  const titleTokens = tokenize(job.title);
  const sharedTitleTokens = titleTokens.filter(token => context.pageTitleTokens.includes(token));
  const sharedHostTokens = companyTokens.filter(token => context.hostTokens.includes(token));

  if (sharedHostTokens.length) score += 30;
  if (sharedTitleTokens.length >= 2) score += 35;
  else if (sharedTitleTokens.length === 1) score += 15;

  if (context.inferredCompany && normalizeText(job.company) === normalizeText(context.inferredCompany)) {
    score += 25;
  }

  if (context.inferredTitle && normalizeText(context.inferredTitle).includes(normalizeText(job.title))) {
    score += 20;
  }

  return score;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadAssistedQueue(profile) {
  const baseUrl = getTrackerBaseUrl(profile);
  const list = document.getElementById('assisted-queue-list');
  try {
    const res = await fetch(`${baseUrl}/api/jobs/queue?mode=assisted`);
    const data = await res.json();
    const jobs = data.jobs || [];
    if (jobs.length === 0) {
      list.innerHTML = '<div style="color:#6c7086;font-size:11px;text-align:center;padding:8px 0">No assisted jobs queued</div>';
      return;
    }
    list.innerHTML = '';
    for (const job of jobs) {
      const item = document.createElement('div');
      item.className = 'queue-item';
      item.innerHTML = `
        <div class="queue-item-text">
          <div class="queue-item-title" title="${escapeHtml(job.title)}">${escapeHtml(job.title)}</div>
          <div class="queue-item-company">${escapeHtml(job.company)}</div>
        </div>
        <button class="btn-open" data-url="${escapeHtml(job.apply_url)}">Open</button>
      `;
      item.querySelector('.btn-open').addEventListener('click', async () => {
        const url = job.apply_url;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          chrome.tabs.update(tab.id, { url });
        } else {
          chrome.tabs.create({ url });
        }
      });
      list.appendChild(item);
    }
  } catch {
    list.innerHTML = '<div style="color:#f38ba8;font-size:11px;text-align:center;padding:8px 0">Could not load queue</div>';
  }
}

// ── Load profile from storage ─────────────────────────────────────────────────

async function loadProfile() {
  return new Promise(resolve => {
    chrome.storage.local.get('profile', data => resolve(data.profile || null));
  });
}

// ── Detect current tab ATS ────────────────────────────────────────────────────

async function detectPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'DETECT' });
    return { tab, ...response, ok: true };
  } catch {
    return { tab, ats: 'Not a job page', inputCount: 0, url: tab.url, ok: false };
  }
}

// ── Get job info from URL (try to match against job tracker) ──────────────────

async function getJobIdFromPage(profile, page) {
  const baseUrl = getTrackerBaseUrl(profile);
  const context = getPageContext(page);
  try {
    const res = await fetch(`${baseUrl}/api/jobs?limit=1000`);
    const data = await res.json();
    const jobs = data.jobs || [];
    let bestMatch = null;
    let bestScore = 0;

    for (const job of jobs) {
      const score = scoreJobMatch(job, context);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = job;
      }
    }

    return bestScore >= 45 ? bestMatch?.id || null : null;
  } catch {
    return null;
  }
}

async function createManualAppliedJob(profile, page, jdState) {
  const baseUrl = getTrackerBaseUrl(profile);
  const payload = buildJobPayload(page, jdState);
  const res = await fetch(`${baseUrl}/api/jobs/manual`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to add manual applied job.');
  }

  return data.job;
}

// ── Mark as applied in job tracker ────────────────────────────────────────────

async function markApplied(profile, page, jdState) {
  const baseUrl = getTrackerBaseUrl(profile);
  const payload = buildJobPayload(page, jdState);
  const preferredJobId = jdState?.jdJobId || null;
  const jobId = preferredJobId || await getJobIdFromPage(profile, page);
  if (!jobId) {
    const manualJob = await createManualAppliedJob(profile, page, jdState);
    showMsg(`✓ Added "${manualJob.title}" at ${manualJob.company} to Applied.`);
    return manualJob;
  }
  const patchBody = { status: 'applied' };
  if (jdState?.jdTitle)   patchBody.title   = payload.title;
  if (jdState?.jdCompany) patchBody.company  = payload.company;
  if (payload.apply_url)          patchBody.apply_url           = payload.apply_url;
  if (payload.location)           patchBody.location            = payload.location;
  if (payload.description_snippet) patchBody.description_snippet = payload.description_snippet;
  if (payload.raw_json)           patchBody.raw_json            = payload.raw_json;
  if (payload.job_type)           patchBody.job_type            = payload.job_type;

  const res = await fetch(`${baseUrl}/api/jobs/${jobId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchBody),
  });
  if (res.ok) {
    showMsg(`✓ Marked "${payload.title}" at ${payload.company} as applied!`);
    return { id: jobId };
  } else {
    showMsg('Failed to update status.', true);
    return null;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  const profile = await loadProfile();
  if (!profile) {
    $('ats-label').textContent = 'Profile not loaded. See README.';
    setDot('#d20f39');
    showMsg('Load your profile.json first (see README).', true);
    return;
  }

  // Load assisted queue
  loadAssistedQueue(profile);

  // ── JD context state ────────────────────────────────────────────────────────
  const storedJd = await new Promise(resolve => {
    chrome.storage.local.get(['jdText', 'jdJobId', 'jdCompany', 'jdTitle', 'jdLocation', 'jdDescriptionSnippet', 'jdHighlights'], data => resolve(data));
  });
  let jdText = storedJd.jdText || '';
  let jdJobId = storedJd.jdJobId || null;
  let jdCompany = storedJd.jdCompany || '';
  let jdTitle = storedJd.jdTitle || '';
  let jdLocation = storedJd.jdLocation || '';
  let jdDescriptionSnippet = storedJd.jdDescriptionSnippet || '';
  let jdHighlights = Array.isArray(storedJd.jdHighlights) ? storedJd.jdHighlights : [];
  let jdExpanded = !!jdText;

  const HIGHLIGHT_ICON = { danger: '🔴', warning: '🟡', info: '🔵', positive: '🟢', neutral: '⚪' };
  const SEVERITY_RANK = { danger: 0, warning: 1, info: 2, positive: 3, neutral: 4 };

  function renderJdHighlights() {
    const box = $('jd-highlights');
    box.innerHTML = '';
    if (!jdJobId || !jdHighlights.length) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'flex';
    const sorted = [...jdHighlights].sort((a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
    for (const h of sorted) {
      const severity = HIGHLIGHT_ICON[h.severity] ? h.severity : 'info';
      const hasUrl = typeof h.url === 'string' && /^https?:\/\//i.test(h.url);
      const tag = document.createElement(hasUrl ? 'a' : 'span');
      tag.className = `highlight-tag ${severity}`;
      tag.title = h.detail || h.category || '';
      const prefix = hasUrl ? `🔗 ${HIGHLIGHT_ICON[severity]} ` : `${HIGHLIGHT_ICON[severity]} `;
      tag.textContent = `${prefix}${h.label}`;
      if (hasUrl) {
        tag.href = h.url;
        tag.target = '_blank';
        tag.rel = 'noopener noreferrer';
      }
      box.appendChild(tag);
    }
  }

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
  renderJdHighlights();

  // ── JD toggle ──
  $('jd-toggle').addEventListener('click', () => {
    jdExpanded = !jdExpanded;
    $('jd-input-area').style.display = jdExpanded ? 'block' : 'none';
    $('jd-toggle').textContent = jdExpanded ? '▲ Hide' : '▼ Paste JD';
  });

  // ── JD textarea ──
  $('jd-text').addEventListener('input', () => {
    jdText = $('jd-text').value;
    chrome.storage.local.set({ jdText });
    const hasText = !!jdText.trim();
    $('jd-badge').style.display = hasText ? 'flex' : 'none';
    if (hasText && !jdJobId) $('jd-badge-text').textContent = 'JD loaded ✓';
    $('btn-add-tracker').disabled = !hasText || !!jdJobId;
  });

  // ── Add to Tracker ──
  $('btn-add-tracker').addEventListener('click', async () => {
    if (!jdText.trim()) return;
    const baseUrl = getTrackerBaseUrl(profile);
    $('btn-add-tracker').disabled = true;
    $('btn-add-tracker').textContent = 'Adding...';
    try {
      const res = await fetch(`${baseUrl}/api/jobs/from-jd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jdText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add job');
      jdJobId = data.jobId;
      jdCompany = data.company;
      jdTitle = data.title;
      jdLocation = data.location || '';
      jdDescriptionSnippet = data.descriptionSnippet || '';
      jdHighlights = Array.isArray(data.highlights) ? data.highlights : [];
      chrome.storage.local.set({ jdJobId, jdCompany, jdTitle, jdLocation, jdDescriptionSnippet, jdHighlights });
      $('jd-badge-text').textContent = `JD loaded ✓ — ${jdCompany} · ${jdTitle}`;
      $('btn-add-tracker').textContent = '✓ Added to Tracker';
      renderJdHighlights();
      showMsg(`Added "${jdTitle}" at ${jdCompany} to tracker!`);
    } catch (e) {
      $('btn-add-tracker').disabled = false;
      $('btn-add-tracker').textContent = '📋 Add to Tracker';
      showMsg(e.message || 'Failed to add to tracker', true);
    }
  });

  // ── Clear JD ──
  $('jd-clear').addEventListener('click', () => {
    jdText = '';
    jdJobId = null;
    jdCompany = '';
    jdTitle = '';
    jdLocation = '';
    jdDescriptionSnippet = '';
    jdHighlights = [];
    jdExpanded = false;
    chrome.storage.local.remove(['jdText', 'jdJobId', 'jdCompany', 'jdTitle', 'jdLocation', 'jdDescriptionSnippet', 'jdHighlights']);
    $('jd-text').value = '';
    $('jd-badge').style.display = 'none';
    $('jd-input-area').style.display = 'none';
    $('jd-toggle').textContent = '▼ Paste JD';
    $('btn-add-tracker').disabled = true;
    $('btn-add-tracker').textContent = '📋 Add to Tracker';
    renderJdHighlights();
  });

  // ── Extract job info from current page ──────────────────────────────────────
  async function extractJobFromPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return null;
      const data = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_JOB' });
      return data || null;
    } catch {
      return null;
    }
  }

  async function checkDedup(extracted) {
    const baseUrl = getTrackerBaseUrl(profile);
    const params = new URLSearchParams();
    if (extracted.url) params.set('url', extracted.url);
    if (extracted.title) params.set('title', extracted.title);
    if (extracted.company) params.set('company', extracted.company);
    try {
      const res = await fetch(`${baseUrl}/api/jobs/dedup-check?${params}`);
      return await res.json();
    } catch {
      return { match: false };
    }
  }


  const TYPE_LABELS = {
    fulltime: 'Full-time',
    internship: 'Internship',
    coop: 'Co-op',
    contract: 'Contract',
    parttime: 'Part-time',
  };

  function formatFieldDisplay(key, value) {
    if (key === 'jobType') return TYPE_LABELS[value] || value;
    return value;
  }

  function renderFieldDisplay(row, key, label, extracted, syncState) {
    const value = extracted[key];
    const span = document.createElement('span');
    span.className = `info-value editable${value ? '' : ' muted'}`;
    span.title = 'Double-click to edit';
    span.textContent = value
      ? formatFieldDisplay(key, value)
      : 'Not detected — double-click to edit';
    span.addEventListener('dblclick', () => {
      replaceWithInput(row, key, label, extracted, syncState);
    });
    row.appendChild(span);
  }

  function replaceWithInput(row, key, label, extracted, syncState) {
    const existing = row.querySelector('.info-value, .info-input');
    if (existing) existing.remove();

    const showDisplay = () => {
      const current = row.querySelector('.info-value, .info-input');
      if (current) current.remove();
      renderFieldDisplay(row, key, label, extracted, syncState);
    };

    if (key === 'jobType') {
      const select = document.createElement('select');
      select.className = 'info-input';
      [['', 'Select type'], ['fulltime', 'Full-time'], ['internship', 'Internship'], ['coop', 'Co-op'], ['contract', 'Contract'], ['parttime', 'Part-time']].forEach(([v, t]) => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = t;
        select.appendChild(opt);
      });
      select.value = normalizeJobType(extracted[key]);
      select.addEventListener('change', () => {
        extracted[key] = normalizeJobType(select.value);
        syncState();
      });
      select.addEventListener('blur', showDisplay);
      row.appendChild(select);
      select.focus();
      return;
    }

    const input = document.createElement('input');
    input.className = 'info-input';
    input.placeholder = `Enter ${label.toLowerCase()}`;
    input.value = extracted[key] || '';
    input.addEventListener('input', () => {
      extracted[key] = input.value.trim();
      syncState();
    });
    input.addEventListener('blur', showDisplay);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
    row.appendChild(input);
    input.focus();
    input.select();
  }

  function renderExtractedInfo(extracted) {
    const section = $('extracted-section');
    const info = $('extracted-info');
    section.style.display = 'block';
    info.innerHTML = '';

    const saveBtn = $('btn-save-tracker');
    const syncState = () => {
      saveBtn.disabled = !extracted.title && !extracted.company;
    };

    const fields = [
      ['title', 'Title'],
      ['company', 'Company'],
      ['location', 'Location'],
      ['jobType', 'Type'],
      ['source', 'Source'],
    ];
    for (const [key, label] of fields) {
      const row = document.createElement('div');
      row.className = 'info-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'info-label';
      labelEl.textContent = label;
      row.appendChild(labelEl);
      renderFieldDisplay(row, key, label, extracted, syncState);
      info.appendChild(row);
    }

    syncState();
  }

  function renderDedupBanner(result) {
    const banner = $('dedup-banner');
    if (!result.match) {
      banner.style.display = 'none';
      return;
    }
    banner.style.display = 'block';
    const job = result.job;
    const date = job.status_updated_at
      ? new Date(job.status_updated_at).toLocaleDateString()
      : 'unknown date';
    $('dedup-title').textContent = job.status === 'applied'
      ? 'Already Applied'
      : 'Already in Tracker';
    $('dedup-detail').innerHTML = `You ${job.status === 'applied' ? 'applied to' : 'tracked'} <strong>${escapeHtml(job.title)}</strong> at <strong>${escapeHtml(job.company)}</strong> on ${escapeHtml(date)}.`
      + ` <a href="${escapeHtml(getTrackerBaseUrl(profile))}" target="_blank">Open Dashboard</a>`;
  }

  let page = await detectPage();
  let isJobPage = (page?.inputCount || 0) > 0;

  // ── Run extraction + dedup ──────────────────────────────────────────────────
  let extracted = toEditableExtracted(await extractJobFromPage(), page);
  renderExtractedInfo(extracted);
  if (extracted.url || extracted.title || extracted.company) {
    const dedupResult = await checkDedup(extracted);
    renderDedupBanner(dedupResult);
  }

  // ── Save to Tracker button ──────────────────────────────────────────────────
  $('btn-save-tracker').addEventListener('click', async () => {
    if (!extracted) return;
    $('btn-save-tracker').disabled = true;
    $('btn-save-tracker').textContent = 'Saving...';
    try {
      const baseUrl = getTrackerBaseUrl(profile);
      const res = await fetch(`${baseUrl}/api/jobs/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: extracted.title || 'Unknown',
          company: extracted.company || 'Unknown',
          apply_url: extracted.url || '',
          location: extracted.location || '',
          description_snippet: (extracted.description || '').slice(0, 500),
          job_type: ['fulltime', 'internship', 'coop', 'contract', 'parttime'].includes(extracted.jobType || '')
            ? extracted.jobType
            : undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      $('btn-save-tracker').textContent = 'Saved!';
      showMsg(`Saved "${extracted.title}" to tracker`);
    } catch (e) {
      $('btn-save-tracker').disabled = false;
      $('btn-save-tracker').textContent = 'Save to Tracker';
      showMsg(e.message || 'Save failed', true);
    }
  });

  function applyDetection() {
    const ats = page?.ats || 'Unknown';
    const inputCount = page?.inputCount || 0;
    isJobPage = inputCount > 0;

    $('page-ats').textContent = page?.url?.slice(0, 50) || '';
    const atsLabel = ats !== 'Unknown' ? `${ats} — ${inputCount} fields detected` : `${inputCount} fields detected`;
    $('ats-label').textContent = isJobPage ? atsLabel : 'No form fields found on this page';
    setDot(isJobPage ? '#40a02b' : '#df8e1d');
  }

  async function refreshDetection() {
    const fresh = await detectPage();
    if (!fresh) return;
    // Ignore transient messaging failures once we've had a successful read
    if (!fresh.ok && page?.ok) return;
    page = fresh;
    applyDetection();
  }

  applyDetection();

  // Manual re-scan
  $('btn-rescan').addEventListener('click', () => { refreshDetection().catch(() => {}); });

  // Re-detect when the active tab navigates (SPA pushState fires onUpdated with changeInfo.url)
  const tabUpdateListener = (_tabId, changeInfo) => {
    if (!changeInfo.url && changeInfo.status !== 'complete') return;
    refreshDetection().catch(() => {});
  };
  chrome.tabs.onUpdated.addListener(tabUpdateListener);

  // Poll while the side panel is visible — catches DOM-only changes (tab switches, modals)
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      refreshDetection().catch(() => {});
    }
  }, 1500);

  // ── Auto-fill button ──
  $('btn-autofill').addEventListener('click', async () => {
    // Defense-in-depth: re-scan right before filling so SPA tab switches
    // (Overview -> Application on Ashby, etc.) don't leave us with stale state.
    await refreshDetection();
    if (!isJobPage) { showMsg('Navigate to a job application page first.', true); return; }
    $('btn-autofill').disabled = true;
    $('btn-autofill').textContent = 'Phase 1: Filling known fields...';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      await new Promise(r => setTimeout(r, 50));
      $('btn-autofill').textContent = 'Filling... (AI may take ~10s)';

      const result = await chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL', profile, jobDescription: jdText || undefined });
      const filled = result?.filled?.length || 0;
      const skipped = result?.skipped?.length || 0;
      const aiFilled = (result?.filled || []).filter(f => f.includes('(AI)')).length;
      const profileFilled = filled - aiFilled;

      const summary = $('field-summary');
      summary.style.display = 'flex';
      summary.innerHTML = '';
      (result?.filled || []).slice(0, 15).forEach(f => {
        const tag = document.createElement('span');
        tag.className = 'field-tag' + (f.includes('(AI)') ? ' ai' : '');
        tag.textContent = f;
        summary.appendChild(tag);
      });

      if (result?.aiError) {
        showMsg(`Profile: ${profileFilled} filled | AI error: ${result.aiError.slice(0, 50)}`, true);
      } else if (aiFilled > 0) {
        showMsg(`Profile: ${profileFilled} filled | AI: ${aiFilled} filled | ${skipped} skipped`);
      } else {
        showMsg(`Filled ${filled} fields, ${skipped} skipped`);
      }
    } catch (e) {
      showMsg(e.message || 'Fill failed', true);
    }
    $('btn-autofill').disabled = false;
    $('btn-autofill').textContent = '⚡ Auto-Fill This Form';
  });

  // ── Mark applied button ──
  $('btn-applied').addEventListener('click', async () => {
    $('btn-applied').disabled = true;
    try {
      await markApplied(profile, page, { jdText, jdJobId, jdCompany, jdTitle, jdLocation, jdDescriptionSnippet });
    } catch (e) {
      showMsg(e.message, true);
    }
    $('btn-applied').disabled = false;
  });
})();

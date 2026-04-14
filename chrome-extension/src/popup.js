// ── Popup Script ──────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

function showMsg(text, isErr = false) {
  $('msg').textContent = isErr ? '' : text;
  $('err').textContent = isErr ? text : '';
  if (text) setTimeout(() => { $('msg').textContent = ''; $('err').textContent = ''; }, 4000);
}

function setDot(color) {
  $('ats-dot').style.background = color;
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
    return { tab, ...response };
  } catch {
    return { tab, ats: 'Not a job page', inputCount: 0, url: tab.url };
  }
}

// ── Get job info from URL (try to match against job tracker) ──────────────────

async function getJobIdFromPage(profile, tabUrl) {
  if (!profile?.job_tracker_url) return null;
  try {
    const res = await fetch(`${profile.job_tracker_url}/api/jobs?limit=200`);
    const data = await res.json();
    const jobs = data.jobs || [];
    // Match by apply_url similarity
    const match = jobs.find(j => tabUrl && (tabUrl.includes(j.company?.toLowerCase().replace(/\s/g,'')))
      || (j.apply_url && tabUrl.startsWith(j.apply_url.split('?')[0])));
    return match?.id || null;
  } catch {
    return null;
  }
}

// ── Mark as applied in job tracker ────────────────────────────────────────────

async function markApplied(profile, tabUrl) {
  if (!profile?.job_tracker_url) {
    showMsg('job_tracker_url not set in profile.json', true);
    return;
  }
  const jobId = await getJobIdFromPage(profile, tabUrl);
  if (!jobId) {
    showMsg('Could not match this page to a tracked job.', true);
    return;
  }
  const res = await fetch(`${profile.job_tracker_url}/api/jobs/${jobId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'applied' }),
  });
  if (res.ok) {
    showMsg(`✓ Marked job #${jobId} as applied!`);
  } else {
    showMsg('Failed to update status.', true);
  }
}

// ── Generate cover letter via backend (uses ANTHROPIC_API_KEY server-side) ───

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

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  const profile = await loadProfile();
  if (!profile) {
    $('ats-label').textContent = 'Profile not loaded. See README.';
    setDot('#d20f39');
    showMsg('Load your profile.json first (see README).', true);
    return;
  }

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

  const page = await detectPage();
  const ats = page?.ats || 'Unknown';
  const inputCount = page?.inputCount || 0;
  const isJobPage = inputCount > 0;

  $('page-ats').textContent = page?.url?.slice(0, 50) || '';
  const atsLabel = ats !== 'Unknown' ? `${ats} — ${inputCount} fields detected` : `${inputCount} fields detected`;
  $('ats-label').textContent = isJobPage ? atsLabel : 'No form fields found on this page';
  setDot(isJobPage ? '#40a02b' : '#df8e1d');

  // ── Auto-fill button ──
  $('btn-autofill').addEventListener('click', async () => {
    if (!isJobPage) { showMsg('Navigate to a job application page first.', true); return; }
    $('btn-autofill').disabled = true;
    $('btn-autofill').textContent = 'Phase 1: Filling known fields...';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Brief delay to let button text render before blocking on message
      await new Promise(r => setTimeout(r, 50));
      $('btn-autofill').textContent = 'Filling... (AI may take ~10s)';

      const result = await chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL', profile, jobDescription: jdText || undefined });
      const filled = result?.filled?.length || 0;
      const skipped = result?.skipped?.length || 0;
      const aiFilled = (result?.filled || []).filter(f => f.includes('(AI)')).length;
      const profileFilled = filled - aiFilled;

      // Show filled fields as tags
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

  // ── Cover letter button ──
  $('btn-coverletter').addEventListener('click', async () => {
    $('btn-coverletter').disabled = true;
    $('btn-coverletter').textContent = 'Generating...';
    $('cl-output').style.display = 'none';
    $('btn-copy').style.display = 'none';
    try {
      const matchedJobId = jdJobId || await getJobIdFromPage(profile, page?.url);
      const cl = await generateCoverLetter(profile, matchedJobId, jdText || undefined);
      // cl is null when no context available; generateCoverLetter already called showMsg
      if (cl) {
        $('cl-output').value = cl;
        $('cl-output').style.display = 'block';
        $('btn-copy').style.display = 'block';
        showMsg('Cover letter generated!');
      }
    } catch (e) {
      showMsg(e.message || 'Generation failed', true);
    }
    $('btn-coverletter').disabled = false;
    $('btn-coverletter').textContent = '✉️ Generate Cover Letter (Claude)';
  });

  // ── Copy button ──
  $('btn-copy').addEventListener('click', () => {
    const text = $('cl-output').value;
    navigator.clipboard.writeText(text).then(() => {
      $('btn-copy').textContent = '✓ Copied!';
      setTimeout(() => { $('btn-copy').textContent = '📋 Copy to Clipboard'; }, 2000);
    });
  });

  // ── Mark applied button ──
  $('btn-applied').addEventListener('click', async () => {
    $('btn-applied').disabled = true;
    try {
      await markApplied(profile, page?.url);
    } catch (e) {
      showMsg(e.message, true);
    }
    $('btn-applied').disabled = false;
  });
})();

// ── Content Script: Auto-fill job application forms ──────────────────────────
// Injected on all pages. Phase 1 fills known fields from profile.json,
// Phase 2 sends unknown fields to the backend AI endpoint.

// ── Field label matchers ─────────────────────────────────────────────────────
const FIELD_MAP = [
  // Personal
  { keys: ['first name', 'firstname', 'first_name'], profilePath: 'personal.name', transform: 'firstName' },
  { keys: ['last name', 'lastname', 'last_name', 'surname'], profilePath: 'personal.name', transform: 'lastName' },
  { keys: ['full name', 'fullname', 'full_name', 'name'], profilePath: 'personal.name' },
  { keys: ['email', 'e-mail', 'email address'], profilePath: 'personal.email' },
  { keys: ['phone', 'telephone', 'mobile', 'cell'], profilePath: 'personal.phone' },
  { keys: ['city'], profilePath: 'personal.address.city' },
  { keys: ['state', 'province'], profilePath: 'personal.address.state' },
  { keys: ['zip', 'postal', 'postal code', 'zip code'], profilePath: 'personal.address.zip' },
  { keys: ['country'], profilePath: 'personal.address.country' },
  { keys: ['linkedin', 'linkedin url', 'linkedin profile'], profilePath: 'personal.linkedin' },
  { keys: ['github', 'github url', 'github profile'], profilePath: 'personal.github' },
  { keys: ['website', 'portfolio', 'personal website', 'personal url'], profilePath: 'personal.portfolio' },

  // Work auth
  { keys: ['authorized to work', 'work authorization', 'legally authorized', 'eligible to work'], profilePath: 'work_auth_answers.authorized_to_work' },
  { keys: ['require sponsorship', 'visa sponsorship', 'need sponsorship', 'currently require sponsorship'], profilePath: 'work_auth_answers.require_sponsorship_now' },
  { keys: ['future sponsorship', 'will you require', 'sponsorship in the future'], profilePath: 'work_auth_answers.require_sponsorship_future' },

  // General
  { keys: ['salary', 'compensation', 'expected salary', 'desired salary'], profilePath: 'answers.salary_expectation' },
  { keys: ['years of experience', 'years experience', 'how many years'], profilePath: 'answers.years_experience' },
  { keys: ['notice period', 'start date', 'available to start'], profilePath: 'answers.notice_period' },
  { keys: ['education', 'highest degree', 'highest level of education'], profilePath: 'answers.highest_education' },
  { keys: ['pronouns'], profilePath: 'answers.pronouns' },
];

// ── Utilities ────────────────────────────────────────────────────────────────

function getNestedValue(obj, path) {
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

function applyTransform(value, transform) {
  if (!transform || !value) return value;
  const parts = value.trim().split(/\s+/);
  if (transform === 'firstName') return parts[0] || value;
  if (transform === 'lastName') return parts.slice(1).join(' ') || value;
  return value;
}

function labelMatches(labelText, keys) {
  const lower = (labelText || '').toLowerCase();
  return keys.some(k => lower.includes(k));
}

function getLabel(el) {
  try {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.placeholder) return el.placeholder;

    const id = el.id;
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label) return label.textContent;
    }

    // Walk up to find a label/legend
    let parent = el.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const label = parent.querySelector('label');
      if (label) return label.textContent;
      const legend = parent.querySelector('legend');
      if (legend) return legend.textContent;
      parent = parent.parentElement;
    }
  } catch (e) {
    console.warn('[AutoFill] getLabel error:', e);
  }
  return el.name || '';
}

/** Check if a field already has a user-provided value */
function isAlreadyFilled(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') {
    return el.selectedIndex > 0;
  }
  if (el.type === 'radio' || el.type === 'checkbox') {
    return el.checked;
  }
  return !!(el.value && el.value.trim());
}

function fillInput(el, value) {
  if (!value) return false;

  const tag = el.tagName.toLowerCase();

  if (tag === 'select') {
    const lower = value.toLowerCase().trim();
    // Exact match first
    for (const opt of el.options) {
      if (opt.text.toLowerCase().trim() === lower || opt.value.toLowerCase().trim() === lower) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    // Partial match fallback
    for (const opt of el.options) {
      if (opt.text.toLowerCase().includes(lower) || opt.value.toLowerCase().includes(lower)) {
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  if (tag === 'textarea' || (tag === 'input' && !['checkbox','radio','file','submit','button'].includes(el.type))) {
    // Use native setter for React/Vue controlled inputs, with fallback
    try {
      const proto = tag === 'textarea'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(el, value);
      } else {
        el.value = value;
      }
    } catch (_e) {
      // Fallback: direct assignment if native setter fails
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  if (tag === 'input' && (el.type === 'radio' || el.type === 'checkbox')) {
    const lower = value.toLowerCase().trim();
    const elLabel = getLabel(el).toLowerCase().trim();
    const elValue = (el.value || '').toLowerCase().trim();

    // Exact match on label or value
    if (elLabel === lower || elValue === lower) {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    // Yes/No shorthand
    if (lower === 'yes' && (elLabel.includes('yes') || elValue === 'yes' || elValue === 'true' || elValue === '1')) {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (lower === 'no' && (elLabel.includes('no') || elValue === 'no' || elValue === 'false' || elValue === '0')) {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    // Partial match (e.g. AI says "Prefer not to say", label contains it)
    if (elLabel.includes(lower) || lower.includes(elLabel)) {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  }

  return false;
}

// ── Floating status banner (shown on the page during AI fill) ────────────────

function showPageBanner(text, type) {
  try {
    let banner = document.getElementById('__job-autofill-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = '__job-autofill-banner';
      // Set styles individually (Object.assign on CSSStyleDeclaration can throw in content scripts)
      banner.style.position = 'fixed';
      banner.style.top = '12px';
      banner.style.right = '12px';
      banner.style.zIndex = '999999';
      banner.style.padding = '10px 18px';
      banner.style.borderRadius = '8px';
      banner.style.fontSize = '13px';
      banner.style.fontFamily = 'system-ui, sans-serif';
      banner.style.fontWeight = '600';
      banner.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
      banner.style.transition = 'opacity 0.3s';
      banner.style.color = '#fff';
      document.body.appendChild(banner);
    }
    banner.style.background = type === 'error' ? '#d20f39'
      : type === 'success' ? '#40a02b'
      : '#1e66f5';
    banner.textContent = text;
    banner.style.opacity = '1';
  } catch (e) {
    console.warn('[AutoFill] Banner error:', e);
  }
}

function hideBanner(delay) {
  setTimeout(() => {
    try {
      const banner = document.getElementById('__job-autofill-banner');
      if (banner) {
        banner.style.opacity = '0';
        setTimeout(() => { try { banner.remove(); } catch(_) {} }, 400);
      }
    } catch (_) {}
  }, delay || 3000);
}

// ── Main auto-fill function ───────────────────────────────────────────────────

async function autoFill(profile) {
  const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
  const filled = [];
  const skipped = [];
  let aiError = null;

  const unknownMap = new Map();
  const radioGroups = new Map();

  // ── Phase 1: fill known fields from profile ───────────────────────────────
  console.log('[AutoFill] Phase 1: scanning', inputs.length, 'form elements');

  for (const el of inputs) {
    try {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'file') continue;
      if (el.readOnly || el.disabled) continue;
      if (isAlreadyFilled(el)) continue;

      const label = getLabel(el);
      if (!label) continue;

      let matched = false;
      for (const { keys, profilePath, transform } of FIELD_MAP) {
        if (labelMatches(label, keys)) {
          let value = getNestedValue(profile, profilePath);
          value = applyTransform(String(value ?? ''), transform);
          if (fillInput(el, value)) {
            filled.push(label.trim().slice(0, 40));
            matched = true;
            break;
          }
        }
      }

      if (!matched) {
        const tag = el.tagName.toLowerCase();
        const type = tag === 'select' ? 'select'
                   : tag === 'textarea' ? 'textarea'
                   : (el.type || 'text');
        const labelKey = label.trim().slice(0, 80);

        if (type === 'radio') {
          if (!radioGroups.has(labelKey)) radioGroups.set(labelKey, []);
          radioGroups.get(labelKey).push(el);
          if (!unknownMap.has(labelKey))
            unknownMap.set(labelKey, { el, descriptor: { label: labelKey, type: 'radio' } });
        } else if (!unknownMap.has(labelKey)) {
          const descriptor = { label: labelKey, type };
          if (type === 'select' && el.options && el.options.length) {
            descriptor.options = Array.from(el.options)
              .filter(o => o.value !== '')
              .map(o => o.text.trim())
              .slice(0, 20);
          }
          unknownMap.set(labelKey, { el, descriptor });
        }
      }
    } catch (elErr) {
      console.warn('[AutoFill] Error processing element:', el, elErr);
    }
  }

  console.log('[AutoFill] Phase 1 done:', filled.length, 'filled,', unknownMap.size, 'unknown fields for AI');

  // ── Phase 2: AI-fill unknown fields via backend ───────────────────────────
  // NOTE: fetch is routed through the background service worker to avoid
  // mixed-content blocks (HTTPS page → HTTP localhost = blocked in content scripts).
  if (unknownMap.size > 0) {
    const fields = Array.from(unknownMap.values()).map(v => v.descriptor);
    const baseUrl = (profile.job_tracker_url || 'http://localhost:8000').replace(/\/$/, '');

    console.log('[AutoFill] Phase 2: sending', fields.length, 'fields to AI via background proxy');
    console.log('[AutoFill] Fields:', JSON.stringify(fields.map(f => f.label)));
    showPageBanner('AI filling ' + unknownMap.size + ' fields...', 'info');

    try {
      // Route fetch through background service worker (avoids HTTPS→HTTP mixed content block)
      const proxyResponse = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('AI request timed out (30s). Backend may be slow or unreachable.')), 30000);
        chrome.runtime.sendMessage({
          type: 'FETCH_PROXY',
          url: baseUrl + '/api/ai-fill',
          options: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields, profile }),
          },
        }, (response) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'Extension messaging error'));
          } else {
            resolve(response);
          }
        });
      });

      if (proxyResponse.error) {
        throw new Error(proxyResponse.error);
      }

      if (proxyResponse.ok) {
        let data;
        try { data = JSON.parse(proxyResponse.body); } catch (_) {
          console.error('[AutoFill] Failed to parse proxy response body:', proxyResponse.body);
          data = {};
        }
        const answers = (data && data.answers) || {};
        if (data.aiError) {
          aiError = data.aiError;
          console.warn('[AutoFill] AI error:', aiError);
          showPageBanner('AI error: ' + aiError.slice(0, 60), 'error');
          hideBanner(5000);
        } else {
          console.log('[AutoFill] AI answers:', JSON.stringify(answers));
        }

        // Re-scan DOM for fresh element references (React/Vue may have re-rendered during AI wait)
        const freshInputs = Array.from(document.querySelectorAll('input, textarea, select'));
        const freshByLabel = new Map();
        const freshRadioGroups = new Map();
        for (const el of freshInputs) {
          try {
            if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'file') continue;
            if (el.readOnly || el.disabled) continue;
            const label = getLabel(el);
            if (!label) continue;
            const labelKey = label.trim().slice(0, 80);
            if (el.type === 'radio') {
              if (!freshRadioGroups.has(labelKey)) freshRadioGroups.set(labelKey, []);
              freshRadioGroups.get(labelKey).push(el);
              if (!freshByLabel.has(labelKey)) freshByLabel.set(labelKey, el);
            } else if (!freshByLabel.has(labelKey)) {
              freshByLabel.set(labelKey, el);
            }
          } catch (_) {}
        }

        let aiFilled = 0;
        for (const [labelKey, entry] of unknownMap) {
          const answer = answers[labelKey];
          if (!answer || !String(answer).trim()) {
            skipped.push(labelKey.slice(0, 40));
            continue;
          }
          try {
            // Use fresh DOM element if available, fall back to original reference
            const freshEl = freshByLabel.get(labelKey) || entry.el;

            if (entry.descriptor.type === 'radio') {
              const radios = freshRadioGroups.get(labelKey) || radioGroups.get(labelKey) || [freshEl];
              const ok = radios.some(r => fillInput(r, String(answer)));
              if (ok) {
                filled.push(labelKey.slice(0, 40) + ' (AI)');
                aiFilled++;
              } else {
                console.warn('[AutoFill] Radio no match:', labelKey, '=', answer);
                skipped.push(labelKey.slice(0, 40));
              }
            } else {
              const ok = fillInput(freshEl, String(answer));
              if (ok) {
                filled.push(labelKey.slice(0, 40) + ' (AI)');
                aiFilled++;
              } else {
                console.warn('[AutoFill] Fill failed:', labelKey, '=', answer);
                skipped.push(labelKey.slice(0, 40));
              }
            }
          } catch (fillErr) {
            console.warn('[AutoFill] Error filling', labelKey, fillErr);
            skipped.push(labelKey.slice(0, 40));
          }
        }

        if (!aiError) {
          if (aiFilled > 0) {
            showPageBanner('AI filled ' + aiFilled + ' fields', 'success');
          } else {
            showPageBanner('AI returned no usable answers', 'error');
          }
          hideBanner(4000);
        }
      } else {
        aiError = 'Server ' + proxyResponse.status + ': ' + (proxyResponse.body || '').slice(0, 100);
        console.error('[AutoFill] Server error:', aiError);
        showPageBanner('AI fill failed: ' + proxyResponse.status, 'error');
        hideBanner(5000);
        for (const [k] of unknownMap) skipped.push(k.slice(0, 40));
      }
    } catch (fetchErr) {
      aiError = fetchErr.message || 'Network error connecting to backend';
      console.error('[AutoFill] Fetch error:', fetchErr);
      showPageBanner(aiError.slice(0, 60), 'error');
      hideBanner(5000);
      for (const [k] of unknownMap) skipped.push(k.slice(0, 40));
    }
  } else {
    console.log('[AutoFill] No unknown fields — skipping AI phase');
  }

  return { filled, skipped, aiError };
}

// ── Detect which ATS we're on ─────────────────────────────────────────────────

function detectATS() {
  const host = window.location.hostname;
  if (host.includes('greenhouse.io')) return 'Greenhouse';
  if (host.includes('lever.co')) return 'Lever';
  if (host.includes('ashbyhq.com')) return 'Ashby';
  if (host.includes('myworkdayjobs.com')) return 'Workday';
  if (host.includes('smartrecruiters.com')) return 'SmartRecruiters';
  if (host.includes('workable.com')) return 'Workable';
  return 'Unknown';
}

// ── Message listener (from popup) ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'DETECT') {
    const ats = detectATS();
    const inputCount = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]), textarea, select').length;
    sendResponse({ ats, inputCount, url: window.location.href });
  }

  if (message.type === 'AUTOFILL') {
    autoFill(message.profile)
      .then(result => sendResponse(result))
      .catch((err) => {
        console.error('[AutoFill] Fatal error:', err);
        sendResponse({ filled: [], skipped: [], aiError: err.message || String(err) });
      });
    return true; // keep channel open for async response
  }

  return true;
});

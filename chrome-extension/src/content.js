// ── Content Script: Auto-fill job application forms ──────────────────────────
// Injected on all pages. Phase 1 fills known fields from profile.json,
// Phase 1.5 checks answer cache, Phase 2 sends unknown fields to the backend AI endpoint.
// Phase 7 additions: custom dropdown handlers, multi-step observer, "Learn this field" button, cache integration.

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

// ── Proxy fetch helper ──────────────────────────────────────────────────────
// Routes all backend requests through the background service worker to avoid
// HTTPS → HTTP mixed content blocks.

function proxyFetch(url, options) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out (30s)')), 30000);
    chrome.runtime.sendMessage({
      type: 'FETCH_PROXY',
      url,
      options: {
        method: options?.method || 'GET',
        headers: options?.headers || {},
        body: options?.body || undefined,
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
}

// ── SHA-256 hash (for cache lookup) ─────────────────────────────────────────

async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Answer Cache Integration (Phase 7) ──────────────────────────────────────

/**
 * Look up a cached answer for a question via the backend API.
 * Returns the answer string if found with confidence >= 0.8, null otherwise.
 */
async function lookupCache(baseUrl, questionText) {
  try {
    const hash = await sha256(questionText);
    const res = await proxyFetch(`${baseUrl}/api/cache/lookup?hash=${encodeURIComponent(hash)}`);
    if (!res.ok) return null;
    const data = JSON.parse(res.body);
    if (data.answer && (data.confidence ?? 0) >= 0.8) return data.answer;
  } catch (_) {}
  return null;
}

/**
 * Save an answer to the cache via the backend API.
 */
async function saveToCache(baseUrl, questionText, answer, source) {
  if (!answer || !answer.trim()) return;
  try {
    await proxyFetch(`${baseUrl}/api/cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_text: questionText, answer, source }),
    });
  } catch (err) {
    console.warn('[AutoFill] Cache save error:', err);
  }
}

// ── Custom Dropdown Handling (Phase 7) ──────────────────────────────────────

/**
 * Detect if an element is a custom dropdown (MUI, React Select, Ant Design).
 */
function isCustomDropdown(el) {
  const className = (el.className || '').toString().toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  const ariaHasPopup = (el.getAttribute('aria-haspopup') || '').toLowerCase();

  return (
    role === 'combobox' ||
    role === 'listbox' ||
    ariaHasPopup === 'listbox' ||
    className.includes('react-select') ||
    className.includes('ant-select') ||
    className.includes('mui') ||
    className.includes('select__control') ||
    el.closest('.react-select__control, .ant-select, .MuiAutocomplete-root, [class*="select__control"]') !== null
  );
}

/**
 * Click-based interaction for custom dropdowns.
 * Clicks the trigger, waits for the menu to appear, selects the matching option.
 */
async function fillCustomDropdown(el, value) {
  try {
    // Find the clickable trigger element
    const trigger = el.closest('.react-select__control, .ant-select-selector, .MuiAutocomplete-root, [role="combobox"]') || el;
    trigger.click();
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    // Wait for dropdown menu to appear
    await new Promise(r => setTimeout(r, 300));

    const menuSelectors = [
      '[role="listbox"]',
      '[role="option"]',
      '.react-select__menu',
      '.react-select__option',
      '.ant-select-dropdown',
      '.ant-select-item-option',
      '.MuiAutocomplete-popper',
      '.MuiAutocomplete-option',
      '.Select-menu-outer',
      '.Select-option',
    ];

    const lower = value.toLowerCase().trim();

    // Try to find and click a matching option
    for (const selector of menuSelectors) {
      const options = document.querySelectorAll(selector);
      for (const option of options) {
        const text = (option.textContent || '').trim().toLowerCase();
        if (text === lower || text.includes(lower) || lower.includes(text)) {
          option.click();
          option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          return true;
        }
      }
    }

    // Fallback: type into the search input within the dropdown
    const searchInput = document.querySelector(
      '.react-select__input input, .ant-select-selection-search-input, input[aria-autocomplete], [role="combobox"] input'
    );
    if (searchInput) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(searchInput, value);
      else searchInput.value = value;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));

      // Wait for filtered results
      await new Promise(r => setTimeout(r, 400));

      // Click first matching option
      for (const selector of ['[role="option"]', '.react-select__option', '.ant-select-item-option', '.MuiAutocomplete-option']) {
        const firstOption = document.querySelector(selector);
        if (firstOption) {
          firstOption.click();
          return true;
        }
      }
    }

    // Close the dropdown if nothing matched
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  } catch (err) {
    console.warn('[AutoFill] Custom dropdown error:', err);
    return false;
  }
}

// ── "Learn this field" button (Phase 7) ─────────────────────────────────────

const learnButtonsPlaced = new WeakSet();

/**
 * Place a small "Remember" button next to unfilled fields.
 * When clicked, saves the field's current value to the answer cache.
 */
function placeLearnButton(el, labelKey, baseUrl) {
  if (learnButtonsPlaced.has(el)) return;
  learnButtonsPlaced.add(el);

  try {
    const btn = document.createElement('button');
    btn.textContent = 'Remember';
    btn.className = '__ja-learn-btn';
    btn.style.position = 'absolute';
    btn.style.fontSize = '10px';
    btn.style.padding = '2px 6px';
    btn.style.background = '#1e66f5';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.borderRadius = '4px';
    btn.style.cursor = 'pointer';
    btn.style.zIndex = '999998';
    btn.style.opacity = '0.8';
    btn.style.fontFamily = 'system-ui, sans-serif';
    btn.style.fontWeight = '600';
    btn.title = 'Save this answer for future applications';

    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.8'; });

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentValue = el.value?.trim();
      if (!currentValue) {
        btn.textContent = 'Fill first!';
        btn.style.background = '#d20f39';
        setTimeout(() => { btn.textContent = 'Remember'; btn.style.background = '#1e66f5'; }, 2000);
        return;
      }

      await saveToCache(baseUrl, labelKey, currentValue, 'manual_first_fill');
      btn.textContent = 'Saved!';
      btn.style.background = '#40a02b';
      setTimeout(() => {
        try { btn.remove(); } catch (_) {}
      }, 2000);
    });

    // Position relative to the field
    const parent = el.parentElement;
    if (parent) {
      parent.style.position = parent.style.position || 'relative';
      parent.appendChild(btn);
      // Position at top-right of the field's parent
      btn.style.right = '4px';
      btn.style.top = '4px';
    }
  } catch (err) {
    console.warn('[AutoFill] Learn button error:', err);
  }
}

// ── Form state snapshot for correction detection ────────────────────────────

function snapshotFormState() {
  const state = {};
  const inputs = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select');
  for (const el of inputs) {
    const label = getLabel(el);
    if (!label) continue;
    const key = label.trim().slice(0, 80);
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      state[key] = el.options[el.selectedIndex]?.text?.trim() || '';
    } else if (el.type === 'radio' || el.type === 'checkbox') {
      if (el.checked) {
        const prev = state[key];
        state[key] = prev ? `${prev}, ${el.value}` : el.value;
      }
    } else {
      state[key] = el.value || '';
    }
  }
  return state;
}

// ── Main auto-fill function ───────────────────────────────────────────────────

async function autoFill(profile, jobDescription) {
  const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
  const filled = [];
  const skipped = [];
  let aiError = null;

  const unknownMap = new Map();
  const radioGroups = new Map();
  const baseUrl = (profile.job_tracker_url || 'http://localhost:8000').replace(/\/$/, '');

  // Also scan for custom dropdown elements
  const customDropdowns = Array.from(document.querySelectorAll(
    '[role="combobox"], [aria-haspopup="listbox"], .react-select__control, .ant-select-selector, .MuiAutocomplete-root'
  ));

  // ── Phase 1: fill known fields from profile ───────────────────────────────
  console.log('[AutoFill] Phase 1: scanning', inputs.length, 'form elements +', customDropdowns.length, 'custom dropdowns');

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

          // Check if this is a custom dropdown
          if (isCustomDropdown(el)) {
            const ok = await fillCustomDropdown(el, value);
            if (ok) {
              filled.push(label.trim().slice(0, 40));
              matched = true;
              break;
            }
          }

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
            unknownMap.set(labelKey, { el, descriptor: { label: labelKey, type: 'radio' }, isCustom: false });
        } else if (!unknownMap.has(labelKey)) {
          const descriptor = { label: labelKey, type };
          if (type === 'select' && el.options && el.options.length) {
            descriptor.options = Array.from(el.options)
              .filter(o => o.value !== '')
              .map(o => o.text.trim())
              .slice(0, 20);
          }
          unknownMap.set(labelKey, { el, descriptor, isCustom: isCustomDropdown(el) });
        }
      }
    } catch (elErr) {
      console.warn('[AutoFill] Error processing element:', el, elErr);
    }
  }

  // Also process standalone custom dropdown elements not caught by input scan
  for (const el of customDropdowns) {
    try {
      const label = getLabel(el);
      if (!label) continue;
      const labelKey = label.trim().slice(0, 80);
      if (unknownMap.has(labelKey)) continue; // already tracked

      let matched = false;
      for (const { keys, profilePath, transform } of FIELD_MAP) {
        if (labelMatches(label, keys)) {
          let value = getNestedValue(profile, profilePath);
          value = applyTransform(String(value ?? ''), transform);
          const ok = await fillCustomDropdown(el, value);
          if (ok) {
            filled.push(labelKey.slice(0, 40));
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        unknownMap.set(labelKey, { el, descriptor: { label: labelKey, type: 'select' }, isCustom: true });
      }
    } catch (_) {}
  }

  console.log('[AutoFill] Phase 1 done:', filled.length, 'filled,', unknownMap.size, 'unknown fields');

  // ── Phase 1.5: Check answer cache for unknown fields ──────────────────────
  const cacheFilled = [];
  const stillUnknown = new Map();

  if (unknownMap.size > 0) {
    console.log('[AutoFill] Phase 1.5: checking answer cache for', unknownMap.size, 'fields');
    showPageBanner('Checking answer cache...', 'info');

    for (const [labelKey, entry] of unknownMap) {
      try {
        const cachedAnswer = await lookupCache(baseUrl, labelKey);
        if (cachedAnswer) {
          let ok = false;
          if (entry.isCustom) {
            ok = await fillCustomDropdown(entry.el, cachedAnswer);
          } else {
            // Re-fetch fresh element
            const freshInputs = document.querySelectorAll('input, textarea, select');
            let freshEl = entry.el;
            for (const input of freshInputs) {
              const l = getLabel(input);
              if (l && l.trim().slice(0, 80) === labelKey) { freshEl = input; break; }
            }
            if (entry.descriptor.type === 'radio') {
              const radios = radioGroups.get(labelKey) || [freshEl];
              ok = radios.some(r => fillInput(r, cachedAnswer));
            } else {
              ok = fillInput(freshEl, cachedAnswer);
            }
          }
          if (ok) {
            filled.push(labelKey.slice(0, 40) + ' (cached)');
            cacheFilled.push(labelKey);
            continue;
          }
        }
      } catch (_) {}
      stillUnknown.set(labelKey, entry);
    }

    if (cacheFilled.length > 0) {
      console.log('[AutoFill] Cache filled', cacheFilled.length, 'fields');
    }
  }

  // ── Phase 2: AI-fill remaining unknown fields via backend ─────────────────
  if (stillUnknown.size > 0) {
    const fields = Array.from(stillUnknown.values()).map(v => v.descriptor);

    console.log('[AutoFill] Phase 2: sending', fields.length, 'fields to AI via background proxy');
    console.log('[AutoFill] Fields:', JSON.stringify(fields.map(f => f.label)));
    showPageBanner('AI filling ' + stillUnknown.size + ' fields...', 'info');

    try {
      const proxyResponse = await proxyFetch(baseUrl + '/api/ai-fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, profile, jobDescription }),
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
        for (const [labelKey, entry] of stillUnknown) {
          const answer = answers[labelKey];
          if (!answer || !String(answer).trim()) {
            skipped.push(labelKey.slice(0, 40));
            // Place "Learn this field" button for unfilled fields
            const freshEl = freshByLabel.get(labelKey) || entry.el;
            placeLearnButton(freshEl, labelKey, baseUrl);
            continue;
          }
          try {
            const freshEl = freshByLabel.get(labelKey) || entry.el;
            let ok = false;

            if (entry.isCustom) {
              ok = await fillCustomDropdown(freshEl, String(answer));
            } else if (entry.descriptor.type === 'radio') {
              const radios = freshRadioGroups.get(labelKey) || radioGroups.get(labelKey) || [freshEl];
              ok = radios.some(r => fillInput(r, String(answer)));
            } else {
              ok = fillInput(freshEl, String(answer));
            }

            if (ok) {
              filled.push(labelKey.slice(0, 40) + ' (AI)');
              aiFilled++;
              // Save AI answer to cache for future reuse
              saveToCache(baseUrl, labelKey, String(answer), 'ai').catch(() => {});
            } else {
              console.warn('[AutoFill] Fill failed:', labelKey, '=', answer);
              skipped.push(labelKey.slice(0, 40));
              placeLearnButton(freshEl, labelKey, baseUrl);
            }
          } catch (fillErr) {
            console.warn('[AutoFill] Error filling', labelKey, fillErr);
            skipped.push(labelKey.slice(0, 40));
          }
        }

        if (!aiError) {
          if (aiFilled > 0) {
            showPageBanner(`Filled: ${filled.length} (${cacheFilled.length} cached, ${aiFilled} AI)`, 'success');
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
        for (const [k] of stillUnknown) skipped.push(k.slice(0, 40));
      }
    } catch (fetchErr) {
      aiError = fetchErr.message || 'Network error connecting to backend';
      console.error('[AutoFill] Fetch error:', fetchErr);
      showPageBanner(aiError.slice(0, 60), 'error');
      hideBanner(5000);
      for (const [k] of stillUnknown) skipped.push(k.slice(0, 40));
    }
  } else if (unknownMap.size > 0 && cacheFilled.length > 0) {
    showPageBanner(`Filled ${filled.length} fields (${cacheFilled.length} from cache)`, 'success');
    hideBanner(4000);
  } else {
    console.log('[AutoFill] No unknown fields -- skipping AI phase');
  }

  return { filled, skipped, aiError, cacheFilled: cacheFilled.length };
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

// ── Multi-step form detection via MutationObserver (Phase 7) ────────────────

let multiStepObserver = null;
let lastAutoFillProfile = null;
let lastJobDescription = null;
let multiStepDebounce = null;

function startMultiStepObserver() {
  if (multiStepObserver) return;

  // Track the current set of form fields
  let knownFieldCount = document.querySelectorAll(
    'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select'
  ).length;

  multiStepObserver = new MutationObserver((mutations) => {
    // Check if any mutations added form-related nodes
    let hasNewFormContent = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        const el = node;
        // Check if the added node contains or is a form element
        if (
          el.matches?.('input, textarea, select, form, fieldset') ||
          el.querySelector?.('input, textarea, select')
        ) {
          hasNewFormContent = true;
          break;
        }
      }
      if (hasNewFormContent) break;
    }

    if (!hasNewFormContent) return;

    // Debounce: wait 500ms for DOM to settle before re-filling
    clearTimeout(multiStepDebounce);
    multiStepDebounce = setTimeout(() => {
      const currentFieldCount = document.querySelectorAll(
        'input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select'
      ).length;

      // Only re-fill if we gained new fields (not just DOM reshuffling)
      if (currentFieldCount > knownFieldCount && lastAutoFillProfile) {
        console.log('[AutoFill] Multi-step: detected', currentFieldCount - knownFieldCount, 'new form fields, re-filling...');
        knownFieldCount = currentFieldCount;
        showPageBanner('New form section detected, auto-filling...', 'info');
        autoFill(lastAutoFillProfile, lastJobDescription).then((result) => {
          if (result.filled.length > 0) {
            showPageBanner(`Filled ${result.filled.length} new fields`, 'success');
            hideBanner(3000);
          } else {
            hideBanner(1000);
          }
        }).catch(() => {});
      }
      knownFieldCount = currentFieldCount;
    }, 500);
  });

  multiStepObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
  console.log('[AutoFill] Multi-step form observer started');
}

// ── Correction detection: watch for form submission ─────────────────────────

let preSubmitSnapshot = null;

function watchForSubmission(baseUrl) {
  // Capture pre-submit state
  preSubmitSnapshot = snapshotFormState();

  // Listen for form submissions
  document.addEventListener('submit', async (e) => {
    if (!preSubmitSnapshot) return;

    // Snapshot the final state right before submission
    const postState = snapshotFormState();

    // Compare and save corrections
    let correctionCount = 0;
    for (const [label, originalValue] of Object.entries(preSubmitSnapshot)) {
      const finalValue = postState[label];
      if (finalValue === undefined) continue;
      if (finalValue.trim() === originalValue.trim()) continue;
      if (!finalValue.trim()) continue;

      // User changed this field — save as correction
      await saveToCache(baseUrl, label, finalValue, 'manual_correction');
      correctionCount++;
      console.log(`[AutoFill] Correction saved: "${label}": "${originalValue}" -> "${finalValue}"`);
    }

    if (correctionCount > 0) {
      console.log(`[AutoFill] Saved ${correctionCount} correction(s) to cache`);
    }
    preSubmitSnapshot = null;
  }, { capture: true });
}

// ── Message listener (from popup) ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'DETECT') {
    const ats = detectATS();
    const inputCount = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]), textarea, select').length;
    const customDropdownCount = document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"], .react-select__control, .ant-select-selector').length;
    sendResponse({ ats, inputCount, customDropdownCount, url: window.location.href });
  }

  if (message.type === 'AUTOFILL') {
    // Store for multi-step re-fill
    lastAutoFillProfile = message.profile;
    lastJobDescription = message.jobDescription;

    const baseUrl = (message.profile.job_tracker_url || 'http://localhost:8000').replace(/\/$/, '');

    autoFill(message.profile, message.jobDescription)
      .then(result => {
        // Start watching for multi-step form changes
        startMultiStepObserver();
        // Start watching for submission to detect corrections
        watchForSubmission(baseUrl);
        // Snapshot pre-submit state for correction detection
        preSubmitSnapshot = snapshotFormState();
        sendResponse(result);
      })
      .catch((err) => {
        console.error('[AutoFill] Fatal error:', err);
        sendResponse({ filled: [], skipped: [], aiError: err.message || String(err) });
      });
    return true; // keep channel open for async response
  }

  return true;
});

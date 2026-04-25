"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ashby = void 0;
// ── Ashby Adapter ──────────────────────────────────────────────────────────────
exports.ashby = {
    name: 'ashby',
    // ── Detection ───────────────────────────────────────────────────────────────
    async detect(page) {
        try {
            const url = page.url();
            if (url.includes('jobs.ashbyhq.com') || url.includes('app.ashbyhq.com')) {
                const pageState = await page.evaluate(() => {
                    const text = (document.body?.innerText ?? '').toLowerCase();
                    const hasPassword = !!document.querySelector('input[type="password"]');
                    const hasApplySignals = /(resume|cover letter|work authorization|submit application|apply for this job)/i.test(text);
                    return { hasPassword, hasApplySignals };
                });
                if (pageState.hasPassword && !pageState.hasApplySignals)
                    return false;
                return true;
            }
            // DOM-based signals
            const domMatch = await page.evaluate(() => {
                if (document.querySelector('[data-ashby-app]'))
                    return true;
                if (document.querySelector('[data-ashby]'))
                    return true;
                return false;
            });
            return domMatch;
        }
        catch {
            return false;
        }
    },
    // ── Form Filling ─────────────────────────────────────────────────────────────
    async fillForm(page, engine, job) {
        // Wait for Ashby's React app to mount
        try {
            await page.waitForSelector('form, [data-ashby-app]', { timeout: 15000 });
        }
        catch {
            console.warn('[ashby] No form or [data-ashby-app] found within 15s');
            return [];
        }
        const fieldInfos = await page.evaluate(() => {
            const results = [];
            // Standard inputs
            const standardInputs = Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], ' +
                'input[type="number"], input[type="url"], ' +
                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), ' +
                'textarea'));
            // Custom Ashby dropdowns
            const comboboxes = Array.from(document.querySelectorAll('div[role="combobox"], button[aria-haspopup="listbox"]'));
            // Radio groups
            const radioGroups = Array.from(document.querySelectorAll('div[role="radiogroup"]'));
            // Checkboxes (ARIA)
            const checkboxes = Array.from(document.querySelectorAll('div[role="checkbox"]'));
            const allElements = [
                ...standardInputs.map(el => ({ el })),
                ...comboboxes.map(el => ({ el, customType: 'combobox' })),
                ...radioGroups.map(el => ({ el, customType: 'radiogroup' })),
                ...checkboxes.map(el => ({ el, customType: 'checkbox' })),
            ];
            let globalIndex = 0;
            // Per-type counters for .nth() positioning of ARIA elements
            let comboboxIndex = 0;
            let radiogroupIndex = 0;
            let checkboxAriaIndex = 0;
            for (const { el, customType } of allElements) {
                const tag = el.tagName.toLowerCase();
                const inputType = el.type?.toLowerCase() ?? '';
                let fieldType;
                if (customType === 'combobox') {
                    fieldType = 'select';
                }
                else if (customType === 'radiogroup') {
                    fieldType = 'radio';
                }
                else if (customType === 'checkbox') {
                    fieldType = 'checkbox';
                }
                else if (tag === 'textarea') {
                    fieldType = 'textarea';
                }
                else if (inputType === 'radio') {
                    fieldType = 'radio';
                }
                else if (inputType === 'checkbox') {
                    fieldType = 'checkbox';
                }
                else {
                    fieldType = 'text';
                }
                // Build a unique selector
                const id = el.id || null;
                const ariaLabel = el.getAttribute('aria-label')?.trim() || null;
                const name = el.name || null;
                let selector = '';
                let ariaBase = null;
                let nthIndex = null;
                if (customType === 'combobox') {
                    const role = el.getAttribute('role');
                    const baseSelector = role === 'combobox' ? 'div[role="combobox"]' : 'button[aria-haspopup="listbox"]';
                    if (id) {
                        selector = `${baseSelector}#${id}`;
                    }
                    else if (ariaLabel) {
                        selector = `${baseSelector}[aria-label="${ariaLabel}"]`;
                    }
                    else {
                        ariaBase = baseSelector;
                        nthIndex = comboboxIndex;
                        selector = baseSelector; // placeholder; interaction uses .nth(nthIndex)
                    }
                    comboboxIndex++;
                }
                else if (customType === 'radiogroup') {
                    if (id) {
                        selector = `div[role="radiogroup"]#${id}`;
                    }
                    else if (ariaLabel) {
                        selector = `div[role="radiogroup"][aria-label="${ariaLabel}"]`;
                    }
                    else {
                        ariaBase = 'div[role="radiogroup"]';
                        nthIndex = radiogroupIndex;
                        selector = 'div[role="radiogroup"]';
                    }
                    radiogroupIndex++;
                }
                else if (customType === 'checkbox') {
                    if (id) {
                        selector = `div[role="checkbox"]#${id}`;
                    }
                    else if (ariaLabel) {
                        selector = `div[role="checkbox"][aria-label="${ariaLabel}"]`;
                    }
                    else {
                        ariaBase = 'div[role="checkbox"]';
                        nthIndex = checkboxAriaIndex;
                        selector = 'div[role="checkbox"]';
                    }
                    checkboxAriaIndex++;
                }
                else if (id) {
                    selector = `#${id}`;
                }
                else if (name) {
                    selector = `[name="${name}"]`;
                }
                else {
                    selector = '';
                }
                if (!selector) {
                    globalIndex++;
                    continue;
                }
                // Label extraction — look for <label>, aria-label, or sibling/parent text
                let labelText = '';
                if (id) {
                    const lbl = document.querySelector(`label[for="${id}"]`);
                    if (lbl)
                        labelText = lbl.textContent?.trim() ?? '';
                }
                if (!labelText) {
                    labelText = el.getAttribute('aria-label')?.trim() ?? '';
                }
                if (!labelText) {
                    labelText = el.getAttribute('aria-labelledby')
                        ? (document.getElementById(el.getAttribute('aria-labelledby'))?.textContent?.trim() ?? '')
                        : '';
                }
                if (!labelText) {
                    // Walk up the tree looking for a label or a sibling div with text
                    let node = el.parentElement;
                    while (node) {
                        if (node.tagName === 'LABEL') {
                            labelText = node.textContent?.trim() ?? '';
                            break;
                        }
                        const labels = node.querySelectorAll('label');
                        if (labels.length === 1) {
                            labelText = labels[0].textContent?.trim() ?? '';
                            break;
                        }
                        // Look for a sibling div or span that acts as a label
                        const siblings = Array.from(node.children);
                        for (const sibling of siblings) {
                            if (sibling === el)
                                continue;
                            const sibTag = sibling.tagName.toLowerCase();
                            if (['div', 'span', 'p', 'legend'].includes(sibTag)) {
                                const text = sibling.textContent?.trim();
                                if (text && text.length < 150) {
                                    labelText = text;
                                    break;
                                }
                            }
                        }
                        if (labelText)
                            break;
                        if (['FIELDSET', 'LI', 'DD', 'SECTION', 'FORM'].includes(node.tagName))
                            break;
                        node = node.parentElement;
                    }
                }
                if (!labelText) {
                    globalIndex++;
                    continue; // skip unlabelled fields
                }
                // Options for custom dropdowns — try to read from aria attributes or DOM
                let options = [];
                if (customType === 'combobox') {
                    // Options are in a listbox that may not be in DOM yet; leave empty for now
                    options = [];
                }
                results.push({
                    label: labelText,
                    type: fieldType,
                    selector,
                    ariaBase,
                    nthIndex,
                    options,
                    required: el.required ?? el.getAttribute('aria-required') === 'true',
                    id,
                    name,
                    index: globalIndex,
                });
                globalIndex++;
            }
            return results;
        });
        // Deduplicate by label+type (keep first occurrence)
        const seen = new Set();
        const uniqueFields = [];
        for (const f of fieldInfos) {
            const key = `${f.label}::${f.type}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueFields.push(f);
            }
        }
        // Build FormField array for the engine
        const formFields = uniqueFields.map(f => ({
            label: f.label,
            type: f.type,
            options: f.options.length > 0 ? f.options : undefined,
            required: f.required,
        }));
        // Resolve all fields via the engine (profile → cache → AI)
        const resolved = await engine.resolveFields(formFields, job.description_snippet);
        // ── Apply resolved values to the page ─────────────────────────────────────
        for (const result of resolved) {
            if (result.source === 'unfilled' || !result.value)
                continue;
            const info = uniqueFields.find(f => f.label === result.label);
            if (!info)
                continue;
            try {
                switch (info.type) {
                    case 'text':
                    case 'textarea': {
                        await page.locator(info.selector).fill(result.value);
                        break;
                    }
                    case 'select': {
                        // Custom Ashby dropdown: click to open → wait for listbox → click matching option
                        // Use .nth() for ARIA elements that had no unique id/aria-label
                        const selectLocator = info.ariaBase !== null && info.nthIndex !== null
                            ? page.locator(info.ariaBase).nth(info.nthIndex)
                            : page.locator(info.selector);
                        try {
                            await selectLocator.click();
                            await page.waitForSelector('[role="listbox"]', { timeout: 3000 });
                            // Find matching option in the listbox
                            const option = page
                                .locator('div[role="option"], li[role="option"]')
                                .filter({ hasText: result.value })
                                .first();
                            if (await option.count() > 0) {
                                await option.click();
                            }
                            else {
                                // Try case-insensitive partial match
                                const allOptions = page.locator('div[role="option"], li[role="option"]');
                                const optCount = await allOptions.count();
                                let matched = false;
                                for (let oi = 0; oi < optCount; oi++) {
                                    const opt = allOptions.nth(oi);
                                    const text = (await opt.textContent()) ?? '';
                                    if (text.toLowerCase().includes(result.value.toLowerCase())) {
                                        await opt.click();
                                        matched = true;
                                        break;
                                    }
                                }
                                if (!matched) {
                                    // Close the dropdown by pressing Escape
                                    await page.keyboard.press('Escape');
                                    console.warn(`[ashby] Could not find option "${result.value}" for field "${result.label}"`);
                                }
                            }
                        }
                        catch (err) {
                            console.warn(`[ashby] Dropdown interaction failed for "${result.label}":`, err);
                        }
                        break;
                    }
                    case 'radio': {
                        // Ashby radio groups use div[role="radiogroup"] with div[role="radio"] children
                        const radioLocator = info.ariaBase !== null && info.nthIndex !== null
                            ? page.locator(info.ariaBase).nth(info.nthIndex)
                            : page.locator(info.selector);
                        await radioLocator
                            .locator('div[role="radio"]')
                            .filter({ hasText: result.value })
                            .first()
                            .click();
                        break;
                    }
                    case 'checkbox': {
                        const truthy = /^(yes|true|1)$/i.test(result.value.trim());
                        if (truthy) {
                            const checkbox = info.ariaBase !== null && info.nthIndex !== null
                                ? page.locator(info.ariaBase).nth(info.nthIndex)
                                : page.locator(info.selector).first();
                            const isChecked = (await checkbox.getAttribute('aria-checked')) === 'true';
                            if (!isChecked)
                                await checkbox.click();
                        }
                        break;
                    }
                    default:
                        break;
                }
            }
            catch (err) {
                console.warn(`[ashby] Failed to fill field "${result.label}":`, err);
            }
        }
        return resolved;
    },
    // ── Multi-step handling ──────────────────────────────────────────────────────
    async handleMultiStep(page) {
        try {
            const nextButton = page
                .locator('button')
                .filter({ hasText: /next|continue/i })
                .first();
            if (await nextButton.count() === 0)
                return false;
            await nextButton.click();
            await page.waitForTimeout(300);
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null);
            return true;
        }
        catch {
            return false;
        }
    },
    // ── Resume upload ────────────────────────────────────────────────────────────
    async uploadResume(page, filePath) {
        const fileInputs = page.locator('input[type="file"]');
        const count = await fileInputs.count();
        if (count > 0) {
            await fileInputs.first().setInputFiles(filePath);
        }
        else {
            console.warn('[ashby] No file input found for resume upload');
        }
    },
    // ── Submit button ────────────────────────────────────────────────────────────
    async getSubmitButton(page) {
        const candidates = [
            'button[type="submit"]',
            'button:text-matches("Submit Application", "i")',
            'button:text-matches("Submit", "i")',
            'button:text-matches("Apply", "i")',
        ];
        for (const sel of candidates) {
            try {
                const el = await page.$(sel);
                if (el)
                    return el;
            }
            catch {
                // try next candidate
            }
        }
        return null;
    },
};

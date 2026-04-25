import type { Page, ElementHandle } from 'playwright';
import type { FormEngine } from '../form-engine';
import type { PlatformAdapter, QueuedJob, FormField, FillResult, FieldType } from '../types';

// ── Greenhouse Adapter ─────────────────────────────────────────────────────────

export const greenhouse: PlatformAdapter = {
  name: 'greenhouse',

  // ── Detection ───────────────────────────────────────────────────────────────

  async detect(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (url.includes('boards.greenhouse.io') || url.includes('job-boards.greenhouse.io')) {
        const pageState = await page.evaluate(() => {
          const text = (document.body?.innerText ?? '').toLowerCase();
          const hasPassword = !!document.querySelector('input[type="password"]');
          const hasApplySignals = /(resume|cover letter|work authorization|submit application|apply for this job)/i.test(text);
          return { hasPassword, hasApplySignals };
        });
        if (pageState.hasPassword && !pageState.hasApplySignals) return false;
        return true;
      }

      // DOM-based signals
      const domMatch = await page.evaluate(() => {
        if (document.querySelector('[data-source="greenhouse"]')) return true;
        if (document.querySelector('#app_body .application')) return true;
        if (document.title.toLowerCase().includes('greenhouse')) return true;
        return false;
      });
      return domMatch;
    } catch {
      return false;
    }
  },

  // ── Form Filling ─────────────────────────────────────────────────────────────

  async fillForm(page: Page, engine: FormEngine, job: QueuedJob): Promise<FillResult[]> {
    // Wait for the form to be ready
    try {
      await page.waitForSelector('form', { timeout: 10000 });
    } catch {
      console.warn('[greenhouse] No <form> found within 10s');
      return [];
    }

    // ── Scan all relevant form elements ───────────────────────────────────────
    type FieldInfo = {
      label: string;
      type: FieldType;
      selector: string;
      options: string[];
      required: boolean;
      name: string | null;
      id: string | null;
    };

    const fieldInfos: FieldInfo[] = await page.evaluate(() => {
      const results: FieldInfo[] = [];

      const inputs = Array.from(
        document.querySelectorAll<HTMLElement>(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]), ' +
          'textarea, ' +
          'select, ' +
          'div[role="combobox"]',
        ),
      );

      for (const el of inputs) {
        const tag = el.tagName.toLowerCase();
        const inputType = (el as HTMLInputElement).type?.toLowerCase() ?? '';

        let fieldType: FieldType;
        if (tag === 'textarea') {
          fieldType = 'textarea';
        } else if (tag === 'select' || el.getAttribute('role') === 'combobox') {
          fieldType = 'select';
        } else if (inputType === 'radio') {
          fieldType = 'radio';
        } else if (inputType === 'checkbox') {
          fieldType = 'checkbox';
        } else {
          fieldType = 'text';
        }

        // Build a unique selector
        const id = el.id || null;
        let selector = '';
        if (id) {
          selector = `#${id}`;
        } else {
          // Use a data attribute or nth-of-type fallback — just mark for later
          const name = (el as HTMLInputElement).name;
          if (name) {
            selector = `[name="${name}"]`;
          } else {
            // Will be skipped for now; real impl can use index
            selector = '';
          }
        }

        if (!selector) continue;

        // Label extraction (inline — no page.evaluate re-entry needed)
        let labelText = '';
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          if (lbl) labelText = lbl.textContent?.trim() ?? '';
        }
        if (!labelText) {
          labelText = el.getAttribute('aria-label')?.trim() ?? '';
        }
        if (!labelText) {
          let node: Element | null = el.parentElement;
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
            // Stop at field container boundaries
            if (['FIELDSET', 'LI', 'DD', 'SECTION', 'FORM'].includes(node.tagName)) break;
            node = node.parentElement;
          }
        }
        if (!labelText) continue; // skip unlabelled fields

        // Options for select / radio / checkbox
        let options: string[] = [];
        if (tag === 'select') {
          options = Array.from((el as HTMLSelectElement).options).map(o => o.label.trim());
        }

        results.push({
          label: labelText,
          type: fieldType,
          selector,
          options,
          required: (el as HTMLInputElement).required ?? false,
          name: (el as HTMLInputElement).name || null,
          id: el.id || null,
        });
      }

      return results;
    });

    // Deduplicate by label (radio groups share a label — keep first)
    const seen = new Set<string>();
    const uniqueFields: FieldInfo[] = [];
    for (const f of fieldInfos) {
      const key = `${f.label}::${f.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFields.push(f);
      }
    }

    // Build FormField array for the engine
    const formFields: FormField[] = uniqueFields.map(f => ({
      label: f.label,
      type: f.type,
      options: f.options.length > 0 ? f.options : undefined,
      required: f.required,
    }));

    // Resolve all fields via the engine (profile → cache → AI)
    const resolved = await engine.resolveFields(formFields, job.description_snippet);

    // ── Apply resolved values to the page ─────────────────────────────────────
    for (const result of resolved) {
      if (result.source === 'unfilled' || !result.value) continue;

      const info = uniqueFields.find(f => f.label === result.label);
      if (!info) continue;

      try {
        switch (info.type) {
          case 'text':
          case 'textarea': {
            await page.fill(info.selector, result.value);
            break;
          }

          case 'select': {
            // Try label match first, fall back to value match
            try {
              await page.selectOption(info.selector, { label: result.value });
            } catch {
              try {
                await page.selectOption(info.selector, { value: result.value });
              } catch {
                console.warn(`[greenhouse] Could not select "${result.value}" for field "${result.label}"`);
              }
            }
            break;
          }

          case 'radio': {
            const radios = page.locator(`input[type="radio"][name="${info.name || info.id}"]`);
            const count = await radios.count();
            let clicked = false;
            for (let ri = 0; ri < count; ri++) {
              const radio = radios.nth(ri);
              // Get label text for this radio
              const labelText = await radio.evaluate((el: HTMLInputElement) => {
                const forLabel = el.id
                  ? document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`)
                  : null;
                return forLabel?.textContent?.trim()
                  ?? el.value
                  ?? '';
              });
              if (labelText.toLowerCase().includes(result.value.toLowerCase()) ||
                  result.value.toLowerCase().includes(labelText.toLowerCase())) {
                await radio.click();
                clicked = true;
                break;
              }
            }
            if (!clicked) {
              // Fallback: try clicking by value attribute
              const byValue = page.locator(`input[type="radio"][value="${result.value}"]`).first();
              if (await byValue.count() > 0) await byValue.click();
            }
            break;
          }

          case 'checkbox': {
            // Click if value is truthy (yes/true/1)
            const truthy = /^(yes|true|1)$/i.test(result.value.trim());
            if (truthy) {
              const isChecked = await page.evaluate((sel: string) => {
                return (document.querySelector(sel) as HTMLInputElement)?.checked ?? false;
              }, info.selector);
              if (!isChecked) await page.click(info.selector);
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.warn(`[greenhouse] Failed to fill field "${result.label}":`, err);
      }
    }

    return resolved;
  },

  // ── Multi-step handling ──────────────────────────────────────────────────────

  async handleMultiStep(page: Page): Promise<boolean> {
    try {
      // Look for a Next / Continue button that is NOT Submit
      const nextButton = page
        .locator('button:not([type="submit"])')
        .filter({ hasText: /next|continue/i })
        .first();

      const nextInput = page
        .locator('input[type="button"]')
        .filter({ hasText: /next|continue/i })
        .first();

      const buttonCount = await nextButton.count();
      const inputCount = await nextInput.count();
      if (buttonCount === 0 && inputCount === 0) return false;
      const toClick = buttonCount > 0 ? nextButton : nextInput;

      const isDisabled = await toClick.evaluate(
        el => (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true',
      );
      if (isDisabled) return false;

      await toClick.click();

      // Wait for DOM change or navigation
      await page.waitForTimeout(300);
      await Promise.race([
        page.waitForNavigation({ timeout: 5000 }).catch(() => null),
        page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => null),
      ]);

      return true;
    } catch {
      return false;
    }
  },

  // ── Resume upload ────────────────────────────────────────────────────────────

  async uploadResume(page: Page, filePath: string): Promise<void> {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);
  },

  // ── Submit button ────────────────────────────────────────────────────────────

  async getSubmitButton(page: Page): Promise<ElementHandle | null> {
    const candidates = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:text-matches("Submit Application", "i")',
      'button:text-matches("Apply", "i")',
      'button:text-matches("Submit", "i")',
    ];

    for (const sel of candidates) {
      try {
        const el = await page.$(sel);
        if (el) return el;
      } catch {
        // try next candidate
      }
    }
    return null;
  },
};

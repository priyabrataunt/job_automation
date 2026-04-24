import type { Page, ElementHandle } from 'playwright';
import type { FormEngine } from '../form-engine';
import type { PlatformAdapter, QueuedJob, FormField, FillResult, FieldType } from '../types';
import { selectCustomDropdown } from '../dropdown-handler';

// ── Generic Adapter (AI-powered fallback) ─────────────────────────────────────

export const generic: PlatformAdapter = {
  name: 'generic',

  // ── Detection ────────────────────────────────────────────────────────────────
  // Always true — this is the last-resort fallback adapter.

  async detect(_page: Page): Promise<boolean> {
    return true;
  },

  // ── Form Filling ─────────────────────────────────────────────────────────────

  async fillForm(page: Page, engine: FormEngine, job: QueuedJob): Promise<FillResult[]> {
    // 1. Wait for a form container
    for (const sel of ['form', 'main', 'body']) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        break;
      } catch {
        // try next container
      }
    }

    // 2. Scan all interactive elements
    type FieldInfo = {
      label: string;
      type: FieldType;
      selector: string;
      options: string[];
      required: boolean;
      name: string | null;
      id: string | null;
      isCustomDropdown: boolean;
    };

    const rawFieldInfos = await page.evaluate(() => {
      // NOTE: No TypeScript type annotations inside this callback body.
      const results: Array<{
        label: string;
        type: string;
        selector: string;
        options: string[];
        required: boolean;
        name: string | null;
        id: string | null;
        isCustomDropdown: boolean;
      }> = [];

      const elements = Array.from(
        document.querySelectorAll(
          'input[type="text"], input[type="email"], input[type="tel"], ' +
          'input[type="number"], input[type="url"], ' +
          'input[type="radio"], input[type="checkbox"], ' +
          'textarea, ' +
          'select, ' +
          'div[role="combobox"], button[aria-haspopup="listbox"]',
        ),
      );

      for (const el of elements) {
        const tag = el.tagName.toLowerCase();
        const inputType = el.getAttribute('type')?.toLowerCase() ?? '';
        const role = el.getAttribute('role')?.toLowerCase() ?? '';
        const ariaHasPopup = el.getAttribute('aria-haspopup')?.toLowerCase() ?? '';

        let fieldType;
        let isCustomDropdown = false;

        if (tag === 'textarea') {
          fieldType = 'textarea';
        } else if (tag === 'select') {
          fieldType = 'select';
        } else if (role === 'combobox' || ariaHasPopup === 'listbox') {
          fieldType = 'select';
          isCustomDropdown = true;
        } else if (inputType === 'radio') {
          fieldType = 'radio';
        } else if (inputType === 'checkbox') {
          fieldType = 'checkbox';
        } else {
          fieldType = 'text';
        }

        // Build a unique selector
        const elId = el.id || null;
        const elName = el.getAttribute('name') || null;
        let selector = '';

        if (elId) {
          selector = '#' + elId;
        } else if (elName) {
          selector = '[name="' + elName + '"]';
        } else {
          // Skip elements without a stable selector
          continue;
        }

        // ── 3-tier label extraction ──────────────────────────────────────────

        let labelText = '';

        // Tier 1: label[for=id]
        if (elId) {
          const lbl = document.querySelector('label[for="' + elId + '"]');
          if (lbl) labelText = lbl.textContent?.trim() ?? '';
        }

        // Tier 2: aria-label
        if (!labelText) {
          labelText = el.getAttribute('aria-label')?.trim() ?? '';
        }

        // Tier 3: ancestor walk (single-label rule)
        if (!labelText) {
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
            if (['FIELDSET', 'LI', 'DD', 'SECTION', 'FORM'].includes(node.tagName)) break;
            node = node.parentElement;
          }
        }

        if (!labelText) continue; // skip unlabelled fields

        // Options for native selects
        const options: string[] = [];
        if (tag === 'select') {
          const selectEl = el as HTMLSelectElement;
          for (let oi = 0; oi < selectEl.options.length; oi++) {
            options.push(selectEl.options[oi].label.trim());
          }
        }

        results.push({
          label: labelText,
          type: fieldType,
          selector,
          options,
          required: el.hasAttribute('required'),
          name: elName,
          id: elId,
          isCustomDropdown,
        });
      }

      return results;
    });

    const fieldInfos: FieldInfo[] = rawFieldInfos.map(f => ({
      ...f,
      type: f.type as FieldType,
    }));

    // Deduplicate by label+type (radio groups share a label — keep first)
    const seen = new Set<string>();
    const uniqueFields: FieldInfo[] = [];
    for (const f of fieldInfos) {
      const key = f.label + '::' + f.type;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueFields.push(f);
      }
    }

    // 4. Build FormField[] and resolve via engine (profile → cache → AI)
    const formFields: FormField[] = uniqueFields.map(f => ({
      label: f.label,
      type: f.type,
      options: f.options.length > 0 ? f.options : undefined,
      required: f.required,
    }));

    const resolved = await engine.resolveFields(formFields, job.description_snippet);

    // 5. Apply resolved values to the page
    for (const result of resolved) {
      if (result.source === 'unfilled' || !result.value) continue;

      const info = uniqueFields.find(f => f.label === result.label);
      if (!info) continue;

      try {
        switch (info.type) {
          case 'text':
          case 'textarea': {
            await page.locator(info.selector).first().fill(result.value);
            break;
          }

          case 'select': {
            if (info.isCustomDropdown) {
              // Custom div/button dropdown — use dropdown handler
              await selectCustomDropdown(page, info.selector, result.value);
            } else {
              // Native <select>
              try {
                await page.locator(info.selector).first().selectOption({ label: result.value });
              } catch {
                try {
                  await page.locator(info.selector).first().selectOption({ value: result.value });
                } catch {
                  console.warn(`[generic] Could not select "${result.value}" for field "${result.label}"`);
                }
              }
            }
            break;
          }

          case 'radio': {
            const nameAttr = info.name || info.id;
            if (!nameAttr) break;

            const radios = page.locator(`input[type="radio"][name="${nameAttr}"]`);
            const count = await radios.count();
            let clicked = false;

            for (let ri = 0; ri < count; ri++) {
              const radio = radios.nth(ri);
              const labelText = await radio.evaluate((el: HTMLInputElement) => {
                const forLabel = el.id
                  ? document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`)
                  : null;
                return forLabel?.textContent?.trim() ?? el.value ?? '';
              });

              if (
                labelText.toLowerCase().includes(result.value.toLowerCase()) ||
                result.value.toLowerCase().includes(labelText.toLowerCase())
              ) {
                await radio.click();
                clicked = true;
                break;
              }
            }

            if (!clicked) {
              // Fallback: match by value attribute
              const byValue = page.locator(`input[type="radio"][value="${result.value}"]`).first();
              if (await byValue.count() > 0) await byValue.click();
            }
            break;
          }

          case 'checkbox': {
            const truthy = /^(yes|true|1)$/i.test(result.value.trim());
            if (truthy) {
              const locator = page.locator(info.selector).first();
              const isChecked = await locator.isChecked();
              if (!isChecked) await locator.click();
            }
            break;
          }

          case 'file': {
            // Handled by uploadResume — skip here
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.warn(`[generic] Failed to fill field "${result.label}":`, err);
      }
    }

    return resolved;
  },

  // ── Multi-step handling ──────────────────────────────────────────────────────

  async handleMultiStep(page: Page): Promise<boolean> {
    try {
      const nextButton = page
        .locator('button')
        .filter({ hasText: /next|continue|proceed/i })
        .first();

      // Exclude submit buttons
      const tag = await nextButton.evaluate((el: HTMLButtonElement) => el.type?.toLowerCase());
      if (tag === 'submit') return false;

      const count = await nextButton.count();
      if (count === 0) return false;

      await nextButton.click();
      await page.waitForTimeout(300);

      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
        // swallow — navigation may not trigger networkidle
      }

      return true;
    } catch {
      return false;
    }
  },

  // ── Resume upload ────────────────────────────────────────────────────────────

  async uploadResume(page: Page, filePath: string): Promise<void> {
    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    if (count > 0) {
      await fileInputs.first().setInputFiles(filePath);
    }
  },

  // ── Submit button ────────────────────────────────────────────────────────────

  async getSubmitButton(page: Page): Promise<ElementHandle | null> {
    // Try explicit submit selectors first
    const staticCandidates = ['button[type="submit"]', 'input[type="submit"]'];
    for (const sel of staticCandidates) {
      try {
        const el = await page.$(sel);
        if (el) return el;
      } catch {
        // try next
      }
    }

    // Then try buttons with submit-like text
    try {
      const textButton = page
        .locator('button')
        .filter({ hasText: /submit|apply|send application/i })
        .first();
      const count = await textButton.count();
      if (count > 0) return await textButton.elementHandle();
    } catch {
      // ignore
    }

    return null;
  },
};

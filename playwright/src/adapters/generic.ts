import type { Page, ElementHandle } from 'playwright';
import type { FormEngine } from '../form-engine';
import type { PlatformAdapter, QueuedJob, FormField, FillResult, FieldType } from '../types';
import { fillAutocomplete, selectCustomDropdown } from '../dropdown-handler';

export const generic: PlatformAdapter = {
  name: 'generic',

  async detect(_page: Page): Promise<boolean> {
    return true;
  },

  async fillForm(page: Page, engine: FormEngine, job: QueuedJob): Promise<FillResult[]> {
    for (const selector of ['form', 'main', 'body']) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        break;
      } catch {
        // try next container
      }
    }

    type FieldInfo = {
      label: string;
      type: FieldType;
      selector: string;
      options: string[];
      required: boolean;
      name: string | null;
      id: string | null;
      isCustomDropdown: boolean;
      isAutocomplete: boolean;
    };

    const rawFieldInfos = await page.evaluate(() => {
      const results: Array<{
        label: string;
        type: string;
        selector: string;
        options: string[];
        required: boolean;
        name: string | null;
        id: string | null;
        isCustomDropdown: boolean;
        isAutocomplete: boolean;
      }> = [];

      const candidateSelector =
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), ' +
        'textarea, select, [role="combobox"], [aria-haspopup="listbox"], [aria-autocomplete], ' +
        '.react-select__control, .ant-select-selector, .MuiAutocomplete-root';

      const allCandidates = Array.from(document.querySelectorAll<HTMLElement>(candidateSelector));
      const seenElements = new Set<HTMLElement>();
      const elements: HTMLElement[] = [];
      for (const candidate of allCandidates) {
        if (!seenElements.has(candidate)) {
          seenElements.add(candidate);
          elements.push(candidate);
        }
      }

      const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().replace(/\s*\*+\s*$/, '');
      const extractByIds = (ids: string | null): string => {
        if (!ids) return '';
        return ids
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .filter(Boolean)
          .join(' ');
      };
      const buildSelector = (element: HTMLElement, index: number): string => {
        if (element.id) return `#${element.id}`;
        const name = element.getAttribute('name');
        if (name) return `[name="${name}"]`;
        const testId = element.getAttribute('data-testid');
        if (testId) return `[data-testid="${testId}"]`;
        const key = element.getAttribute('data-ja-field-key') ?? `ja-field-${index}`;
        element.setAttribute('data-ja-field-key', key);
        return `[data-ja-field-key="${key}"]`;
      };
      const inferLabel = (element: HTMLElement): string => {
        if (element.id) {
          const byFor = document.querySelector(`label[for="${element.id}"]`);
          if (byFor?.textContent) return normalize(byFor.textContent);
        }

        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) return normalize(ariaLabel);

        const labelledBy = extractByIds(element.getAttribute('aria-labelledby'));
        if (labelledBy) return normalize(labelledBy);

        const enclosingLabel = element.closest('label');
        if (enclosingLabel?.textContent) return normalize(enclosingLabel.textContent);

        let node: Element | null = element.parentElement;
        while (node) {
          const labels = node.querySelectorAll('label');
          if (labels.length === 1 && labels[0].textContent) {
            return normalize(labels[0].textContent);
          }
          const legend = node.querySelector('legend');
          if (legend?.textContent) return normalize(legend.textContent);
          if (['FIELDSET', 'LI', 'DD', 'SECTION', 'FORM'].includes(node.tagName)) break;
          node = node.parentElement;
        }

        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          if (element.placeholder?.trim()) return normalize(element.placeholder);
        }

        return '';
      };

      for (let index = 0; index < elements.length; index++) {
        const element = elements[index];
        if (!element.isConnected) continue;

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const tag = element.tagName.toLowerCase();
        const inputType = element.getAttribute('type')?.toLowerCase() ?? '';
        const role = element.getAttribute('role')?.toLowerCase() ?? '';
        const ariaHasPopup = element.getAttribute('aria-haspopup')?.toLowerCase() ?? '';
        const ariaAutocomplete = element.getAttribute('aria-autocomplete')?.toLowerCase() ?? '';
        const className = String(element.className ?? '').toLowerCase();

        let fieldType = 'text';
        let isCustomDropdown = false;
        const isAutocomplete =
          ariaAutocomplete === 'list' ||
          ariaAutocomplete === 'both' ||
          className.includes('autocomplete') ||
          className.includes('react-select') ||
          className.includes('ant-select');

        if (tag === 'textarea') {
          fieldType = 'textarea';
        } else if (tag === 'select') {
          fieldType = 'select';
        } else if (
          role === 'combobox' ||
          ariaHasPopup === 'listbox' ||
          className.includes('react-select') ||
          className.includes('ant-select') ||
          className.includes('mui')
        ) {
          fieldType = 'select';
          isCustomDropdown = tag !== 'select';
        } else if (inputType === 'radio') {
          fieldType = 'radio';
        } else if (inputType === 'checkbox') {
          fieldType = 'checkbox';
        }

        const selector = buildSelector(element, index);
        const label = inferLabel(element);
        if (!label) continue;

        const options: string[] = [];
        if (tag === 'select') {
          const selectElement = element as HTMLSelectElement;
          for (let optionIndex = 0; optionIndex < selectElement.options.length; optionIndex++) {
            const optionText = selectElement.options[optionIndex].label.trim();
            if (optionText) options.push(optionText);
          }
        }

        results.push({
          label,
          type: fieldType,
          selector,
          options,
          required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
          name: element.getAttribute('name'),
          id: element.id || null,
          isCustomDropdown,
          isAutocomplete,
        });
      }

      return results;
    });

    const fieldInfos: FieldInfo[] = rawFieldInfos.map((field) => ({
      ...field,
      type: field.type as FieldType,
    }));

    const dedupe = new Set<string>();
    const uniqueFields: FieldInfo[] = [];
    for (const field of fieldInfos) {
      const dedupeKey = [
        field.label.toLowerCase(),
        field.type,
        field.name ?? field.id ?? field.selector,
      ].join('::');
      if (!dedupe.has(dedupeKey)) {
        dedupe.add(dedupeKey);
        uniqueFields.push(field);
      }
    }

    const formFields: FormField[] = uniqueFields.map((field) => ({
      label: field.label,
      type: field.type,
      options: field.options.length > 0 ? field.options : undefined,
      required: field.required,
    }));

    const resolved = await engine.resolveFields(formFields, job.description_snippet);
    const remainingByLabel = new Map<string, FieldInfo[]>();
    for (const field of uniqueFields) {
      const list = remainingByLabel.get(field.label) ?? [];
      list.push(field);
      remainingByLabel.set(field.label, list);
    }

    for (const result of resolved) {
      if (result.source === 'unfilled' || !result.value) continue;

      const candidates = remainingByLabel.get(result.label) ?? [];
      const info = candidates.shift();
      if (!info) continue;
      remainingByLabel.set(result.label, candidates);

      try {
        switch (info.type) {
          case 'text':
          case 'textarea': {
            if (info.isAutocomplete) {
              const selected = await fillAutocomplete(page, info.selector, result.value);
              if (!selected) await page.locator(info.selector).first().fill(result.value);
            } else {
              await page.locator(info.selector).first().fill(result.value);
            }
            break;
          }

          case 'select': {
            if (info.isCustomDropdown || info.isAutocomplete) {
              const selected = await selectCustomDropdown(page, info.selector, result.value);
              if (!selected && info.isAutocomplete) {
                await fillAutocomplete(page, info.selector, result.value);
              }
              break;
            }

            try {
              await page.locator(info.selector).first().selectOption({ label: result.value });
            } catch {
              try {
                await page.locator(info.selector).first().selectOption({ value: result.value });
              } catch {
                const options = page.locator(`${info.selector} option`);
                const optionCount = await options.count();
                let selected = false;
                for (let optionIndex = 0; optionIndex < optionCount; optionIndex++) {
                  const option = options.nth(optionIndex);
                  const optionText = ((await option.textContent()) ?? '').trim().toLowerCase();
                  const targetText = result.value.trim().toLowerCase();
                  if (
                    optionText === targetText ||
                    optionText.includes(targetText) ||
                    targetText.includes(optionText)
                  ) {
                    const optionValue = await option.getAttribute('value');
                    if (optionValue !== null) {
                      await page.locator(info.selector).first().selectOption({ value: optionValue });
                      selected = true;
                      break;
                    }
                  }
                }
                if (!selected) {
                  console.warn(`[generic] Could not select "${result.value}" for "${result.label}"`);
                }
              }
            }
            break;
          }

          case 'radio': {
            const nameAttr = info.name ?? info.id;
            const radios = nameAttr
              ? page.locator(`input[type="radio"][name="${nameAttr}"]`)
              : page.locator(`input[type="radio"]${info.id ? `#${info.id}` : ''}`);
            const count = await radios.count();
            let clicked = false;

            for (let index = 0; index < count; index++) {
              const radio = radios.nth(index);
              const labelText = await radio.evaluate((element: HTMLInputElement) => {
                const attachedLabel = element.id
                  ? document.querySelector<HTMLLabelElement>(`label[for="${element.id}"]`)
                  : null;
                return attachedLabel?.textContent?.trim() ?? element.value ?? '';
              });
              const normalizedLabel = labelText.toLowerCase();
              const normalizedValue = result.value.toLowerCase();
              if (
                normalizedLabel === normalizedValue ||
                normalizedLabel.includes(normalizedValue) ||
                normalizedValue.includes(normalizedLabel)
              ) {
                await radio.click();
                clicked = true;
                break;
              }
            }

            if (!clicked) {
              const byValue = page.locator(`input[type="radio"][value="${result.value}"]`).first();
              if (await byValue.count() > 0) await byValue.click();
            }
            break;
          }

          case 'checkbox': {
            const shouldCheck = /^(yes|true|1|y)$/i.test(result.value.trim());
            const shouldUncheck = /^(no|false|0|n)$/i.test(result.value.trim());
            const locator = page.locator(info.selector).first();
            const isChecked = await locator.isChecked().catch(() => false);
            if (shouldCheck && !isChecked) await locator.click();
            if (shouldUncheck && isChecked) await locator.click();
            break;
          }

          case 'file':
          default:
            break;
        }
      } catch (error) {
        console.warn(`[generic] Failed to fill field "${result.label}":`, error);
      }
    }

    return resolved;
  },

  async handleMultiStep(page: Page): Promise<boolean> {
    try {
      const nextButton = page
        .locator('button')
        .filter({ hasText: /next|continue|proceed/i })
        .first();

      const count = await nextButton.count();
      if (count === 0) return false;

      const tag = await nextButton.evaluate((el) => (el as HTMLButtonElement).type?.toLowerCase());
      if (tag === 'submit') return false;

      await nextButton.click();
      await page.waitForTimeout(300);

      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
        // navigation might not go idle
      }

      return true;
    } catch {
      return false;
    }
  },

  async uploadResume(page: Page, filePath: string): Promise<void> {
    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    if (count > 0) {
      await fileInputs.first().setInputFiles(filePath);
    }
  },

  async getSubmitButton(page: Page): Promise<ElementHandle | null> {
    const staticCandidates = ['button[type="submit"]', 'input[type="submit"]'];
    for (const selector of staticCandidates) {
      try {
        const element = await page.$(selector);
        if (element) return element;
      } catch {
        // try next selector
      }
    }

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

import type { Page } from 'playwright';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Handles custom dropdown interactions (non-native <select> elements).
 *
 * @param page            The Playwright page.
 * @param triggerSelector CSS selector for the element that opens the dropdown.
 * @param value           The option text to select (case-insensitive, partial match).
 * @returns               `true` if the option was clicked, `false` otherwise.
 */
export async function selectCustomDropdown(
  page: Page,
  triggerSelector: string,
  value: string,
): Promise<boolean> {
  try {
    // 1. Open the dropdown
    await page.locator(triggerSelector).click();

    // 2. Wait for a listbox / menu to appear (try selectors in order)
    const listboxSelectors = [
      '[role="listbox"]',
      '[role="menu"]',
      'ul[role="listbox"]',
      '.dropdown-menu:visible',
    ];

    let listboxLocator = null;
    for (const sel of listboxSelectors) {
      try {
        await page.locator(sel).first().waitFor({ state: 'visible', timeout: 3000 });
        listboxLocator = page.locator(sel).first();
        break;
      } catch {
        // try next selector
      }
    }

    if (!listboxLocator) {
      await page.keyboard.press('Escape');
      return false;
    }

    // 3. Find a matching option inside the listbox
    const optionSelectors = ['[role="option"]', '[role="menuitem"]', 'li'];

    for (const optSel of optionSelectors) {
      const option = listboxLocator.locator(optSel).filter({ hasText: new RegExp(escapeRegex(value), 'i') }).first();
      const count = await option.count();
      if (count > 0) {
        await option.click();
        return true;
      }
    }

    // 4. No matching option found — close and return false
    await page.keyboard.press('Escape');
    return false;
  } catch {
    // On any error: try to close the dropdown and bail
    try {
      await page.keyboard.press('Escape');
    } catch {
      // ignore secondary error
    }
    return false;
  }
}

/**
 * Fills an autocomplete input by typing the first 3 characters and selecting
 * a matching suggestion. Falls back to typing the full value if no suggestion
 * matches.
 *
 * @param page          The Playwright page.
 * @param inputSelector CSS selector for the autocomplete <input>.
 * @param value         The value to type / select.
 * @returns             `true` if a suggestion was selected, `false` if fell back to direct type.
 */
export async function fillAutocomplete(
  page: Page,
  inputSelector: string,
  value: string,
): Promise<boolean> {
  try {
    const input = page.locator(inputSelector).first();

    // 1. Click and type the first 3 chars to trigger suggestions
    await input.click();
    await input.type(value.slice(0, 3), { delay: 80 });

    // 2. Wait for suggestions to appear
    const suggestionSelector = '[role="option"], [role="listitem"], .autocomplete-suggestion';
    try {
      await page.locator(suggestionSelector).first().waitFor({ state: 'visible', timeout: 2000 });
    } catch {
      // No suggestions — fall back to typing the full value
      await input.fill(value);
      return false;
    }

    // 3. Find a suggestion containing the value text
    const suggestion = page
      .locator(suggestionSelector)
      .filter({ hasText: new RegExp(escapeRegex(value), 'i') })
      .first();

    const count = await suggestion.count();
    if (count > 0) {
      await suggestion.click();
      return true;
    }

    // 4. No matching suggestion — clear and type the full value
    await input.fill(value);
    return false;
  } catch {
    // Fallback: try to fill with full value
    try {
      await page.locator(inputSelector).first().fill(value);
    } catch {
      // ignore
    }
    return false;
  }
}

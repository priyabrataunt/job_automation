"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectCustomDropdown = selectCustomDropdown;
exports.fillAutocomplete = fillAutocomplete;
function normalizeText(value) {
    return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function isNearMatch(target, candidate) {
    const t = normalizeText(target);
    const c = normalizeText(candidate);
    if (!t || !c)
        return false;
    return c === t || c.includes(t) || t.includes(c);
}
async function findMatchingOption(page, optionSelectors, value) {
    for (const selector of optionSelectors) {
        const options = page.locator(selector);
        const count = await options.count();
        for (let index = 0; index < count; index++) {
            const option = options.nth(index);
            const text = normalizeText(await option.textContent());
            if (isNearMatch(value, text)) {
                return option;
            }
        }
    }
    return null;
}
/**
 * Handles custom dropdown interactions (non-native <select> elements).
 *
 * @param page            The Playwright page.
 * @param triggerSelector CSS selector for the element that opens the dropdown.
 * @param value           The option text to select (case-insensitive, partial match).
 * @returns               `true` if the option was clicked, `false` otherwise.
 */
async function selectCustomDropdown(page, triggerSelector, value) {
    try {
        const trigger = page.locator(triggerSelector).first();
        await trigger.waitFor({ state: 'visible', timeout: 3000 });
        await trigger.click();
        const listboxSelectors = [
            '[role="listbox"]',
            '[role="menu"]',
            '[id*="listbox"]',
            '.MuiAutocomplete-popper',
            '.MuiMenu-paper',
            '.ant-select-dropdown',
            '.react-select__menu',
            '.Select-menu-outer',
            '.dropdown-menu',
        ];
        let hasMenu = false;
        for (const selector of listboxSelectors) {
            try {
                await page.locator(selector).first().waitFor({ state: 'visible', timeout: 1200 });
                hasMenu = true;
                break;
            }
            catch {
                // continue
            }
        }
        const searchableInput = page.locator([
            'input[aria-autocomplete]',
            'input[role="combobox"]',
            '.react-select__input input',
            '.ant-select-selection-search-input',
        ].join(', ')).first();
        if (!hasMenu) {
            const inputCount = await searchableInput.count();
            if (inputCount > 0) {
                await searchableInput.fill(value);
                await page.keyboard.press('Enter');
                return true;
            }
            await page.keyboard.press('Escape').catch(() => null);
            return false;
        }
        const optionSelectors = [
            '[role="option"]',
            '[role="menuitem"]',
            '.MuiAutocomplete-option',
            '.ant-select-item-option',
            '.react-select__option',
            '.Select-option',
            'li',
        ];
        let matchingOption = await findMatchingOption(page, optionSelectors, value);
        if (!matchingOption) {
            const inputCount = await searchableInput.count();
            if (inputCount > 0) {
                await searchableInput.fill('');
                await searchableInput.type(value, { delay: 30 });
                await page.waitForTimeout(250);
                matchingOption = await findMatchingOption(page, optionSelectors, value);
            }
        }
        if (matchingOption) {
            await matchingOption.click();
            return true;
        }
        const inputCount = await searchableInput.count();
        if (inputCount > 0) {
            await searchableInput.fill(value);
            await page.keyboard.press('Enter');
            return true;
        }
        await page.keyboard.press('Escape').catch(() => null);
        return false;
    }
    catch {
        await page.keyboard.press('Escape').catch(() => null);
        return false;
    }
}
/**
 * Fills an autocomplete input by typing a short prefix and selecting
 * a matching suggestion. Falls back to typing the full value if no suggestion
 * matches.
 *
 * @param page          The Playwright page.
 * @param inputSelector CSS selector for the autocomplete <input>.
 * @param value         The value to type / select.
 * @returns             `true` if a suggestion was selected, `false` if fell back to direct type.
 */
async function fillAutocomplete(page, inputSelector, value) {
    try {
        const input = page.locator(inputSelector).first();
        await input.waitFor({ state: 'visible', timeout: 2000 });
        await input.click();
        await input.fill('');
        await input.type(value.slice(0, 4), { delay: 50 });
        const suggestionSelectors = [
            '[role="option"]',
            '[role="listitem"]',
            '.autocomplete-suggestion',
            '.MuiAutocomplete-option',
            '.ant-select-item-option',
            '.react-select__option',
            '.Select-option',
        ];
        const suggestionSelector = suggestionSelectors.join(', ');
        try {
            await page.locator(suggestionSelector).first().waitFor({ state: 'visible', timeout: 1500 });
        }
        catch {
            await input.fill(value);
            return false;
        }
        const suggestion = await findMatchingOption(page, suggestionSelectors, value);
        if (suggestion) {
            await suggestion.click();
            return true;
        }
        await input.fill(value);
        return false;
    }
    catch {
        await page.locator(inputSelector).first().fill(value).catch(() => null);
        return false;
    }
}

"use strict";
// ── Interfaces ──────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectAndSaveCorrections = detectAndSaveCorrections;
exports.saveToCache = saveToCache;
// ── Public API ───────────────────────────────────────────────────────────────
/**
 * Compare pre-fill and post-submit form values.
 * Any field where the value changed = user correction.
 * Saves corrections to the cache with source='manual_correction', confidence=1.0.
 */
async function detectAndSaveCorrections(apiBase, preFill, postSubmit) {
    const results = [];
    for (const field of preFill) {
        const finalValue = postSubmit[field.label];
        // Skip if we have no post-submit value for this field
        if (finalValue === undefined)
            continue;
        // Skip if unchanged
        if (finalValue.trim() === field.value.trim())
            continue;
        // Skip if the final value is empty (user cleared it — not a meaningful correction)
        if (!finalValue.trim())
            continue;
        const saved = await saveToCache(apiBase, field.label, finalValue, 'manual_correction');
        results.push({
            question_text: field.label,
            original_answer: field.value,
            corrected_answer: finalValue,
            saved,
        });
    }
    return results;
}
/**
 * Save a single answer to the cache.
 * source: 'ai' | 'manual_correction' | 'manual_first_fill'
 * confidence: manual_correction=1.0, manual_first_fill=0.9, ai=0.5
 */
async function saveToCache(apiBase, questionText, answer, source) {
    if (!answer.trim())
        return false;
    const confidenceMap = {
        manual_correction: 1.0,
        manual_first_fill: 0.9,
        ai: 0.5,
    };
    const confidence = confidenceMap[source] ?? 0.5;
    try {
        const res = await fetch(`${apiBase}/api/cache`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question_text: questionText, answer, source, confidence }),
        });
        return res.ok;
    }
    catch (err) {
        console.error('[cache] Failed to save to cache:', err);
        return false;
    }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generic = exports.ashby = exports.lever = exports.greenhouse = exports.ADAPTERS = void 0;
exports.detectAdapter = detectAdapter;
const greenhouse_1 = require("./greenhouse");
Object.defineProperty(exports, "greenhouse", { enumerable: true, get: function () { return greenhouse_1.greenhouse; } });
const lever_1 = require("./lever");
Object.defineProperty(exports, "lever", { enumerable: true, get: function () { return lever_1.lever; } });
const ashby_1 = require("./ashby");
Object.defineProperty(exports, "ashby", { enumerable: true, get: function () { return ashby_1.ashby; } });
const generic_1 = require("./generic");
Object.defineProperty(exports, "generic", { enumerable: true, get: function () { return generic_1.generic; } });
// ── Adapter registry ───────────────────────────────────────────────────────────
// Adapters are tried in order; the first one whose detect() returns true is used.
// generic is intentionally excluded from this list — it is always the fallback.
exports.ADAPTERS = [
    greenhouse_1.greenhouse,
    lever_1.lever,
    ashby_1.ashby,
];
/**
 * Iterate through all registered adapters and return the first one that
 * recognises the current page. Falls back to the generic adapter if none match.
 */
async function detectAdapter(page) {
    for (const adapter of exports.ADAPTERS) {
        try {
            if (await adapter.detect(page)) {
                return adapter;
            }
        }
        catch (err) {
            console.warn(`[adapter-registry] Error during detect() for "${adapter.name}":`, err);
        }
    }
    return generic_1.generic;
}

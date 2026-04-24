import type { Page } from 'playwright';
import type { PlatformAdapter } from '../types';
import { greenhouse } from './greenhouse';
import { generic } from './generic';

// ── Adapter registry ───────────────────────────────────────────────────────────
// Adapters are tried in order; the first one whose detect() returns true is used.
// generic is intentionally excluded from this list — it is always the fallback.
export const ADAPTERS: PlatformAdapter[] = [
  greenhouse,
  // lever,   — Task 2
  // ashby,   — Task 2
];

/**
 * Iterate through all registered adapters and return the first one that
 * recognises the current page. Falls back to the generic adapter if none match.
 */
export async function detectAdapter(page: Page): Promise<PlatformAdapter> {
  for (const adapter of ADAPTERS) {
    try {
      if (await adapter.detect(page)) {
        return adapter;
      }
    } catch (err) {
      console.warn(`[adapter-registry] Error during detect() for "${adapter.name}":`, err);
    }
  }
  return generic;
}

export { greenhouse, generic };

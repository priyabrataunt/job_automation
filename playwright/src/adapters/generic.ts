import type { Page, ElementHandle } from 'playwright';
import type { FormEngine } from '../form-engine';
import type { PlatformAdapter, QueuedJob, FillResult } from '../types';

/**
 * Generic adapter — fallback when no platform-specific adapter matches.
 * Full implementation will be added in Task 3.
 */
export const generic: PlatformAdapter = {
  name: 'generic',

  async detect(_page: Page): Promise<boolean> {
    // Always returns true — used as the last-resort fallback
    return true;
  },

  async fillForm(_page: Page, _engine: FormEngine, _job: QueuedJob): Promise<FillResult[]> {
    // Stub — Task 3 will implement full generic form filling
    return [];
  },

  async handleMultiStep(_page: Page): Promise<boolean> {
    return false;
  },

  async uploadResume(_page: Page, _filePath: string): Promise<void> {
    // no-op stub
  },

  async getSubmitButton(_page: Page): Promise<ElementHandle | null> {
    return null;
  },
};

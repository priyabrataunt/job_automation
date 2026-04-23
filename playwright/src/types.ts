import type { Page, ElementHandle } from 'playwright';
import type { FormEngine } from './form-engine';

// ── Job / Queue ────────────────────────────────────────────────────────────────

export interface QueuedJob {
  id: number;
  title: string;
  company: string;
  apply_url: string;
  ats_source: string;
  location: string;
  queue_position: number;
  description_snippet?: string;
  raw_json?: string;
  status: string;
}

// ── User Profile ───────────────────────────────────────────────────────────────

export interface UserProfile {
  personal: {
    name: string;
    email: string;
    phone: string;
    linkedin?: string;
    github?: string;
    portfolio?: string;
    address: {
      street?: string;
      city: string;
      state: string;
      zip?: string;
      country: string;
    };
  };
  visa: {
    status: string;
    opt_expiry?: string;
  };
  work_auth_answers: {
    authorized_to_work: string;
    require_sponsorship_now: string;
    require_sponsorship_future: string;
  };
  answers: {
    years_experience?: string;
    highest_education?: string;
    degree_field?: string;
    salary_expectation?: string;
    notice_period?: string;
    pronouns?: string;
  };
  resume_path?: string;
}

// ── Form Field & Fill Results ──────────────────────────────────────────────────

export type FieldType = 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file';
export type FieldSource = 'profile' | 'cache' | 'ai' | 'unfilled';

export interface FormField {
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
}

export interface FillResult {
  label: string;
  value: string;
  source: FieldSource;
}

// ── Platform Adapter ───────────────────────────────────────────────────────────

export interface PlatformAdapter {
  name: string;
  detect(page: Page): Promise<boolean>;
  fillForm(page: Page, engine: FormEngine, job: QueuedJob): Promise<FillResult[]>;
  handleMultiStep(page: Page): Promise<boolean>;
  uploadResume(page: Page, filePath: string): Promise<void>;
  getSubmitButton(page: Page): Promise<ElementHandle | null>;
}

// ── Batch Results ──────────────────────────────────────────────────────────────

export interface JobResult {
  jobId: number;
  title: string;
  company: string;
  status: 'applied' | 'skipped' | 'error';
  error?: string;
  fillResults?: FillResult[];
  adapterUsed?: string;
}

// ── Engine Config ──────────────────────────────────────────────────────────────

export interface EngineConfig {
  apiBase: string;
  profilePath: string;
  headless: boolean;
}

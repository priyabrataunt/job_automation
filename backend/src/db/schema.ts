export interface Job {
  id?: number;
  external_id: string;
  title: string;
  company: string;
  ats_source: string;
  location: string;
  remote: boolean;
  posted_at: string;
  apply_url: string;
  job_type: string;       // 'fulltime' | 'internship' | 'coop'
  experience_level: string; // 'entry' | 'internship' | 'coop'
  department: string;
  description_snippet: string;
  status: string;
  raw_json: string;
  first_seen_at: string;
  relevance_score?: number;
  mode?: string;           // 'bulk' | 'assisted'
  mode_reason?: string;    // set on auto-demote
  archetype?: string;      // 'frontend' | 'backend' | 'data' | 'ml' | etc.
  visa_clauses?: string;   // JSON: deep visa-clause analysis from OpenAI
}

export interface Company {
  id?: number;
  name: string;
  ats_platform: string;
  ats_url: string;
  last_crawled_at: string;
}

export interface Run {
  id?: number;
  started_at: string;
  finished_at: string;
  jobs_found: number;
  jobs_new: number;
  errors: string;
  status: string;
}

export interface UserPreferences {
  keywords: string[];
  company_allowlist: string[];
  company_blocklist: string[];
}

export interface PushSubscription {
  id?: number;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
  created_at: string;
}

export interface UserResume {
  id: number;
  label: string;
  filename: string;
  resume_text: string;
  is_default: boolean;
  uploaded_at: string;
}

export interface JobResumeScore {
  job_id: number;
  resume_id: number;
  score: number;
  details?: unknown;
  scored_at: string;
}

export interface StoryBank {
  id?: number;
  title: string;
  archetype: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  reflection: string;
  created_at?: string;
}

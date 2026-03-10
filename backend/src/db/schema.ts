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

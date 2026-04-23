import * as crypto from 'crypto';
import { FormField, FillResult, UserProfile } from './types';

/**
 * Resolves form field answers using a three-tier pipeline:
 *   1. Profile data  (instant, free)
 *   2. Answer cache  (instant, free — via backend API)
 *   3. AI generation (via backend /api/ai-fill)
 */
export class FormEngine {
  constructor(
    private readonly profile: UserProfile,
    private readonly apiBase: string,
  ) {}

  /** Resolve a batch of fields, returning one FillResult per field. */
  async resolveFields(fields: FormField[], jobDescription?: string): Promise<FillResult[]> {
    const results: FillResult[] = [];
    const unresolved: FormField[] = [];

    for (const field of fields) {
      const profileValue = this.resolveFromProfile(field.label);
      if (profileValue !== null) {
        results.push({ label: field.label, value: profileValue, source: 'profile' });
        continue;
      }

      const cacheValue = await this.resolveFromCache(field.label);
      if (cacheValue !== null) {
        results.push({ label: field.label, value: cacheValue, source: 'cache' });
        continue;
      }

      unresolved.push(field);
    }

    // Batch AI call for all unresolved fields
    if (unresolved.length > 0) {
      const aiAnswers = await this.resolveWithAI(unresolved, jobDescription);
      for (const field of unresolved) {
        const value = aiAnswers[field.label] ?? '';
        results.push({ label: field.label, value, source: value ? 'ai' : 'unfilled' });
      }
    }

    return results;
  }

  // ── Profile resolution ────────────────────────────────────────────────────

  private resolveFromProfile(label: string): string | null {
    const l = label.toLowerCase();
    const p = this.profile;
    const addr = p.personal.address;
    const wa   = p.work_auth_answers;
    const ans  = p.answers;

    // Name (but not company name, manager name, etc.)
    if (/\bfull[\s-]?name\b|\bfirst.*last\b/i.test(label)) return p.personal.name || null;
    if (/\bfirst\s+name\b/i.test(label)) return p.personal.name.split(' ')[0] || null;
    if (/\blast\s+name\b/i.test(label)) return p.personal.name.split(' ').slice(1).join(' ') || null;
    if (/^name$/i.test(label.trim())) return p.personal.name || null;

    // Contact
    if (/\bemail\b/i.test(label)) return p.personal.email || null;
    if (/\bphone\b|\bmobile\b|\bcell\b|\btelephone\b/i.test(label)) return p.personal.phone || null;

    // Social / Links
    if (/\blinkedin\b/i.test(label)) return p.personal.linkedin || null;
    if (/\bgithub\b/i.test(label)) return p.personal.github || null;
    if (/\bportfolio\b|\bpersonal\s+site\b|\bwebsite\b/i.test(label)) return p.personal.portfolio || null;

    // Address
    if (/\bcity\b/i.test(label)) return addr.city || null;
    if (/\bstate\b|\bprovince\b/i.test(label)) return addr.state || null;
    if (/\bcountry\b/i.test(label)) return addr.country || null;
    if (/\bzip\b|\bpostal\b/i.test(label)) return addr.zip || null;
    if (/\bstreet\b|\baddress\b/i.test(label)) {
      if (addr.street && addr.city) return `${addr.street}, ${addr.city}, ${addr.state}`;
      return addr.city ? `${addr.city}, ${addr.state}` : null;
    }

    // Work authorization
    if (/authorized.*(work|us\b)|(work|us\b).*authorized|work authorization|legally.*work/i.test(label)) {
      return wa.authorized_to_work || null;
    }
    if (/sponsor.*(now|current|requir)|current.*sponsor|require.*sponsor.*now/i.test(l)) {
      return wa.require_sponsorship_now || null;
    }
    if (/sponsor.*(future)|future.*sponsor|will.*need.*sponsor/i.test(l)) {
      return wa.require_sponsorship_future || null;
    }
    if (/\bvisa\s+status\b|\bimmigration\b/i.test(label)) return p.visa.status || null;
    if (/\bopt\b|\bcpt\b/i.test(label) && !/\bopt.?in\b/i.test(label)) return p.visa.status || null;

    // Education
    if (/\bdegree\b|\beducation\s+level\b|\bhighest.*education\b/i.test(label)) {
      return ans.highest_education || null;
    }
    if (/\bdegree\s+field\b|\bfield\s+of\s+study\b|\bmajor\b/i.test(label)) {
      return ans.degree_field || null;
    }

    // Experience
    if (/years.*experience|experience.*years|how many years/i.test(label)) {
      return ans.years_experience || null;
    }

    // Compensation
    if (/\bsalary\b|\bcompensation\b|\bdesired\s+pay\b|\bwage\b/i.test(label)) {
      return ans.salary_expectation || null;
    }

    // Availability
    if (/\bstart\s+date\b|\bnotice\s+period\b|\bwhen.*available\b|\bavailability\b/i.test(label)) {
      return ans.notice_period || null;
    }

    // Pronouns
    if (/\bpronoun\b/i.test(label)) return ans.pronouns || null;

    return null;
  }

  // ── Cache resolution ──────────────────────────────────────────────────────

  private async resolveFromCache(question: string): Promise<string | null> {
    try {
      const hash = crypto
        .createHash('sha256')
        .update(question.trim().toLowerCase())
        .digest('hex');

      const res = await fetch(`${this.apiBase}/api/cache/lookup?hash=${encodeURIComponent(hash)}`);
      if (!res.ok) return null;

      const data = (await res.json()) as { answer?: string; confidence?: number };
      if (data.answer && (data.confidence ?? 0) >= 0.8) return data.answer;
      return null;
    } catch {
      return null;
    }
  }

  // ── AI resolution ─────────────────────────────────────────────────────────

  private async resolveWithAI(
    fields: FormField[],
    jobDescription?: string,
  ): Promise<Record<string, string>> {
    try {
      const res = await fetch(`${this.apiBase}/api/ai-fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields,
          profile: this.profile,
          jobDescription,
        }),
      });

      if (!res.ok) return {};
      const data = (await res.json()) as { answers?: Record<string, string> };
      return data.answers ?? {};
    } catch {
      return {};
    }
  }
}

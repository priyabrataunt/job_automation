
# JD Context Field for Chrome Extension

**Date:** 2026-04-14  
**Status:** Approved

## Overview

Add a "Job Context" section to the chrome extension popup that lets users paste a job description (JD) when applying directly on company portals (Handshake, LinkedIn, etc.) that aren't tracked in the job tracker. The pasted JD persists in `chrome.storage.local` until manually cleared and serves three purposes: AI-fill context, cover letter generation, and auto-adding the job to the tracker.

---

## UI Layout

A new "Job Context" section is inserted between "Page Detection" and "Auto-Fill" in `popup.html`.

### Empty state
- Collapsed by default — header row with a "▼ Paste JD" toggle
- Expanding reveals:
  - Textarea with placeholder "Paste job description here..."
  - "Add to Tracker" button (disabled until text is entered)

### Loaded state (JD pasted, not yet added to tracker)
- Badge: `JD loaded ✓`
- "Add to Tracker" button enabled
- Small "✕ Clear" link

### Loaded + tracked state (after "Add to Tracker" succeeds)
- Badge: `JD loaded ✓ — [Company] · [Title]`
- "Add to Tracker" becomes "✓ Added" (disabled)
- "✕ Clear" link remains

Clicking "✕ Clear" removes `jdText` and `jdJobId` from `chrome.storage.local` and resets the section to empty state.

---

## Data Flow

### Storage keys (`chrome.storage.local`)
| Key | Value | Cleared by |
|-----|-------|------------|
| `jdText` | Raw pasted JD string | "✕ Clear" button |
| `jdJobId` | Tracker job ID (number) | "✕ Clear" button |

### "Add to Tracker" button
1. POST `{ jdText }` → `/api/jobs/from-jd`
2. Backend extracts `company`, `title`, `location`, `description_snippet` via OpenAI
3. Inserts job row: `status='saved'`, `ats_source='manual'`, `apply_url=''`
4. Returns `{ jobId, company, title }`
5. Extension stores `jdJobId`, updates badge to show company + title

### "Auto-Fill" button
- Existing: sends `{ fields, profile }` to `/api/ai-fill`
- Change: additionally sends `jobDescription: jdText` if `jdText` is set
- Backend appends `## Job Description` block to AI prompt

### "Generate Cover Letter" button
Priority order for job context:
1. `jdJobId` (from JD add) → use as `jobId` in existing flow
2. URL-matched `jobId` from tracker → existing flow
3. `jdText` only (no tracker entry) → pass `jobDescription` directly to `/api/cover-letter`, generate without DB record
4. Neither → show existing error

---

## Backend Changes (`backend/src/api/routes.ts`)

### 1. New: `POST /api/jobs/from-jd`
**Input:** `{ jdText: string }`  
**Logic:**
- Send JD to OpenAI with extraction prompt → JSON with `company`, `title`, `location`, `description_snippet`
- INSERT into `jobs` table: `status='saved'`, `ats_source='manual'`, `apply_url=''`, `source='chrome_ext_jd'`  
**Output:** `{ jobId, company, title }`

### 2. Modified: `POST /api/ai-fill`
**Input change:** accepts optional `jobDescription?: string`  
**Prompt change:** if present, append:
```
## Job Description
${jobDescription.slice(0, 2000)}
```

### 3. Modified: `POST /api/cover-letter`
**Input change:** `jobId` becomes optional; accepts optional `jobDescription?: string`  
**Logic:**
- If `jobId` provided → existing DB lookup flow (unchanged)
- If no `jobId` but `jobDescription` provided → build prompt directly from `jobDescription`, skip DB lookup
- Resume is still required in both cases

---

## Files Changed

| File | Change |
|------|--------|
| `chrome-extension/popup.html` | Add "Job Context" section with textarea, toggle, buttons |
| `chrome-extension/src/popup.js` | Load/save `jdText`+`jdJobId` from storage; wire up toggle, add-to-tracker, clear, pass JD to autofill + cover letter |
| `backend/src/api/routes.ts` | Add `/api/jobs/from-jd`; modify `/api/ai-fill` and `/api/cover-letter` |

---

## Out of Scope
- Auto-scraping JD from the page DOM
- Editing the extracted company/title before saving to tracker
- Multiple saved JDs (one active JD at a time)

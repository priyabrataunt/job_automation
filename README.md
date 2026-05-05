<div align="center">

# 🧠 Job Tracker — Automated Job Aggregator

**Scrape, filter, score, and track entry-level software engineering jobs across 200+ companies — all from one self-hosted dashboard.**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## ✨ What It Does

Job Tracker automatically scrapes job postings from **Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, SimplifyJobs, JobRight** (curated intern / new-grad listings), and **JSearch** on a schedule. On startup it runs a wider backfill; the cron job then pulls new posts every **6 hours**. It then:

- **Filters** for entry-level, junior, internship, and co-op software engineering roles
- **Scores** each posting against your custom keywords and company preferences
- **Lets you track** each job through a full pipeline — including **queue** ordering, **follow-ups**, and outcomes
- **Scores your resume** against a job description using a local ATS engine (no external API), with **multiple saved resumes** and a **Resume Optimizer** view in the dashboard
- **Auto-fills** job application forms and generates AI cover letters via a companion Chrome extension

---

## 📸 Screenshots

| Dashboard | ATS Resume Score |
|:---------:|:---------------:|
| ![Dashboard](docs/screenshot-main.png) | ![ATS Score](docs/screenshot-ats-score.png) |

| Filter Bar | Chrome Extension |
|:----------:|:---------------:|
| ![Filters](docs/screenshot-filters.png) | ![Extension](docs/screenshot-extension.png) |

---

## 🛠️ Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Backend** | Node.js 20, TypeScript 5, Fastify 5, `pg` (PostgreSQL), node-cron |
| **Frontend** | React 19, Vite 7 |
| **Database** | PostgreSQL ([Neon](https://neon.tech) or any compatible host) — schema is created on first launch |
| **AI / ML** | OpenAI API (cover letters, form fill, follow-up drafts), local TF-IDF resume scorer |
| **Notifications** | Web Push (VAPID) — daily job digest |
| **Browser Extension** | Chrome MV3 — auto-fill + AI-assisted cover letter |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 20 or later
- **npm** 9 or later
- **PostgreSQL** database (e.g. [Neon](https://neon.tech) free tier) and its connection string for `DATABASE_URL`

### 1 — Clone & Install

```bash
git clone https://github.com/priyabrataunt/job_automation.git
cd job_automation

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### 2 — Configure Environment

```bash
cp backend/.env.example backend/.env
# Edit backend/.env
# Required: DATABASE_URL — Postgres connection string (e.g. Neon pooled URL with sslmode=require).
# Optional: OPENAI_API_KEY — AI cover letters, form fill, follow-up drafts, and persona-aware text.
# Optional: RAPIDAPI_KEY — JSearch job source.
# Optional: VAPID_* — Web Push digest (see table below).
```

### 3 — Run

```bash
# Terminal 1 — Backend API (port 8000)
cd backend
npm run dev

# Terminal 2 — Frontend UI (port 3000)
cd frontend
npm run dev
```

The backend initializes database tables if needed, runs an initial collection (48-hour lookback), and the scheduler repeats collection every 6 hours (8-hour window per run) plus hourly cleanup of stale rows.

---

## ⚙️ Environment Variables

All variables live in `backend/.env`. Copy `backend/.env.example` to get started.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string (SSL as required by your host) |
| `OPENAI_API_KEY` | For AI features | Cover letters, form auto-fill, follow-up drafts, outreach |
| `RAPIDAPI_KEY` | For JSearch | Enables the JSearch job source ([get a free key](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch)) |
| `VAPID_PUBLIC_KEY` | For push | Web Push public key (generate with `npx web-push generate-vapid-keys`) |
| `VAPID_PRIVATE_KEY` | For push | Web Push private key |
| `VAPID_SUBJECT` | For push | `mailto:` address used in VAPID headers |

---

## 🔌 API Reference

The canonical list lives in `backend/src/api/routes.ts`. Highlights:

**Jobs & collection**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/jobs` | List jobs — query params include `status`, `ats_source`, `job_type`, `remote`, `search`, `hours` |
| `POST` | `/api/jobs/manual` | Add a job by URL or fields |
| `POST` | `/api/jobs/from-jd` | Create a job from pasted job description text |
| `PATCH` | `/api/jobs/:id/status` | Update pipeline status |
| `GET` | `/api/stats` | Counts by status / source / type, last run, new counts |
| `GET` | `/api/runs` | Recent collection run records |
| `POST` | `/api/collect` | Trigger collection (`hours` query/body) |
| `GET` | `/api/collect/status` | `{ running: boolean }` |
| `GET` | `/api/digest` | Digest payload for notifications |
| `POST` | `/api/priority-scan` | Re-score / prioritize jobs |
| `POST` | `/api/visa-scan` | Batch visa signal pass |

**Queue**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/jobs/queue` | Queued jobs |
| `POST` / `DELETE` | `/api/jobs/:id/queue` | Add / remove from queue |
| `PATCH` | `/api/jobs/:id/queue-mode` | Bulk vs focused mode |
| `PATCH` | `/api/jobs/:id/queue-position` | Reorder |
| `POST` | `/api/jobs/bulk-queue` | Queue many at once |

**Resume & ATS**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/resume/upload` | Upload PDF → extracted text |
| `GET` | `/api/resume` | Current default resume metadata |
| `GET` | `/api/resumes` | All saved resumes |
| `POST` / `PATCH` / `DELETE` | `/api/resumes`, `/api/resumes/:id` | Manage saved resumes |
| `POST` | `/api/resume/analyze` | Score resume against a job |
| `POST` | `/api/resume/score-all`, `/api/resumes/:id/score-all` | Score against many jobs |

**AI & workflow**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/cover-letter` | Generate cover letter for a job |
| `POST` | `/api/ai-fill` | Suggest answers for application fields |
| `POST` | `/api/follow-up/draft` | Draft follow-up message |
| `GET` | `/api/follow-up` | Jobs needing follow-up |
| `POST` | `/api/outreach` | Outreach text for a job |
| `GET` / `POST` / `DELETE` | `/api/storybank` | Story / bullet bank |

**Preferences, analytics, sessions, cache**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` / `POST` | `/api/preferences` | Keywords and company allow/block lists |
| `GET` | `/api/analytics` | Dashboard analytics |
| `GET` / `POST` / `PATCH` | `/api/sessions` | Saved browser / apply sessions |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/cache`, `/api/cache/:id` | Cached form values |
| `POST` / `DELETE` | `/api/subscribe` | Web Push subscription |
| `GET` | `/api/vapid-public-key` | Public VAPID key for client |
| `GET` | `/health` | Health check |

---

## 🔍 Filtering Logic

A job is included only when **all three** conditions are met:

1. **Title** contains a software / ML / infra keyword (e.g., *software engineer*, *SDE*, *ML engineer*, *DevOps*)
2. **Seniority** — no senior / lead / principal / staff keywords in the title
3. **Location** — US-based or remote; international roles are excluded

Detected job types: `fulltime` · `internship` · `co-op`

---

## 📊 ATS Resume Scorer

The built-in resume scorer runs **entirely locally** (no external API calls) and evaluates four dimensions:

| Metric | Weight | Description |
|--------|--------|-------------|
| Skills Match | 40% | Required vs. preferred skills extracted from the JD |
| Relevance | 30% | TF-IDF–inspired term overlap between resume and JD |
| Visa Signal | 15% | Detects sponsorship-positive / sponsorship-negative language |
| Impact | 15% | JD-aligned action-theme comparison |

The dashboard **Resume Optimizer** flow uploads a resume, picks a job (or JD text), and shows scores, matched / missing keywords, and suggestions — all backed by the `/api/resume/*` endpoints above.

---

## ✍️ Optional writing persona (AI voice)

If the repo contains a `Priyabrata_persona/` folder at the project root with `Priyabrata_Writing.json` and `user_questions.json`, the backend loads them and steers OpenAI outputs (cover letters, fills, follow-ups) toward that writing style. If the folder is missing, AI features still work with a default voice.

---

## 🧩 Chrome Extension

The companion extension auto-fills job application forms and generates tailored cover letters.

**Setup:**
1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `chrome-extension/` folder
4. Click the extension icon and configure your profile
5. In `profile.json`, set `job_tracker_url` if your backend is not running at `http://localhost:8000`

---

## 📅 Status Workflow

Statuses in the UI include: `new`, `saved`, `queued`, `applied`, `followed_up`, `response`, `rejected`, `archived`. A typical path:

```
new → saved → queued → applied → followed_up → response
                              ↘ rejected / archived
```

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

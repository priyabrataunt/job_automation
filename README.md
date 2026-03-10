# Job Tracker

Automated job aggregator that scrapes 200+ companies across Greenhouse, Lever, Ashby, and Workday — filtering for entry-level / internship software engineering roles.

## Tech Stack

- **Backend**: Node.js + TypeScript + Fastify + better-sqlite3 + node-cron
- **Frontend**: React + Vite
- **Database**: SQLite (single file `backend/jobs.db`)

## Running

```bash
# Terminal 1 — Backend (port 8000)
cd backend
npm run dev

# Terminal 2 — Frontend (port 3000)
cd frontend
npm run dev
```

Open http://localhost:3000

## Architecture

```
job_automation/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Entry point — init DB, start server + scheduler
│   │   ├── orchestrator.ts   # Runs collectors, inserts to DB, tracks runs
│   │   ├── scheduler.ts      # node-cron every 6 hours
│   │   ├── db/
│   │   │   ├── schema.ts     # TypeScript interfaces
│   │   │   └── database.ts   # SQLite setup + singleton
│   │   ├── collectors/
│   │   │   ├── filters.ts    # Title/seniority/remote detection
│   │   │   ├── greenhouse.ts # 65 companies
│   │   │   ├── lever.ts      # 60 companies
│   │   │   ├── ashby.ts      # 60 AI/startup companies
│   │   │   ├── workday.ts    # 32 large enterprises
│   │   │   └── index.ts      # Promise.allSettled orchestration
│   │   └── api/
│   │       ├── routes.ts     # GET /api/jobs, PATCH status, stats, runs, collect
│   │       └── server.ts     # Fastify + CORS setup
│   └── jobs.db               # Created on first run
└── frontend/
    └── src/
        └── App.jsx           # Single-file React UI
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs` | List jobs (filter: status, ats_source, job_type, remote, search, hours) |
| PATCH | `/api/jobs/:id/status` | Update job status |
| GET | `/api/stats` | Counts by status/source/type, last run info |
| GET | `/api/runs` | Last 10 collection runs |
| POST | `/api/collect?hours=24` | Trigger immediate collection |
| GET | `/api/collect/status` | `{ running: boolean }` |
| GET | `/health` | Health check |

## Filters

Jobs are included when:
1. Title matches a software/ML/infra keyword
2. Title is entry-level OR is an internship/co-op (no senior/lead/principal/staff)
3. Posted within the requested time window

Status workflow: `new` → `saved` → `applied` → `rejected` / `archived`

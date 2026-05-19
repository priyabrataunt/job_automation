# Job Automation — Domain Glossary

## Core Concepts

**Job**
A single employment opportunity tracked in the system. Identified uniquely by `external_id` from its ATS source, or by the normalized tuple `(title, company, location)` for cross-source deduplication.

**Job Status**
The lifecycle state of a Job: `new` → `saved` → `queued` → `applied` → `followed_up` → `response` → `rejected`. A job may also be `skipped` or `expired`. Status transitions are always explicit — the system never infers status from external signals.

**ATS Source**
The Applicant Tracking System where a job originates (Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters). These are crawled by backend collectors.

**Job Board**
An aggregator site where the user browses and discovers jobs manually (LinkedIn, JobRight, Handshake). Distinct from ATS sources — job boards are not crawled; the Chrome extension extracts data from them.

**Dedup Check**
The process of determining whether a job the user is viewing on a job board already exists in the database. Uses URL-based match first, then fuzzy normalized (title, company) fallback.

**Page Extraction**
The content script's ability to read structured job data (title, company, location, URL, description, job type) from the current page. Uses site-specific selectors for known boards (LinkedIn, JobRight, Handshake) and a generic fallback (ld+json JobPosting schema, og: meta tags) for unknown sites.

**Side Panel**
The Chrome Side Panel that replaces the popup as the extension's primary UI. Opens on manual icon click, persists across navigations. Displays extracted job data, dedup status, and tracker controls.

**Enrichment Data**
Static datasets that augment job/company information: OPT-friendly companies, H1B sponsor history. Stored as backend data files.

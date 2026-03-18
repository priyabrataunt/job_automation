1. Company Visa Intelligence Layer
Before your scoring even runs, enrich each company with historical H1B/OPT data. Sites like myvisajobs.com and H1BGrader have public data. Tag each company as "known sponsor," "never sponsored," or "unknown." This is more reliable than parsing the JD text.
2. Application Velocity Tracker
You need to know: how many apps per day, which sources convert to responses, which job titles get callbacks. After 2 weeks of data you'll see patterns — maybe Greenhouse jobs respond 3x more than Workday, or "Software Engineer" gets more replies than "SWE II." Let the data tell you where to focus.
3. Duplicate Job Detection Across Sources
Same job appears on LinkedIn, Greenhouse, and Indeed. You want to apply once via the most direct route (company career page > Greenhouse/Lever > job boards). Build a deduplication layer using company name + job title + location fuzzy matching.
4. Workday/Taleo/iCIMS Detector
These three ATS platforms are the slowest to apply to manually. If your scraper can detect which ATS a job uses, you can batch "easy" (Greenhouse/Lever) jobs vs. "hard" (Workday) jobs and tackle them separately. Never mix them in one session or you'll burn out.
5. Follow-up Automation
5 days after applying with no response, auto-draft a LinkedIn message to the recruiter or hiring manager. Something like "Hi [name], I applied for [role] on [date] and wanted to express continued interest..." This alone meaningfully improves response rates and almost nobody does it systematically.
6. OPT-Friendly Company List
Build or import a static list of ~500 companies known to hire OPT students — usually mid-size tech companies, consulting firms, and startups that have done it before. Weight these companies higher in your scoring regardless of other factors. This list is more valuable than any algorithmic scoring for your specific situation.
# TODO
# ----------------------------------------------------------------------------
Suggested Revised Weights & Fixes

Current:  Skills 45% | Relevance 30% | Impact 25%
Proposed: Skills 40% | Relevance 30% | Visa Signal 15% | Impact 15%

# ----------------------------------------------------------------------------
Skills Match fix:

 <!-- Instead of: matched / total_jd_skills
# Use:
required_skills = extract_required_skills(jd)  # before "preferred"/"nice to have"
preferred_skills = extract_preferred_skills(jd)

score = (
    (matched_required / max(len(required_skills), 1)) * 0.7 +
    (matched_preferred / max(len(preferred_skills), 1)) * 0.3
) * 100 -->

# ----------------------------------------------------------------------------

Add a Visa Signal scorer:
<!-- pythonSPONSOR_POSITIVE = [
    "will sponsor", "visa sponsorship", "h1b", "opt", "cpt",
    "work authorization provided", "sponsorship available"
]
SPONSOR_NEGATIVE = [
    "no sponsorship", "will not sponsor", "must be authorized",
    "not able to sponsor", "citizen or permanent resident only",
    "us citizen", "security clearance"
]

def visa_score(jd_text):
    text = jd_text.lower()
    if any(p in text for p in SPONSOR_NEGATIVE):
        return 0   # hard zero — don't waste time
    if any(p in text for p in SPONSOR_POSITIVE):
        return 100
    return 50  # ambiguous — apply but flag it -->

# ----------------------------------------------------------------------------

Impact fix — make it comparative:

<!-- Extract impact themes from JD, then check resume for alignment
JD_IMPACT_THEMES = extract_action_themes(jd)  # "scale", "growth", "optimize"
RESUME_IMPACT_THEMES = extract_action_themes(resume)
impact_alignment = len(JD_IMPACT_THEMES & RESUME_IMPACT_THEMES) / max(len(JD_IMPACT_THEMES), 1) -->

# ----------------------------------------------------------------------------

One More Thing Worth Adding:

Recency decay — not a scoring metric but a ranking modifier:

<!-- def recency_multiplier(days_posted):
    if days_posted <= 2:  return 1.0
    if days_posted <= 5:  return 0.85
    if days_posted <= 10: return 0.65
    return 0.40  # >10 days, response rate drops sharply -->
    
Multiply your final score by this before sorting. A 75% match posted today beats an 85% match posted 12 days ago in practice.

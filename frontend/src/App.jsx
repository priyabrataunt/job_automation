import { useState, useEffect, useCallback, useRef } from 'react'
import ResumeOptimizer from './ResumeOptimizer'

const API = ''  // proxied via vite
const LIMIT = 30

// ── Utilities ──────────────────────────────────────────────────────────────
function timeAgo(isoString) {
  if (!isoString) return '—'
  const diff = Date.now() - new Date(isoString).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Small Components ───────────────────────────────────────────────────────
function StatCard({ value, label, color }) {
  return (
    <div style={{
      borderTop: `3px solid ${color}`,
      background: 'var(--bg-surface)',
      borderRadius: 8,
      padding: '12px 16px',
      minWidth: 90,
      flex: '1 1 90px',
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>{value ?? 0}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

const SOURCE_COLORS = {
  greenhouse: '#40a02b',
  lever: '#1e66f5',
  ashby: '#8839ef',
  workday: '#df8e1d',
  smartrecruiters: '#e64553',
  workable: '#04a5e5',
  simplifyjobs: '#fe640b',
  jsearch: '#ea76cb',
}
function SourceBadge({ source }) {
  return (
    <span style={{
      background: SOURCE_COLORS[source] || '#45475a',
      color: '#fff',
      fontSize: 10,
      padding: '2px 7px',
      borderRadius: 99,
      fontWeight: 600,
      textTransform: 'capitalize',
    }}>{source}</span>
  )
}

const TYPE_COLORS = {
  fulltime: { bg: 'var(--bg-surface-alt)', fg: 'var(--text-primary)' },
  internship: { bg: 'var(--bg-green)', fg: 'var(--fg-green)' },
  coop: { bg: 'var(--bg-yellow)', fg: 'var(--fg-yellow)' },
}
function TypeBadge({ type }) {
  const c = TYPE_COLORS[type] || TYPE_COLORS.fulltime
  const label = type === 'fulltime' ? 'Full-time' : type === 'internship' ? 'Internship' : 'Co-op'
  return (
    <span style={{
      background: c.bg,
      color: c.fg,
      fontSize: 10,
      padding: '2px 7px',
      borderRadius: 99,
      fontWeight: 600,
    }}>{label}</span>
  )
}

const STATUS_OPTIONS = ['new', 'saved', 'queued', 'applied', 'followed_up', 'response', 'rejected', 'archived']
const STATUS_LABELS = {
  new: 'new', saved: 'saved', queued: 'queued', applied: 'applied',
  followed_up: 'followed up', response: 'got response', rejected: 'rejected', archived: 'archived',
}
const STATUS_COLORS = {
  new: '#1e66f5',
  saved: '#8839ef',
  queued: '#fe640b',
  applied: '#40a02b',
  followed_up: '#df8e1d',
  response: '#04a5e5',
  rejected: '#d20f39',
  archived: '#45475a',
}

function VisaBadge({ signal }) {
  if (signal === null || signal === undefined) return null
  if (signal === 100) return (
    <span style={{ background: 'var(--bg-green)', color: 'var(--fg-green)', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 700 }}>✓ Sponsors</span>
  )
  if (signal === 0) return (
    <span style={{ background: 'var(--bg-red)', color: 'var(--fg-red)', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 700 }}>✗ No Sponsor</span>
  )
  return (
    <span style={{ background: 'var(--bg-yellow)', color: 'var(--fg-yellow)', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 600 }}>? Visa Unknown</span>
  )
}

const ATS_DIFFICULTY = {
  greenhouse: { level: 'easy', label: 'Quick Apply', color: 'var(--fg-green)', bg: 'var(--bg-green)' },
  lever: { level: 'easy', label: 'Quick Apply', color: 'var(--fg-green)', bg: 'var(--bg-green)' },
  ashby: { level: 'easy', label: 'Quick Apply', color: 'var(--fg-green)', bg: 'var(--bg-green)' },
  smartrecruiters: { level: 'medium', label: 'Medium Form', color: 'var(--fg-yellow)', bg: 'var(--bg-yellow)' },
  workable: { level: 'medium', label: 'Medium Form', color: 'var(--fg-yellow)', bg: 'var(--bg-yellow)' },
  workday: { level: 'hard', label: 'Long Form', color: 'var(--fg-red)', bg: 'var(--bg-red)' },
  simplifyjobs: { level: 'easy', label: 'Quick Apply', color: 'var(--fg-green)', bg: 'var(--bg-green)' },
  jsearch: { level: 'varies', label: 'External Link', color: '#cba6f7', bg: 'var(--bg-purple)' },
}
function EasyApplyBadge({ source }) {
  const diff = ATS_DIFFICULTY[source]
  if (!diff) return null
  return (
    <span style={{ background: diff.bg, color: diff.color, fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 600 }}>
      {diff.label}
    </span>
  )
}

function OptFriendlyBadge({ optFriendly }) {
  if (!optFriendly) return null
  return (
    <span style={{ background: 'var(--bg-opt)', color: 'var(--fg-green)', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 700, border: '1px solid #40a02b' }}>
      OPT Friendly
    </span>
  )
}

function SponsorTierBadge({ tier }) {
  if (!tier) return null
  const config = {
    top: { bg: 'var(--bg-green)', fg: 'var(--fg-green)', border: '#40a02b', label: 'Top Sponsor' },
    regular: { bg: 'var(--bg-blue)', fg: 'var(--fg-blue)', border: '#1e66f5', label: 'Sponsor' },
    known: { bg: 'var(--bg-yellow)', fg: 'var(--fg-yellow)', border: '#df8e1d', label: 'Has Sponsored' },
  }
  const c = config[tier] || config.known
  return (
    <span style={{ background: c.bg, color: c.fg, fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 700, border: `1px solid ${c.border}` }}>
      {c.label}
    </span>
  )
}

function H1bProbabilityBadge({ probability, count }) {
  if (!probability || probability === 'None') return null
  const config = {
    High:   { bg: 'var(--bg-green)',  fg: 'var(--fg-green)',  border: '#40a02b' },
    Medium: { bg: 'var(--bg-blue)',   fg: 'var(--fg-blue)',   border: '#1e66f5' },
    Low:    { bg: 'var(--bg-yellow)', fg: 'var(--fg-yellow)', border: '#df8e1d' },
  }
  const c = config[probability] || config.Low
  const tip = count != null ? `~${count.toLocaleString()} LCAs/yr` : 'historical sponsor'
  return (
    <span title={tip} style={{ background: c.bg, color: c.fg, fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 700, border: `1px solid ${c.border}` }}>
      H1B: {probability}
    </span>
  )
}

const ARCHETYPE_LABELS = {
  frontend: 'Frontend', backend: 'Backend', fullstack: 'Fullstack', mobile: 'Mobile',
  devops: 'DevOps', data: 'Data', ml: 'ML/AI', security: 'Security', qa: 'QA',
  pm: 'PM', design: 'Design', embedded: 'Embedded', other: 'Other',
}
function ArchetypeBadge({ archetype }) {
  if (!archetype) return null
  return (
    <span style={{
      background: 'var(--bg-surface-alt)', color: 'var(--text-secondary)',
      fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 600,
      border: '1px solid var(--border-subtle)',
    }}>{ARCHETYPE_LABELS[archetype] || archetype}</span>
  )
}

function ScoreBar({ score }) {
  const maxScore = 100
  const pct = Math.min(100, Math.round((score / maxScore) * 100))
  const color = pct >= 60 ? '#40a02b' : pct >= 30 ? '#df8e1d' : 'var(--text-muted)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 60, height: 6, background: 'var(--bg-surface-alt)', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 600 }}>{score}</span>
    </div>
  )
}

function ScoreTooltip({ details, children }) {
  const [show, setShow] = useState(false)
  const ref = useRef(null)
  let parsed = null
  if (details) {
    try { parsed = typeof details === 'string' ? JSON.parse(details) : details } catch { parsed = null }
  }

  return (
    <span
      ref={ref}
      style={{ position: 'relative', cursor: 'default' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && parsed && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginTop: 8,
          background: 'var(--bg-surface-deep)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 10,
          padding: '14px 16px',
          width: 300,
          zIndex: 999,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          fontSize: 12,
          color: 'var(--text-primary)',
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--text-primary)' }}>
            Score Breakdown
          </div>

          {/* Metric bars */}
          {[
            { label: 'Skills Match', metric: parsed.skillsMatch, weight: '40%' },
            { label: 'Relevance', metric: parsed.relevance, weight: '30%' },
            { label: 'Visa Signal', metric: parsed.visaSignal, weight: '15%' },
            { label: 'Impact', metric: parsed.impact, weight: '15%' },
          ].filter(({ metric }) => metric != null).map(({ label, metric, weight }) => (
            <div key={label} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{label} <span style={{ color: 'var(--text-faint)' }}>({weight})</span></span>
                <span style={{ fontWeight: 600, color: metric.score >= 60 ? 'var(--fg-green)' : metric.score >= 40 ? 'var(--fg-yellow)' : 'var(--fg-red)' }}>
                  {metric.score}%
                </span>
              </div>
              <div style={{ height: 4, background: 'var(--bg-surface-alt)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: `${metric.score}%`,
                  height: '100%',
                  borderRadius: 2,
                  background: metric.score >= 60 ? 'var(--fg-green)' : metric.score >= 40 ? 'var(--fg-yellow)' : 'var(--fg-red)',
                }} />
              </div>
            </div>
          ))}

          {/* Matched keywords */}
          {parsed.matchedKeywords?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--fg-green)', fontWeight: 600, marginBottom: 4 }}>
                ✓ Matched Skills ({parsed.matchedKeywords.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {parsed.matchedKeywords.slice(0, 12).map(kw => (
                  <span key={kw} style={{
                    background: 'var(--bg-green)', color: 'var(--fg-green)',
                    fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  }}>{kw}</span>
                ))}
                {parsed.matchedKeywords.length > 12 && (
                  <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>+{parsed.matchedKeywords.length - 12} more</span>
                )}
              </div>
            </div>
          )}

          {/* Missing keywords */}
          {parsed.missingKeywords?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--fg-red)', fontWeight: 600, marginBottom: 4 }}>
                ✗ Missing Skills ({parsed.missingKeywords.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {parsed.missingKeywords.slice(0, 8).map(kw => (
                  <span key={kw} style={{
                    background: 'var(--bg-surface-alt)', color: 'var(--fg-red)',
                    fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  }}>{kw}</span>
                ))}
                {parsed.missingKeywords.length > 8 && (
                  <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>+{parsed.missingKeywords.length - 8} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  )
}

function JobCard({ job, onStatusChange, onOptimize, onQueue, onOutreach }) {
  let fullDescription = job.description || job.description_snippet || ''
  if (job.raw_json) {
    try {
      const parsed = typeof job.raw_json === 'string' ? JSON.parse(job.raw_json) : job.raw_json
      const manualDescription = parsed?.manualContext?.jobDescription
      if (manualDescription) fullDescription = manualDescription
    } catch {
      fullDescription = job.description || job.description_snippet || ''
    }
  }

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderLeft: `4px solid ${STATUS_COLORS[job.status] || 'var(--border-subtle)'}`,
      borderRadius: 8,
      padding: '14px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <a
              href={job.apply_url}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--text-link)', fontWeight: 600, fontSize: 15, textDecoration: 'none' }}
            >{job.title}</a>
            {job.relevance_score != null && <ScoreBar score={job.relevance_score} />}
            {job.hired_score != null && (
              <ScoreTooltip details={job.hired_score_details} score={job.hired_score}>
                <span style={{
                  background: job.hired_score >= 70 ? 'var(--bg-green)' : job.hired_score >= 40 ? 'var(--bg-yellow)' : 'var(--bg-surface-alt)',
                  color: job.hired_score >= 70 ? 'var(--fg-green)' : job.hired_score >= 40 ? 'var(--fg-yellow)' : 'var(--text-muted)',
                  fontSize: 11, fontWeight: 700,
                  padding: '2px 8px', borderRadius: 99,
                  whiteSpace: 'nowrap',
                }}>🎯 {job.hired_score}%</span>
              </ScoreTooltip>
            )}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 2 }}>{job.company}</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{timeAgo(job.posted_at || job.first_seen_at)}</div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <SourceBadge source={job.ats_source} />
        <TypeBadge type={job.job_type} />
        <EasyApplyBadge source={job.ats_source} />
        <OptFriendlyBadge optFriendly={job.opt_friendly} />
        <SponsorTierBadge tier={job.sponsor_tier} />
        <H1bProbabilityBadge probability={job.h1b_probability} count={job.h1b_lca_count} />
        <ArchetypeBadge archetype={job.archetype} />
        <VisaBadge signal={job.visa_signal} />
        {job.remote ? (
          <span style={{ background: 'var(--bg-teal)', color: 'var(--fg-blue)', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 600 }}>Remote</span>
        ) : null}
        {job.location ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>📍 {job.location}</span>
        ) : null}
      </div>

      {job.description_snippet ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0, lineHeight: 1.5 }}>
          {job.description_snippet.slice(0, 200)}{job.description_snippet.length > 200 ? '…' : ''}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {STATUS_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => onStatusChange(job.id, s)}
            style={{
              background: job.status === s ? STATUS_COLORS[s] : 'var(--bg-surface-alt)',
              color: job.status === s ? '#fff' : 'var(--text-muted)',
              border: 'none',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              cursor: 'pointer',
              fontWeight: job.status === s ? 700 : 400,
            }}
          >{STATUS_LABELS[s] || s}</button>
        ))}
        <button
          onClick={() => {
            const encoded = encodeURIComponent(fullDescription)
            const savedAts = localStorage.getItem(`ats_score_${job.id}`)
            const atsParam = savedAts ? `&ats=${savedAts}` : ''
            window.open(`http://localhost:5174?jd=${encoded}${atsParam}`, '_blank')
          }}
          style={{
            marginLeft: 'auto',
            background: '#4f46e5',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '4px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >✨ Optimize Resume</button>
        <button
          onClick={() => onOptimize(job)}
          style={{
            background: '#8839ef',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '4px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >ATS Score</button>
        <a
          href={job.apply_url}
          target="_blank"
          rel="noreferrer"
          style={{
            background: '#1e66f5',
            color: '#fff',
            borderRadius: 6,
            padding: '4px 14px',
            fontSize: 12,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >Apply →</a>
        {onQueue && (
          <button
            onClick={() => job.status !== 'queued' && onQueue(job.id)}
            style={{
              background: job.status === 'queued' ? 'var(--bg-green)' : 'var(--bg-surface-alt)',
              color: job.status === 'queued' ? 'var(--fg-green)' : 'var(--text-muted)',
              border: 'none',
              borderRadius: 6,
              padding: '4px 14px',
              fontSize: 12,
              fontWeight: job.status === 'queued' ? 700 : 400,
              cursor: job.status === 'queued' ? 'default' : 'pointer',
            }}
          >{job.status === 'queued' ? '✓ Queued' : '🚀 Queue'}</button>
        )}
        {onOutreach && (
          <button
            onClick={() => onOutreach(job)}
            style={{
              background: 'var(--bg-surface-alt)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
            title="Generate cold outreach message for this job"
          >📨 Outreach</button>
        )}
      </div>
    </div>
  )
}

// ── Cache Viewer ────────────────────────────────────────────────────────────
const SOURCE_BADGE_STYLES = {
  ai:                 { background: '#df8e1d', color: '#fff' },
  manual_correction:  { background: '#40a02b', color: '#fff' },
  manual_first_fill:  { background: '#1e66f5', color: '#fff' },
}

function CacheSourceBadge({ source }) {
  const style = SOURCE_BADGE_STYLES[source] || { background: '#45475a', color: '#fff' }
  return (
    <span style={{
      ...style,
      fontSize: 10, fontWeight: 600, borderRadius: 4,
      padding: '2px 6px', whiteSpace: 'nowrap',
    }}>{source}</span>
  )
}

function CacheViewer() {
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [loading, setLoading] = useState(false)
  const searchTimerRef = useRef(null)

  const fetchEntries = useCallback(async (q = '') => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (q) params.set('search', q)
      const res = await fetch(`${API}/api/cache?${params}`)
      const data = await res.json()
      setEntries(data.entries || [])
      setTotal(data.total || 0)
    } catch {
      // ignore fetch errors
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    async function loadEntries() {
      await fetchEntries()
    }
    loadEntries()
  }, [fetchEntries])

  const handleSearch = useCallback((e) => {
    const q = e.target.value
    setSearch(q)
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => fetchEntries(q), 350)
  }, [fetchEntries])

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this cached answer?')) return
    await fetch(`${API}/api/cache/${id}`, { method: 'DELETE' })
    fetchEntries(search)
  }, [search, fetchEntries])

  const startEdit = useCallback((entry) => {
    setEditingId(entry.id)
    setEditValue(entry.answer)
  }, [])

  const saveEdit = useCallback(async (id) => {
    if (editValue.trim()) {
      await fetch(`${API}/api/cache/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: editValue.trim() }),
      })
    }
    setEditingId(null)
    fetchEntries(search)
  }, [editValue, search, fetchEntries])

  const trunc = (str, n) => str && str.length > n ? str.slice(0, n) + '…' : (str || '')

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ color: 'var(--text-primary)', margin: 0, fontSize: 16 }}>🧠 Answer Cache</h3>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {loading ? 'Loading…' : `${total} entries`}
        </span>
      </div>

      <input
        value={search}
        onChange={handleSearch}
        placeholder="Search questions…"
        style={{
          width: '100%', boxSizing: 'border-box',
          background: 'var(--bg-surface-alt)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 6, padding: '7px 12px',
          color: 'var(--text-primary)', fontSize: 13, marginBottom: 12,
        }}
      />

      {entries.length === 0 && !loading && (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
          No cached answers yet. They appear after the form engine fills applications.
        </div>
      )}

      {entries.length > 0 && (
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 8, overflow: 'hidden',
          background: 'var(--bg-surface)',
        }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 2fr 130px 70px 70px 80px',
            gap: 8, padding: '8px 12px',
            background: 'var(--bg-surface-alt)',
            borderBottom: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase',
          }}>
            <span>Question</span>
            <span>Answer</span>
            <span>Source</span>
            <span style={{ textAlign: 'right' }}>Confidence</span>
            <span style={{ textAlign: 'right' }}>Used</span>
            <span></span>
          </div>

          {entries.map((entry, i) => (
            <div key={entry.id} style={{
              display: 'grid',
              gridTemplateColumns: '2fr 2fr 130px 70px 70px 80px',
              gap: 8, padding: '8px 12px',
              borderBottom: i < entries.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              alignItems: 'center',
              fontSize: 12,
            }}>
              <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }} title={entry.question_text}>
                {trunc(entry.question_text, 80)}
              </span>
              <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                {editingId === entry.id ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={() => saveEdit(entry.id)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(entry.id); if (e.key === 'Escape') setEditingId(null) }}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: 'var(--bg-surface-alt)',
                      border: '1px solid #1e66f5',
                      borderRadius: 4, padding: '3px 6px',
                      color: 'var(--text-primary)', fontSize: 12,
                    }}
                  />
                ) : (
                  <span
                    onClick={() => startEdit(entry)}
                    title={`Click to edit: ${entry.answer}`}
                    style={{ cursor: 'text', borderBottom: '1px dashed var(--border-subtle)' }}
                  >
                    {trunc(entry.answer, 60)}
                  </span>
                )}
              </span>
              <span><CacheSourceBadge source={entry.source} /></span>
              <span style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                {entry.confidence !== null ? `${Math.round(entry.confidence * 100)}%` : '—'}
              </span>
              <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
                {entry.times_used ?? 0}×
              </span>
              <span style={{ textAlign: 'right' }}>
                <button
                  onClick={() => handleDelete(entry.id)}
                  style={{
                    background: 'transparent', border: '1px solid var(--border-subtle)',
                    borderRadius: 4, padding: '2px 8px',
                    color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11,
                  }}
                  onMouseEnter={e => { e.target.style.borderColor = '#e64553'; e.target.style.color = '#e64553' }}
                  onMouseLeave={e => { e.target.style.borderColor = 'var(--border-subtle)'; e.target.style.color = 'var(--text-muted)' }}
                >Delete</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Preferences Panel ──────────────────────────────────────────────────────
function PreferencesPanel({ prefs, onSave }) {
  const [keywords, setKeywords] = useState(prefs.keywords?.join(', ') || '')
  const [allowlist, setAllowlist] = useState(prefs.company_allowlist?.join(', ') || '')
  const [blocklist, setBlocklist] = useState(prefs.company_blocklist?.join(', ') || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const parseList = (str) => str.split(',').map(s => s.trim()).filter(Boolean)

  async function handleSave() {
    setSaving(true)
    setMsg('')
    try {
      const body = {
        keywords: parseList(keywords),
        company_allowlist: parseList(allowlist),
        company_blocklist: parseList(blocklist),
      }
      const res = await fetch(`${API}/api/preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setMsg(`Saved! Rescored ${data.rescored} jobs.`)
      onSave(body)
    } catch {
      setMsg('Failed to save.')
    }
    setSaving(false)
  }

  const inputStyle = {
    width: '100%',
    background: 'var(--bg-surface-alt)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 6,
    padding: '8px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    boxSizing: 'border-box',
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 20, maxWidth: 600,
    }}>
      <h3 style={{ color: 'var(--text-primary)', margin: '0 0 16px', fontSize: 16 }}>⚙️ Personalization Preferences</h3>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
          Tech Stack Keywords <span style={{ color: 'var(--text-muted)' }}>(comma-separated)</span>
        </label>
        <input
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
          placeholder="React, Python, AWS, Docker, TypeScript..."
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
          Favorite Companies <span style={{ color: 'var(--text-muted)' }}>(comma-separated)</span>
        </label>
        <input
          value={allowlist}
          onChange={e => setAllowlist(e.target.value)}
          placeholder="Google, Meta, Stripe, Figma..."
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
          Blocked Companies <span style={{ color: 'var(--text-muted)' }}>(comma-separated)</span>
        </label>
        <input
          value={blocklist}
          onChange={e => setBlocklist(e.target.value)}
          placeholder="Revature, Infosys..."
          style={inputStyle}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            background: '#1e66f5', color: '#fff', border: 'none', borderRadius: 8,
            padding: '8px 20px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13,
          }}
        >{saving ? 'Saving...' : 'Save & Rescore'}</button>
        {msg && <span style={{ fontSize: 12, color: 'var(--fg-green)' }}>{msg}</span>}
      </div>
    </div>
  )
}

// ── Push Notification Toggle ───────────────────────────────────────────────
function PushToggle() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        setEnabled(!!sub)
      })
    })
  }, [])

  async function toggle() {
    if (!('serviceWorker' in navigator)) return
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      if (enabled) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await fetch(`${API}/api/subscribe`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
          await sub.unsubscribe()
        }
        setEnabled(false)
      } else {
        const res = await fetch(`${API}/api/vapid-public-key`)
        const { key } = await res.json()
        if (!key) { alert('Push not configured on server'); setLoading(false); return }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        })
        await fetch(`${API}/api/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        })
        setEnabled(true)
      }
    } catch (err) {
      console.error('Push toggle error:', err)
    }
    setLoading(false)
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={enabled ? 'Disable push notifications' : 'Enable push notifications'}
      style={{
        background: enabled ? 'var(--bg-green)' : 'var(--bg-surface-alt)',
        color: enabled ? 'var(--fg-green)' : 'var(--text-muted)',
        border: 'none', borderRadius: 8,
        padding: '6px 12px', fontSize: 12, fontWeight: 600,
        cursor: loading ? 'not-allowed' : 'pointer',
      }}
    >{loading ? '...' : enabled ? '🔔 On' : '🔕 Off'}</button>
  )
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

// ── Queue View ─────────────────────────────────────────────────────────────
function QueueView() {
  const [queueJobs, setQueueJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draggedId, setDraggedId] = useState(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/jobs/queue`)
      const data = await res.json()
      setQueueJobs(data.jobs || [])
    } catch {
      setError('Failed to load queue.')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleRemove(jobId) {
    const prev = queueJobs
    setQueueJobs(p => p.filter(j => j.id !== jobId))
    try {
      const res = await fetch(`${API}/api/jobs/${jobId}/queue`, { method: 'DELETE' })
      if (!res.ok) throw new Error('remove failed')
    } catch {
      setQueueJobs(prev) // rollback
    }
  }

  function handleDragStart(e, jobId) {
    setDraggedId(jobId)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  async function handleDrop(e, targetId) {
    e.preventDefault()
    if (draggedId === null || draggedId === targetId) return
    const fromIdx = queueJobs.findIndex(j => j.id === draggedId)
    const toIdx = queueJobs.findIndex(j => j.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return
    // Optimistic reorder
    const reordered = [...queueJobs]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)
    setQueueJobs(reordered)
    setDraggedId(null)
    // Persist new position (1-based)
    try {
      const res = await fetch(`${API}/api/jobs/${draggedId}/queue-position`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: toIdx + 1 }),
      })
      if (!res.ok) throw new Error('reorder failed')
    } catch {
      // Rollback to real server state on failure
      load()
    }
  }

  async function handleQueueAllSaved() {
    try {
      const res = await fetch(`${API}/api/jobs?status=saved&limit=200`)
      const data = await res.json()
      const ids = (data.jobs || []).map(j => j.id)
      if (ids.length === 0) { alert('No saved jobs to queue.'); return }
      await fetch(`${API}/api/jobs/bulk-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      load()
    } catch {
      alert('Failed to queue saved jobs.')
    }
  }

  async function handleClearQueue() {
    if (!window.confirm('Remove all jobs from the queue?')) return
    try {
      await Promise.all(queueJobs.map(j => fetch(`${API}/api/jobs/${j.id}/queue`, { method: 'DELETE' })))
      setQueueJobs([])
    } catch {
      alert('Failed to clear queue.')
    }
  }

  async function handleModeChange(jobId, newMode) {
    setQueueJobs(prev => prev.map(j => j.id === jobId ? { ...j, mode: newMode } : j))
    try {
      const res = await fetch(`${API}/api/jobs/${jobId}/queue-mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      })
      if (!res.ok) throw new Error('mode update failed')
    } catch {
      load() // rollback to server state
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: 18 }}>Application Queue</h2>
        {queueJobs.length > 0 && (
          <span style={{ background: 'var(--bg-yellow)', color: 'var(--fg-yellow)', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>
            {queueJobs.length} queued
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            onClick={handleQueueAllSaved}
            style={{
              background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: '1px solid var(--border)',
              borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >+ Queue All Saved</button>
          {queueJobs.length > 0 && (
            <button
              onClick={handleClearQueue}
              style={{
                background: 'var(--bg-red)', color: 'var(--fg-red)', border: '1px solid var(--fg-red)',
                borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >Clear Queue</button>
          )}
        </div>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 16px' }}>
        Drag to reorder. Jobs in your queue are ready to apply to — remove them when done.
      </p>
      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Loading queue...</div>
      ) : error ? (
        <div style={{ color: 'var(--fg-red)', padding: 40, textAlign: 'center' }}>{error}</div>
      ) : queueJobs.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-empty)', padding: 60, fontSize: 15 }}>
          Queue is empty. Save jobs and click "+ Queue All Saved", or use the 🚀 Queue button on any job card.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {queueJobs.map((job, idx) => (
            <div
              key={job.id}
              draggable
              onDragStart={e => handleDragStart(e, job.id)}
              onDragEnd={() => setDraggedId(null)}
              onDragOver={handleDragOver}
              onDrop={e => handleDrop(e, job.id)}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderLeft: '4px solid #fe640b',
                borderRadius: 8,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                opacity: draggedId === job.id ? 0.5 : 1,
                cursor: 'default',
              }}
            >
              {/* Drag handle */}
              <span style={{ fontSize: 18, color: 'var(--text-muted)', cursor: 'grab', userSelect: 'none', lineHeight: 1 }}>≡</span>
              {/* Position */}
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', minWidth: 24 }}>{idx + 1}</span>
              {/* Job info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <a
                    href={job.apply_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--text-link)', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}
                  >{job.title}</a>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{job.company}</span>
                  {job.ats_source && <SourceBadge source={job.ats_source} />}
                  {/* Mode badge */}
                  <span
                    title={job.mode_reason || undefined}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 99,
                      background: job.mode === 'assisted' ? '#3b2c00' : '#1e3a5f',
                      color: job.mode === 'assisted' ? '#f9e2af' : '#89b4fa',
                      cursor: job.mode_reason ? 'help' : 'default',
                    }}
                  >{job.mode === 'assisted' ? 'Assisted' : 'Bulk'}</span>
                </div>
              </div>
              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                {/* Mode selector */}
                <select
                  value={job.mode || 'bulk'}
                  onChange={e => handleModeChange(job.id, e.target.value)}
                  style={{
                    background: 'var(--bg-surface-alt)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '4px 8px',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  <option value="bulk">Bulk</option>
                  <option value="assisted">Assisted</option>
                </select>
                {job.apply_url && (
                  <a
                    href={job.apply_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: '#1e66f5', color: '#fff',
                      borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >Apply →</a>
                )}
                <button
                  onClick={() => handleRemove(job.id)}
                  style={{
                    background: 'var(--bg-surface-alt)', color: 'var(--fg-red)',
                    border: '1px solid var(--fg-red)', borderRadius: 6,
                    padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                  }}
                >Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tab Components ─────────────────────────────────────────────────────────
function TabBar({ tab, setTab, followUpCount, queueCount }) {
  const tabs = [
    { id: 'digest', label: '📬 Digest' },
    { id: 'all', label: '📋 All Jobs' },
    { id: 'saved', label: '💜 Saved' },
    { id: 'queue', label: queueCount > 0 ? `🚀 Queue (${queueCount})` : '🚀 Queue' },
    { id: 'applied', label: '✅ Applied' },
    { id: 'followup', label: followUpCount > 0 ? `⏰ Follow-up (${followUpCount})` : '⏰ Follow-up' },
    { id: 'analytics', label: '📊 Analytics' },
    { id: 'storybank', label: '📚 Story Bank' },
    { id: 'history', label: '📁 History' },
    { id: 'prefs', label: '⚙️ Settings' },
  ]
  return (
    <div style={{
      display: 'flex', gap: 4, background: 'var(--bg-header)',
      borderBottom: '1px solid var(--border)', padding: '0 24px',
    }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          style={{
            background: tab === t.id ? 'var(--bg-surface)' : 'transparent',
            color: tab === t.id ? 'var(--text-link)' : 'var(--text-muted)',
            border: 'none',
            borderBottom: tab === t.id ? '2px solid var(--text-link)' : '2px solid transparent',
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: tab === t.id ? 700 : 400,
            cursor: 'pointer',
          }}
        >{t.label}</button>
      ))}
    </div>
  )
}

// ── Follow-up View ─────────────────────────────────────────────────────────
function FollowUpMessageModal({ job, onClose }) {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [source, setSource] = useState('')

  useEffect(() => {
    async function generate() {
      setLoading(true)
      try {
        const res = await fetch(`${API}/api/follow-up/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: job.id }),
        })
        const data = await res.json()
        if (data.ok) {
          setMessage(data.message)
          setSource(data.source)
        } else {
          setMessage(`Hi,\n\nI applied for the ${job.title} position at ${job.company} recently and wanted to follow up on my application.\n\nI'm very interested in this opportunity and would love to discuss how I can contribute to your team.\n\nBest regards`)
          setSource('fallback')
        }
      } catch {
        setMessage(`Hi,\n\nI applied for the ${job.title} position at ${job.company} recently and wanted to follow up.\n\nBest regards`)
        setSource('fallback')
      }
      setLoading(false)
    }
    generate()
  }, [job])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const ta = document.createElement('textarea')
      ta.value = message
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12,
        padding: 24, width: 520, maxWidth: '95vw',
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: 'var(--text-primary)', margin: '0 0 4px', fontSize: 16 }}>Follow-up Message</h3>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
          {job.title} at {job.company}
          {source === 'ai' && <span style={{ color: '#8839ef', marginLeft: 8 }}>AI Generated</span>}
          {source === 'template' && <span style={{ color: '#df8e1d', marginLeft: 8 }}>Template (no API key)</span>}
        </div>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', padding: 30, textAlign: 'center' }}>Generating message...</div>
        ) : (
          <>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={8}
              style={{
                width: '100%', background: 'var(--bg-surface-alt)', border: '1px solid var(--border-subtle)',
                borderRadius: 8, padding: '10px 14px', color: 'var(--text-primary)', fontSize: 13,
                lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={onClose} style={{
                background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: 'none',
                borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontSize: 13,
              }}>Close</button>
              <button onClick={handleCopy} style={{
                background: copied ? 'var(--bg-green)' : '#1e66f5', color: copied ? 'var(--fg-green)' : '#fff', border: 'none',
                borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer', fontSize: 13,
              }}>{copied ? 'Copied!' : 'Copy to Clipboard'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Cold Outreach Modal ────────────────────────────────────────────────────
function OutreachModal({ job, onClose }) {
  const [hiringManager, setHiringManager] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    if (!hiringManager.trim()) {
      setError('Please enter a hiring manager name')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, hiringManagerName: hiringManager.trim() }),
      })
      const data = await res.json()
      if (res.ok && data.message) {
        setMessage(data.message)
      } else {
        setError(data.error || 'Failed to generate message')
      }
    } catch {
      setError('Network error')
    }
    setLoading(false)
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12,
        padding: 24, width: 560, maxWidth: '95vw',
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: 'var(--text-primary)', margin: '0 0 4px', fontSize: 16 }}>📨 Cold Outreach Message</h3>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
          {job.title} at {job.company}
        </div>

        <label style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 12, marginBottom: 4 }}>
          Hiring Manager Name
        </label>
        <input
          autoFocus
          value={hiringManager}
          onChange={e => setHiringManager(e.target.value)}
          placeholder="e.g. Jane Smith"
          onKeyDown={e => { if (e.key === 'Enter' && !loading) generate() }}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--bg-surface-alt)', border: '1px solid var(--border-subtle)',
            borderRadius: 6, padding: '8px 12px', color: 'var(--text-primary)', fontSize: 13,
            marginBottom: 12,
          }}
        />

        {error && <div style={{ color: 'var(--fg-red)', fontSize: 12, marginBottom: 8 }}>{error}</div>}

        {!message && (
          <button
            onClick={generate}
            disabled={loading}
            style={{
              background: '#1e66f5', color: '#fff', border: 'none', borderRadius: 8,
              padding: '8px 18px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 13, opacity: loading ? 0.6 : 1,
            }}
          >{loading ? 'Generating…' : '✨ Generate Message'}</button>
        )}

        {message && (
          <>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={8}
              style={{
                width: '100%', background: 'var(--bg-surface-alt)', border: '1px solid var(--border-subtle)',
                borderRadius: 8, padding: '10px 14px', color: 'var(--text-primary)', fontSize: 13,
                lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box', marginBottom: 12,
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => { setMessage(''); }} style={{
                background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: 'none',
                borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontSize: 13,
              }}>Regenerate</button>
              <button onClick={onClose} style={{
                background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: 'none',
                borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontSize: 13,
              }}>Close</button>
              <button onClick={handleCopy} style={{
                background: copied ? 'var(--bg-green)' : '#1e66f5', color: copied ? 'var(--fg-green)' : '#fff',
                border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600,
                cursor: 'pointer', fontSize: 13,
              }}>{copied ? 'Copied!' : 'Copy to Clipboard'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Story Bank ─────────────────────────────────────────────────────────────
const STORY_ARCHETYPES = ['frontend', 'backend', 'fullstack', 'mobile', 'devops', 'data', 'ml', 'security', 'qa', 'pm', 'design', 'embedded', 'other']

function StoryBankView() {
  const [stories, setStories] = useState([])
  const [filterArchetype, setFilterArchetype] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState({
    title: '', archetype: 'backend',
    situation: '', task: '', action: '', result: '', reflection: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (filterArchetype) params.set('archetype', filterArchetype)
    const res = await fetch(`${API}/api/storybank?${params}`)
    const data = await res.json()
    setStories(Array.isArray(data) ? data : [])
  }, [filterArchetype])

  useEffect(() => {
    async function loadStories() { await load() }
    loadStories()
  }, [load])

  async function save() {
    if (!draft.title.trim()) { setError('Title is required'); return }
    setError('')
    setSaving(true)
    try {
      const res = await fetch(`${API}/api/storybank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Save failed')
      } else {
        setShowForm(false)
        setDraft({ title: '', archetype: 'backend', situation: '', task: '', action: '', result: '', reflection: '' })
        load()
      }
    } catch {
      setError('Network error')
    }
    setSaving(false)
  }

  async function remove(id) {
    if (!window.confirm('Delete this story?')) return
    await fetch(`${API}/api/storybank/${id}`, { method: 'DELETE' })
    load()
  }

  const labelStyle = { display: 'block', color: 'var(--text-secondary)', fontSize: 12, marginTop: 10, marginBottom: 4 }
  const inputStyle = {
    width: '100%', boxSizing: 'border-box', background: 'var(--bg-surface-alt)',
    border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '7px 12px',
    color: 'var(--text-primary)', fontSize: 13,
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: 18 }}>📚 Story Bank</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={filterArchetype}
            onChange={e => setFilterArchetype(e.target.value)}
            style={{ ...inputStyle, width: 160 }}
          >
            <option value="">All Archetypes</option>
            {STORY_ARCHETYPES.map(a => <option key={a} value={a}>{ARCHETYPE_LABELS[a] || a}</option>)}
          </select>
          <button
            onClick={() => setShowForm(v => !v)}
            style={{
              background: '#1e66f5', color: '#fff', border: 'none', borderRadius: 8,
              padding: '8px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 13,
            }}
          >{showForm ? 'Cancel' : '+ Add Story'}</button>
        </div>
      </div>

      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 16 }}>
        Track interview stories using the STAR method, tagged by job archetype. Use these to prep targeted bullets when you apply to jobs of that type.
      </div>

      {showForm && (
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 16, marginBottom: 20,
        }}>
          <label style={labelStyle}>Title</label>
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Migrated billing service to async pipeline" style={inputStyle} />

          <label style={labelStyle}>Archetype</label>
          <select value={draft.archetype} onChange={e => setDraft({ ...draft, archetype: e.target.value })} style={inputStyle}>
            {STORY_ARCHETYPES.map(a => <option key={a} value={a}>{ARCHETYPE_LABELS[a] || a}</option>)}
          </select>

          {['situation', 'task', 'action', 'result', 'reflection'].map(field => (
            <div key={field}>
              <label style={labelStyle}>{field[0].toUpperCase() + field.slice(1)}</label>
              <textarea
                value={draft[field]}
                onChange={e => setDraft({ ...draft, [field]: e.target.value })}
                rows={field === 'action' ? 4 : 2}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>
          ))}

          {error && <div style={{ color: 'var(--fg-red)', fontSize: 12, marginTop: 8 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{
                background: '#40a02b', color: '#fff', border: 'none', borderRadius: 8,
                padding: '8px 18px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13,
                opacity: saving ? 0.6 : 1,
              }}
            >{saving ? 'Saving…' : 'Save Story'}</button>
          </div>
        </div>
      )}

      {stories.length === 0 ? (
        <div style={{ color: 'var(--text-empty)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
          No stories yet. Click "+ Add Story" to capture your first STAR-method interview answer.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {stories.map(s => (
            <div key={s.id} style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 14 }}>{s.title}</span>
                  <ArchetypeBadge archetype={s.archetype} />
                </div>
                <button onClick={() => remove(s.id)} style={{
                  background: 'transparent', color: 'var(--text-muted)', border: 'none',
                  cursor: 'pointer', fontSize: 12,
                }}>Delete</button>
              </div>
              {['situation', 'task', 'action', 'result', 'reflection'].map(f => s[f] ? (
                <div key={f} style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', fontSize: 10 }}>{f}: </span>
                  {s[f]}
                </div>
              ) : null)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FollowUpView({ onStatusChange, onOptimize, onOutreach }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(5)
  const [draftJob, setDraftJob] = useState(null)

  async function load(d) {
    setLoading(true)
    const res = await fetch(`${API}/api/follow-up?days=${d}`)
    const data = await res.json()
    setJobs(data.jobs || [])
    setLoading(false)
  }

  useEffect(() => {
    async function loadFollowUps() {
      await load(days)
    }
    loadFollowUps()
  }, [days])

  function handleStatusChange(id, status) {
    onStatusChange(id, status)
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status } : j).filter(j => j.status === 'applied'))
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: 18 }}>Follow-up Needed</h2>
        {jobs.length > 0 && (
          <span style={{ background: 'var(--bg-yellow)', color: 'var(--fg-yellow)', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>
            {jobs.length} waiting
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No response after</span>
          {[3, 5, 7].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              background: days === d ? '#df8e1d' : 'var(--bg-surface-alt)',
              color: days === d ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: days === d ? 700 : 400,
            }}>{d}d</button>
          ))}
        </div>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 16px' }}>
        Jobs you applied to {days}+ days ago with no response. Click <strong style={{ color: '#df8e1d' }}>Draft Message</strong> to generate a follow-up, then mark as <strong style={{ color: '#df8e1d' }}>followed up</strong>.
      </p>
      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Loading...</div>
      ) : jobs.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-empty)', padding: 60, fontSize: 15 }}>
          No applications waiting for follow-up.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {jobs.map(job => (
            <div key={job.id} style={{ position: 'relative' }}>
              <JobCard job={job} onStatusChange={handleStatusChange} onOptimize={onOptimize} onOutreach={onOutreach} />
              <button
                onClick={() => setDraftJob(job)}
                style={{
                  position: 'absolute', top: 10, right: 10,
                  background: '#df8e1d', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', zIndex: 1,
                }}
              >Draft Message</button>
            </div>
          ))}
        </div>
      )}
      {draftJob && <FollowUpMessageModal job={draftJob} onClose={() => setDraftJob(null)} />}
    </div>
  )
}

// ── History View ───────────────────────────────────────────────────────────
const STATUS_META = {
  followed_up: { label: 'Followed Up', color: '#df8e1d', bg: 'var(--bg-yellow)' },
  response:    { label: 'Got Response', color: '#40a02b', bg: 'var(--bg-green-deep)' },
  rejected:    { label: 'Rejected',     color: 'var(--fg-red)', bg: 'var(--bg-red)' },
}

function HistoryView({ onStatusChange, onOptimize, onOutreach }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  async function load() {
    setLoading(true)
    const res = await fetch(`${API}/api/jobs?status=followed_up&limit=200`)
    const d1 = await res.json()
    const res2 = await fetch(`${API}/api/jobs?status=response&limit=200`)
    const d2 = await res2.json()
    const res3 = await fetch(`${API}/api/jobs?status=rejected&limit=200`)
    const d3 = await res3.json()
    setJobs([...(d1.jobs || []), ...(d2.jobs || []), ...(d3.jobs || [])])
    setLoading(false)
  }

  useEffect(() => {
    async function loadHistory() {
      await load()
    }
    loadHistory()
  }, [])

  function handleStatusChange(id, status) {
    onStatusChange(id, status)
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status } : j))
  }

  const counts = jobs.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc }, {})
  const visible = filter === 'all' ? jobs : jobs.filter(j => j.status === filter)
  const sorted = [...visible].sort((a, b) => new Date(b.status_updated_at || b.first_seen_at) - new Date(a.status_updated_at || a.first_seen_at))

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: 18 }}>Application History</h2>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: `All (${jobs.length})` },
            { id: 'followed_up', label: `Followed Up (${counts.followed_up || 0})` },
            { id: 'response',    label: `Response (${counts.response || 0})` },
            { id: 'rejected',    label: `Rejected (${counts.rejected || 0})` },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              background: filter === f.id ? 'var(--bg-surface-alt)' : 'transparent',
              color: filter === f.id ? 'var(--text-primary)' : 'var(--text-muted)',
              border: '1px solid var(--border)', borderRadius: 6,
              padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: filter === f.id ? 700 : 400,
            }}>{f.label}</button>
          ))}
        </div>
      </div>
      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Loading...</div>
      ) : sorted.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-empty)', padding: 60, fontSize: 15 }}>
          No history yet. Jobs you follow up on, get responses from, or are rejected by will appear here.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sorted.map(job => {
            const meta = STATUS_META[job.status] || {}
            return (
              <div key={job.id} style={{ position: 'relative' }}>
                <div style={{
                  position: 'absolute', top: 10, right: 10, zIndex: 1,
                  background: meta.bg, color: meta.color,
                  fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 99,
                }}>{meta.label}</div>
                <JobCard job={job} onStatusChange={handleStatusChange} onOptimize={onOptimize} onOutreach={onOutreach} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Digest View ────────────────────────────────────────────────────────────
function DigestView({ onStatusChange, onOptimize, onQueue, onOutreach }) {
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const res = await fetch(`${API}/api/digest?limit=50`)
      const data = await res.json()
      setJobs(data.jobs || [])
      setTotal(data.total || 0)
      setLoading(false)
    }
    load()
  }, [])

  function handleStatusChange(id, status) {
    onStatusChange(id, status)
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status } : j))
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Loading digest...</div>

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: 18 }}>Today's Digest</h2>
        <span style={{
          background: 'var(--bg-green)', color: 'var(--fg-green)',
          fontSize: 12, fontWeight: 700,
          padding: '3px 10px', borderRadius: 99,
        }}>{total} jobs in last 24h</span>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 16px' }}>
        Top jobs ranked by your preferences. Update settings to improve results.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {jobs.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-empty)', padding: 40 }}>
            No jobs in the last 24h. Run a collection first!
          </div>
        ) : jobs.map(job => (
          <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} onOptimize={onOptimize} onQueue={onQueue} onOutreach={onOutreach} />
        ))}
      </div>
    </div>
  )
}

// ── Add Job Manually Modal ─────────────────────────────────────────────────
function AddJobModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ title: '', company: '', apply_url: '', location: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim() || !form.company.trim()) { setErr('Title and company are required.'); return }
    setSaving(true)
    setErr('')
    try {
      const res = await fetch(`${API}/api/jobs/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error || 'Failed to add job'); setSaving(false); return }
      onAdded(data.job)
      onClose()
    } catch {
      setErr('Network error')
      setSaving(false)
    }
  }

  const inputStyle = {
    width: '100%', background: 'var(--bg-surface-alt)', border: '1px solid var(--border-subtle)',
    borderRadius: 6, padding: '8px 12px', color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12,
        padding: 28, width: 460, maxWidth: '95vw',
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: 'var(--text-primary)', margin: '0 0 20px', fontSize: 17 }}>➕ Add Job Manually</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { key: 'title', label: 'Job Title *', placeholder: 'Software Engineer' },
            { key: 'company', label: 'Company *', placeholder: 'Acme Inc.' },
            { key: 'apply_url', label: 'Application URL', placeholder: 'https://...' },
            { key: 'location', label: 'Location', placeholder: 'Austin, TX / Remote' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>{label}</label>
              <input
                value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                style={inputStyle}
              />
            </div>
          ))}
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any notes about this application..."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          {err && <div style={{ color: 'var(--fg-red)', fontSize: 12 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: 'none',
              borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontSize: 13,
            }}>Cancel</button>
            <button type="submit" disabled={saving} style={{
              background: '#40a02b', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 18px', fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13,
            }}>{saving ? 'Adding...' : 'Add as Applied'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Analytics View ────────────────────────────────────────────────────────
function BarChart({ data, labelKey, valueKey, maxValue, color, secondaryKey, secondaryColor, formatLabel }) {
  const max = maxValue || Math.max(...data.map(d => d[valueKey] || 0), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {data.map((d, i) => {
        const pct = Math.round(((d[valueKey] || 0) / max) * 100)
        const secPct = secondaryKey ? Math.round(((d[secondaryKey] || 0) / max) * 100) : 0
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 120, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {formatLabel ? formatLabel(d[labelKey]) : d[labelKey]}
            </div>
            <div style={{ flex: 1, position: 'relative', height: 20, background: 'var(--bg-surface-alt)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.3s' }} />
              {secondaryKey && secPct > 0 && (
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${secPct}%`, background: secondaryColor || '#40a02b', borderRadius: 4, opacity: 0.7, transition: 'width 0.3s' }} />
              )}
            </div>
            <div style={{ width: 50, fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right', flexShrink: 0 }}>
              {d[valueKey]}{secondaryKey ? ` / ${d[secondaryKey]}` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FunnelChart({ funnel }) {
  if (!funnel) return null
  const stages = [
    { label: 'Discovered', value: funnel.total, color: '#89b4fa' },
    { label: 'Saved', value: funnel.saved, color: '#8839ef' },
    { label: 'Applied', value: funnel.applied, color: '#40a02b' },
    { label: 'Followed Up', value: funnel.followed_up, color: '#df8e1d' },
    { label: 'Got Response', value: funnel.response, color: '#04a5e5' },
    { label: 'Rejected', value: funnel.rejected, color: '#f38ba8' },
  ]
  const max = stages[0].value || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {stages.map((s, i) => {
        const pct = Math.max(4, Math.round((s.value / max) * 100))
        const convRate = i > 0 && stages[i - 1].value > 0
          ? Math.round((s.value / stages[i - 1].value) * 100)
          : null
        return (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 100, fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>{s.label}</div>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <div style={{
                width: `${pct}%`, minWidth: 40,
                height: 28, background: s.color, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, color: '#fff',
                transition: 'width 0.3s',
              }}>{s.value}</div>
            </div>
            <div style={{ width: 50, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
              {convRate !== null ? `${convRate}%` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MiniStat({ label, value, unit, color }) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '16px 20px', flex: '1 1 150px', minWidth: 140,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value ?? '—'}{unit && <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}> {unit}</span>}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
    </div>
  )
}

function AnalyticsView() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`${API}/api/analytics?days=${days}`)
        const d = await res.json()
        setData(d)
      } catch (err) {
        console.error('Analytics fetch error:', err)
      }
      setLoading(false)
    }
    load()
  }, [days])

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Loading analytics...</div>
  if (!data) return <div style={{ color: 'var(--fg-red)', padding: 40, textAlign: 'center' }}>Failed to load analytics.</div>

  const totalApplied = data.funnel?.applied || 0
  const totalResponses = data.funnel?.response || 0
  const overallRate = totalApplied > 0 ? Math.round((totalResponses / totalApplied) * 100) : 0

  // Compute avg apps/day from the daily data
  const avgAppsPerDay = data.apps_per_day?.length > 0
    ? Math.round(data.apps_per_day.reduce((s, d) => s + d.count, 0) / data.apps_per_day.length * 10) / 10
    : 0

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h2 style={{ color: 'var(--text-primary)', margin: 0, fontSize: 18 }}>Application Analytics</h2>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
          {[7, 14, 30, 60].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              background: days === d ? '#1e66f5' : 'var(--bg-surface-alt)',
              color: days === d ? '#fff' : 'var(--text-muted)',
              border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: days === d ? 700 : 400,
            }}>{d}d</button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <MiniStat label="Total Applied" value={totalApplied} color="#40a02b" />
        <MiniStat label="Responses" value={totalResponses} color="#04a5e5" />
        <MiniStat label="Response Rate" value={overallRate} unit="%" color={overallRate >= 10 ? '#a6e3a1' : overallRate >= 5 ? '#f9e2af' : '#f38ba8'} />
        <MiniStat label="Avg Days to Response" value={data.avg_days_to_response} unit="days" color="#89b4fa" />
        <MiniStat label="Avg Apps / Day" value={avgAppsPerDay} color="#df8e1d" />
      </div>

      {/* Funnel */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <h3 style={{ color: 'var(--text-primary)', margin: '0 0 16px', fontSize: 15 }}>Conversion Funnel</h3>
        <FunnelChart funnel={data.funnel} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Response Rate by Source */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <h3 style={{ color: 'var(--text-primary)', margin: '0 0 4px', fontSize: 15 }}>Response Rate by Source</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: '0 0 14px' }}>Which ATS platforms get the most callbacks?</p>
          {data.by_source?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.by_source.map(s => (
                <div key={s.ats_source}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, textTransform: 'capitalize' }}>{s.ats_source}</span>
                    <span style={{ fontSize: 12, color: s.rate > 0 ? 'var(--fg-green)' : 'var(--text-muted)' }}>
                      {s.responses}/{s.applied} ({s.rate}%)
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-surface-alt)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3, transition: 'width 0.3s',
                      width: `${Math.max(2, s.rate)}%`,
                      background: s.rate >= 15 ? '#a6e3a1' : s.rate >= 5 ? '#f9e2af' : 'var(--text-faint)',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-empty)', fontSize: 13, padding: 20, textAlign: 'center' }}>No application data yet. Start applying to see conversion rates.</div>
          )}
        </div>

        {/* Response Rate by Title */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <h3 style={{ color: 'var(--text-primary)', margin: '0 0 4px', fontSize: 15 }}>Response Rate by Job Title</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: '0 0 14px' }}>Which roles get the most callbacks?</p>
          {data.by_title?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.by_title.map(t => (
                <div key={t.title}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{t.title}</span>
                    <span style={{ fontSize: 12, color: t.rate > 0 ? 'var(--fg-green)' : 'var(--text-muted)' }}>
                      {t.responses}/{t.applied} ({t.rate}%)
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-surface-alt)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3, transition: 'width 0.3s',
                      width: `${Math.max(2, t.rate)}%`,
                      background: t.rate >= 15 ? '#a6e3a1' : t.rate >= 5 ? '#f9e2af' : 'var(--text-faint)',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-empty)', fontSize: 13, padding: 20, textAlign: 'center' }}>No application data yet.</div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Easy vs Hard Apply */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <h3 style={{ color: 'var(--text-primary)', margin: '0 0 4px', fontSize: 15 }}>Easy Apply vs Hard Apply</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: '0 0 14px' }}>Greenhouse/Lever/Ashby (easy) vs Workday/others (hard)</p>
          {data.difficulty_analysis?.length > 0 ? (
            <div style={{ display: 'flex', gap: 16 }}>
              {data.difficulty_analysis.map(d => (
                <div key={d.difficulty} style={{
                  flex: 1, background: 'var(--bg-surface-deep)', borderRadius: 8, padding: 16, textAlign: 'center',
                  border: `1px solid ${d.difficulty === 'easy' ? '#40a02b' : '#df8e1d'}`,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {d.difficulty === 'easy' ? 'Easy Apply' : 'Hard Apply'}
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: d.difficulty === 'easy' ? 'var(--fg-green)' : 'var(--fg-yellow)' }}>
                    {d.rate}%
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {d.responses} / {d.applied} apps
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-empty)', fontSize: 13, padding: 20, textAlign: 'center' }}>No data yet.</div>
          )}
        </div>

        {/* OPT-friendly analysis */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <h3 style={{ color: 'var(--text-primary)', margin: '0 0 4px', fontSize: 15 }}>OPT-Friendly vs Others</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: '0 0 14px' }}>Do known OPT sponsors respond more?</p>
          {data.opt_analysis?.length > 0 ? (
            <div style={{ display: 'flex', gap: 16 }}>
              {data.opt_analysis.map(d => (
                <div key={String(d.opt_friendly)} style={{
                  flex: 1, background: 'var(--bg-surface-deep)', borderRadius: 8, padding: 16, textAlign: 'center',
                  border: `1px solid ${d.opt_friendly ? '#40a02b' : 'var(--border)'}`,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {d.opt_friendly ? 'OPT Friendly' : 'Other Companies'}
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: d.opt_friendly ? 'var(--fg-green)' : 'var(--text-primary)' }}>
                    {d.rate}%
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {d.responses} / {d.applied} apps
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--text-empty)', fontSize: 13, padding: 20, textAlign: 'center' }}>No data yet.</div>
          )}
        </div>
      </div>

      {/* Daily Applications Timeline */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
        <h3 style={{ color: 'var(--text-primary)', margin: '0 0 4px', fontSize: 15 }}>Daily Applications</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: '0 0 14px' }}>Applications submitted per day</p>
        {data.apps_per_day?.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120, padding: '0 4px' }}>
            {data.apps_per_day.map((d, i) => {
              const max = Math.max(...data.apps_per_day.map(x => x.count), 1)
              const h = Math.max(4, Math.round((d.count / max) * 100))
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span style={{ fontSize: 9, color: 'var(--text-secondary)', fontWeight: 600 }}>{d.count}</span>
                  <div style={{
                    width: '100%', maxWidth: 28, height: `${h}%`, minHeight: 4,
                    background: '#1e66f5', borderRadius: '3px 3px 0 0',
                    transition: 'height 0.3s',
                  }} />
                  <span style={{ fontSize: 8, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                    {new Date(d.day + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ color: 'var(--text-empty)', fontSize: 13, padding: 30, textAlign: 'center' }}>
            No application data yet. Apply to some jobs first!
          </div>
        )}
      </div>

      {/* Weekly Velocity */}
      {data.weekly_velocity?.length > 1 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20 }}>
          <h3 style={{ color: 'var(--text-primary)', margin: '0 0 4px', fontSize: 15 }}>Weekly Velocity</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: '0 0 14px' }}>Are you ramping up or slowing down?</p>
          <BarChart
            data={data.weekly_velocity}
            labelKey="week"
            valueKey="count"
            color="#8839ef"
            formatLabel={(w) => w ? `Week ${w.split('W')[1]}` : ''}
          />
        </div>
      )}
    </div>
  )
}

// ── Theme Toggle ───────────────────────────────────────────────────────────
function ThemeToggle({ dark, onToggle }) {
  return (
    <button className="theme-toggle" onClick={onToggle} title="Toggle dark/light mode">
      <span>{dark ? '🌙' : '☀️'}</span>
      <div className="theme-toggle-track">
        <div className="theme-toggle-thumb" style={{ left: dark ? 1 : 15 }} />
      </div>
    </button>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('digest')
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState(null)
  const [lastRun, setLastRun] = useState(null)
  const [collecting, setCollecting] = useState(false)

  const [offset, setOffset] = useState(0)
  const [prefs, setPrefs] = useState({ keywords: [], company_allowlist: [], company_blocklist: [] })
  const [optimizeJob, setOptimizeJob] = useState(null)
  const [outreachJob, setOutreachJob] = useState(null)
  const [resumeInfo, setResumeInfo] = useState(null) // { filename, uploadedAt }
  const [scoring, setScoring] = useState(false)
  const [scoreMsg, setScoreMsg] = useState('')
  const [followUpCount, setFollowUpCount] = useState(0)
  const [queueCount, setQueueCount] = useState(0)
  const [showAddJob, setShowAddJob] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('theme') !== 'light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  const [filters, setFilters] = useState({
    status: '',
    ats_source: '',
    job_type: '',
    remote: '',
    search: '',
    hours: '24',
    sort: '',
    entry_only: '',
  })

  const fetchJobs = useCallback(async (currentFilters, currentOffset, statusOverride) => {
    const params = new URLSearchParams()
    Object.entries(currentFilters).forEach(([k, v]) => { if (v !== '') params.set(k, v) })
    if (statusOverride) params.set('status', statusOverride)
    params.set('limit', LIMIT)
    params.set('offset', currentOffset)
    const res = await fetch(`${API}/api/jobs?${params}`)
    const data = await res.json()
    setJobs(data.jobs || [])
    setTotal(data.total || 0)
  }, [])

  const fetchStats = useCallback(async () => {
    const res = await fetch(`${API}/api/stats`)
    const data = await res.json()
    setStats(data)
    setLastRun(data.last_run)
  }, [])

  const fetchPrefs = useCallback(async () => {
    const res = await fetch(`${API}/api/preferences`)
    const data = await res.json()
    setPrefs(data)
  }, [])

  const fetchFollowUpCount = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/follow-up?days=5`)
      const data = await res.json()
      setFollowUpCount(data.total || 0)
    } catch { /* ignore */ }
  }, [])

  const fetchQueueCount = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/jobs/queue`)
      const data = await res.json()
      setQueueCount((data.jobs || []).length)
    } catch { /* ignore */ }
  }, [])

  const fetchResume = useCallback(async () => {
    const res = await fetch(`${API}/api/resume`)
    const data = await res.json()
    if (data.uploaded) setResumeInfo({ filename: data.filename, uploadedAt: data.uploadedAt })
  }, [])

  useEffect(() => {
    fetchPrefs()
    fetchResume()
    fetchFollowUpCount()
    fetchQueueCount()
  }, [fetchPrefs, fetchResume, fetchFollowUpCount, fetchQueueCount])

  useEffect(() => {
    if (tab === 'digest' || tab === 'prefs' || tab === 'followup' || tab === 'history' || tab === 'queue' || tab === 'storybank' || tab === 'analytics') return
    const statusOverride = tab === 'saved' ? 'saved' : tab === 'applied' ? 'applied' : undefined
    const activeFilters = tab === 'applied' ? { search: '', status: '', ats_source: '', job_type: '', remote: '', hours: '', sort: '', entry_only: '' } : filters
    fetchJobs(activeFilters, offset, statusOverride)
    fetchStats()
  }, [tab, filters, offset, fetchJobs, fetchStats])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  // Poll collection status
  useEffect(() => {
    if (!collecting) return
    const iv = setInterval(async () => {
      const res = await fetch(`${API}/api/collect/status`)
      const data = await res.json()
      if (!data.running) {
        setCollecting(false)
        const statusOverride = tab === 'saved' ? 'saved' : tab === 'applied' ? 'applied' : undefined
        fetchJobs(filters, offset, statusOverride)
        fetchStats()
        fetchFollowUpCount()
        fetchQueueCount()
        // Auto visa-scan new jobs after collection
        fetch(`${API}/api/visa-scan`, { method: 'POST' }).catch(() => {})
      }
    }, 3000)
    return () => clearInterval(iv)
  }, [collecting, tab, filters, offset, fetchJobs, fetchStats, fetchFollowUpCount, fetchQueueCount])

  async function handleCollect() {
    setCollecting(true)
    await fetch(`${API}/api/collect?hours=48`, { method: 'POST' })
  }


  async function handleGlobalResumeUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`${API}/api/resume/upload`, { method: 'POST', body: formData })
      const data = await res.json()
      if (data.ok) {
        setResumeInfo({ filename: data.filename, uploadedAt: new Date().toISOString() })
        // Auto-trigger batch scoring
        handleScoreAll()
      } else {
        alert(data.error || 'Upload failed')
      }
    } catch {
      alert('Upload failed')
    }
    e.target.value = '' // reset input
  }

  async function handleScoreAll() {
    setScoring(true)
    setScoreMsg('Scoring all jobs...')
    try {
      const res = await fetch(`${API}/api/resume/score-all`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setScoreMsg(`Scored ${data.scored} jobs (${data.skipped} skipped)`)
        // Also visa-scan any jobs that were skipped (no description)
        await fetch(`${API}/api/visa-scan`, { method: 'POST' }).catch(() => {})
        // Refresh current view
        const statusOverride = tab === 'saved' ? 'saved' : tab === 'applied' ? 'applied' : undefined
        fetchJobs(filters, offset, statusOverride)
      } else {
        setScoreMsg(data.error || 'Scoring failed')
      }
    } catch {
      setScoreMsg('Scoring failed')
    }
    setScoring(false)
    setTimeout(() => setScoreMsg(''), 5000)
  }

  async function handleStatusChange(jobId, newStatus) {
    await fetch(`${API}/api/jobs/${jobId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: newStatus } : j))
    fetchStats()
    fetchQueueCount()
  }

  async function handleQueueAdd(jobId) {
    // Optimistic update
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'queued' } : j))
    try {
      const res = await fetch(`${API}/api/jobs/${jobId}/queue`, { method: 'POST' })
      if (!res.ok) throw new Error('queue add failed')
      fetchQueueCount()
    } catch {
      // Rollback - restore previous status (we don't know exact prev status, so refetch)
      fetchJobs()
      fetchQueueCount()
    }
  }

  function setFilter(key, value) {
    setOffset(0)
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  function clearFilters() {
    setOffset(0)
    setFilters({ status: '', ats_source: '', job_type: '', remote: '', search: '', hours: '24', sort: '', entry_only: '' })
  }

  const bs = stats?.by_status || {}
  const bsrc = stats?.by_source || {}

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'var(--bg-header)', borderBottom: '1px solid var(--border)',
        padding: '12px 24px',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-link)' }}>🎯 Job Tracker</div>
        <div style={{ flex: 1 }} />
        {/* Global Resume Upload */}
        <label style={{
          background: resumeInfo ? 'var(--bg-green)' : 'var(--bg-surface-alt)',
          color: resumeInfo ? 'var(--fg-green)' : 'var(--text-primary)',
          border: 'none', borderRadius: 8,
          padding: '6px 14px', fontSize: 12, fontWeight: 600,
          cursor: scoring ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
          opacity: scoring ? 0.6 : 1,
        }}>
          📄 {resumeInfo ? resumeInfo.filename : 'Upload Resume'}
          <input
            type="file"
            accept=".pdf,.txt,.tex"
            onChange={handleGlobalResumeUpload}
            disabled={scoring}
            style={{ display: 'none' }}
          />
        </label>
        {resumeInfo && (
          <button
            onClick={handleScoreAll}
            disabled={scoring}
            style={{
              background: scoring ? 'var(--bg-surface-alt)' : '#8839ef',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              cursor: scoring ? 'not-allowed' : 'pointer',
            }}
          >{scoring ? 'Scoring...' : '🎯 Score All'}</button>
        )}
        {scoreMsg && <span style={{ fontSize: 11, color: 'var(--fg-green)' }}>{scoreMsg}</span>}
        <PushToggle />
        <ThemeToggle dark={dark} onToggle={() => setDark(d => !d)} />
        {lastRun && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Last run: {timeAgo(lastRun.finished_at)} · {lastRun.jobs_new} new
          </div>
        )}
        {stats && (
          <div style={{
            background: 'var(--bg-green)', color: 'var(--fg-green)',
            fontSize: 12, fontWeight: 700,
            padding: '4px 12px', borderRadius: 99,
          }}>
            {stats.new_24h} new (24h)
          </div>
        )}
        <button
          onClick={handleCollect}
          disabled={collecting}
          style={{
            background: collecting ? 'var(--bg-surface-alt)' : '#1e66f5',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '8px 16px',
            fontWeight: 600,
            cursor: collecting ? 'not-allowed' : 'pointer',
            fontSize: 13,
          }}
        >
          {collecting ? 'Collecting...' : '🔄 Collect Now'}
        </button>
      </div>

      {/* Tabs */}
      <TabBar tab={tab} setTab={(t) => { setTab(t); setOffset(0) }} followUpCount={followUpCount} queueCount={queueCount} />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px' }}>

        {/* Digest Tab */}
        {tab === 'digest' && (
          <DigestView onStatusChange={handleStatusChange} onOptimize={setOptimizeJob} onQueue={handleQueueAdd} onOutreach={setOutreachJob} />
        )}

        {/* Queue Tab */}
        {tab === 'queue' && (
          <QueueView />
        )}

        {/* Follow-up Tab */}
        {tab === 'followup' && (
          <FollowUpView onStatusChange={handleStatusChange} onOptimize={setOptimizeJob} onOutreach={setOutreachJob} />
        )}

        {/* Analytics Tab */}
        {tab === 'analytics' && (
          <AnalyticsView />
        )}

        {/* Story Bank Tab */}
        {tab === 'storybank' && (
          <StoryBankView />
        )}

        {/* History Tab */}
        {tab === 'history' && (
          <HistoryView onStatusChange={handleStatusChange} onOptimize={setOptimizeJob} onOutreach={setOutreachJob} />
        )}

        {/* Settings Tab */}
        {tab === 'prefs' && (
          <div>
            <h2 style={{ color: 'var(--text-primary)', margin: '0 0 16px', fontSize: 18 }}>Settings</h2>
            <PreferencesPanel
              key={JSON.stringify(prefs)}
              prefs={prefs}
              onSave={(updated) => setPrefs(updated)}
            />
            <CacheViewer />
          </div>
        )}

        {/* All Jobs / Saved / Applied tabs */}
        {(tab === 'all' || tab === 'saved' || tab === 'applied') && (
          <>
            {/* Stats Row (only on All Jobs) */}
            {tab === 'all' && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
                <StatCard value={(bs.new || 0) + (bs.saved || 0) + (bs.applied || 0)} label="Total" color="#89b4fa" />
                <StatCard value={bs.new || 0} label="New" color="#1e66f5" />
                <StatCard value={bs.saved || 0} label="Saved" color="#8839ef" />
                <StatCard value={bs.applied || 0} label="Applied" color="#40a02b" />
                <StatCard value={bsrc.greenhouse || 0} label="Greenhouse" color="#40a02b" />
                <StatCard value={bsrc.lever || 0} label="Lever" color="#1e66f5" />
                <StatCard value={bsrc.ashby || 0} label="Ashby" color="#8839ef" />
                <StatCard value={bsrc.workday || 0} label="Workday" color="#df8e1d" />
                <StatCard value={bsrc.smartrecruiters || 0} label="SmartRecruit" color="#fe640b" />
                <StatCard value={bsrc.workable || 0} label="Workable" color="#04a5e5" />
                <StatCard value={bsrc.simplifyjobs || 0} label="Simplify" color="#fe640b" />
                <StatCard value={bsrc.jsearch || 0} label="JSearch" color="#ea76cb" />
              </div>
            )}

            {/* Filter Bar (hidden on Applied tab) */}
            {tab !== 'applied' && <div style={{
              display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '10px 14px', marginBottom: 16,
            }}>
              <input
                placeholder="Search title, company..."
                value={filters.search}
                onChange={e => setFilter('search', e.target.value)}
                style={{
                  flex: '2 1 200px', background: 'var(--bg-surface-alt)', border: 'none', borderRadius: 6,
                  padding: '6px 12px', color: 'var(--text-primary)', fontSize: 13,
                }}
              />
              {tab === 'all' && (
                <select
                  value={filters.status}
                  onChange={e => setFilter('status', e.target.value)}
                  style={{
                    flex: '1 1 110px', background: 'var(--bg-surface-alt)', border: 'none', borderRadius: 6,
                    padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13,
                  }}
                >
                  {['', 'new', 'saved', 'queued', 'applied', 'followed_up', 'response', 'rejected', 'archived'].map(o => (
                    <option key={o} value={o}>{o === '' ? 'All Statuses' : STATUS_LABELS[o] || o}</option>
                  ))}
                </select>
              )}
              {[
                { key: 'ats_source', label: 'Source', options: ['', 'greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'workable', 'simplifyjobs', 'jsearch'] },
                { key: 'job_type', label: 'Type', options: ['', 'fulltime', 'internship', 'coop'] },
                { key: 'remote', label: 'Remote', options: ['', 'true', 'false'] },
                { key: 'hours', label: 'Posted', options: ['', '6', '24', '48'] },
              ].map(({ key, label, options }) => (
                <select
                  key={key}
                  value={filters[key]}
                  onChange={e => setFilter(key, e.target.value)}
                  style={{
                    flex: '1 1 110px', background: 'var(--bg-surface-alt)', border: 'none', borderRadius: 6,
                    padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13,
                  }}
                >
                  {options.map(o => (
                    <option key={o} value={o}>
                      {o === '' ? `All ${label}s` : key === 'hours' ? `Last ${o}h` : key === 'remote' ? (o === 'true' ? 'Remote' : 'On-site') : o}
                    </option>
                  ))}
                </select>
              ))}
              <button
                onClick={() => setFilter('entry_only', filters.entry_only === 'true' ? '' : 'true')}
                style={{
                  background: filters.entry_only === 'true' ? 'var(--bg-green)' : 'var(--bg-surface-alt)',
                  color: filters.entry_only === 'true' ? 'var(--fg-green)' : 'var(--text-muted)',
                  border: filters.entry_only === 'true' ? '1px solid #40a02b' : '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >🎓 Entry Roles</button>
              <select
                value={filters.sort}
                onChange={e => setFilter('sort', e.target.value)}
                style={{
                  flex: '1 1 140px', background: 'var(--bg-surface-alt)', border: 'none', borderRadius: 6,
                  padding: '6px 10px', color: 'var(--text-primary)', fontSize: 13,
                }}
              >
                <option value="">Sort: Newest</option>
                <option value="hired_score_desc">🎯 Hired Score ↓</option>
                <option value="hired_score_asc">🎯 Hired Score ↑</option>
              </select>
              <button
                onClick={clearFilters}
                style={{
                  background: 'var(--bg-surface-alt)', color: 'var(--text-secondary)', border: 'none',
                  borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12,
                }}
              >Clear</button>
            </div>}

            {/* Add Manually button — Applied tab only */}
            {tab === 'applied' && (
              <div style={{ marginBottom: 12 }}>
                <button
                  onClick={() => setShowAddJob(true)}
                  style={{
                    background: 'var(--bg-green)', color: 'var(--fg-green)', border: '1px solid #40a02b',
                    borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >➕ Add Job Manually</button>
              </div>
            )}

            {/* Results count + pagination */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {total} job{total !== 1 ? 's' : ''} found
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  disabled={offset === 0}
                  style={{
                    background: 'var(--bg-surface-alt)', color: offset === 0 ? 'var(--text-empty)' : 'var(--text-primary)',
                    border: 'none', borderRadius: 6, padding: '5px 12px',
                    cursor: offset === 0 ? 'default' : 'pointer', fontSize: 12,
                  }}
                >← Prev</button>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                  {Math.floor(offset / LIMIT) + 1} / {Math.max(1, Math.ceil(total / LIMIT))}
                </span>
                <button
                  onClick={() => setOffset(offset + LIMIT)}
                  disabled={offset + LIMIT >= total}
                  style={{
                    background: 'var(--bg-surface-alt)', color: offset + LIMIT >= total ? 'var(--text-empty)' : 'var(--text-primary)',
                    border: 'none', borderRadius: 6, padding: '5px 12px',
                    cursor: offset + LIMIT >= total ? 'default' : 'pointer', fontSize: 12,
                  }}
                >Next →</button>
              </div>
            </div>

            {/* Job List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {jobs.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-empty)', padding: '60px 0', fontSize: 15 }}>
                  {tab === 'saved' ? 'No saved jobs yet. Mark jobs as saved to see them here.' :
                   tab === 'applied' ? 'No applied jobs yet. Track your applications here.' :
                   'No jobs found. Click "Collect Now" to start fetching jobs.'}
                </div>
              ) : jobs.map(job => (
                <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} onOptimize={setOptimizeJob} onQueue={handleQueueAdd} onOutreach={setOutreachJob} />
              ))}
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', color: 'var(--border)', fontSize: 11, padding: '40px 0 20px' }}>
          Job Tracker · Auto-refreshes every 6h · {stats ? `${(bs.new || 0) + (bs.saved || 0) + (bs.applied || 0)}` : '0'} total jobs tracked
        </div>
      </div>

      {/* Resume Optimizer Modal */}
      {optimizeJob && (
        <ResumeOptimizer job={optimizeJob} onClose={() => setOptimizeJob(null)} />
      )}

      {/* Cold Outreach Modal */}
      {outreachJob && (
        <OutreachModal job={outreachJob} onClose={() => setOutreachJob(null)} />
      )}

      {/* Add Job Manually Modal */}
      {showAddJob && (
        <AddJobModal
          onClose={() => setShowAddJob(false)}
          onAdded={(job) => {
            if (tab === 'applied') setJobs(prev => [job, ...prev])
            setShowAddJob(false)
          }}
        />
      )}
    </div>
  )
}

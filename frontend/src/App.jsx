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
      background: '#1e1e2e',
      borderRadius: 8,
      padding: '12px 16px',
      minWidth: 90,
      flex: '1 1 90px',
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#cdd6f4' }}>{value ?? 0}</div>
      <div style={{ fontSize: 11, color: '#6c7086', marginTop: 2 }}>{label}</div>
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
  fulltime: { bg: '#313244', fg: '#cdd6f4' },
  internship: { bg: '#1e4620', fg: '#a6e3a1' },
  coop: { bg: '#3b2c00', fg: '#f9e2af' },
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
    <span style={{ background: '#1e4620', color: '#a6e3a1', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 700 }}>✓ Sponsors</span>
  )
  if (signal === 0) return (
    <span style={{ background: '#3b1c1c', color: '#f38ba8', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 700 }}>✗ No Sponsor</span>
  )
  return (
    <span style={{ background: '#3b2c00', color: '#f9e2af', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 600 }}>? Visa Unknown</span>
  )
}

const EASY_APPLY_SOURCES = new Set(['greenhouse', 'lever', 'ashby'])
function EasyApplyBadge({ source }) {
  if (!EASY_APPLY_SOURCES.has(source)) return null
  return (
    <span style={{ background: '#003344', color: '#89dceb', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 600 }}>⚡ Easy Apply</span>
  )
}

function OptFriendlyBadge({ optFriendly }) {
  if (!optFriendly) return null
  return (
    <span style={{ background: '#1c2b1e', color: '#a6e3a1', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 700, border: '1px solid #40a02b' }}>
      🌍 OPT Friendly
    </span>
  )
}

function ScoreBar({ score }) {
  const maxScore = 100
  const pct = Math.min(100, Math.round((score / maxScore) * 100))
  const color = pct >= 60 ? '#40a02b' : pct >= 30 ? '#df8e1d' : '#6c7086'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width: 60, height: 6, background: '#313244', borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 600 }}>{score}</span>
    </div>
  )
}

function ScoreTooltip({ details, score, children }) {
  const [show, setShow] = useState(false)
  const ref = useRef(null)
  let parsed = null
  if (details) {
    try { parsed = typeof details === 'string' ? JSON.parse(details) : details } catch {}
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
          background: '#181825',
          border: '1px solid #45475a',
          borderRadius: 10,
          padding: '14px 16px',
          width: 300,
          zIndex: 999,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          fontSize: 12,
          color: '#cdd6f4',
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: '#cdd6f4' }}>
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
                <span style={{ color: '#a6adc8' }}>{label} <span style={{ color: '#585b70' }}>({weight})</span></span>
                <span style={{ fontWeight: 600, color: metric.score >= 60 ? '#a6e3a1' : metric.score >= 40 ? '#f9e2af' : '#f38ba8' }}>
                  {metric.score}%
                </span>
              </div>
              <div style={{ height: 4, background: '#313244', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: `${metric.score}%`,
                  height: '100%',
                  borderRadius: 2,
                  background: metric.score >= 60 ? '#a6e3a1' : metric.score >= 40 ? '#f9e2af' : '#f38ba8',
                }} />
              </div>
            </div>
          ))}

          {/* Matched keywords */}
          {parsed.matchedKeywords?.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: '#a6e3a1', fontWeight: 600, marginBottom: 4 }}>
                ✓ Matched Skills ({parsed.matchedKeywords.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {parsed.matchedKeywords.slice(0, 12).map(kw => (
                  <span key={kw} style={{
                    background: '#1e4620', color: '#a6e3a1',
                    fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  }}>{kw}</span>
                ))}
                {parsed.matchedKeywords.length > 12 && (
                  <span style={{ fontSize: 10, color: '#585b70' }}>+{parsed.matchedKeywords.length - 12} more</span>
                )}
              </div>
            </div>
          )}

          {/* Missing keywords */}
          {parsed.missingKeywords?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: '#f38ba8', fontWeight: 600, marginBottom: 4 }}>
                ✗ Missing Skills ({parsed.missingKeywords.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {parsed.missingKeywords.slice(0, 8).map(kw => (
                  <span key={kw} style={{
                    background: '#45475a', color: '#f38ba8',
                    fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  }}>{kw}</span>
                ))}
                {parsed.missingKeywords.length > 8 && (
                  <span style={{ fontSize: 10, color: '#585b70' }}>+{parsed.missingKeywords.length - 8} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  )
}

function JobCard({ job, onStatusChange, onOptimize }) {
  return (
    <div style={{
      background: '#1e1e2e',
      border: '1px solid #313244',
      borderLeft: `4px solid ${STATUS_COLORS[job.status] || '#45475a'}`,
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
              style={{ color: '#89b4fa', fontWeight: 600, fontSize: 15, textDecoration: 'none' }}
            >{job.title}</a>
            {job.relevance_score != null && <ScoreBar score={job.relevance_score} />}
            {job.hired_score != null && (
              <ScoreTooltip details={job.hired_score_details} score={job.hired_score}>
                <span style={{
                  background: job.hired_score >= 70 ? '#1e4620' : job.hired_score >= 40 ? '#3b2c00' : '#45475a',
                  color: job.hired_score >= 70 ? '#a6e3a1' : job.hired_score >= 40 ? '#f9e2af' : '#6c7086',
                  fontSize: 11, fontWeight: 700,
                  padding: '2px 8px', borderRadius: 99,
                  whiteSpace: 'nowrap',
                }}>🎯 {job.hired_score}%</span>
              </ScoreTooltip>
            )}
          </div>
          <div style={{ color: '#a6adc8', fontSize: 13, marginTop: 2 }}>{job.company}</div>
        </div>
        <div style={{ fontSize: 11, color: '#6c7086', whiteSpace: 'nowrap' }}>{timeAgo(job.posted_at || job.first_seen_at)}</div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <SourceBadge source={job.ats_source} />
        <TypeBadge type={job.job_type} />
        <EasyApplyBadge source={job.ats_source} />
        <OptFriendlyBadge optFriendly={job.opt_friendly} />
        <VisaBadge signal={job.visa_signal} />
        {job.remote ? (
          <span style={{ background: '#003344', color: '#89dceb', fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 600 }}>Remote</span>
        ) : null}
        {job.location ? (
          <span style={{ color: '#6c7086', fontSize: 11 }}>📍 {job.location}</span>
        ) : null}
      </div>

      {job.description_snippet ? (
        <p style={{ color: '#7f849c', fontSize: 12, margin: 0, lineHeight: 1.5 }}>
          {job.description_snippet.slice(0, 200)}{job.description_snippet.length > 200 ? '…' : ''}
        </p>
      ) : null}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {STATUS_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => onStatusChange(job.id, s)}
            style={{
              background: job.status === s ? STATUS_COLORS[s] : '#313244',
              color: job.status === s ? '#fff' : '#6c7086',
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
          onClick={() => onOptimize(job)}
          style={{
            marginLeft: 'auto',
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
      </div>
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

  useEffect(() => {
    setKeywords(prefs.keywords?.join(', ') || '')
    setAllowlist(prefs.company_allowlist?.join(', ') || '')
    setBlocklist(prefs.company_blocklist?.join(', ') || '')
  }, [prefs])

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
    background: '#313244',
    border: '1px solid #45475a',
    borderRadius: 6,
    padding: '8px 12px',
    color: '#cdd6f4',
    fontSize: 13,
    boxSizing: 'border-box',
  }

  return (
    <div style={{
      background: '#1e1e2e', border: '1px solid #313244',
      borderRadius: 10, padding: 20, maxWidth: 600,
    }}>
      <h3 style={{ color: '#cdd6f4', margin: '0 0 16px', fontSize: 16 }}>⚙️ Personalization Preferences</h3>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: '#a6adc8', marginBottom: 4, display: 'block' }}>
          Tech Stack Keywords <span style={{ color: '#6c7086' }}>(comma-separated)</span>
        </label>
        <input
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
          placeholder="React, Python, AWS, Docker, TypeScript..."
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: '#a6adc8', marginBottom: 4, display: 'block' }}>
          Favorite Companies <span style={{ color: '#6c7086' }}>(comma-separated)</span>
        </label>
        <input
          value={allowlist}
          onChange={e => setAllowlist(e.target.value)}
          placeholder="Google, Meta, Stripe, Figma..."
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: '#a6adc8', marginBottom: 4, display: 'block' }}>
          Blocked Companies <span style={{ color: '#6c7086' }}>(comma-separated)</span>
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
        {msg && <span style={{ fontSize: 12, color: '#a6e3a1' }}>{msg}</span>}
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
        background: enabled ? '#1e4620' : '#313244',
        color: enabled ? '#a6e3a1' : '#6c7086',
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

// ── Tab Components ─────────────────────────────────────────────────────────
function TabBar({ tab, setTab, followUpCount }) {
  const tabs = [
    { id: 'digest', label: '📬 Digest' },
    { id: 'all', label: '📋 All Jobs' },
    { id: 'saved', label: '💜 Saved' },
    { id: 'applied', label: '✅ Applied' },
    { id: 'followup', label: followUpCount > 0 ? `⏰ Follow-up (${followUpCount})` : '⏰ Follow-up' },
    { id: 'history', label: '📁 History' },
    { id: 'prefs', label: '⚙️ Settings' },
  ]
  return (
    <div style={{
      display: 'flex', gap: 4, background: '#181825',
      borderBottom: '1px solid #313244', padding: '0 24px',
    }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          style={{
            background: tab === t.id ? '#1e1e2e' : 'transparent',
            color: tab === t.id ? '#89b4fa' : '#6c7086',
            border: 'none',
            borderBottom: tab === t.id ? '2px solid #89b4fa' : '2px solid transparent',
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
function FollowUpView({ onStatusChange, onOptimize }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(5)

  async function load(d) {
    setLoading(true)
    const res = await fetch(`${API}/api/follow-up?days=${d}`)
    const data = await res.json()
    setJobs(data.jobs || [])
    setLoading(false)
  }

  useEffect(() => { load(days) }, [days])

  function handleStatusChange(id, status) {
    onStatusChange(id, status)
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status } : j).filter(j => j.status === 'applied'))
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ color: '#cdd6f4', margin: 0, fontSize: 18 }}>Follow-up Needed</h2>
        {jobs.length > 0 && (
          <span style={{ background: '#3b2c00', color: '#f9e2af', fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 99 }}>
            {jobs.length} waiting
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span style={{ fontSize: 12, color: '#6c7086' }}>No response after</span>
          {[3, 5, 7].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              background: days === d ? '#df8e1d' : '#313244',
              color: days === d ? '#fff' : '#6c7086',
              border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: days === d ? 700 : 400,
            }}>{d}d</button>
          ))}
        </div>
      </div>
      <p style={{ color: '#6c7086', fontSize: 12, margin: '0 0 16px' }}>
        Jobs you applied to {days}+ days ago with no response. Mark as <strong style={{ color: '#df8e1d' }}>followed up</strong> after sending a follow-up message.
      </p>
      {loading ? (
        <div style={{ color: '#6c7086', padding: 40, textAlign: 'center' }}>Loading...</div>
      ) : jobs.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#45475a', padding: 60, fontSize: 15 }}>
          No applications waiting for follow-up.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {jobs.map(job => (
            <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} onOptimize={onOptimize} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── History View ───────────────────────────────────────────────────────────
const STATUS_META = {
  followed_up: { label: 'Followed Up', color: '#df8e1d', bg: '#3b2c00' },
  response:    { label: 'Got Response', color: '#40a02b', bg: '#1c2e1c' },
  rejected:    { label: 'Rejected',     color: '#f38ba8', bg: '#3b1c1c' },
}

function HistoryView({ onStatusChange, onOptimize }) {
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

  useEffect(() => { load() }, [])

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
        <h2 style={{ color: '#cdd6f4', margin: 0, fontSize: 18 }}>Application History</h2>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: `All (${jobs.length})` },
            { id: 'followed_up', label: `Followed Up (${counts.followed_up || 0})` },
            { id: 'response',    label: `Response (${counts.response || 0})` },
            { id: 'rejected',    label: `Rejected (${counts.rejected || 0})` },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              background: filter === f.id ? '#313244' : 'transparent',
              color: filter === f.id ? '#cdd6f4' : '#6c7086',
              border: '1px solid #313244', borderRadius: 6,
              padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: filter === f.id ? 700 : 400,
            }}>{f.label}</button>
          ))}
        </div>
      </div>
      {loading ? (
        <div style={{ color: '#6c7086', padding: 40, textAlign: 'center' }}>Loading...</div>
      ) : sorted.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#45475a', padding: 60, fontSize: 15 }}>
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
                <JobCard job={job} onStatusChange={handleStatusChange} onOptimize={onOptimize} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Digest View ────────────────────────────────────────────────────────────
function DigestView({ onStatusChange, onOptimize }) {
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

  if (loading) return <div style={{ color: '#6c7086', padding: 40, textAlign: 'center' }}>Loading digest...</div>

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ color: '#cdd6f4', margin: 0, fontSize: 18 }}>Today's Digest</h2>
        <span style={{
          background: '#1e4620', color: '#a6e3a1',
          fontSize: 12, fontWeight: 700,
          padding: '3px 10px', borderRadius: 99,
        }}>{total} jobs in last 24h</span>
      </div>
      <p style={{ color: '#6c7086', fontSize: 12, margin: '0 0 16px' }}>
        Top jobs ranked by your preferences. Update settings to improve results.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {jobs.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#45475a', padding: 40 }}>
            No jobs in the last 24h. Run a collection first!
          </div>
        ) : jobs.map(job => (
          <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} onOptimize={onOptimize} />
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
    width: '100%', background: '#313244', border: '1px solid #45475a',
    borderRadius: 6, padding: '8px 12px', color: '#cdd6f4', fontSize: 13, boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: '#1e1e2e', border: '1px solid #313244', borderRadius: 12,
        padding: 28, width: 460, maxWidth: '95vw',
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: '#cdd6f4', margin: '0 0 20px', fontSize: 17 }}>➕ Add Job Manually</h3>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { key: 'title', label: 'Job Title *', placeholder: 'Software Engineer' },
            { key: 'company', label: 'Company *', placeholder: 'Acme Inc.' },
            { key: 'apply_url', label: 'Application URL', placeholder: 'https://...' },
            { key: 'location', label: 'Location', placeholder: 'Austin, TX / Remote' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label style={{ fontSize: 12, color: '#a6adc8', marginBottom: 4, display: 'block' }}>{label}</label>
              <input
                value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                style={inputStyle}
              />
            </div>
          ))}
          <div>
            <label style={{ fontSize: 12, color: '#a6adc8', marginBottom: 4, display: 'block' }}>Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any notes about this application..."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          {err && <div style={{ color: '#f38ba8', fontSize: 12 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={{
              background: '#313244', color: '#cdd6f4', border: 'none',
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
  const [resumeInfo, setResumeInfo] = useState(null) // { filename, uploadedAt }
  const [scoring, setScoring] = useState(false)
  const [scoreMsg, setScoreMsg] = useState('')
  const [followUpCount, setFollowUpCount] = useState(0)
  const [showAddJob, setShowAddJob] = useState(false)
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

  const statusFilterForTab = tab === 'saved' ? 'saved' : tab === 'applied' ? 'applied' : filters.status

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

  const fetchResume = useCallback(async () => {
    const res = await fetch(`${API}/api/resume`)
    const data = await res.json()
    if (data.uploaded) setResumeInfo({ filename: data.filename, uploadedAt: data.uploadedAt })
  }, [])

  useEffect(() => {
    fetchPrefs()
    fetchResume()
    fetchFollowUpCount()
  }, [fetchPrefs, fetchResume, fetchFollowUpCount])

  useEffect(() => {
    if (tab === 'digest' || tab === 'prefs' || tab === 'followup' || tab === 'history') return
    const statusOverride = tab === 'saved' ? 'saved' : tab === 'applied' ? 'applied' : undefined
    fetchJobs(filters, offset, statusOverride)
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
        // Auto visa-scan new jobs after collection
        fetch(`${API}/api/visa-scan`, { method: 'POST' }).catch(() => {})
      }
    }, 3000)
    return () => clearInterval(iv)
  }, [collecting, tab, filters, offset, fetchJobs, fetchStats, fetchFollowUpCount])

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
    <div style={{ minHeight: '100vh', background: '#11111b', color: '#cdd6f4', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#181825', borderBottom: '1px solid #313244',
        padding: '12px 24px',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#89b4fa' }}>🎯 Job Tracker</div>
        <div style={{ flex: 1 }} />
        {/* Global Resume Upload */}
        <label style={{
          background: resumeInfo ? '#1e4620' : '#313244',
          color: resumeInfo ? '#a6e3a1' : '#cdd6f4',
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
              background: scoring ? '#313244' : '#8839ef',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              cursor: scoring ? 'not-allowed' : 'pointer',
            }}
          >{scoring ? 'Scoring...' : '🎯 Score All'}</button>
        )}
        {scoreMsg && <span style={{ fontSize: 11, color: '#a6e3a1' }}>{scoreMsg}</span>}
        <PushToggle />
        {lastRun && (
          <div style={{ fontSize: 12, color: '#6c7086' }}>
            Last run: {timeAgo(lastRun.finished_at)} · {lastRun.jobs_new} new
          </div>
        )}
        {stats && (
          <div style={{
            background: '#1e4620', color: '#a6e3a1',
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
            background: collecting ? '#313244' : '#1e66f5',
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
      <TabBar tab={tab} setTab={(t) => { setTab(t); setOffset(0) }} followUpCount={followUpCount} />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px' }}>

        {/* Digest Tab */}
        {tab === 'digest' && (
          <DigestView onStatusChange={handleStatusChange} onOptimize={setOptimizeJob} />
        )}

        {/* Follow-up Tab */}
        {tab === 'followup' && (
          <FollowUpView onStatusChange={handleStatusChange} onOptimize={setOptimizeJob} />
        )}

        {/* History Tab */}
        {tab === 'history' && (
          <HistoryView onStatusChange={handleStatusChange} onOptimize={setOptimizeJob} />
        )}

        {/* Settings Tab */}
        {tab === 'prefs' && (
          <div>
            <h2 style={{ color: '#cdd6f4', margin: '0 0 16px', fontSize: 18 }}>Settings</h2>
            <PreferencesPanel prefs={prefs} onSave={(updated) => setPrefs(updated)} />
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
              </div>
            )}

            {/* Filter Bar (hidden on Saved/Applied since status is locked) */}
            <div style={{
              display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
              background: '#1e1e2e', border: '1px solid #313244',
              borderRadius: 10, padding: '10px 14px', marginBottom: 16,
            }}>
              <input
                placeholder="Search title, company..."
                value={filters.search}
                onChange={e => setFilter('search', e.target.value)}
                style={{
                  flex: '2 1 200px', background: '#313244', border: 'none', borderRadius: 6,
                  padding: '6px 12px', color: '#cdd6f4', fontSize: 13,
                }}
              />
              {tab === 'all' && (
                <select
                  value={filters.status}
                  onChange={e => setFilter('status', e.target.value)}
                  style={{
                    flex: '1 1 110px', background: '#313244', border: 'none', borderRadius: 6,
                    padding: '6px 10px', color: '#cdd6f4', fontSize: 13,
                  }}
                >
                  {['', 'new', 'saved', 'queued', 'applied', 'followed_up', 'response', 'rejected', 'archived'].map(o => (
                    <option key={o} value={o}>{o === '' ? 'All Statuses' : STATUS_LABELS[o] || o}</option>
                  ))}
                </select>
              )}
              {[
                { key: 'ats_source', label: 'Source', options: ['', 'greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'workable', 'simplifyjobs'] },
                { key: 'job_type', label: 'Type', options: ['', 'fulltime', 'internship', 'coop'] },
                { key: 'remote', label: 'Remote', options: ['', 'true', 'false'] },
                { key: 'hours', label: 'Posted', options: ['', '6', '24', '48'] },
              ].map(({ key, label, options }) => (
                <select
                  key={key}
                  value={filters[key]}
                  onChange={e => setFilter(key, e.target.value)}
                  style={{
                    flex: '1 1 110px', background: '#313244', border: 'none', borderRadius: 6,
                    padding: '6px 10px', color: '#cdd6f4', fontSize: 13,
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
                  background: filters.entry_only === 'true' ? '#1e4620' : '#313244',
                  color: filters.entry_only === 'true' ? '#a6e3a1' : '#6c7086',
                  border: filters.entry_only === 'true' ? '1px solid #40a02b' : '1px solid #45475a',
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
                  flex: '1 1 140px', background: '#313244', border: 'none', borderRadius: 6,
                  padding: '6px 10px', color: '#cdd6f4', fontSize: 13,
                }}
              >
                <option value="">Sort: Newest</option>
                <option value="hired_score_desc">🎯 Hired Score ↓</option>
                <option value="hired_score_asc">🎯 Hired Score ↑</option>
              </select>
              <button
                onClick={clearFilters}
                style={{
                  background: '#313244', color: '#a6adc8', border: 'none',
                  borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12,
                }}
              >Clear</button>
            </div>

            {/* Add Manually button — Applied tab only */}
            {tab === 'applied' && (
              <div style={{ marginBottom: 12 }}>
                <button
                  onClick={() => setShowAddJob(true)}
                  style={{
                    background: '#1e4620', color: '#a6e3a1', border: '1px solid #40a02b',
                    borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >➕ Add Job Manually</button>
              </div>
            )}

            {/* Results count + pagination */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: '#6c7086' }}>
                {total} job{total !== 1 ? 's' : ''} found
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  disabled={offset === 0}
                  style={{
                    background: '#313244', color: offset === 0 ? '#45475a' : '#cdd6f4',
                    border: 'none', borderRadius: 6, padding: '5px 12px',
                    cursor: offset === 0 ? 'default' : 'pointer', fontSize: 12,
                  }}
                >← Prev</button>
                <span style={{ fontSize: 12, color: '#6c7086', alignSelf: 'center' }}>
                  {Math.floor(offset / LIMIT) + 1} / {Math.max(1, Math.ceil(total / LIMIT))}
                </span>
                <button
                  onClick={() => setOffset(offset + LIMIT)}
                  disabled={offset + LIMIT >= total}
                  style={{
                    background: '#313244', color: offset + LIMIT >= total ? '#45475a' : '#cdd6f4',
                    border: 'none', borderRadius: 6, padding: '5px 12px',
                    cursor: offset + LIMIT >= total ? 'default' : 'pointer', fontSize: 12,
                  }}
                >Next →</button>
              </div>
            </div>

            {/* Job List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {jobs.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#45475a', padding: '60px 0', fontSize: 15 }}>
                  {tab === 'saved' ? 'No saved jobs yet. Mark jobs as saved to see them here.' :
                   tab === 'applied' ? 'No applied jobs yet. Track your applications here.' :
                   'No jobs found. Click "Collect Now" to start fetching jobs.'}
                </div>
              ) : jobs.map(job => (
                <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} onOptimize={setOptimizeJob} />
              ))}
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ textAlign: 'center', color: '#313244', fontSize: 11, padding: '40px 0 20px' }}>
          Job Tracker · Auto-refreshes every 6h · {stats ? `${(bs.new || 0) + (bs.saved || 0) + (bs.applied || 0)}` : '0'} total jobs tracked
        </div>
      </div>

      {/* Resume Optimizer Modal */}
      {optimizeJob && (
        <ResumeOptimizer job={optimizeJob} onClose={() => setOptimizeJob(null)} />
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

import { useState, useEffect, useCallback } from 'react'

const API = ''  // proxied via vite

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

const STATUS_OPTIONS = ['new', 'saved', 'applied', 'rejected', 'archived']
const STATUS_COLORS = {
  new: '#1e66f5',
  saved: '#8839ef',
  applied: '#40a02b',
  rejected: '#d20f39',
  archived: '#45475a',
}

function JobCard({ job, onStatusChange }) {
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
        <div>
          <a
            href={job.apply_url}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#89b4fa', fontWeight: 600, fontSize: 15, textDecoration: 'none' }}
          >{job.title}</a>
          <div style={{ color: '#a6adc8', fontSize: 13, marginTop: 2 }}>{job.company}</div>
        </div>
        <div style={{ fontSize: 11, color: '#6c7086', whiteSpace: 'nowrap' }}>{timeAgo(job.first_seen_at)}</div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <SourceBadge source={job.ats_source} />
        <TypeBadge type={job.job_type} />
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
          >{s}</button>
        ))}
        <a
          href={job.apply_url}
          target="_blank"
          rel="noreferrer"
          style={{
            marginLeft: 'auto',
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

// ── Main App ───────────────────────────────────────────────────────────────
const LIMIT = 30

export default function App() {
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState(null)
  const [lastRun, setLastRun] = useState(null)
  const [collecting, setCollecting] = useState(false)
  const [offset, setOffset] = useState(0)
  const [filters, setFilters] = useState({
    status: '',
    ats_source: '',
    job_type: '',
    remote: '',
    search: '',
    hours: '24',
  })

  const fetchJobs = useCallback(async (currentFilters, currentOffset) => {
    const params = new URLSearchParams()
    Object.entries(currentFilters).forEach(([k, v]) => { if (v !== '') params.set(k, v) })
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

  useEffect(() => {
    fetchJobs(filters, offset)
    fetchStats()
  }, [filters, offset, fetchJobs, fetchStats])

  // Poll collection status
  useEffect(() => {
    if (!collecting) return
    const iv = setInterval(async () => {
      const res = await fetch(`${API}/api/collect/status`)
      const data = await res.json()
      if (!data.running) {
        setCollecting(false)
        fetchJobs(filters, offset)
        fetchStats()
      }
    }, 3000)
    return () => clearInterval(iv)
  }, [collecting, filters, offset, fetchJobs, fetchStats])

  async function handleCollect() {
    setCollecting(true)
    await fetch(`${API}/api/collect?hours=48`, { method: 'POST' })
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
    setFilters({ status: '', ats_source: '', job_type: '', remote: '', search: '', hours: '24' })
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
        <div style={{ fontSize: 20, fontWeight: 700, color: '#89b4fa' }}>Job Tracker</div>
        <div style={{ flex: 1 }} />
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
          {collecting ? 'Collecting...' : 'Collect Now'}
        </button>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px' }}>
        {/* Stats Row */}
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
        </div>

        {/* Filter Bar */}
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
          {[
            { key: 'status', label: 'Status', options: ['', 'new', 'saved', 'applied', 'rejected', 'archived'] },
            { key: 'ats_source', label: 'Source', options: ['', 'greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'workable'] },
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
            onClick={clearFilters}
            style={{
              background: '#313244', color: '#a6adc8', border: 'none',
              borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12,
            }}
          >Clear</button>
        </div>

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
            >Prev</button>
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
            >Next</button>
          </div>
        </div>

        {/* Job List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {jobs.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#45475a', padding: '60px 0', fontSize: 15 }}>
              No jobs found. Click "Collect Now" to start fetching jobs.
            </div>
          ) : jobs.map(job => (
            <JobCard key={job.id} job={job} onStatusChange={handleStatusChange} />
          ))}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', color: '#313244', fontSize: 11, padding: '40px 0 20px' }}>
          Job Tracker · Auto-refreshes every 6h · {total} total jobs tracked
        </div>
      </div>
    </div>
  )
}

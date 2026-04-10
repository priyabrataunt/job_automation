import { useState, useEffect, useRef } from 'react'

const API = ''

// ── Score Gauge ──────────────────────────────────────────────────────────────
function ScoreGauge({ score, label, title }) {
  const color = score >= 80 ? '#40a02b' : score >= 60 ? '#df8e1d' : score >= 40 ? '#e64553' : '#d20f39'
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (score / 100) * circumference

  return (
    <div style={{ textAlign: 'center', flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>{title}</div>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--bg-surface-alt)" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={radius} fill="none"
          stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={dashOffset}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
        <text x="50" y="46" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontWeight="700">
          {score}
        </text>
        <text x="50" y="62" textAnchor="middle" fill={color} fontSize="10" fontWeight="600">
          {label}
        </text>
      </svg>
    </div>
  )
}

// ── Keyword Pills ────────────────────────────────────────────────────────────
function KeywordPills({ matched, missing }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Matched Keywords</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {matched.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-empty)' }}>None</span>}
          {matched.map(k => (
            <span key={k} style={{
              background: 'var(--bg-green)', color: 'var(--fg-green)',
              fontSize: 10, padding: '2px 8px', borderRadius: 99, fontWeight: 600,
            }}>{k}</span>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Missing Keywords</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {missing.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-empty)' }}>None</span>}
          {missing.map(k => (
            <span key={k} style={{
              background: 'var(--bg-red)', color: 'var(--fg-red)',
              fontSize: 10, padding: '2px 8px', borderRadius: 99, fontWeight: 600,
            }}>{k}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Resume Upload ────────────────────────────────────────────────────────────
function ResumeUpload({ onUploaded, currentFile }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${API}/api/resume/upload`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      onUploaded(data.filename)
    } catch (err) {
      setError(err.message)
    }
    setUploading(false)
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '2px dashed var(--border-subtle)', borderRadius: 10,
      padding: '20px 24px', textAlign: 'center',
    }}>
      {currentFile ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <span style={{ color: 'var(--fg-green)', fontSize: 13, fontWeight: 600 }}>
            Resume uploaded: {currentFile}
          </span>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: 'none', borderRadius: 6,
              padding: '6px 14px', fontSize: 12, cursor: 'pointer',
            }}
          >{uploading ? 'Uploading...' : 'Replace'}</button>
        </div>
      ) : (
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 10 }}>
            Upload your resume (PDF or TXT) to get started
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              background: '#1e66f5', color: '#fff', border: 'none', borderRadius: 8,
              padding: '10px 24px', fontWeight: 600, cursor: 'pointer', fontSize: 14,
            }}
          >{uploading ? 'Uploading...' : 'Upload Resume'}</button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.txt"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />
      {error && <div style={{ color: 'var(--fg-red)', fontSize: 12, marginTop: 8 }}>{error}</div>}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function ResumeOptimizer({ job, onClose }) {
  const [resumeFile, setResumeFile] = useState(null)
  const [result, setResult] = useState(null)
  const [scoring, setScoring] = useState(false)
  const [error, setError] = useState('')
  const [loadingResume, setLoadingResume] = useState(true)
  const [coverLetter, setCoverLetter] = useState('')
  const [generatingCL, setGeneratingCL] = useState(false)
  const [clError, setClError] = useState('')
  const [clCopied, setClCopied] = useState(false)

  // Check if resume already uploaded
  useEffect(() => {
    async function check() {
      try {
        const res = await fetch(`${API}/api/resume`)
        const data = await res.json()
        if (data.uploaded) setResumeFile(data.filename)
      } catch { /* ignore */ }
      setLoadingResume(false)
    }
    check()
  }, [])

  async function handleGenerateCoverLetter() {
    setGeneratingCL(true)
    setClError('')
    setCoverLetter('')
    setClCopied(false)
    try {
      const res = await fetch(`${API}/api/cover-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      setCoverLetter(data.coverLetter)
    } catch (err) {
      setClError(err.message)
    }
    setGeneratingCL(false)
  }

  async function handleScore() {
    setScoring(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch(`${API}/api/resume/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scoring failed')
      setResult(data)
    } catch (err) {
      setError(err.message)
    }
    setScoring(false)
  }

  if (loadingResume) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center',
      overflowY: 'auto', padding: '20px 0',
    }}>
      <div style={{
        background: 'var(--bg-base)', borderRadius: 14, width: '100%', maxWidth: 720,
        margin: 'auto', padding: 0, maxHeight: '95vh', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div>
            <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 18 }}>ATS Compatibility Score</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {job.title} at {job.company}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-surface-alt)', color: 'var(--text-primary)', border: 'none', borderRadius: 8,
              padding: '6px 14px', cursor: 'pointer', fontSize: 16, fontWeight: 700,
            }}
          >X</button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Upload */}
          <ResumeUpload
            currentFile={resumeFile}
            onUploaded={(name) => { setResumeFile(name); setResult(null) }}
          />

          {/* Score button */}
          {resumeFile && (
            <button
              onClick={handleScore}
              disabled={scoring}
              style={{
                background: scoring ? 'var(--bg-surface-alt)' : '#1e66f5', color: '#fff',
                border: 'none', borderRadius: 10, padding: '12px 0',
                fontWeight: 700, fontSize: 15, cursor: scoring ? 'not-allowed' : 'pointer',
                width: '100%',
              }}
            >{scoring ? 'Scoring...' : 'Check ATS Score for This Job'}</button>
          )}

          {error && (
            <div style={{ background: 'var(--bg-red)', color: 'var(--fg-red)', padding: '10px 16px', borderRadius: 8, fontSize: 13 }}>
              {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <>
              {/* Visa warning banner */}
              {result.visaSignal?.score === 0 && (
                <div style={{
                  background: 'var(--bg-red)', color: 'var(--fg-red)', padding: '10px 16px',
                  borderRadius: 8, fontSize: 13, fontWeight: 600,
                }}>
                  No Sponsor — This job likely does not sponsor visas. Applying may not be worth your time.
                </div>
              )}

              {/* Four metric gauges */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 16, background: 'var(--bg-surface)', borderRadius: 12, padding: '20px 16px',
              }}>
                <ScoreGauge score={result.skillsMatch.score} label={result.skillsMatch.label} title="Skills Match" />
                <ScoreGauge score={result.relevance.score} label={result.relevance.label} title="Relevance" />
                <ScoreGauge score={result.visaSignal.score} label={result.visaSignal.label} title="Visa Signal" />
                <ScoreGauge score={result.impact.score} label={result.impact.label} title="Impact" />
              </div>

              {/* Overall score badge */}
              <div style={{
                background: 'var(--bg-surface)', borderRadius: 10, padding: '16px 20px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
              }}>
                <span style={{
                  fontSize: 32, fontWeight: 800, color: 'var(--text-primary)',
                }}>{result.overall}</span>
                <div>
                  <div style={{
                    fontSize: 14, fontWeight: 700,
                    color: result.overall >= 80 ? '#40a02b' : result.overall >= 60 ? '#df8e1d' : result.overall >= 40 ? '#e64553' : '#d20f39',
                  }}>{result.overallLabel}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Overall Score (out of 100)</div>
                </div>
              </div>

              {/* Metric details */}
              <div style={{
                background: 'var(--bg-surface-deep)', borderRadius: 10, padding: 16,
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                {[
                  { icon: '{}', label: 'Skills', detail: result.skillsMatch.details },
                  { icon: '~', label: 'Relevance', detail: result.relevance.details },
                  { icon: '!', label: 'Visa', detail: result.visaSignal.details },
                  { icon: '#', label: 'Impact', detail: result.impact.details },
                ].map(m => (
                  <div key={m.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{
                      background: 'var(--bg-surface-alt)', color: 'var(--text-link)', borderRadius: 4,
                      padding: '2px 6px', fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
                      flexShrink: 0,
                    }}>{m.icon}</span>
                    <div>
                      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>{m.label}: </span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{m.detail}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Keywords */}
              <div style={{ background: 'var(--bg-surface)', borderRadius: 10, padding: 16 }}>
                <KeywordPills matched={result.matchedKeywords} missing={result.missingKeywords} />
              </div>

              {/* External apply link */}
              <a
                href={job.apply_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'block', textAlign: 'center',
                  background: '#40a02b', color: '#fff', borderRadius: 10,
                  padding: '14px 0', fontWeight: 700, fontSize: 15, textDecoration: 'none',
                }}
              >Apply Now (External Link)</a>
            </>
          )}

          {/* ── Cover Letter Generator ── */}
          {resumeFile && (
            <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 15 }}>✉️ Cover Letter</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>Claude generates a personalized letter from your resume + this JD</div>
                </div>
                <button
                  onClick={handleGenerateCoverLetter}
                  disabled={generatingCL}
                  style={{
                    background: generatingCL ? 'var(--bg-surface-alt)' : '#8839ef',
                    color: '#fff', border: 'none', borderRadius: 8,
                    padding: '8px 18px', fontWeight: 600, fontSize: 13,
                    cursor: generatingCL ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                  }}
                >{generatingCL ? 'Generating...' : 'Generate'}</button>
              </div>

              {clError && (
                <div style={{ background: 'var(--bg-red)', color: 'var(--fg-red)', padding: '10px 14px', borderRadius: 8, fontSize: 12 }}>
                  {clError}
                </div>
              )}

              {coverLetter && (
                <>
                  <textarea
                    readOnly
                    value={coverLetter}
                    style={{
                      width: '100%', minHeight: 260, background: 'var(--bg-surface-deep)',
                      border: '1px solid var(--border-subtle)', borderRadius: 8,
                      color: 'var(--text-primary)', fontSize: 12, lineHeight: 1.7,
                      padding: '12px 14px', resize: 'vertical', boxSizing: 'border-box',
                      fontFamily: 'system-ui, sans-serif',
                    }}
                  />
                  <button
                    onClick={() => { navigator.clipboard.writeText(coverLetter); setClCopied(true); setTimeout(() => setClCopied(false), 2000) }}
                    style={{
                      alignSelf: 'flex-end',
                      background: clCopied ? 'var(--bg-green)' : 'var(--bg-surface-alt)',
                      color: clCopied ? 'var(--fg-green)' : 'var(--text-primary)',
                      border: 'none', borderRadius: 6,
                      padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >{clCopied ? '✓ Copied!' : 'Copy to Clipboard'}</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

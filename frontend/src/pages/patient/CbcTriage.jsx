import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ActivitySquare, ChevronRight, Upload, RotateCcw, TrendingDown,
  TrendingUp, Minus, TriangleAlert, CheckCircle2, Loader2,
  XCircle, Siren, FlaskConical, ShieldCheck,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { PatientChips } from '../../components/RoleChips.jsx'
import { Card, Button, Badge } from '../../components/ui.jsx'
import { cbcApi, configApi } from '../../lib/api.js'
import { fileToDataUrl, useSession } from '../../lib/session.js'

// ── Verdict metadata ────────────────────────────────────────────────
const VERDICT_META = {
  DISPATCH_NOW: {
    color: 'primary',
    icon: TrendingDown,
    title: 'Platelet counts are declining',
    panel: 'border-primary/30 bg-primary/10 text-primary',
    text: 'text-primary',
    dot: 'bg-primary',
  },
  HOLD_OFF: {
    color: 'success',
    icon: TrendingUp,
    title: 'Natural recovery detected',
    panel: 'border-success/30 bg-success/10 text-success',
    text: 'text-success',
    dot: 'bg-success',
  },
  INCONCLUSIVE: {
    color: 'warning',
    icon: Minus,
    title: 'Not enough data yet',
    panel: 'border-warning/30 bg-warning/10 text-warning',
    text: 'text-warning',
    dot: 'bg-warning',
  },
  INVALID_IMAGE: {
    color: 'primary',
    icon: XCircle,
    title: 'Invalid image — not a CBC report',
    panel: 'border-primary/30 bg-primary/10 text-primary',
    text: 'text-primary',
    dot: 'bg-primary',
  },
}

const TREND_ICON = {
  RISING: TrendingUp,
  STABLE: Minus,
  FALLING: TrendingDown,
  INSUFFICIENT_DATA: Minus,
}
const TREND_COLOR = {
  RISING: 'text-success',
  STABLE: 'text-text-muted',
  FALLING: 'text-primary',
  INSUFFICIENT_DATA: 'text-text-faint',
}

// ── Sparkline (inline SVG — no extra dependencies) ──────────────────
function Sparkline({ counts }) {
  if (!counts || counts.length < 2) return null
  const w = 260
  const h = 56
  const pad = 8
  const min = Math.min(...counts)
  const max = Math.max(...counts)
  const range = max - min || 1
  const pts = counts.map((v, i) => {
    const x = pad + (i / (counts.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / range) * (h - pad * 2)
    return `${x},${y}`
  })
  const polyline = pts.join(' ')
  const last = pts[pts.length - 1].split(',')
  const falling = counts[counts.length - 1] < counts[counts.length - 2]

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }}>
      <polyline
        points={polyline}
        fill="none"
        stroke={falling ? 'var(--color-primary, #e11d48)' : 'var(--color-success, #22c55e)'}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map((pt, i) => {
        const [x, y] = pt.split(',')
        return (
          <circle
            key={i}
            cx={x} cy={y} r="3"
            fill={falling ? 'var(--color-primary, #e11d48)' : 'var(--color-success, #22c55e)'}
          />
        )
      })}
      {/* Dot on latest value */}
      <circle cx={last[0]} cy={last[1]} r="5" fill="white" fillOpacity="0.9" />
    </svg>
  )
}

// ── Upload thumbnail strip ──────────────────────────────────────────
function ThumbStrip({ uploads, previews }) {
  if (!uploads.length) return null
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {uploads.map((u, i) => (
        <div
          key={u.image_hash}
          className="relative size-14 overflow-hidden rounded-lg border border-line"
          title={u.report_date || `Report ${i + 1}`}
        >
          {previews[i] && (
            <img src={previews[i]} alt={`Report ${i + 1}`} className="size-full object-cover" />
          )}
          <span
            className={`absolute bottom-0 inset-x-0 h-1 ${
              u.is_cbc_report === false ? 'bg-primary' :
              u.platelet_count != null ? 'bg-success' : 'bg-warning'
            }`}
          />
        </div>
      ))}
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────
export default function CbcTriage() {
  useSession({ require: true })

  const [cbcLive, setCbcLive] = useState(null)
  const [minReports, setMinReports] = useState(2)

  const [sessionId, setSessionId] = useState(null)
  const [uploads, setUploads] = useState([])
  const [verdict, setVerdict] = useState('INCONCLUSIVE')
  const [verdictReason, setVerdictReason] = useState('')
  const [lastUpload, setLastUpload] = useState(null)

  // per-upload state for the current pick
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // all data: URIs for the thumbnail strip (parallel array to uploads)
  const [previews, setPreviews] = useState([])

  const fileInput = useRef(null)

  // Load config + existing sessions on mount
  useEffect(() => {
    configApi.get().then((c) => {
      setCbcLive(c.integrations?.cbc ?? null)
      setMinReports(c.cbc_triage?.min_reports ?? 2)
    }).catch(() => {})

    cbcApi.listSessions().then((data) => {
      const sessions = data.sessions ?? []
      if (sessions.length > 0) {
        const latest = sessions[0]
        setSessionId(latest.id)
        setUploads(latest.uploads ?? [])
        setVerdict(latest.verdict ?? 'INCONCLUSIVE')
        setVerdictReason(latest.verdict_reason ?? '')
        // We can't recover the previews from the server (images aren't stored),
        // so we show a placeholder colour bar instead.
        setPreviews(Array(latest.uploads?.length ?? 0).fill(null))
      }
    }).catch(() => {})
  }, [])

  async function pickFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setError(null)
    setLastUpload(null)
    try {
      setPreview(await fileToDataUrl(f))
    } catch (err) {
      setError(err.message)
    }
  }

  async function analyse() {
    if (!preview || busy) return
    setBusy(true)
    setError(null)
    setLastUpload(null)
    try {
      // Create a session on the first upload
      let sid = sessionId
      if (!sid) {
        const s = await cbcApi.createSession()
        sid = s.id
        setSessionId(sid)
      }

      const result = await cbcApi.upload(sid, preview, file?.type || 'image/jpeg')

      setUploads(result.uploads ?? [])
      setVerdict(result.verdict ?? 'INCONCLUSIVE')
      setVerdictReason(result.verdict_reason ?? '')
      setLastUpload(result.last_upload ?? null)
      setPreviews((prev) => [...prev, preview])

      // Clear the picker for the next report
      setFile(null)
      setPreview(null)
      if (fileInput.current) fileInput.current.value = ''
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function startFresh() {
    setSessionId(null)
    setUploads([])
    setVerdict('INCONCLUSIVE')
    setVerdictReason('')
    setLastUpload(null)
    setFile(null)
    setPreview(null)
    setPreviews([])
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const meta = VERDICT_META[verdict] ?? VERDICT_META.INCONCLUSIVE
  const VerdictIcon = meta.icon
  const validCounts = uploads
    .filter((u) => u.is_cbc_report && u.platelet_count != null)
    .map((u) => u.platelet_count)

  return (
    <Shell panel="FAMILY PORTAL" panelColor="primary" right={<PatientChips />}>
      {/* Breadcrumb */}
      <p className="flex items-center gap-1.5 text-xs text-text-faint">
        <Link to="/register/patient" className="hover:text-white">Emergency Request</Link>
        <ChevronRight className="size-3" />
        <span className="font-semibold text-primary">CBC Report Triage</span>
      </p>

      <h1 className="mt-4 text-2xl font-bold">CBC Report Triage</h1>
      <p className="mt-1 max-w-2xl text-sm text-text-faint">
        Upload successive CBC (Complete Blood Count) reports. Spondon tracks the platelet count
        trend across uploads and tells you whether to hold off on a dispatch request — preserving
        volunteer resources for patients whose counts are strictly collapsing.
      </p>

      {/* No OpenAI key banner */}
      {cbcLive === false && (
        <p className="mt-4 flex max-w-2xl items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-[11px] text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          No AI triage engine is configured on this deployment (<code>OPENAI_API_KEY</code> unset).
          Results will always be <strong>inconclusive</strong> — verdicts require OpenAI Vision.
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,400px)_1fr]">

        {/* ── Left — upload surface ─────────────────────────────────── */}
        <div className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10">
                <FlaskConical className="size-5 text-primary" />
              </span>
              <div>
                <h2 className="text-base font-bold">Upload CBC Report</h2>
                <p className="text-xs text-text-faint">JPG or PNG · one photo per reading</p>
              </div>
            </div>

            {/* Preview */}
            <div className="relative mt-5 aspect-[4/5] overflow-hidden rounded-xl border border-dashed border-line bg-[#0d111a]">
              {preview ? (
                <img src={preview} alt="CBC report" className="size-full object-contain" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <span className="grid size-14 place-items-center rounded-2xl bg-line/40">
                    <Upload className="size-6 text-text-faint" />
                  </span>
                  <p className="max-w-[220px] text-xs text-text-faint">
                    Choose a CBC lab report photo to analyse
                  </p>
                </div>
              )}

              {busy && (
                <div className="absolute inset-0 grid place-items-center bg-ink/70 backdrop-blur-[1px]">
                  <span className="flex items-center gap-2 text-xs font-semibold text-primary">
                    <ActivitySquare className="size-4 animate-pulse" />
                    Analysing report…
                  </span>
                </div>
              )}
            </div>

            {/* File picker */}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              onChange={pickFile}
              className="mt-4 w-full text-[11px] text-text-muted file:mr-3 file:rounded-full file:border-0 file:bg-primary/20 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-primary"
            />

            {/* Uploaded thumbs */}
            <ThumbStrip uploads={uploads} previews={previews} />

            {/* Actions */}
            <div className="mt-4 flex gap-2">
              <Button
                onClick={analyse}
                disabled={!preview || busy}
                className="flex-1"
              >
                {busy
                  ? <><Loader2 className="size-4 animate-spin" /> Analysing…</>
                  : <><ActivitySquare className="size-4" /> Analyse Report</>
                }
              </Button>
              {uploads.length > 0 && (
                <Button variant="ghost" onClick={startFresh} title="Start a new session">
                  <RotateCcw className="size-4" />
                </Button>
              )}
            </div>

            {error && (
              <p className="mt-3 flex items-start gap-2 text-[11px] text-primary">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {error}
              </p>
            )}
          </Card>

          {/* Privacy note */}
          <div className="flex items-start gap-3 rounded-xl border border-admin/20 bg-admin/[0.05] px-4 py-3 text-[11px] text-text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-admin" />
            <span>
              Report images are sent to the AI for reading only — platelet values and dates are
              stored, not the photographs themselves.
            </span>
          </div>
        </div>

        {/* ── Right — trend panel ───────────────────────────────────── */}
        <div className="space-y-4">
          <Card className="p-6">
            {/* Verdict header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Trend Analysis</h2>
                <p className="text-xs text-text-faint">
                  {uploads.length === 0
                    ? 'Upload your first CBC report to begin.'
                    : `${uploads.length} report${uploads.length !== 1 ? 's' : ''} uploaded · ${validCounts.length} readable`}
                </p>
              </div>
              <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${meta.panel}`}>
                <VerdictIcon className="size-3.5" />
                {verdict.replace('_', ' ')}
              </span>
            </div>

            {/* Verdict reason / recommendation */}
            {verdictReason && (
              <div className={`mt-5 flex items-start gap-3 rounded-xl border p-4 text-[12px] ${meta.panel}`}>
                <VerdictIcon className="mt-0.5 size-4 shrink-0" />
                <span>{verdictReason}</span>
              </div>
            )}

            {/* Invalid-image specific prominent warning */}
            {verdict === 'INVALID_IMAGE' && lastUpload && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 text-[12px] text-primary">
                <XCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  <strong>Not a CBC report.</strong>{' '}
                  {lastUpload.notes || 'The image does not appear to be a laboratory report.'}{' '}
                  Please upload a clear photograph of a Complete Blood Count (CBC) result sheet.
                </span>
              </div>
            )}

            {/* Sparkline */}
            {validCounts.length >= 2 && (
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Platelet Trend
                </p>
                <Sparkline counts={validCounts} />
              </div>
            )}

            {/* Readings table */}
            {uploads.length > 0 && (
              <div className="mt-5 overflow-hidden rounded-xl border border-line">
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-line/60 bg-surface/60">
                      <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">#</th>
                      <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Date</th>
                      <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Platelets (×10³/µL)</th>
                      <th className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploads.map((u, i) => {
                      const TIcon = TREND_ICON[u.trend_at_upload] ?? Minus
                      const tColor = TREND_COLOR[u.trend_at_upload] ?? 'text-text-faint'
                      return (
                        <tr key={u.image_hash} className="border-b border-line/60 last:border-0">
                          <td className="px-4 py-2.5 text-text-faint">{i + 1}</td>
                          <td className="px-4 py-2.5 text-text-muted">
                            {u.report_date ?? <span className="text-text-faint">—</span>}
                          </td>
                          <td className="px-4 py-2.5 font-semibold text-text-strong">
                            {u.is_cbc_report === false ? (
                              <span className="flex items-center gap-1 text-primary text-[11px]">
                                <XCircle className="size-3" /> invalid image
                              </span>
                            ) : u.platelet_count != null ? (
                              u.platelet_count.toLocaleString()
                            ) : (
                              <span className="text-text-faint">unreadable</span>
                            )}
                          </td>
                          <td className={`px-4 py-2.5 ${tColor}`}>
                            {u.is_cbc_report === false ? '—' : (
                              <span className="flex items-center gap-1">
                                <TIcon className="size-3.5" />
                                {u.trend_at_upload?.replace('_', ' ') ?? '—'}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Empty state */}
            {uploads.length === 0 && !busy && (
              <div className="mt-10 flex flex-col items-center py-12 text-center">
                <span className="grid size-14 place-items-center rounded-2xl bg-line/40">
                  <ActivitySquare className="size-6 text-text-faint" />
                </span>
                <p className="mt-4 text-sm font-semibold text-text-muted">No reports yet</p>
                <p className="mt-1 max-w-xs text-xs text-text-faint">
                  Upload at least {minReports} CBC reports for a trend verdict. The more readings
                  you add, the more accurate the analysis.
                </p>
              </div>
            )}

            {/* Not-enough-data hint */}
            {uploads.length > 0 && validCounts.length < minReports && verdict !== 'INVALID_IMAGE' && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-[12px] text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  Upload at least <strong>{minReports}</strong> readable CBC reports for a trend
                  verdict. So far {validCounts.length} readable reading{validCounts.length !== 1 ? 's have' : ' has'} been extracted.
                </span>
              </div>
            )}

            {/* CTA */}
            <div className="mt-6">
              {verdict === 'DISPATCH_NOW' ? (
                <Link to="/patient/ocr">
                  <Button className="w-full">
                    <Siren className="size-4" />
                    Proceed to Emergency Request
                  </Button>
                </Link>
              ) : (
                <Button className="w-full" disabled>
                  <CheckCircle2 className="size-4" />
                  {verdict === 'HOLD_OFF'
                    ? 'Hold off — recovery detected'
                    : 'Awaiting sufficient data'}
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </Shell>
  )
}

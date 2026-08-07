import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText, ChevronRight, Upload, ScanLine, RotateCcw, CheckCircle2,
  TriangleAlert, ShieldCheck, Siren, Loader2, XCircle, UserCheck,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { PatientChips } from '../../components/RoleChips.jsx'
import { Card, Button, Badge, Select } from '../../components/ui.jsx'
import { configApi, requestApi } from '../../lib/api.js'
import { fileToDataUrl, useSession } from '../../lib/session.js'

// Class strings are written out in full rather than interpolated, because
// Tailwind only generates classes it can see literally in the source.
const TONE = {
  success: { text: 'text-success', panel: 'border-success/30 bg-success/10 text-success' },
  warning: { text: 'text-warning', panel: 'border-warning/30 bg-warning/10 text-warning' },
  primary: { text: 'text-primary', panel: 'border-primary/30 bg-primary/10 text-primary' },
}

const STATUS_META = {
  OCR_CONFIRMED: {
    color: 'success', icon: CheckCircle2,
    title: 'Slip verified — dispatch authorised',
  },
  VERIFIED: {
    color: 'success', icon: UserCheck,
    title: 'Verified by an admin — dispatch authorised',
  },
  NEEDS_REVIEW: {
    color: 'warning', icon: TriangleAlert,
    title: 'Sent to human review',
  },
  PENDING: {
    color: 'warning', icon: ScanLine,
    title: 'No slip uploaded yet',
  },
  REJECTED: {
    color: 'primary', icon: XCircle,
    title: 'Not a valid requisition slip',
  },
}

const fieldMeta = [
  ['patient_name', 'Patient Name'],
  ['hospital', 'Hospital'],
  ['blood_type', 'Blood Type'],
  ['component', 'Component'],
  ['units', 'Units Needed'],
]

export default function DoctorSlipOcr() {
  useSession({ require: false })

  const [requests, setRequests] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [dispatchResult, setDispatchResult] = useState(null)
  const [error, setError] = useState(null)
  const [ocrLive, setOcrLive] = useState(null)
  const fileInput = useRef(null)

  const load = useCallback(async () => {
    try {
      const all = await requestApi.list()
      const open = all.filter((r) => r.status === 'OPEN')
      setRequests(open)
      setSelectedId((cur) => cur || open[0]?.id || '')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    load()
    configApi.get().then((c) => setOcrLive(c.integrations.ocr)).catch(() => {})
  }, [load])

  const selected = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  )

  async function pickFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setResult(null)
    setDispatchResult(null)
    setError(null)
    try {
      setPreview(await fileToDataUrl(f))
    } catch (err) {
      setError(err.message)
    }
  }

  async function scan() {
    if (!selected || !preview || busy) return
    setBusy(true)
    setError(null)
    setDispatchResult(null)
    try {
      const res = await requestApi.uploadSlip(selected.id, preview, file?.type || 'image/jpeg')
      setResult(res)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function dispatch() {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      setDispatchResult(await requestApi.dispatch(selected.id))
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setResult(null)
    setDispatchResult(null)
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  const status = result?.slip_status ?? selected?.slip_status ?? 'PENDING'
  const meta = STATUS_META[status] ?? STATUS_META.PENDING
  const tone = TONE[meta.color]
  const confidence = result?.ocr_confidence ?? selected?.ocr_confidence ?? null
  const authorised = status === 'OCR_CONFIRMED' || status === 'VERIFIED'

  return (
    <Shell panel="FAMILY PORTAL" panelColor="primary" right={<PatientChips />}>
      {/* Breadcrumb */}
      <p className="flex items-center gap-1.5 text-xs text-text-faint">
        <Link to="/register/patient" className="hover:text-white">Emergency Request</Link>
        <ChevronRight className="size-3" /> Requisition Slip{' '}
        <ChevronRight className="size-3" />{' '}
        <span className="font-semibold text-primary">OCR Verification</span>
      </p>

      <h1 className="mt-4 text-2xl font-bold">Doctor&apos;s Slip OCR</h1>
      <p className="mt-1 max-w-2xl text-sm text-text-faint">
        Upload the doctor&apos;s requisition slip. The OCR engine reads the blood requirement,
        cross-checks it against the request, and routes anything it cannot read confidently to a
        human reviewer — a genuine request is never auto-rejected. No donor is pinged until the
        slip is confirmed.
      </p>

      {ocrLive === false && (
        <p className="mt-4 flex max-w-2xl items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-[11px] text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          No OCR engine is configured on this deployment (<code>OPENAI_API_KEY</code> unset), so
          every slip is routed to the human review queue instead of being scored.
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* Left — upload / scan surface */}
        <div className="space-y-4">
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10">
                <FileText className="size-5 text-primary" />
              </span>
              <div>
                <h2 className="text-base font-bold">Requisition Slip</h2>
                <p className="text-xs text-text-faint">JPG or PNG · max 10 MB</p>
              </div>
            </div>

            <label className="mt-5 block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                Attach to request
              </span>
              <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {requests.length === 0 && <option value="">No open requests</option>}
                {requests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.patient_name} · {r.blood_type} · {r.hospital}
                  </option>
                ))}
              </Select>
            </label>

            {/* Slip preview */}
            <div className="relative mt-4 aspect-[4/5] overflow-hidden rounded-xl border border-dashed border-line bg-[#0d111a]">
              {preview ? (
                <img src={preview} alt="Requisition slip" className="size-full object-contain" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <span className="grid size-14 place-items-center rounded-2xl bg-line/40">
                    <Upload className="size-6 text-text-faint" />
                  </span>
                  <p className="max-w-[220px] text-xs text-text-faint">
                    Choose a photo of the doctor&apos;s slip to scan
                  </p>
                </div>
              )}

              {busy && (
                <div className="absolute inset-0 grid place-items-center bg-ink/70 backdrop-blur-[1px]">
                  <span className="flex items-center gap-2 text-xs font-semibold text-primary">
                    <ScanLine className="size-4 animate-pulse" /> Reading the slip…
                  </span>
                </div>
              )}

              {result && !busy && (
                <div className="absolute inset-x-0 bottom-0 bg-ink/80 p-3 backdrop-blur-[1px]">
                  <span
                    className={`flex items-center justify-center gap-2 text-xs font-semibold ${tone.text}`}
                  >
                    <meta.icon className="size-4" /> {meta.title}
                  </span>
                </div>
              )}
            </div>

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              onChange={pickFile}
              className="mt-4 w-full text-[11px] text-text-muted file:mr-3 file:rounded-full file:border-0 file:bg-primary/20 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-primary"
            />

            <div className="mt-4 flex gap-2">
              {result ? (
                <Button variant="ghost" onClick={reset} className="w-full">
                  <RotateCcw className="size-4" /> Scan another slip
                </Button>
              ) : (
                <Button onClick={scan} disabled={!preview || !selected || busy} className="w-full">
                  {busy ? (
                    <><Loader2 className="size-4 animate-spin" /> Scanning…</>
                  ) : (
                    <><Upload className="size-4" /> Upload &amp; Scan Slip</>
                  )}
                </Button>
              )}
            </div>

            {error && (
              <p className="mt-3 flex items-start gap-2 text-[11px] text-primary">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {error}
              </p>
            )}
          </Card>

          <div className="flex items-start gap-3 rounded-xl border border-admin/20 bg-admin/[0.05] px-4 py-3 text-[11px] text-text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-admin" />
            <span>
              The slip is stored against the request only until it is dispatched, and is visible
              to the reviewing admin.
            </span>
          </div>
        </div>

        {/* Right — extracted fields */}
        <div>
          <Card className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Extracted Fields</h2>
                <p className="text-xs text-text-faint">
                  What the engine read off the slip.
                </p>
              </div>
              {result && (
                <Badge color={meta.color} dot={false}>
                  {confidence != null
                    ? `${Math.round(confidence * 100)}% confidence`
                    : 'No confidence score'}
                </Badge>
              )}
            </div>

            {!result ? (
              <div className="mt-10 flex flex-col items-center py-12 text-center">
                <span className="grid size-14 place-items-center rounded-2xl bg-line/40">
                  <ScanLine className="size-6 text-text-faint" />
                </span>
                <p className="mt-4 text-sm font-semibold text-text-muted">No slip scanned yet</p>
                <p className="mt-1 max-w-xs text-xs text-text-faint">
                  Upload a requisition slip on the left and the parsed request details will appear
                  here.
                </p>
                {selected && (
                  <p className="mt-4 text-[11px] text-text-faint">
                    Current status for this request:{' '}
                    <span className={`font-semibold ${tone.text}`}>{status}</span>
                  </p>
                )}
              </div>
            ) : (
              <>
                <div
                  className={`mt-5 flex items-start gap-3 rounded-xl border p-4 text-[12px] ${tone.panel}`}
                >
                  <meta.icon className="mt-0.5 size-4 shrink-0" />
                  <span>{result.message}</span>
                </div>

                <div className="mt-5 overflow-hidden rounded-xl border border-line">
                  <table className="w-full text-left text-[12px]">
                    <tbody>
                      {fieldMeta.map(([key, label]) => (
                        <tr key={key} className="border-b border-line/60 last:border-0">
                          <td className="w-1/2 px-4 py-2.5 text-text-faint">{label}</td>
                          <td className="px-4 py-2.5 font-medium text-text-strong">
                            {result.extracted?.[key] ?? (
                              <span className="text-text-faint">not read</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {status === 'NEEDS_REVIEW' && (
                  <div className="mt-5 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-[12px] text-warning">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>
                      This slip is in the human review queue — an admin or volunteer will confirm
                      it, typically within a minute. Your request is not rejected; it simply is not
                      broadcast to donors until someone verifies the slip.
                    </span>
                  </div>
                )}

                <Button
                  className="mt-6 w-full"
                  onClick={dispatch}
                  disabled={!authorised || busy}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Siren className="size-4" />}
                  {authorised ? 'Confirm & Fire Emergency Ping' : 'Waiting on slip verification'}
                </Button>

                {dispatchResult && (
                  <div className="mt-4 space-y-1.5 rounded-lg border border-line bg-[#0d111a] p-4 text-[11px]">
                    <Row
                      label="Dispatch mode"
                      value={
                        dispatchResult.dispatch_mode === 'CITYWIDE_RARE'
                          ? 'City-wide (rare blood type)'
                          : `Expanding ripple · ${dispatchResult.radius_km} km`
                      }
                    />
                    <Row label="Donors reached" value={String(dispatchResult.reachable)} />
                    <Row label="Pinged" value={String(dispatchResult.pinged)} />
                    <Row label="Push delivery" value={dispatchResult.push_delivery} />
                    {dispatchResult.blocked_reason && (
                      <Row label="Blocked" value={dispatchResult.blocked_reason} />
                    )}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-text-faint">{label}</span>
      <span className="text-right text-text-muted">{value}</span>
    </div>
  )
}

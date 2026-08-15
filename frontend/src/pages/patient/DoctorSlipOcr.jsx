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
  useSession({ require: true })

  const [patientName, setPatientName] = useState('')
  const [hospital, setHospital] = useState('')
  const [bloodType, setBloodType] = useState('O+')
  const [component, setComponent] = useState('WHOLE_BLOOD')
  const [createdReqId, setCreatedReqId] = useState(null)

  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [dispatchResult, setDispatchResult] = useState(null)
  const [error, setError] = useState(null)
  const [ocrLive, setOcrLive] = useState(null)
  const [liveRequest, setLiveRequest] = useState(null)
  const fileInput = useRef(null)

  useEffect(() => {
    configApi.get().then((c) => setOcrLive(c.integrations.ocr)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selected) {
      setLiveRequest(null)
      return
    }
    setLiveRequest(selected)
    
    if (selected.status === 'OPEN' || selected.status === 'LOCKED') {
      const interval = setInterval(async () => {
        try {
          const req = await requestApi.get(selected.id)
          setLiveRequest(req)
          if (req.status !== 'OPEN') {
            clearInterval(interval)
          }
        } catch (e) {
          // ignore
        }
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [selected])

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
    if (!patientName || !hospital || !preview || busy) return
    setBusy(true)
    setError(null)
    setDispatchResult(null)
    try {
      const newReq = await requestApi.create({
        patient_name: patientName,
        blood_type: bloodType,
        component,
        hospital,
        units_needed: 1,
        status: 'OPEN',
      })
      setCreatedReqId(newReq.id)
      const res = await requestApi.uploadSlip(newReq.id, preview, file?.type || 'image/jpeg')
      setResult(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function dispatch() {
    if (!createdReqId || busy) return
    setBusy(true)
    setError(null)
    try {
      setDispatchResult(await requestApi.dispatch(createdReqId))
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
    setCreatedReqId(null)
    setPatientName('')
    setHospital('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const status = result?.slip_status ?? 'PENDING'
  const meta = STATUS_META[status] ?? STATUS_META.PENDING
  const tone = TONE[meta.color]
  const confidence = result?.ocr_confidence ?? null
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

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Patient Name
                </span>
                <input
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
                  placeholder="e.g. Farzana Islam"
                  disabled={!!createdReqId}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Hospital
                </span>
                <input
                  type="text"
                  value={hospital}
                  onChange={(e) => setHospital(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface/50 px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
                  placeholder="e.g. Square Hospital"
                  disabled={!!createdReqId}
                />
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    Blood Type
                  </span>
                  <Select value={bloodType} onChange={(e) => setBloodType(e.target.value)} disabled={!!createdReqId}>
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                    <option value="AB+">AB+</option>
                    <option value="AB-">AB-</option>
                  </Select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    Component
                  </span>
                  <Select value={component} onChange={(e) => setComponent(e.target.value)} disabled={!!createdReqId}>
                    <option value="WHOLE_BLOOD">Whole Blood</option>
                    <option value="PLATELETS">Platelets</option>
                    <option value="PLASMA">Plasma</option>
                  </Select>
                </label>
              </div>
            </div>

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
                <Button onClick={scan} disabled={!preview || !patientName || !hospital || busy || !!createdReqId} className="w-full">
                  {busy ? (
                    <><Loader2 className="size-4 animate-spin" /> Scanning…</>
                  ) : (
                    <><Upload className="size-4" /> Create Request &amp; Scan</>
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
                {createdReqId && (
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

                {dispatchResult && liveRequest?.status !== 'LOCKED' && (
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

                {/* Live Polling Status */}
                {(liveRequest?.status === 'OPEN' || liveRequest?.status === 'LOCKED') && (
                  <div className="min-h-[120px] rounded-lg border border-line bg-ink p-4 mt-6">
                    {liveRequest?.status === 'OPEN' && (
                      <div className="flex items-center gap-3 text-warning">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-warning"></span>
                        </span>
                        <p className="text-sm font-semibold">Broadcasting to donors... Waiting for acceptance.</p>
                      </div>
                    )}
                    {liveRequest?.status === 'LOCKED' && (
                      <div className="animate-in fade-in zoom-in duration-300">
                        <h4 className="text-sm font-bold text-success mb-3 flex items-center gap-2">
                          <span className="size-2 rounded-full bg-success" /> Donor Secured!
                        </h4>
                        <div className="rounded-lg border border-success/30 bg-success/10 p-4">
                          <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success/20 text-success">
                              <UserCheck className="size-6" />
                            </div>
                            <div>
                              <p className="font-bold text-white text-base">{liveRequest.secured_donor_name}</p>
                              <p className="text-sm text-success font-mono mt-1">{liveRequest.secured_donor_phone || 'Number hidden'}</p>
                            </div>
                          </div>
                        </div>
                      </div>
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

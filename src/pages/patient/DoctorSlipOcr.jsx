import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FileText,
  ChevronRight,
  Upload,
  ScanLine,
  RotateCcw,
  CheckCircle2,
  TriangleAlert,
  ShieldCheck,
  Siren,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { PatientChips } from '../../components/RoleChips.jsx'
import { Card, Button, Badge, Field, Input, Select } from '../../components/ui.jsx'

const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const components = ['Whole Blood', 'Platelets (Apheresis)', 'Plasma', 'Red Cells']

/* Simulated OCR extraction — what the engine "reads" off the requisition slip.
 * conf = confidence 0–1; anything under 0.85 is flagged for manual review. */
const extraction = {
  patient: { value: 'Mehedi Hassan', conf: 0.98 },
  hospital: { value: 'Dhaka Medical College', conf: 0.94 },
  doctor: { value: 'Dr. Farhana Rahman', conf: 0.91 },
  blood: { value: 'B+', conf: 0.97 },
  component: { value: 'Whole Blood', conf: 0.88 },
  units: { value: '2', conf: 0.72 }, // low → needs review
}

const fieldMeta = [
  { key: 'patient', label: 'Patient Name', type: 'text' },
  { key: 'hospital', label: 'Hospital', type: 'text' },
  { key: 'doctor', label: 'Prescribing Doctor', type: 'text' },
  { key: 'blood', label: 'Blood Type', type: 'blood' },
  { key: 'component', label: 'Component', type: 'component' },
  { key: 'units', label: 'Units Needed', type: 'text' },
]

function confBadge(conf) {
  const pct = Math.round(conf * 100)
  if (conf >= 0.9) return { color: 'success', text: 'text-success', label: `${pct}% match` }
  if (conf >= 0.85) return { color: 'warning', text: 'text-warning', label: `${pct}% match` }
  return { color: 'warning', text: 'text-warning', label: `${pct}% — review` }
}

export default function DoctorSlipOcr() {
  const [phase, setPhase] = useState('idle') // idle · scanning · review
  const [progress, setProgress] = useState(0)
  const [form, setForm] = useState(null)
  const timer = useRef(null)
  const navigate = useNavigate()

  const startScan = () => {
    if (phase === 'scanning') return
    setPhase('scanning')
    setProgress(0)
  }

  useEffect(() => {
    if (phase !== 'scanning') return
    timer.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          clearInterval(timer.current)
          setForm(
            Object.fromEntries(Object.entries(extraction).map(([k, v]) => [k, v.value])),
          )
          setPhase('review')
          return 100
        }
        return p + 4
      })
    }, 60)
    return () => clearInterval(timer.current)
  }, [phase])

  const reset = () => {
    clearInterval(timer.current)
    setPhase('idle')
    setProgress(0)
    setForm(null)
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const lowConf = Object.entries(extraction).filter(([, v]) => v.conf < 0.85).length

  return (
    <Shell panel="FAMILY PORTAL" panelColor="primary" right={<PatientChips />}>
      {/* Breadcrumb */}
      <p className="flex items-center gap-1.5 text-xs text-text-faint">
        <Link to="/register/patient" className="hover:text-white">
          Emergency Request
        </Link>
        <ChevronRight className="size-3" /> Requisition Slip{' '}
        <ChevronRight className="size-3" />{' '}
        <span className="font-semibold text-primary">OCR Verification</span>
      </p>

      <h1 className="mt-4 text-2xl font-bold">Doctor&apos;s Slip OCR</h1>
      <p className="mt-1 max-w-2xl text-sm text-text-faint">
        Upload the doctor&apos;s requisition slip. Our OCR engine reads the blood
        requirement, cross-checks it against the request, and flags any low-confidence
        field for a human to confirm before a single donor is pinged.
      </p>

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
                <p className="text-xs text-text-faint">JPG, PNG or PDF · max 10 MB</p>
              </div>
            </div>

            {/* Slip preview / scan window */}
            <div className="relative mt-5 aspect-[4/5] overflow-hidden rounded-xl border border-dashed border-line bg-[#0d111a]">
              {/* mock slip content */}
              <div className="space-y-3 p-6 opacity-80">
                <div className="h-3 w-2/5 rounded bg-line" />
                <div className="h-2 w-3/4 rounded bg-line/70" />
                <div className="mt-6 h-2 w-full rounded bg-line/60" />
                <div className="h-2 w-5/6 rounded bg-line/60" />
                <div className="h-2 w-2/3 rounded bg-line/60" />
                <div className="mt-6 h-8 w-1/2 rounded bg-primary/20" />
                <div className="h-2 w-4/5 rounded bg-line/60" />
                <div className="h-2 w-3/5 rounded bg-line/60" />
              </div>

              {/* scanning laser */}
              {phase === 'scanning' && (
                <div
                  className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-primary/30 to-transparent transition-all duration-75"
                  style={{ top: `${progress}%` }}
                >
                  <div className="h-px w-full bg-primary shadow-[0_0_12px_2px] shadow-primary" />
                </div>
              )}

              {phase === 'review' && (
                <div className="absolute inset-0 grid place-items-center bg-ink/60 backdrop-blur-[1px]">
                  <span className="flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-4 py-2 text-xs font-semibold text-success">
                    <CheckCircle2 className="size-4" /> Slip read successfully
                  </span>
                </div>
              )}
            </div>

            {phase === 'scanning' && (
              <div className="mt-4">
                <div className="h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-75"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-2 flex items-center gap-2 text-[11px] text-text-faint">
                  <ScanLine className="size-3.5 text-primary" /> Extracting text · {progress}%
                </p>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              {phase === 'review' ? (
                <Button variant="ghost" onClick={reset} className="w-full">
                  <RotateCcw className="size-4" /> Scan another slip
                </Button>
              ) : (
                <Button onClick={startScan} disabled={phase === 'scanning'} className="w-full">
                  {phase === 'scanning' ? (
                    <>
                      <ScanLine className="size-4 animate-pulse" /> Scanning…
                    </>
                  ) : (
                    <>
                      <Upload className="size-4" /> Upload &amp; Scan Slip
                    </>
                  )}
                </Button>
              )}
            </div>
          </Card>

          <div className="flex items-start gap-3 rounded-xl border border-admin/20 bg-admin/[0.05] px-4 py-3 text-[11px] text-text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-admin" />
            <span>
              Slips are processed on-device and never leave Bangladesh servers. Extracted
              text is retained only until the request is dispatched.
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
                  Confirm the reading, then fire the emergency ping.
                </p>
              </div>
              {phase === 'review' && (
                <Badge color={lowConf ? 'warning' : 'success'} dot={false}>
                  {lowConf ? `${lowConf} field needs review` : 'All fields verified'}
                </Badge>
              )}
            </div>

            {phase !== 'review' ? (
              <div className="mt-10 flex flex-col items-center py-12 text-center">
                <span className="grid size-14 place-items-center rounded-2xl bg-line/40">
                  <ScanLine className="size-6 text-text-faint" />
                </span>
                <p className="mt-4 text-sm font-semibold text-text-muted">
                  No slip scanned yet
                </p>
                <p className="mt-1 max-w-xs text-xs text-text-faint">
                  Upload a requisition slip on the left and the parsed blood-request
                  details will appear here for confirmation.
                </p>
              </div>
            ) : (
              <>
                <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {fieldMeta.map((f) => {
                    const b = confBadge(extraction[f.key].conf)
                    return (
                      <Field
                        key={f.key}
                        label={
                          <span className="flex items-center justify-between gap-2">
                            <span>{f.label}</span>
                          </span>
                        }
                      >
                        <div className="relative">
                          {f.type === 'blood' ? (
                            <Select value={form[f.key]} onChange={set(f.key)}>
                              {bloodTypes.map((b) => (
                                <option key={b} value={b}>{b}</option>
                              ))}
                            </Select>
                          ) : f.type === 'component' ? (
                            <Select value={form[f.key]} onChange={set(f.key)}>
                              {components.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </Select>
                          ) : (
                            <Input value={form[f.key]} onChange={set(f.key)} />
                          )}
                        </div>
                        <span className="mt-1.5 flex items-center gap-1.5 text-[10px] font-semibold">
                          {extraction[f.key].conf >= 0.85 ? (
                            <CheckCircle2 className={`size-3 ${b.text}`} />
                          ) : (
                            <TriangleAlert className={`size-3 ${b.text}`} />
                          )}
                          <span className={b.text}>{b.label}</span>
                        </span>
                      </Field>
                    )
                  })}
                </div>

                {lowConf > 0 && (
                  <div className="mt-5 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-[12px] text-warning">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>
                      <span className="font-bold">Units Needed</span> was read at low
                      confidence (72%). Please confirm the figure against the slip before
                      dispatching — an incorrect unit count delays matching.
                    </span>
                  </div>
                )}

                <Button
                  className="mt-6 w-full"
                  onClick={() => navigate('/register/patient')}
                >
                  <Siren className="size-4" /> Confirm &amp; Continue to Dispatch
                </Button>
              </>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  )
}

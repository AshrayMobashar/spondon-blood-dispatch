import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Droplet, ArrowLeft, ArrowRight, CheckCircle2, Siren, TriangleAlert, Loader2,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, Button, Field, Input, Select, OtpInput, Badge } from '../../components/ui.jsx'
import { authApi, setUserSession } from '../../lib/api.js'

const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const components = [
  { value: 'WHOLE_BLOOD', label: 'Whole Blood' },
  { value: 'PLATELETS', label: 'Platelets (Apheresis)' },
  { value: 'PLASMA', label: 'Plasma' },
]

/**
 * The captured-request corner case, end to end.
 *
 * Step 1 collects the emergency details while the user is still logged out.
 * Those details are handed to the OTP request as `pending_request`, so the
 * server holds them alongside the challenge. On verification the backend
 * creates the request and runs dispatch in the same call — the family never
 * re-enters the hospital or blood details.
 */
export default function PatientSignup() {
  const [step, setStep] = useState(1) // 1 request · 2 verify · 3 done
  const [form, setForm] = useState({
    patient: '', hospital: '', blood: 'O+', component: 'WHOLE_BLOOD',
    units: '2', phone: '', name: '',
  })
  const [devCode, setDevCode] = useState(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const navigate = useNavigate()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const phone = form.phone.replace(/\s/g, '')
  const step1Valid = form.patient && form.hospital && form.blood && form.component
  const phoneValid = /^01\d{9}$/.test(phone)

  /** The emergency details ride along with the OTP so they survive verification. */
  const pendingRequest = () => ({
    patient_name: form.patient,
    hospital: form.hospital,
    blood_type: form.blood,
    component: form.component,
    units: Math.max(1, parseInt(form.units, 10) || 1),
    severity: 'CRITICAL',
  })

  async function sendOtp() {
    if (!phoneValid || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.requestOtp(phone, 'LOGIN', pendingRequest())
      setDevCode(res.dev_code ?? null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function verifyAndFire(entered) {
    const value = entered ?? code
    if (value.length !== 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      let res = await authApi.verifyOtp(phone, value)

      // First-time requester: the verification already proved this number, so
      // its ticket completes sign-up without a second code or a second SMS.
      if (!res.registered) {
        if (!form.name.trim()) {
          setError('Enter your name to finish creating the account.')
          return
        }
        res = await authApi.register({
          phone,
          ticket: res.registration_ticket,
          pending_request: pendingRequest(),
          name: form.name.trim(),
          role: 'patient',
          blood_type: form.blood,
        })
      }

      setUserSession(res.access_token, res.account)
      setResult(res.auto_request ?? null)
      setStep(3)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const dispatch = result?.dispatch
  const created = result?.request

  return (
    <Shell center max="max-w-xl" panel="FAMILY PORTAL">
      <Card className="w-full p-8">
        {/* progress */}
        <div className="mb-8 flex items-center gap-2 text-[11px] font-semibold">
          {['Request', 'Verify', 'Dispatch'].map((s, i) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <span
                className={`grid size-6 place-items-center rounded-full ${
                  step >= i + 1 ? 'bg-primary text-white' : 'bg-line text-text-faint'
                }`}
              >
                {i + 1}
              </span>
              <span className={step >= i + 1 ? 'text-white' : 'text-text-faint'}>{s}</span>
              {i < 2 && <span className="h-px flex-1 bg-line" />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10">
                <Droplet className="size-5 text-primary" />
              </span>
              <div>
                <h1 className="text-lg font-bold">Emergency Blood Request</h1>
                <p className="text-xs text-text-faint">
                  Enter details first — we verify your identity after.
                </p>
              </div>
            </div>

            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (step1Valid) setStep(2)
              }}
            >
              <Field label="Patient Name">
                <Input value={form.patient} onChange={set('patient')} placeholder="e.g. Mehedi Hassan" />
              </Field>
              <Field label="Hospital">
                <Input value={form.hospital} onChange={set('hospital')} placeholder="e.g. Dhaka Medical College" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Blood Type">
                  <Select value={form.blood} onChange={set('blood')}>
                    {bloodTypes.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Units Needed">
                  <Input value={form.units} onChange={set('units')} inputMode="numeric" />
                </Field>
              </div>
              <Field label="Component">
                <Select value={form.component} onChange={set('component')}>
                  {components.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </Select>
              </Field>
              <p className="rounded-lg border border-line bg-[#0d111a] px-3 py-2.5 text-[11px] text-text-faint">
                You'll photograph the doctor's requisition slip next — no dispatch
                reaches donors until that slip is confirmed.
              </p>
              <Button type="submit" disabled={!step1Valid} className="w-full">
                Continue to Verification <ArrowRight className="size-4" />
              </Button>
            </form>
          </>
        )}

        {step === 2 && (
          <>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="mb-4 inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-white"
            >
              <ArrowLeft className="size-3.5" /> Back to request
            </button>
            <h1 className="text-lg font-bold">Verify your number</h1>
            <p className="mt-1 text-xs text-text-faint">
              We captured your request. Verify via OTP and we'll create it
              automatically — you never re-enter anything.
            </p>
            <div className="mt-6 space-y-4">
              <Field label="Mobile Number">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-line bg-[#0d111a] px-3 py-2.5 text-sm text-text-muted">
                    +880
                  </span>
                  <Input value={form.phone} onChange={set('phone')} placeholder="01XXXXXXXXX" inputMode="numeric" />
                </div>
              </Field>
              <Field label="Your Name" hint="Only needed if this number is new to Spondon">
                <Input value={form.name} onChange={set('name')} placeholder="e.g. Ashray Mobashar" />
              </Field>

              <Button variant="ghost" className="w-full" disabled={!phoneValid || busy} onClick={sendOtp}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Send code
              </Button>

              {devCode && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/10 px-4 py-3">
                  <span className="text-[11px] leading-snug text-text-muted">
                    No SMS gateway configured — use this code:
                  </span>
                  <span className="font-mono text-lg font-bold tracking-[0.3em] text-primary">{devCode}</span>
                </div>
              )}

              <div>
                <p className="mb-2 text-center text-xs text-text-faint">Enter the 6-digit code</p>
                <OtpInput onChange={setCode} onComplete={verifyAndFire} />
              </div>

              {error && (
                <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] text-primary">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  {error}
                </p>
              )}

              <Button
                className="w-full"
                disabled={code.length !== 6 || busy}
                onClick={() => verifyAndFire()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Verify &amp; Submit Emergency Request
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <div className="flex flex-col items-center text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-success/10">
              <CheckCircle2 className="size-7 text-success" />
            </span>
            <h1 className="mt-4 text-xl font-bold">
              {dispatch?.pinged > 0 ? 'Emergency ping fired!' : 'Request created'}
            </h1>
            <p className="mt-2 max-w-sm text-sm text-text-faint">
              {result?.note ??
                'Your request was created from the details you already entered.'}
            </p>

            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Badge color="primary">
                <Siren className="size-3" /> {form.units} units ·{' '}
                {components.find((c) => c.value === form.component)?.label}
              </Badge>
              {created && (
                <Badge color="success" dot={false}>
                  Request #{created.id.slice(-6)} {created.status.toLowerCase()}
                </Badge>
              )}
            </div>

            {dispatch && (
              <dl className="mt-5 w-full space-y-1.5 rounded-lg border border-line bg-[#0d111a] p-4 text-left text-[11px]">
                <Row label="Dispatch mode" value={dispatch.dispatch_mode === 'CITYWIDE_RARE'
                  ? 'City-wide (rare type)'
                  : `Expanding ripple · ${dispatch.radius_km} km`} />
                <Row label="Donors pinged" value={String(dispatch.pinged)} />
                {dispatch.blocked_reason && (
                  <Row label="Waiting on" value={dispatch.blocked_reason} />
                )}
              </dl>
            )}

            <Button className="mt-6 w-full" onClick={() => navigate('/patient/ocr')}>
              Upload the doctor's slip
            </Button>
          </div>
        )}
      </Card>
    </Shell>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-faint">{label}</dt>
      <dd className="text-right text-text-muted">{value}</dd>
    </div>
  )
}

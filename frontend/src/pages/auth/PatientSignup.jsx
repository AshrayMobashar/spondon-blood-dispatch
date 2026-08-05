import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Droplet, ArrowLeft, ArrowRight, CheckCircle2, Siren, Upload } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, Button, Field, Input, Select, OtpInput, Badge } from '../../components/ui.jsx'

const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const components = ['Whole Blood', 'Platelets (Apheresis)', 'Plasma', 'Red Cells']

export default function PatientSignup() {
  const [step, setStep] = useState(1) // 1 request · 2 verify · 3 done
  const [form, setForm] = useState({
    patient: '',
    hospital: '',
    blood: 'O+',
    component: 'Whole Blood',
    units: '2',
    phone: '',
  })
  const navigate = useNavigate()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const step1Valid = form.patient && form.hospital && form.blood && form.component
  const phoneValid = /^01\d{9}$/.test(form.phone.replace(/\s/g, ''))

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
              <span className={step >= i + 1 ? 'text-white' : 'text-text-faint'}>
                {s}
              </span>
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
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Doctor's Requisition Slip" hint="Required before dispatch — OCR verified in-app">
                <Link
                  to="/patient/ocr"
                  className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-[#0d111a] py-4 text-sm text-text-muted transition-colors hover:border-primary/40 hover:text-white"
                >
                  <Upload className="size-4" /> Upload doctor's slip
                </Link>
              </Field>
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
              We captured your request. Verify via OTP and we'll fire the emergency
              ping automatically — you never re-enter anything.
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
              {phoneValid && (
                <div>
                  <p className="mb-2 text-center text-xs text-text-faint">Enter the 6-digit code</p>
                  <OtpInput onComplete={() => setStep(3)} />
                </div>
              )}
              <Button
                className="w-full"
                disabled={!phoneValid}
                onClick={() => setStep(3)}
              >
                Verify &amp; Fire Emergency Ping
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <div className="flex flex-col items-center text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-success/10">
              <CheckCircle2 className="size-7 text-success" />
            </span>
            <h1 className="mt-4 text-xl font-bold">Emergency ping fired!</h1>
            <p className="mt-2 max-w-sm text-sm text-text-faint">
              We're pinging eligible <span className="font-semibold text-primary">{form.blood}</span> donors near{' '}
              <span className="font-semibold text-white">{form.hospital}</span>. You'll
              be able to track your donor live the moment someone accepts.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Badge color="primary">
                <Siren className="size-3" /> {form.units} units · {form.component}
              </Badge>
              <Badge color="success">Request #4821 active</Badge>
            </div>
            <Button className="mt-6 w-full" onClick={() => navigate('/')}>
              Go to tracking dashboard
            </Button>
          </div>
        )}
      </Card>
    </Shell>
  )
}

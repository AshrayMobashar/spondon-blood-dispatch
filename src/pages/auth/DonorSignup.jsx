import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { HeartHandshake, ArrowLeft, ArrowRight, CheckCircle2, TriangleAlert } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, Button, Field, Input, Select, OtpInput, Badge } from '../../components/ui.jsx'

const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

export default function DonorSignup() {
  const [step, setStep] = useState(1) // 1 phone · 2 otp · 3 health · 4 done
  const [form, setForm] = useState({
    name: '',
    phone: '',
    blood: 'O+',
    weight: '',
    lastDonation: '',
    route: '',
  })
  const [otp, setOtp] = useState('') // demo code — no SMS gateway wired up
  const [entered, setEntered] = useState('')
  const [otpError, setOtpError] = useState(false)
  const navigate = useNavigate()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const sendOtp = () => {
    setOtp(String(Math.floor(100000 + Math.random() * 900000)))
    setEntered('')
    setOtpError(false)
    setStep(2)
  }

  const verifyOtp = (value) => {
    if (value === otp) {
      setOtpError(false)
      setStep(3)
    } else {
      setOtpError(true)
    }
  }

  const phoneValid = /^01\d{9}$/.test(form.phone.replace(/\s/g, ''))
  const weightNum = parseFloat(form.weight)
  const weightImplausible = form.weight !== '' && (weightNum < 30 || weightNum > 250)
  const underweight = weightNum >= 30 && weightNum < 50
  const healthValid = form.name && weightNum >= 30 && weightNum <= 250

  return (
    <Shell center max="max-w-xl" panel="DONOR PANEL" panelColor="donor">
      <Card className="w-full p-8" accent="donor">
        {/* progress */}
        <div className="mb-8 flex items-center gap-2 text-[11px] font-semibold">
          {['Phone', 'Verify', 'Health', 'Done'].map((s, i) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <span
                className={`grid size-6 place-items-center rounded-full ${
                  step >= i + 1 ? 'bg-donor text-white' : 'bg-line text-text-faint'
                }`}
              >
                {i + 1}
              </span>
              {i < 3 && <span className="h-px flex-1 bg-line" />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-donor/10">
                <HeartHandshake className="size-5 text-donor" />
              </span>
              <div>
                <h1 className="text-lg font-bold">Become a donor</h1>
                <p className="text-xs text-text-faint">Start with your mobile number</p>
              </div>
            </div>
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (phoneValid && form.name) sendOtp()
              }}
            >
              <Field label="Full Name">
                <Input value={form.name} onChange={set('name')} placeholder="e.g. Rafiul Islam" />
              </Field>
              <Field label="Mobile Number">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-line bg-[#0d111a] px-3 py-2.5 text-sm text-text-muted">+880</span>
                  <Input value={form.phone} onChange={set('phone')} placeholder="01XXXXXXXXX" inputMode="numeric" />
                </div>
              </Field>
              <Button type="submit" disabled={!phoneValid || !form.name} className="w-full">
                Send OTP <ArrowRight className="size-4" />
              </Button>
            </form>
          </>
        )}

        {step === 2 && (
          <>
            <button type="button" onClick={() => setStep(1)} className="mb-4 inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-white">
              <ArrowLeft className="size-3.5" /> Back
            </button>
            <h1 className="text-lg font-bold">Verify OTP</h1>
            <p className="mt-1 text-xs text-text-faint">6-digit code sent to +880 {form.phone}</p>

            <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-dashed border-donor/40 bg-donor/10 px-4 py-3">
              <span className="text-[11px] leading-snug text-text-muted">
                Demo mode — no SMS gateway connected. Use this code:
              </span>
              <span className="font-mono text-lg font-bold tracking-[0.3em] text-donor">{otp}</span>
            </div>

            <div className="mt-6">
              <OtpInput
                onChange={(v) => {
                  setEntered(v)
                  if (otpError) setOtpError(false)
                }}
                onComplete={verifyOtp}
              />
            </div>

            {otpError && (
              <p className="mt-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] text-primary">
                <TriangleAlert className="size-3.5 shrink-0" />
                Incorrect code — check the demo code above and try again.
              </p>
            )}

            <Button className="mt-6 w-full" onClick={() => verifyOtp(entered)}>Verify</Button>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="text-lg font-bold">Health profile</h1>
            <p className="mt-1 text-xs text-text-faint">
              Required for eligibility. Minimum 50&nbsp;kg per WHO / Bangladesh
              Blood Transfusion Society protocol.
            </p>
            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (healthValid) setStep(4)
              }}
            >
              <div className="grid grid-cols-2 gap-4">
                <Field label="Blood Type">
                  <Select value={form.blood} onChange={set('blood')}>
                    {bloodTypes.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Weight (kg)">
                  <Input value={form.weight} onChange={set('weight')} placeholder="e.g. 68" inputMode="decimal" />
                </Field>
              </div>
              {weightImplausible && (
                <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] text-primary">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  Implausible weight — please enter a value between 30 and 250 kg.
                </p>
              )}
              {underweight && (
                <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  Below 50 kg — you can register, but your eligibility flag will be
                  locked as a medical-risk factor.
                </p>
              )}
              <Field label="Last Donation Date" hint="Leave blank if you've never donated">
                <Input type="date" value={form.lastDonation} onChange={set('lastDonation')} />
              </Field>
              <Field label="Daily Commute Route" hint="Enables route-aware matching along roads you already travel">
                <Input value={form.route} onChange={set('route')} placeholder="e.g. Mirpur-10 → Farmgate → Motijheel" />
              </Field>
              <Button type="submit" disabled={!healthValid} className="w-full" variant={underweight ? 'outline' : 'primary'}>
                Complete Registration
              </Button>
            </form>
          </>
        )}

        {step === 4 && (
          <div className="flex flex-col items-center text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-success/10">
              <CheckCircle2 className="size-7 text-success" />
            </span>
            <h1 className="mt-4 text-xl font-bold">You're registered!</h1>
            <p className="mt-2 max-w-sm text-sm text-text-faint">
              Welcome, {form.name}. Your donor dashboard is ready.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Badge color="primary" dot={false}>{form.blood}</Badge>
              {underweight ? (
                <Badge color="warning">Eligibility locked ({form.weight} kg)</Badge>
              ) : (
                <Badge color="success">Eligible to donate</Badge>
              )}
            </div>
            <Button className="mt-6 w-full" onClick={() => navigate('/donor/sleep')}>
              Go to Donor Dashboard
            </Button>
          </div>
        )}
      </Card>
      <p className="mt-6 text-center text-xs text-text-faint">
        Already a donor?{' '}
        <Link to="/login" className="font-semibold text-donor">Sign in</Link>
      </p>
    </Shell>
  )
}

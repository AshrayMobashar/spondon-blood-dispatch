import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  HeartHandshake, ArrowLeft, ArrowRight, CheckCircle2, TriangleAlert, Loader2,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, Button, Field, Input, Select, OtpInput, Badge } from '../../components/ui.jsx'
import { authApi, configApi, donorApi, setUserSession } from '../../lib/api.js'

const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

// Used only to shape the form before the config call lands; the server is the
// authority and rejects an implausible weight regardless of what the UI allowed.
const FALLBACK_RULES = { min_weight_kg: 50, plausible_weight_min_kg: 30, plausible_weight_max_kg: 250 }

export default function DonorSignup() {
  const [step, setStep] = useState(1) // 1 phone · 2 otp · 3 health · 4 done
  const [form, setForm] = useState({
    name: '', phone: '', blood: 'O+', weight: '', lastDonation: '',
    donationType: 'WHOLE_BLOOD', route: '',
  })
  const [rules, setRules] = useState(FALLBACK_RULES)
  const [devCode, setDevCode] = useState(null)
  const [entered, setEntered] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [account, setAccount] = useState(null)
  const [eligibility, setEligibility] = useState(null)
  const navigate = useNavigate()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  useEffect(() => {
    configApi.get().then((c) => setRules(c.eligibility)).catch(() => {})
  }, [])

  const phone = form.phone.replace(/\s/g, '')
  const phoneValid = /^01\d{9}$/.test(phone)
  const weightNum = parseFloat(form.weight)
  const weightImplausible =
    form.weight !== '' &&
    (weightNum < rules.plausible_weight_min_kg || weightNum > rules.plausible_weight_max_kg)
  const underweight = weightNum >= rules.plausible_weight_min_kg && weightNum < rules.min_weight_kg
  const healthValid =
    form.name &&
    weightNum >= rules.plausible_weight_min_kg &&
    weightNum <= rules.plausible_weight_max_kg

  async function sendOtp(e) {
    e?.preventDefault()
    if (!phoneValid || !form.name || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.requestOtp(phone, 'REGISTER')
      setDevCode(res.dev_code ?? null)
      setEntered('')
      setStep(2)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /** The code is only proven at registration — the server validates it there,
   *  so this step just collects it and moves on to the health profile. */
  function acceptCode(value) {
    if ((value ?? entered).length !== 6) return
    setEntered(value ?? entered)
    setError(null)
    setStep(3)
  }

  async function completeRegistration(e) {
    e?.preventDefault()
    if (!healthValid || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.register({
        phone,
        code: entered,
        name: form.name.trim(),
        role: 'donor',
        blood_type: form.blood,
        health: {
          weight_kg: weightNum,
          last_donation_date: form.lastDonation
            ? new Date(form.lastDonation).toISOString()
            : null,
          last_donation_type: form.lastDonation ? form.donationType : null,
        },
      })
      setUserSession(res.access_token, res.account)
      setAccount(res.account)
      setEligibility(res.eligibility)

      // Save the commute route now that we have an authenticated session.
      const segments = form.route
        .split(/[→>,]/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (segments.length) {
        await donorApi.saveRoute(res.account.id, segments, 'Daily commute').catch(() => {})
      }
      setStep(4)
    } catch (err) {
      setError(err.message)
      // A rejected code means starting the verification over.
      if (/code/i.test(err.message)) setStep(2)
    } finally {
      setBusy(false)
    }
  }

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
            <form className="mt-6 space-y-4" onSubmit={sendOtp}>
              <Field label="Full Name">
                <Input value={form.name} onChange={set('name')} placeholder="e.g. Rafiul Islam" />
              </Field>
              <Field label="Mobile Number">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-line bg-[#0d111a] px-3 py-2.5 text-sm text-text-muted">+880</span>
                  <Input value={form.phone} onChange={set('phone')} placeholder="01XXXXXXXXX" inputMode="numeric" />
                </div>
              </Field>
              {error && <p className="text-[11px] text-primary">{error}</p>}
              <Button type="submit" disabled={!phoneValid || !form.name || busy} className="w-full">
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
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

            {devCode && (
              <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-dashed border-donor/40 bg-donor/10 px-4 py-3">
                <span className="text-[11px] leading-snug text-text-muted">
                  No SMS gateway configured — use this code:
                </span>
                <span className="font-mono text-lg font-bold tracking-[0.3em] text-donor">{devCode}</span>
              </div>
            )}

            <div className="mt-6">
              <OtpInput
                onChange={(v) => {
                  setEntered(v)
                  if (error) setError(null)
                }}
                onComplete={acceptCode}
              />
            </div>

            {error && (
              <p className="mt-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] text-primary">
                <TriangleAlert className="size-3.5 shrink-0" />
                {error}
              </p>
            )}

            <Button className="mt-6 w-full" disabled={entered.length !== 6} onClick={() => acceptCode()}>
              Continue
            </Button>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="text-lg font-bold">Health profile</h1>
            <p className="mt-1 text-xs text-text-faint">
              Required for eligibility. Minimum {rules.min_weight_kg}&nbsp;kg per WHO / Bangladesh
              Blood Transfusion Society protocol.
            </p>
            <form className="mt-6 space-y-4" onSubmit={completeRegistration}>
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
                  Implausible weight — please enter a value between{' '}
                  {rules.plausible_weight_min_kg} and {rules.plausible_weight_max_kg} kg.
                </p>
              )}
              {underweight && (
                <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  Below {rules.min_weight_kg} kg — you can register, but your eligibility flag
                  will be locked as a medical-risk factor.
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Last Donation Date" hint="Leave blank if you've never donated">
                  <Input type="date" value={form.lastDonation} onChange={set('lastDonation')} />
                </Field>
                <Field label="Donation Type" hint="Sets your cooldown length">
                  <Select value={form.donationType} onChange={set('donationType')} disabled={!form.lastDonation}>
                    <option value="WHOLE_BLOOD">Whole blood</option>
                    <option value="PLATELETS">Platelets (apheresis)</option>
                  </Select>
                </Field>
              </div>
              <Field label="Daily Commute Route" hint="Enables route-aware matching along roads you already travel">
                <Input value={form.route} onChange={set('route')} placeholder="e.g. Mirpur-10 → Farmgate → Motijheel" />
              </Field>
              {error && (
                <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] text-primary">
                  <TriangleAlert className="size-3.5 shrink-0" />
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={!healthValid || busy}
                className="w-full"
                variant={underweight ? 'outline' : 'primary'}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Complete Registration
              </Button>
            </form>
          </>
        )}

        {step === 4 && account && (
          <div className="flex flex-col items-center text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-success/10">
              <CheckCircle2 className="size-7 text-success" />
            </span>
            <h1 className="mt-4 text-xl font-bold">You're registered!</h1>
            <p className="mt-2 max-w-sm text-sm text-text-faint">
              Welcome, {account.name}. Your donor dashboard is ready.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Badge color="primary" dot={false}>{account.blood_type}</Badge>
              {eligibility?.eligible ? (
                <Badge color="success">Eligible to donate</Badge>
              ) : (
                <Badge color="warning">Eligibility locked</Badge>
              )}
            </div>
            {!eligibility?.eligible && eligibility?.reasons?.length > 0 && (
              <ul className="mt-3 space-y-1 text-[11px] text-text-muted">
                {eligibility.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <Button className="mt-6 w-full" onClick={() => navigate(account.home)}>
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

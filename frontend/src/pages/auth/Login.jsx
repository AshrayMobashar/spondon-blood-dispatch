import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Phone, ArrowLeft, ShieldCheck, Loader2 } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, Button, Field, Input, OtpInput } from '../../components/ui.jsx'
import { authApi, setUserSession } from '../../lib/api.js'

export default function Login() {
  const [step, setStep] = useState('phone') // 'phone' | 'otp'
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  const valid = /^01\d{9}$/.test(phone.replace(/\s/g, ''))
  const clean = phone.replace(/\s/g, '')

  async function sendOtp(e) {
    e?.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.requestOtp(clean, 'LOGIN')
      // Only present without an SMS gateway; the API says so explicitly.
      setDevCode(res.dev_code ?? null)
      setStep('otp')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  /** The entered code is checked by the server — never on the client. */
  async function verify(entered) {
    const value = entered ?? code
    if (value.length !== 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.verifyOtp(clean, value)
      if (!res.registered) {
        setError('No account uses this number yet — create one to continue.')
        return
      }
      setUserSession(res.access_token, res.account)
      // Each role goes to its own dashboard; the server decides which.
      navigate(res.account.home)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell center max="max-w-md">
      <Card className="w-full p-8">
        {step === 'phone' ? (
          <>
            <div className="flex flex-col items-center text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-primary/10">
                <Phone className="size-5 text-primary" />
              </span>
              <h1 className="mt-4 text-2xl font-bold">Welcome back</h1>
              <p className="mt-1 text-sm text-text-faint">
                Sign in with your Bangladeshi mobile number
              </p>
            </div>

            <form className="mt-8 space-y-4" onSubmit={sendOtp}>
              <Field label="Mobile Number" hint="No email required — we'll text you a code">
                <div className="flex items-center gap-2">
                  <span className="rounded-lg border border-line bg-[#0d111a] px-3 py-2.5 text-sm text-text-muted">
                    +880
                  </span>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01XXXXXXXXX"
                    inputMode="numeric"
                  />
                </div>
              </Field>
              {error && <p className="text-xs text-primary">{error}</p>}
              <Button type="submit" disabled={!valid || busy} className="w-full">
                {busy && <Loader2 className="size-4 animate-spin" />}
                Send OTP
              </Button>
            </form>

            <p className="mt-6 text-center text-xs text-text-faint">
              New here?{' '}
              <Link to="/register" className="font-semibold text-primary">
                Create an account
              </Link>
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setStep('phone')
                setError(null)
                setCode('')
              }}
              className="mb-4 inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-white"
            >
              <ArrowLeft className="size-3.5" /> Back
            </button>
            <div className="flex flex-col items-center text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-success/10">
                <ShieldCheck className="size-5 text-success" />
              </span>
              <h1 className="mt-4 text-2xl font-bold">Verify OTP</h1>
              <p className="mt-1 text-sm text-text-faint">
                Enter the 6-digit code sent to +880 {phone}
              </p>
            </div>

            {devCode && (
              <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-center text-[11px] text-warning">
                No SMS gateway configured — your code is{' '}
                <span className="font-bold tracking-widest">{devCode}</span>
              </p>
            )}

            <div className="mt-8">
              <OtpInput onChange={setCode} onComplete={verify} />
            </div>

            {error && <p className="mt-4 text-center text-xs text-primary">{error}</p>}

            <Button
              className="mt-8 w-full"
              disabled={code.length !== 6 || busy}
              onClick={() => verify()}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Verify &amp; Continue
            </Button>
            <p className="mt-4 text-center text-xs text-text-faint">
              Didn't get a code?{' '}
              <button type="button" onClick={sendOtp} className="font-semibold text-primary">
                Resend
              </button>
            </p>
          </>
        )}
      </Card>
    </Shell>
  )
}

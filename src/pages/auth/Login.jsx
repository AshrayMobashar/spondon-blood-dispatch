import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Phone, ArrowLeft, ShieldCheck } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, Button, Field, Input, OtpInput } from '../../components/ui.jsx'

export default function Login() {
  const [step, setStep] = useState('phone') // 'phone' | 'otp'
  const [phone, setPhone] = useState('')
  const navigate = useNavigate()

  const valid = /^01\d{9}$/.test(phone.replace(/\s/g, ''))

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

            <form
              className="mt-8 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (valid) setStep('otp')
              }}
            >
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
              <Button type="submit" disabled={!valid} className="w-full">
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
              onClick={() => setStep('phone')}
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

            <div className="mt-8">
              <OtpInput onComplete={() => navigate('/donor/sleep')} />
            </div>

            <Button
              className="mt-8 w-full"
              onClick={() => navigate('/donor/sleep')}
            >
              Verify &amp; Continue
            </Button>
            <p className="mt-4 text-center text-xs text-text-faint">
              Didn't get a code?{' '}
              <button className="font-semibold text-primary">Resend</button> · via
              SSL Wireless
            </p>
          </>
        )}
      </Card>
    </Shell>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Lock, TriangleAlert, Loader2 } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, Button, Field, Input } from '../../components/ui.jsx'
import { adminApi, setSession } from '../../lib/api.js'

export default function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await adminApi.login(email.trim().toLowerCase(), password)
      setSession(res.access_token, res.admin)
      navigate('/admin')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell center max="max-w-md" panel="SYSTEM CORE" panelColor="admin">
      <Card className="w-full p-8" accent="admin">
        <div className="flex flex-col items-center text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-admin/10">
            <ShieldCheck className="size-5 text-admin" />
          </span>
          <h1 className="mt-4 text-2xl font-bold">Admin Access</h1>
          <p className="mt-1 text-sm text-text-faint">
            Authorized administration body only — secure sign-in
          </p>
        </div>

        <form className="mt-8 space-y-4" onSubmit={submit}>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@spondon.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>

          {error && (
            <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] text-primary">
              <TriangleAlert className="size-3.5 shrink-0" />
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full"
            variant="primary"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Lock className="size-4" />}
            {busy ? 'Signing in…' : 'Sign in to Console'}
          </Button>
        </form>

        <p className="mt-6 rounded-lg border border-line bg-[#0d111a] px-3 py-2 text-center text-[11px] text-text-faint">
          Demo credentials — <span className="font-semibold text-admin">admin@spondon.com</span> /{' '}
          <span className="font-semibold text-admin">spondon123</span>
        </p>
      </Card>
    </Shell>
  )
}

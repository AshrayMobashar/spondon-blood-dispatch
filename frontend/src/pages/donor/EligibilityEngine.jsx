import { useNavigate } from 'react-router-dom'
import { ShieldCheck, FileUp, UserCog, CheckCircle2, Droplet, AlertTriangle, Loader2 } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { DonorChips } from '../../components/RoleChips.jsx'
import { Card, StatCard, Tabs, Button, Input } from '../../components/ui.jsx'
import { useState, useEffect } from 'react'
import { eligibilityApi, ApiError } from '../../lib/api.js'

const tabs = ['Cooldown Dashboard', 'Update Records', 'Weight Validation', 'Ping Activity Log']
const tabRoutes = ['/donor/eligibility', '/donor/records', '/donor/weight', '/admin/pings']

// This demo has no donor login session, so we let the user paste a donor id
// (from POST /api/donors) and remember it. Real app: read it from the session.
const DONOR_KEY = 'spondon_demo_donor_id'

export default function EligibilityEngine() {
  const [tab, setTab] = useState(0)
  const navigate = useNavigate()

  const [donorId, setDonorId] = useState(() => localStorage.getItem(DONOR_KEY) || '')
  const [data, setData] = useState(null)      // the eligibility payload from the API
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [certMsg, setCertMsg] = useState('')

  // Recalculate on load (this is the "recalculated on every login" behaviour).
  async function load(id) {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      // login-recalc first (recompute), then read the fresh status.
      await eligibilityApi.loginRecalc(id)
      const status = await eligibilityApi.get(id)
      setData(status)
      localStorage.setItem(DONOR_KEY, id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load eligibility.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (donorId) load(donorId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function uploadCertificate() {
    setCertMsg('')
    try {
      // In a real app this URL comes from a file-upload widget; we send a stub.
      const res = await eligibilityApi.uploadCertificate(
        donorId,
        'https://files.spondon.app/cert/demo.pdf',
        'Requesting early unlock — donation date was mistyped.',
        null,
      )
      setCertMsg(res.message || 'Certificate uploaded for admin review.')
    } catch (e) {
      setCertMsg(e instanceof ApiError ? e.message : 'Upload failed.')
    }
  }

  const eligible = data?.eligible
  const locked = data && !data.eligible

  // Derived display values (fall back to placeholders before data loads).
  const flagRows = data
    ? [
        { label: 'Cooldown Lock', value: data.cooldown_locked ? 'LOCKED' : 'CLEAR', color: data.cooldown_locked ? 'text-primary' : 'text-success' },
        { label: 'Weight Lock', value: data.weight_locked ? 'LOCKED' : 'CLEAR', color: data.weight_locked ? 'text-primary' : 'text-success' },
        { label: 'Geo-Ripple Pings', value: eligible ? 'RECEIVING' : 'PAUSED', color: eligible ? 'text-admin' : 'text-text-faint' },
      ]
    : []

  const profileRows = data
    ? [
        ['Weight', data.weight_kg != null ? `${data.weight_kg} kg` : '\u2014'],
        ['Last Donation', data.last_donation_date ? data.last_donation_date.slice(0, 10) : '\u2014'],
        ['Type', data.donation_type === 'PLATELET' ? 'Platelets (14d)' : 'Whole Blood (120d)'],
        ['Next Eligible', data.next_eligible_date ? data.next_eligible_date.slice(0, 10) : 'Now'],
      ]
    : []

  return (
    <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 space-y-5 lg:w-[300px]">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg bg-primary/10">
                <ShieldCheck className="size-4 text-primary" />
              </span>
              <h2 className="text-sm font-bold">Eligibility Engine</h2>
            </div>
            <p className="mt-2 text-xs text-text-faint">
              Auto-pause &amp; cooldown management
            </p>
          </div>

          {/* Demo donor selector - real app reads this from the session */}
          <Card className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Donor ID</p>
            <div className="mt-2 flex gap-2">
              <Input
                value={donorId}
                onChange={(e) => setDonorId(e.target.value)}
                placeholder="Paste donor _id"
                className="text-xs"
              />
              <Button className="shrink-0 px-3 text-xs" onClick={() => load(donorId)}>
                Load
              </Button>
            </div>
          </Card>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[11px] text-primary">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </div>
          )}

          <Card className="p-4" accent={eligible ? 'success' : 'primary'}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold">Eligibility Flag</p>
                <p className={`text-[11px] font-semibold ${eligible ? 'text-success' : 'text-primary'}`}>
                  {loading ? 'Checking\u2026' : eligible ? 'ELIGIBLE \u2014 Active' : locked ? 'LOCKED \u2014 Paused' : '\u2014'}
                </p>
              </div>
              <span className={`size-2.5 rounded-full ${eligible ? 'bg-success' : 'bg-primary'}`} />
            </div>
            {flagRows.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-line pt-3">
                {flagRows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between text-[11px]">
                    <span className="text-text-faint">{row.label}</span>
                    <span className={`font-semibold ${row.color}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {profileRows.length > 0 && (
            <Card className="p-4">
              <p className="text-xs font-bold">Donor Profile</p>
              <div className="mt-3 space-y-2">
                {profileRows.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between text-[11px]">
                    <span className="text-text-faint">{k}</span>
                    <span className="font-medium text-white">{v}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Button variant="outline" className="w-full" onClick={uploadCertificate} disabled={!donorId}>
            <FileUp className="size-4" /> Upload Medical Certificate
          </Button>
          {certMsg && <p className="text-[11px] text-text-muted">{certMsg}</p>}
          <Button variant="ghost" className="w-full" onClick={() => navigate('/admin/concurrency')}>
            <UserCog className="size-4" /> Admin Review Panel
          </Button>
        </aside>

        {/* Main */}
        <section className="min-w-0 flex-1">
          <Tabs
            tabs={tabs}
            active={tab}
            color="donor"
            onChange={(i) => {
              setTab(i)
              if (i !== 0) navigate(tabRoutes[i])
            }}
          />

          <div className="pt-6">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10">
                <ShieldCheck className="size-5 text-primary" />
              </span>
              <div>
                <h1 className="text-lg font-bold">Eligibility Cooldown Engine</h1>
                <p className="text-xs text-text-faint">
                  Live eligibility flag recalculated on every login and post-donation
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Eligibility Status"
                value={loading ? '\u2026' : eligible ? 'ELIGIBLE' : locked ? 'PAUSED' : '\u2014'}
                sub={eligible ? 'Receiving pings' : 'Excluded from pings'}
                color={eligible ? 'success' : 'primary'}
              />
              <StatCard
                label="Days Remaining"
                value={data ? `${data.days_remaining} days` : '\u2014'}
                sub={data?.lock_period_days ? `of ${data.lock_period_days}-day cooldown` : 'no active cooldown'}
                color="warning"
                subColor="text-text-faint"
              />
              <StatCard
                label="Donation Type"
                value={data?.donation_type === 'PLATELET' ? 'Platelet' : 'Whole Blood'}
                sub={data?.donation_type === 'PLATELET' ? '14-day lock period' : '120-day lock period'}
                color="admin"
                subColor="text-text-faint"
              />
              <StatCard
                label="Weight Status"
                value={data?.weight_kg != null ? `${data.weight_kg} kg` : '\u2014'}
                sub={data?.weight_locked ? 'Below 50 kg threshold' : 'Above 50 kg threshold'}
                color={data?.weight_locked ? 'primary' : 'success'}
              />
            </div>

            <Card className="mt-4 p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-text-muted">Live Countdown to Eligibility</p>
                <span className={`inline-flex items-center gap-2 text-xs font-semibold ${eligible ? 'text-success' : 'text-primary'}`}>
                  <span className={`size-2 rounded-full ${eligible ? 'bg-success' : 'bg-primary'}`} />
                  {eligible ? 'Eligible Now' : 'Locked'}
                </span>
              </div>
              <div className={`mt-6 flex flex-col items-center justify-center rounded-xl border py-10 ${eligible ? 'border-success/20 bg-success/[0.05]' : 'border-primary/20 bg-primary/[0.05]'}`}>
                {loading ? (
                  <Loader2 className="size-10 animate-spin text-text-faint" />
                ) : eligible ? (
                  <CheckCircle2 className="size-10 text-success" />
                ) : (
                  <AlertTriangle className="size-10 text-primary" />
                )}
                <p className={`mt-3 text-2xl font-bold ${eligible ? 'text-success' : 'text-primary'}`}>
                  {data ? data.countdown : '\u2014'}
                </p>
                <p className="mt-1 text-xs text-text-faint">
                  {eligible
                    ? 'Cooldown has fully elapsed - donor is receiving pings'
                    : data?.next_eligible_date
                      ? `Next eligible on ${data.next_eligible_date.slice(0, 10)}`
                      : 'Load a donor to see their live countdown'}
                </p>
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/[0.05] px-4 py-3 text-[11px] text-text-muted">
                <Droplet className="size-3.5 shrink-0 text-primary" />
                Platelet (apheresis) donations lock eligibility for only 14 days -
                far less depleting than whole blood.
              </div>
            </Card>
          </div>
        </section>
      </div>
    </Shell>
  )
}

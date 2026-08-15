import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, FileUp, CheckCircle2, Droplet, Loader2, TriangleAlert,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { DonorChips } from '../../components/RoleChips.jsx'
import { Card, StatCard, Tabs, Button, Field, Input, Badge } from '../../components/ui.jsx'
import { donorApi } from '../../lib/api.js'
import { fileToDataUrl, useSession } from '../../lib/session.js'

const tabs = ['Cooldown Dashboard', 'Update Records', 'Weight Validation', 'Ping Activity Log']
const tabRoutes = ['/donor/eligibility', '/donor/records', '/donor/weight', '/admin/pings']

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—')

export default function EligibilityEngine() {
  const [tab, setTab] = useState(0)
  const navigate = useNavigate()
  const { account, loading: sessionLoading } = useSession({ role: 'donor' })

  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [remaining, setRemaining] = useState(0)

  const load = useCallback(async () => {
    if (!account) return
    try {
      setData(await donorApi.eligibility(account.id))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [account])

  useEffect(() => {
    load()
  }, [load])

  // The countdown ticks off the server's absolute target time rather than
  // decrementing a local number, so it stays correct across a sleeping tab.
  const target = data?.countdown?.next_eligible_at
  useEffect(() => {
    if (!target) {
      setRemaining(0)
      return undefined
    }
    const end = new Date(target).getTime()
    const tick = () => setRemaining(Math.max(0, Math.floor((end - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [target])

  // The moment the clock runs out, ask the server to re-evaluate the flag.
  const wasCounting = useRef(false)
  useEffect(() => {
    if (remaining > 0) wasCounting.current = true
    else if (wasCounting.current) {
      wasCounting.current = false
      load()
    }
  }, [remaining, load])

  if (sessionLoading || (!data && !error)) {
    return (
      <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
        <div className="flex items-center gap-2 py-20 text-sm text-text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading your eligibility…
        </div>
      </Shell>
    )
  }

  const eligible = data?.eligible
  const rules = data?.rules ?? {}
  const health = data?.health ?? {}
  const progress = data?.progress ?? {}
  const cooldownDays =
    health.last_donation_type === 'PLATELETS'
      ? rules.platelet_cooldown_days
      : rules.whole_blood_cooldown_days

  const days = Math.floor(remaining / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const mins = Math.floor((remaining % 3600) / 60)
  const secs = remaining % 60

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

          {error && (
            <Card className="p-4" accent="primary">
              <p className="flex items-center gap-2 text-[11px] text-primary">
                <TriangleAlert className="size-3.5 shrink-0" /> {error}
              </p>
            </Card>
          )}

          <Card className="p-4" accent={eligible ? 'success' : 'warning'}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold">Eligibility Flag</p>
                <p className={`text-[11px] font-semibold ${eligible ? 'text-success' : 'text-warning'}`}>
                  {eligible ? 'ELIGIBLE — Active' : 'LOCKED — Paused'}
                </p>
              </div>
              <span className={`size-2.5 rounded-full ${eligible ? 'bg-success' : 'bg-warning'}`} />
            </div>
            <div className="mt-4 space-y-2 border-t border-line pt-3">
              <FlagRow
                label="Cooldown Lock"
                value={data?.countdown?.locked_by_cooldown ? 'ACTIVE' : 'CLEAR'}
                ok={!data?.countdown?.locked_by_cooldown}
              />
              <FlagRow
                label="Weight Lock"
                value={data?.underweight ? 'ACTIVE' : 'CLEAR'}
                ok={!data?.underweight}
              />
              <FlagRow
                label="Geo-Ripple Pings"
                value={eligible ? 'RECEIVING' : 'EXCLUDED'}
                ok={eligible}
              />
            </div>
            {!eligible && data?.reasons?.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[10px] text-text-muted">
                {data.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <p className="text-xs font-bold">Donor Profile</p>
            <div className="mt-3 space-y-2">
              <ProfileRow k="Name" v={data?.donor_name} />
              <ProfileRow k="Blood Type" v={data?.blood_type} tone="text-primary" />
              <ProfileRow k="Weight" v={health.weight_kg ? `${health.weight_kg} kg` : 'Not set'} />
              <ProfileRow k="Last Donation" v={fmtDate(health.last_donation_date)} />
              <ProfileRow
                k="Type"
                v={
                  health.last_donation_type
                    ? `${health.last_donation_type === 'PLATELETS' ? 'Platelets' : 'Whole Blood'} (${cooldownDays}d)`
                    : '—'
                }
              />
              <ProfileRow
                k="Next Eligible"
                v={data?.countdown?.locked_by_cooldown ? fmtDate(target) : 'Now'}
                tone={data?.countdown?.locked_by_cooldown ? 'text-warning' : 'text-success'}
              />
              <ProfileRow k="Donations" v={String(health.donation_count ?? 0)} />
            </div>
          </Card>

          <CertificateUpload donorId={account?.id} onDone={load} />

          <Button variant="primary" className="w-full" onClick={() => navigate('/donor/requests')}>
            Requests
          </Button>
          <Button variant="outline" className="w-full mt-3 border-donor/30 text-donor hover:bg-donor/10 hover:text-donor" onClick={() => navigate('/donor/profile')}>
            My Profile
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
                value={eligible ? 'ELIGIBLE' : 'LOCKED'}
                sub={eligible ? 'Receiving pings' : 'Excluded from pings'}
                color={eligible ? 'success' : 'warning'}
              />
              <StatCard
                label="Days Remaining"
                value={`${days} days`}
                sub={`of ${progress.total_days ?? cooldownDays}-day cooldown`}
                color={days > 0 ? 'warning' : 'success'}
                subColor="text-text-faint"
              />
              <StatCard
                label="Donation Type"
                value={
                  health.last_donation_type === 'PLATELETS' ? 'Platelets'
                    : health.last_donation_type ? 'Whole Blood' : 'None yet'
                }
                sub={health.last_donation_type ? `${cooldownDays}-day lock period` : 'No cooldown armed'}
                color="admin"
                subColor="text-text-faint"
              />
              <StatCard
                label="Weight Status"
                value={health.weight_kg ? `${health.weight_kg} kg` : 'Not set'}
                sub={
                  data?.underweight
                    ? `Below ${rules.min_weight_kg} kg threshold`
                    : `Above ${rules.min_weight_kg} kg threshold`
                }
                color={data?.underweight ? 'warning' : 'success'}
              />
            </div>

            <Card className="mt-4 p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-text-muted">Live Countdown to Eligibility</p>
                <span
                  className={`inline-flex items-center gap-2 text-xs font-semibold ${
                    remaining > 0 ? 'text-warning' : 'text-success'
                  }`}
                >
                  <span className={`size-2 rounded-full ${remaining > 0 ? 'bg-warning' : 'bg-success'}`} />
                  {remaining > 0 ? 'Counting down' : 'Eligible Now'}
                </span>
              </div>

              <div
                className={`mt-6 flex flex-col items-center justify-center rounded-xl border py-10 ${
                  remaining > 0
                    ? 'border-warning/20 bg-warning/[0.05]'
                    : 'border-success/20 bg-success/[0.05]'
                }`}
              >
                {remaining > 0 ? (
                  <>
                    <Droplet className="size-10 text-warning" />
                    <p className="mt-3 font-mono text-2xl font-bold text-warning">
                      {days}d : {String(hours).padStart(2, '0')}h :{' '}
                      {String(mins).padStart(2, '0')}m : {String(secs).padStart(2, '0')}s
                    </p>
                    <p className="mt-1 text-xs text-text-faint">
                      {health.last_donation_type === 'PLATELETS' ? 'Platelet' : 'Whole-blood'}{' '}
                      cooldown of {progress.total_days ?? cooldownDays} days ends{' '}
                      {new Date(target).toLocaleString()}
                    </p>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-10 text-success" />
                    <p className="mt-3 text-2xl font-bold text-success">0d : 00h : 00m</p>
                    <p className="mt-1 text-xs text-text-faint">
                      {health.last_donation_date
                        ? `Cooldown of ${progress.total_days ?? cooldownDays} days has fully elapsed`
                        : 'No donation on record — no cooldown applies'}
                    </p>
                  </>
                )}
              </div>

              {progress.total_days > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between text-[11px] text-text-faint">
                    <span>Recovery progress</span>
                    <span>
                      {progress.elapsed_days} / {progress.total_days} days
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-full rounded-full ${remaining > 0 ? 'bg-warning' : 'bg-success'}`}
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/[0.05] px-4 py-3 text-[11px] text-text-muted">
                <Droplet className="size-3.5 shrink-0 text-primary" />
                Platelet (apheresis) donations lock eligibility for only{' '}
                {rules.platelet_cooldown_days} days — far less depleting than the{' '}
                {rules.whole_blood_cooldown_days}-day whole-blood window.
              </div>

              {data?.cooldown_waived_at && (
                <p className="mt-3 text-[11px] text-success">
                  An admin released this cooldown early on {fmtDate(data.cooldown_waived_at)} after
                  reviewing your medical certificate.
                </p>
              )}
            </Card>
          </div>
        </section>
      </div>
    </Shell>
  )
}

function FlagRow({ label, value, ok }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-text-faint">{label}</span>
      <span className={`font-semibold ${ok ? 'text-success' : 'text-warning'}`}>{value}</span>
    </div>
  )
}

function ProfileRow({ k, v, tone = 'text-white' }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-text-faint">{k}</span>
      <span className={`font-medium ${tone}`}>{v ?? '—'}</span>
    </div>
  )
}

/**
 * Corner case: a donor locked out for months by a mistyped donation date can
 * upload a timestamped certificate for an admin to review and clear early.
 */
function CertificateUpload({ donorId, onDone }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [correctedDate, setCorrectedDate] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)
  const [mine, setMine] = useState([])

  const loadMine = useCallback(async () => {
    if (!donorId) return
    try {
      setMine(await donorApi.certificates(donorId))
    } catch {
      /* the list is supplementary — a failure here must not block the form */
    }
  }, [donorId])

  useEffect(() => {
    loadMine()
  }, [loadMine])

  async function submit(e) {
    e.preventDefault()
    if (!donorId || busy) return
    setBusy(true)
    setError(null)
    try {
      await donorApi.uploadCertificate(donorId, {
        note: note || null,
        image: file ? await fileToDataUrl(file) : null,
        issued_at: new Date().toISOString(),
        corrected_donation_date: correctedDate
          ? new Date(correctedDate).toISOString()
          : null,
      })
      setMsg('Submitted — an admin will review it shortly.')
      setNote('')
      setCorrectedDate('')
      setFile(null)
      setOpen(false)
      loadMine()
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const pending = mine.filter((c) => c.status === 'PENDING').length

  return (
    <Card className="p-4">
      <Button variant="outline" className="w-full" onClick={() => setOpen((v) => !v)}>
        <FileUp className="size-4" /> Upload Medical Certificate
      </Button>

      {msg && <p className="mt-2 text-[11px] text-success">{msg}</p>}
      {pending > 0 && (
        <p className="mt-2 text-center text-[10px] text-text-faint">
          <Badge color="warning">{pending} awaiting admin review</Badge>
        </p>
      )}

      {open && (
        <form className="mt-4 space-y-3" onSubmit={submit}>
          <Field label="Why should the cooldown be lifted?">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. donation date was mistyped"
            />
          </Field>
          <Field label="Correct donation date" hint="Optional — if the stored date was wrong">
            <Input
              type="date"
              value={correctedDate}
              onChange={(e) => setCorrectedDate(e.target.value)}
            />
          </Field>
          <Field label="Certificate photo" hint="Timestamped document from your clinic">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-[11px] text-text-muted file:mr-3 file:rounded-full file:border-0 file:bg-donor/20 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-donor"
            />
          </Field>
          {error && <p className="text-[11px] text-primary">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Loader2 className="size-4 animate-spin" />} Submit for review
          </Button>
        </form>
      )}
    </Card>
  )
}

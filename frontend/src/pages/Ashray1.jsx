import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import logo from '../assets/icons/logo.svg'
import userIcon from '../assets/icons/user.svg'
import pingsIcon from '../assets/icons/pings.svg'
import controlCenter from '../assets/icons/control-center.svg'
import moonSm from '../assets/icons/moon-sm.svg'
import moonLg from '../assets/icons/moon-lg.svg'
import commute from '../assets/icons/commute.svg'
import gps from '../assets/icons/gps.svg'
import dnd from '../assets/icons/dnd.svg'
import { configApi, donorApi, requestApi } from '../lib/api.js'
import { useSession } from '../lib/session.js'

/* ── Small building blocks ───────────────────────────────────────── */
function Toggle({ on, color = 'bg-donor', onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${
        on ? `${color} border-transparent` : 'border-[#374151] bg-line'
      }`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
          on ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

const tabs = ['Sleep Mode Engine', 'Commute-Aware Matching', 'Ping Activity Log']

function Chip({ children }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-text-muted">
      {children}
    </span>
  )
}

/** Is `hhmm` inside the donor's window? Mirrors the server's midnight-crossing
 *  logic so the panel and the engine agree on "sleeping". */
function inWindow(hhmm, start, end) {
  const mins = (t) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }
  const n = mins(hhmm)
  const s = mins(start)
  const e = mins(end)
  return s <= e ? n >= s && n < e : n >= s || n < e
}

export default function Ashray1() {
  const [activeTab, setActiveTab] = useState(0)
  const { account, loading: sessionLoading } = useSession({ role: 'donor' })

  const [donor, setDonor] = useState(null)
  const [elig, setElig] = useState(null)
  const [logs, setLogs] = useState([])
  const [tz, setTz] = useState('Asia/Dhaka')
  const [staleAfter, setStaleAfter] = useState(15)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!account) return
    try {
      const [d, e] = await Promise.all([
        donorApi.get(account.id),
        donorApi.eligibility(account.id),
      ])
      setDonor(d)
      setElig(e)
      const all = await requestApi.pingLogs().catch(() => [])
      setLogs(all.filter((l) => l.donor_id === account.id))
    } catch (err) {
      setError(err.message)
    }
  }, [account])

  useEffect(() => {
    load()
    configApi
      .get()
      .then((c) => {
        setTz(c.timezone)
        setStaleAfter(c.dispatch.location_stale_after_minutes)
      })
      .catch(() => {})
  }, [load])

  // Local wall-clock time in the deployment's zone — the same basis the
  // backend evaluates the sleep window against.
  const [nowHHMM, setNowHHMM] = useState('--:--')
  useEffect(() => {
    const tick = () =>
      setNowHHMM(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date()),
      )
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [tz])

  async function saveSleep(patch) {
    if (!account || !donor) return
    const sm = { ...donor.sleep_mode, ...patch }
    setDonor({ ...donor, sleep_mode: sm })   // optimistic
    setSaving(true)
    try {
      await donorApi.saveSleepMode(account.id, {
        enabled: sm.enabled,
        start: sm.start,
        end: sm.end,
        allow_extreme_emergencies: sm.allow_extreme_emergencies,
        dnd_on: sm.dnd_on,
      })
    } catch (err) {
      setError(err.message)
      load()
    } finally {
      setSaving(false)
    }
  }

  /** Pause/resume matching. This must never delete the route — a donor who
   *  switches it off should be able to switch it back on without retyping. */
  async function toggleCommute(on) {
    if (!account) return
    if (!(donor?.commute_route?.segments ?? []).length) {
      setError('Add a commute route on the Update Records page first.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await donorApi.toggleRoute(account.id, on)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  /** The engine only fires a proactive route ping while the donor's live fix is
   *  on the matching road, so the panel needs a way to move that fix. */
  async function setLocation(segment) {
    if (!account) return
    setSaving(true)
    setError(null)
    try {
      const loc = donor?.current_location
      await donorApi.updateLocation(
        account.id,
        loc?.lat ?? 23.7806,
        loc?.lng ?? 90.3792,
        segment,
      )
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  /* 24-hour ping histogram from the real audit log. */
  const timeline = useMemo(() => {
    const buckets = Array(24).fill(0)
    logs.forEach((l) => {
      if (!l.pinged) return
      const hour = Number(
        new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false })
          .format(new Date(l.created_at)),
      )
      if (!Number.isNaN(hour)) buckets[hour % 24] += 1
    })
    const peak = Math.max(1, ...buckets)
    return buckets.map((count, hour) => ({
      hour,
      count,
      height: count ? Math.max(18, (count / peak) * 100) : 6,
    }))
  }, [logs, tz])

  const weekPings = useMemo(() => {
    const cutoff = Date.now() - 7 * 86_400_000
    return logs.filter((l) => l.pinged && new Date(l.created_at).getTime() >= cutoff).length
  }, [logs])

  if (sessionLoading || (!donor && !error)) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-ink text-sm text-text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading your control center…
      </div>
    )
  }

  const sm = donor?.sleep_mode ?? {}
  const sleeping = !!sm.enabled
  const segments = donor?.commute_route?.segments ?? []
  // A saved-but-paused route is not the same as no route at all.
  const commuteOn = segments.length > 0 && donor?.commute_route?.enabled !== false
  const currentSegment = donor?.current_location?.road_segment ?? null
  // The engine ignores a fix older than the stale window, so the panel must not
  // claim "you are here now" off one either.
  const fixAgeMin = donor?.current_location?.updated_at
    ? (Date.now() - new Date(donor.current_location.updated_at).getTime()) / 60000
    : Infinity
  const gpsStale = fixAgeMin > staleAfter
  const progress = elig?.progress ?? {}

  const engineStats = [
    {
      label: 'Sleep Window',
      value: `${sm.start ?? '23:00'} – ${sm.end ?? '07:00'}`,
      sub: sm.enabled ? `Protected · now ${nowHHMM} ${tz.split('/')[1] ?? ''}` : 'Sleep Mode off',
      valueColor: 'text-white',
      subColor: 'text-donor',
    },
    {
      label: 'Emergency Override',
      value: sm.allow_extreme_emergencies ? 'ON' : 'OFF',
      sub: sm.allow_extreme_emergencies
        ? 'Life-threatening pings break through'
        : 'Nothing breaks through sleep',
      valueColor: sm.allow_extreme_emergencies ? 'text-success' : 'text-text-faint',
      subColor: sm.allow_extreme_emergencies ? 'text-success/60' : 'text-[#374151]',
    },
    {
      label: 'Sleep Mode',
      value: sleeping ? 'SLEEPING' : 'AWAKE',
      sub: sleeping ? 'Pings suppressed' : 'Receiving pings',
      valueColor: sleeping ? 'text-donor' : 'text-success',
      subColor: sleeping ? 'text-donor/60' : 'text-success/60',
    },
    {
      label: 'OS DND State',
      value: sm.dnd_on ? 'DND ON' : 'DND OFF',
      sub: sm.dnd_on ? 'High-priority pushes flagged to pierce it' : 'Phone reachable',
      valueColor: sm.dnd_on ? 'text-warning' : 'text-success',
      subColor: sm.dnd_on ? 'text-warning/60' : 'text-success/60',
    },
  ]

  // What the engine would decide for a life-threatening request right now.
  const flow = sleeping
    ? [
        { label: '🌙 Sleep Active', cls: 'border-donor/30 bg-donor/10 text-donor' },
        sm.allow_extreme_emergencies
          ? { label: '🚨 Override On', cls: 'border-success/30 bg-success/10 text-success' }
          : { label: '🔕 No Override', cls: 'border-[#374151]/40 bg-[#374151]/20 text-text-faint' },
        sm.dnd_on
          ? { label: '📵 Phone DND', cls: 'border-warning/30 bg-warning/10 text-warning' }
          : { label: '📱 Phone Open', cls: 'border-success/30 bg-success/10 text-success' },
        sm.allow_extreme_emergencies
          ? {
              label: sm.dnd_on ? '✅ Ping Pierces DND' : '✅ Ping Delivered',
              cls: 'border-success/30 bg-success/10 text-success',
            }
          : { label: '❌ Ping Blocked', cls: 'border-primary/30 bg-primary/10 text-primary' },
      ]
    : [
        { label: '☀️ Awake', cls: 'border-success/30 bg-success/10 text-success' },
        elig?.eligible
          ? { label: '🩸 Eligible', cls: 'border-success/30 bg-success/10 text-success' }
          : { label: '⏸️ Cooldown Lock', cls: 'border-warning/30 bg-warning/10 text-warning' },
        commuteOn && !gpsStale && currentSegment && segments.includes(currentSegment)
          ? { label: '🛣️ On Saved Route', cls: 'border-admin/30 bg-admin/10 text-admin' }
          : { label: '📍 Standard Range', cls: 'border-line bg-[#0d111a] text-text-muted' },
        elig?.eligible
          ? { label: '✅ Ping Delivered', cls: 'border-success/30 bg-success/10 text-success' }
          : { label: '❌ Excluded', cls: 'border-primary/30 bg-primary/10 text-primary' },
      ]

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink text-white">
      {/* Ambient glows */}
      <div className="pointer-events-none absolute -left-12 -top-60 h-[486px] w-[400px] rounded-full bg-primary opacity-[0.04] blur-[40px]" />
      <div className="pointer-events-none absolute left-[840px] top-[280px] size-[500px] rounded-full bg-donor opacity-5 blur-[50px]" />
      <div className="pointer-events-none absolute left-[680px] top-[200px] size-[300px] rounded-full bg-admin opacity-[0.04] blur-[35px]" />

      {/* Top bar */}
      <header className="relative z-20 border-b border-line">
        <div className="flex h-16 items-center justify-between gap-4 px-8">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg bg-primary">
                <img src={logo} alt="" className="size-[18px]" />
              </span>
              <span className="text-xl font-bold tracking-tight">Spondon</span>
            </Link>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              DONOR PANEL
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Chip>
              <span className={`size-2 rounded-full ${elig?.eligible ? 'bg-success' : 'bg-warning'}`} />
              {elig?.eligible ? 'Live Dispatch Active' : 'Paused — not eligible'}
            </Chip>
            <Chip>
              <img src={userIcon} alt="" className="size-3.5" />
              {donor?.name}
              <span className="font-bold text-primary">{donor?.blood_type}</span>
            </Chip>
            <Chip>
              <img src={pingsIcon} alt="" className="size-3.5" />
              <span className="font-semibold text-warning">{weekPings} pings this week</span>
            </Chip>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex flex-col lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 border-b border-line lg:w-[340px] lg:border-b-0 lg:border-r">
          <div className="border-b border-line px-5 py-5">
            <div className="flex items-center gap-3">
              <span className="grid size-6 place-items-center rounded-md bg-donor/10">
                <img src={controlCenter} alt="" className="size-[13px]" />
              </span>
              <h2 className="text-sm font-bold">Donor Control Center</h2>
            </div>
            <p className="mt-2 text-xs text-text-faint">
              Manage your availability &amp; smart ping preferences
            </p>
          </div>

          <div className="space-y-5 p-5">
            {error && (
              <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-[11px] text-primary">
                {error}
              </div>
            )}

            {/* Sleep Mode card */}
            <div className="rounded-xl border border-donor/30 bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-7 place-items-center rounded-lg bg-donor/10">
                    <img src={moonSm} alt="" className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold">Sleep Mode</p>
                    <p className="text-[10px] text-text-faint">
                      {sm.start ?? '23:00'} – {sm.end ?? '07:00'}
                    </p>
                  </div>
                </div>
                <Toggle
                  on={!!sm.enabled}
                  color="bg-donor"
                  disabled={saving}
                  onChange={(v) => saveSleep({ enabled: v })}
                />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[9px] uppercase tracking-wide text-text-faint">
                    Start
                  </span>
                  <input
                    type="time"
                    value={sm.start ?? '23:00'}
                    onChange={(e) => saveSleep({ start: e.target.value })}
                    className="w-full rounded-md border border-line bg-[#0d111a] px-2 py-1 text-[11px] text-white outline-none focus:border-donor/60"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[9px] uppercase tracking-wide text-text-faint">
                    End
                  </span>
                  <input
                    type="time"
                    value={sm.end ?? '07:00'}
                    onChange={(e) => saveSleep({ end: e.target.value })}
                    className="w-full rounded-md border border-line bg-[#0d111a] px-2 py-1 text-[11px] text-white outline-none focus:border-donor/60"
                  />
                </label>
              </div>

              <div className="mt-4 rounded-lg border border-donor/15 bg-donor/[0.07] p-3">
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={!!sm.allow_extreme_emergencies}
                    onChange={(e) => saveSleep({ allow_extreme_emergencies: e.target.checked })}
                    className="mt-0.5 size-3.5 shrink-0 accent-donor"
                  />
                  <span>
                    <span className="block text-[11px] font-medium text-text-strong">
                      Wake me for extreme emergencies
                    </span>
                    <span className="mt-0.5 block text-[10px] text-text-faint">
                      Only life-threatening requests will bypass sleep
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {/* Commute Matching card */}
            <div className="rounded-xl border border-admin/30 bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-7 place-items-center rounded-lg bg-admin/10">
                    <img src={commute} alt="" className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold">Commute Matching</p>
                    <p className="text-[10px] text-text-faint">Route-aware ping engine</p>
                  </div>
                </div>
                <Toggle
                  on={commuteOn}
                  color="bg-admin"
                  disabled={saving}
                  onChange={toggleCommute}
                />
              </div>

              <p
                className={`mt-3 flex items-center gap-1.5 text-[10px] ${
                  gpsStale ? 'text-warning' : currentSegment ? 'text-success' : 'text-text-faint'
                }`}
              >
                <img src={gps} alt="" className="size-2.5" />
                {currentSegment
                  ? gpsStale
                    ? `Last fix on ${currentSegment} is over ${staleAfter} min old — treated as "left"`
                    : `GPS active — currently on ${currentSegment}`
                  : 'No live GPS fix on record'}
              </p>

              {segments.length > 0 && !commuteOn && (
                <p className="mt-2 rounded-lg border border-warning/20 bg-warning/[0.07] p-2.5 text-[10px] text-warning">
                  Matching is paused. Your {segments.length} saved segment(s) are kept — switch it
                  back on any time.
                </p>
              )}

              <div className="mt-2 space-y-2">
                {segments.length === 0 && (
                  <p className="rounded-lg border border-line bg-[#0d111a] p-2.5 text-[10px] text-text-faint">
                    No route saved. Add one on{' '}
                    <Link to="/donor/records" className="text-admin">
                      Update Records
                    </Link>
                    .
                  </p>
                )}
                {segments.map((name, i) => {
                  const active = name === currentSegment && !gpsStale
                  return (
                    <button
                      key={name}
                      type="button"
                      disabled={saving}
                      onClick={() => setLocation(name)}
                      title="Report your live GPS as being on this segment"
                      className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors disabled:opacity-50 ${
                        active
                          ? 'border-admin/20 bg-admin/[0.07]'
                          : 'border-line bg-[#0d111a] hover:border-admin/20'
                      }`}
                    >
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-full text-[8px] font-bold text-white ${
                          active ? 'bg-admin' : 'bg-line'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <div className="flex-1">
                        <p
                          className={`text-[11px] font-medium ${
                            active ? 'text-text-strong' : 'text-text-faint'
                          }`}
                        >
                          {name}
                        </p>
                        <p className={`text-[9px] ${active ? 'text-admin' : 'text-[#374151]'}`}>
                          {active ? 'You are here now' : 'Tap to set as your live location'}
                        </p>
                      </div>
                      {active && <span className="size-1.5 rounded-full bg-success" />}
                    </button>
                  )
                })}
                {segments.length > 0 && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setLocation('Off route')}
                    className="w-full rounded-lg border border-line bg-[#0d111a] p-2 text-[10px] text-text-faint hover:border-line/80 disabled:opacity-50"
                  >
                    I have driven past — I am off my route
                  </button>
                )}
              </div>
            </div>

            {/* OS DND card */}
            <div className="rounded-xl border border-line bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-7 place-items-center rounded-lg bg-primary/10">
                    <img src={dnd} alt="" className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold">OS Do Not Disturb</p>
                    <p className="text-[10px] text-text-faint">Phone DND state</p>
                  </div>
                </div>
                <Toggle
                  on={!!sm.dnd_on}
                  disabled={saving}
                  onChange={(v) => saveSleep({ dnd_on: v })}
                />
              </div>
            </div>

            {/* Donor Health Status */}
            <div className="rounded-xl border border-line bg-card p-4">
              <p className="text-xs font-semibold text-text-muted">Donor Health Status</p>
              <div className="mt-3 grid grid-cols-2 gap-y-2 text-[10px]">
                <span className="font-bold text-primary">{donor?.blood_type}</span>
                <span className="text-right text-text-faint">Blood Type</span>
                <span
                  className={`font-semibold ${elig?.eligible ? 'text-success' : 'text-warning'}`}
                >
                  {elig?.eligible ? 'Eligible ✓' : 'Locked'}
                </span>
                <span className="text-right text-text-faint">Cooldown Status</span>
                <span className="font-medium text-text-strong">
                  {elig?.health?.last_donation_date
                    ? `${progress.elapsed_days} days ago`
                    : 'Never'}
                </span>
                <span className="text-right text-text-faint">Last Donation</span>
              </div>
              {progress.total_days > 0 && (
                <>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                    <div
                      className={`h-full rounded-full ${
                        progress.percent >= 100 ? 'bg-success' : 'bg-warning'
                      }`}
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[9px] text-text-faint">
                    {progress.elapsed_days} / {progress.total_days} day cooldown —{' '}
                    {progress.percent}% recovered
                  </p>
                </>
              )}
            </div>

            <div className="rounded-xl border border-line bg-card p-4">
              <p
                className={`flex items-center gap-2 text-[10px] ${
                  sm.dnd_on ? 'text-warning' : 'text-success'
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${sm.dnd_on ? 'bg-warning' : 'bg-success'}`}
                />
                {sm.dnd_on
                  ? 'Phone DND is on — only high-priority pushes will sound'
                  : 'Phone is reachable — all pings delivered normally'}
              </p>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1">
          <div className="flex overflow-x-auto border-b border-line">
            {tabs.map((t, i) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveTab(i)}
                className={`shrink-0 border-b-2 px-8 py-3 text-xs font-semibold transition-colors ${
                  activeTab === i
                    ? 'border-donor bg-donor/[0.03] text-donor'
                    : 'border-transparent text-text-faint hover:text-text-muted'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 p-6 xl:grid-cols-[1fr_220px]">
            <div>
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-donor/10">
                  <img src={moonLg} alt="" className="size-5" />
                </span>
                <div>
                  <h1 className="text-base font-bold">
                    {activeTab === 0
                      ? 'Sleep Mode Engine'
                      : activeTab === 1
                        ? 'Commute-Aware Matching'
                        : 'Ping Activity Log'}
                  </h1>
                  <p className="text-xs text-text-faint">
                    {activeTab === 0
                      ? 'Intelligent ping suppression with emergency override'
                      : activeTab === 1
                        ? 'Pings for requests on roads you already travel'
                        : 'Every dispatch decision recorded against your account'}
                  </p>
                </div>
              </div>

              {activeTab === 0 && (
                <>
                  <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {engineStats.map((s) => (
                      <div key={s.label} className="rounded-xl border border-line bg-card p-4">
                        <p className="text-[10px] text-text-faint">{s.label}</p>
                        <p className={`mt-2 text-lg font-bold ${s.valueColor}`}>{s.value}</p>
                        <p className={`mt-1 text-[10px] ${s.subColor}`}>{s.sub}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-xl border border-line bg-card p-4">
                    <p className="text-xs font-semibold text-text-muted">
                      Decision Flow — a life-threatening request arriving right now
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {flow.map((f, i) => (
                        <div key={f.label} className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold ${f.cls}`}
                          >
                            {f.label}
                          </span>
                          {i < flow.length - 1 && <span className="text-text-faint">›</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {activeTab === 1 && (
                <div className="mt-6 space-y-4">
                  <div className="rounded-xl border border-line bg-card p-4">
                    <p className="text-xs font-semibold text-text-muted">How this works</p>
                    <p className="mt-2 text-[11px] leading-relaxed text-text-faint">
                      A saved route only ever <em>adds</em> reach. When a request sits on a segment
                      you are travelling right now, you get a high-priority proactive ping with zero
                      extra travel. When you have already driven past it, that proactive ping is
                      withheld and you simply receive the standard ping for your area — saving a
                      route never makes you harder to reach.
                    </p>
                  </div>
                  <div className="rounded-xl border border-line bg-card p-4">
                    <p className="text-xs font-semibold text-text-muted">Saved segments</p>
                    {segments.length === 0 ? (
                      <p className="mt-2 text-[11px] text-text-faint">None saved yet.</p>
                    ) : (
                      <ul className="mt-3 space-y-1.5 text-[11px]">
                        {segments.map((s) => (
                          <li key={s} className="flex items-center justify-between">
                            <span className="text-text-strong">{s}</span>
                            <span
                              className={
                                s === currentSegment && !gpsStale
                                  ? 'text-success'
                                  : 'text-text-faint'
                              }
                            >
                              {s === currentSegment && !gpsStale ? 'on it now' : 'idle'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 2 && (
                <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-card">
                  <table className="w-full text-left text-[11px]">
                    <thead className="border-b border-line text-text-faint">
                      <tr>
                        <th className="px-4 py-3 font-medium">When</th>
                        <th className="px-4 py-3 font-medium">Decision</th>
                        <th className="px-4 py-3 font-medium">Priority</th>
                        <th className="px-4 py-3 font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-text-faint">
                            No ping decisions recorded for your account yet.
                          </td>
                        </tr>
                      )}
                      {logs.slice(0, 40).map((l) => (
                        <tr key={l.id} className="border-b border-line/60 last:border-0">
                          <td className="whitespace-nowrap px-4 py-3 text-text-muted">
                            {new Date(l.created_at).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`font-semibold ${
                                l.pinged ? 'text-success' : 'text-text-faint'
                              }`}
                            >
                              {l.decision}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-text-muted">
                            {l.fcm_priority}
                            {l.fcm_bypass_dnd && (
                              <span className="ml-1.5 text-warning">· pierces DND</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-text-faint">{l.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Right rail */}
            <div className="space-y-6">
              <div className="rounded-xl border border-line bg-card p-4">
                <p className="text-xs font-semibold text-text-muted">24h Ping Timeline</p>
                <div className="mt-4 flex h-24 items-end gap-[2px]">
                  {timeline.map((b) => {
                    const inSleep =
                      sm.enabled && inWindow(`${String(b.hour).padStart(2, '0')}:00`, sm.start ?? '23:00', sm.end ?? '07:00')
                    return (
                      <div
                        key={b.hour}
                        title={`${b.hour}:00 — ${b.count} ping(s)`}
                        className={`flex-1 rounded-t ${
                          b.count === 0
                            ? 'bg-line'
                            : inSleep
                              ? 'bg-donor/40'
                              : 'bg-primary/40'
                        }`}
                        style={{ height: `${b.height}%` }}
                      />
                    )
                  })}
                </div>
                <div className="mt-1 flex justify-between border-t border-line pt-1 text-[8px] text-[#374151]">
                  <span>12AM</span>
                  <span>12PM</span>
                  <span>12AM</span>
                </div>
                <div className="mt-3 space-y-1.5 text-[9px] text-text-faint">
                  <p className="flex items-center gap-2">
                    <span className="size-2 rounded bg-donor/40" />
                    Pings during your sleep window
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="size-2 rounded bg-primary/40" />
                    Pings while awake
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-card p-4">
                <p className="text-xs font-semibold text-text-muted">FCM Priority Logic</p>
                <div className="mt-4 space-y-3 text-[10px]">
                  <p className="flex items-center gap-2 font-semibold text-primary">
                    <span className="grid size-4 place-items-center rounded-full bg-primary/10">
                      <span className="size-1.5 rounded-full bg-primary" />
                    </span>
                    LIFE_THREATENING → high
                  </p>
                  <p className="flex items-center gap-2 font-semibold text-warning">
                    <span className="grid size-4 place-items-center rounded-full bg-warning/10">
                      <span className="size-1.5 rounded-full bg-warning" />
                    </span>
                    CRITICAL → normal
                  </p>
                  <p className="mt-2 leading-relaxed text-text-faint">
                    A high-priority push on the emergency channel is what pierces the phone's own
                    Do Not Disturb.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Droplet, User, Loader2, Siren, Radio, Building2, TriangleAlert, Wifi, WifiOff,
  MessageSquare, BellRing,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import CityRadar from '../../components/CityRadar.jsx'
import { Card, StatCard, Tabs, Badge, Button, Field, Input, Select } from '../../components/ui.jsx'
import { Chip } from '../../components/TopBar.jsx'
import { adminApi, configApi, donorApi, getToken, requestApi } from '../../lib/api.js'
import { useDispatchFeed } from '../../lib/realtime.js'

const HOSPITALS = {
  'Square Hospital': { lat: 23.7529, lng: 90.3789 },
  'Dhaka Medical College': { lat: 23.7261, lng: 90.3969 },
  'United Hospital': { lat: 23.8041, lng: 90.4152 },
  'Ibn Sina Hospital': { lat: 23.7465, lng: 90.3712 },
}

const SLIP_OK = ['VERIFIED', 'OCR_CONFIRMED']

export default function RareBlood() {
  const [tab, setTab] = useState(0)
  const [cfg, setCfg] = useState(null)
  const [zones, setZones] = useState([])
  const [donors, setDonors] = useState([])
  const [requests, setRequests] = useState([])
  const [escalations, setEscalations] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [radar, setRadar] = useState(null)
  const [sim, setSim] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const isAdmin = !!getToken()
  const live = useDispatchFeed(selectedId)

  const load = useCallback(async (opts = {}) => {
    try {
      const [c, z, d, r] = await Promise.all([
        configApi.get(),
        configApi.zones(),
        donorApi.list(),
        requestApi.list(),
      ])
      setCfg(c)
      setZones(z.zones)
      setDonors(d)
      setRequests(r)
      if (!opts.quiet) setError(null)
      if (getToken()) adminApi.escalations().then(setEscalations).catch(() => {})
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const rareTypes = useMemo(() => cfg?.dispatch?.rare_blood_types ?? [], [cfg])
  const rareRequests = useMemo(
    () => requests.filter((r) => rareTypes.includes(r.blood_type)),
    [requests, rareTypes],
  )
  const openRare = useMemo(
    () => rareRequests.filter((r) => r.status === 'OPEN'),
    [rareRequests],
  )

  useEffect(() => {
    if (selectedId || !rareRequests.length) return
    setSelectedId((openRare[0] ?? rareRequests[0]).id)
  }, [rareRequests, openRare, selectedId])

  const selected = rareRequests.find((r) => r.id === selectedId) ?? null

  // Zone summary for whichever request is selected.
  const loadRadar = useCallback(async (id) => {
    if (!id) return
    try {
      setRadar(await requestApi.radar(id))
    } catch {
      setRadar(null)
    }
  }, [])

  useEffect(() => {
    loadRadar(selectedId)
  }, [selectedId, loadRadar])

  // Refresh the request row when the socket says something changed, so the
  // escalated / locked state follows the live feed without polling for it.
  const lastEvent = live.lastEventAt
  useEffect(() => {
    if (!lastEvent) return
    load({ quiet: true })
    loadRadar(selectedId)
  }, [lastEvent, load, loadRadar, selectedId])

  const escalationSeconds = radar?.escalation_seconds ?? cfg?.dispatch?.rare_escalation_seconds ?? 180

  async function dispatch(id) {
    setBusy(id)
    setError(null)
    try {
      setSim(await requestApi.evaluate(id))
      await load({ quiet: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function escalateNow(id) {
    setBusy(id)
    try {
      await requestApi.escalate(id)
      await load({ quiet: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const totalRareEligible = useMemo(
    () =>
      donors.filter(
        (d) =>
          d.role === 'donor' &&
          d.status === 'ACTIVE' &&
          d.eligibility?.eligible &&
          rareTypes.includes(d.blood_type),
      ).length,
    [donors, rareTypes],
  )

  return (
    <Shell
      panel="RARE BLOOD OVERRIDE"
      panelColor="primary"
      right={
        <>
          <Chip>
            {live.status === 'reconnecting' || live.status === 'connecting' ? (
              <WifiOff className="size-3.5 text-warning" />
            ) : (
              <Wifi className="size-3.5 text-success" />
            )}
            {live.status === 'reconnecting' ? 'Radar reconnecting…' : 'Radar live'}
          </Chip>
          <Chip><User className="size-3.5" /> Admin</Chip>
        </>
      }
    >
      <div className="flex items-start gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10">
          <Droplet className="size-6 text-primary" />
        </span>
        <div>
          <Badge color="primary" dot={false} className="mb-2">MODULE 1 · FEATURE 3</Badge>
          <h1 className="text-3xl font-bold tracking-tight">Rare-Blood City-Wide Override</h1>
          <p className="mt-2 max-w-2xl text-sm text-text-faint">
            Triage routes a negative type straight to the city-wide service: no radius, every
            eligible donor of that type reached at once by push and SMS, streamed to this radar
            over a WebSocket as it happens.
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-[11px] text-primary">
          <TriangleAlert className="size-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Rare pool city-wide"
          value={String(totalRareEligible)}
          sub={`eligible across ${rareTypes.length} negative types`}
          color="success"
        />
        <StatCard
          label="Reached this broadcast"
          value={String(live.reached)}
          sub={
            radar
              ? `of ${radar.totals.eligible} eligible in ${radar.totals.zones_covered} zone(s)`
              : 'run the override to begin'
          }
          color="primary"
        />
        <StatCard
          label="Escalation timer"
          value={`${escalationSeconds}s`}
          sub="unanswered → blood banks + NGOs"
          color="warning"
        />
        <StatCard
          label="Open rare requests"
          value={String(openRare.length)}
          sub={`${rareRequests.filter((r) => r.escalated).length} escalated so far`}
          color="admin"
        />
      </div>

      <div className="mt-8">
        <Tabs
          tabs={['City-Wide Radar', 'Launch an Emergency', 'Escalation Queue']}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          <RequestPicker
            requests={rareRequests}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id)
              setSim(null)
            }}
          />

          {!selected ? (
            <Card className="p-8 text-center text-[12px] text-text-faint">
              No rare-type requests yet. Open one on the{' '}
              <button type="button" className="text-primary underline" onClick={() => setTab(1)}>
                Launch an Emergency
              </button>{' '}
              tab.
            </Card>
          ) : (
            <div className="space-y-4">
              <SelectedHeader
                req={selected}
                radar={radar}
                live={live}
                busy={busy === selected.id}
                escalationSeconds={escalationSeconds}
                escalation={escalations.find((e) => e.request_id === selected.id)}
                onDispatch={() => dispatch(selected.id)}
                onEscalate={() => escalateNow(selected.id)}
              />

              <Card className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-text-muted">
                    City-Wide Radar — {selected.blood_type} coverage
                  </p>
                  <span className="text-[10px] text-text-faint">
                    {live.status === 'broadcasting'
                      ? 'broadcasting…'
                      : live.status === 'secured'
                        ? 'donor secured'
                        : live.status === 'escalated'
                          ? 'escalated'
                          : 'idle'}
                  </span>
                </div>
                <div className="mt-4">
                  <CityRadar
                    zones={zones}
                    summary={radar}
                    live={live}
                    hospitalZone={radar?.hospital_zone}
                    bloodType={selected.blood_type}
                  />
                </div>
              </Card>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <EventLog live={live} />
                {radar && <Counterfactual radar={radar} />}
              </div>

              <PoolTable
                donors={donors}
                bloodType={selected.blood_type}
                sim={sim}
                live={live}
              />
              {sim && <EngineResult sim={sim} />}
            </div>
          )}
        </div>
      )}

      {tab === 1 && (
        <LaunchPanel
          rareTypes={rareTypes}
          isAdmin={isAdmin}
          onLaunched={async (id) => {
            await load({ quiet: true })
            setSelectedId(id)
            setTab(0)
            // Let the socket subscribe to the new request before the broadcast
            // starts, or the first pings arrive before anyone is listening.
            setTimeout(() => dispatch(id), 700)
          }}
        />
      )}

      {tab === 2 && (
        <EscalationQueue rareRequests={rareRequests} escalations={escalations} cfg={cfg} />
      )}
    </Shell>
  )
}

/* ── Request picker ───────────────────────────────────────────────── */
function RequestPicker({ requests, selectedId, onSelect }) {
  return (
    <Card className="h-fit p-3">
      <p className="px-2 pb-2 text-[10px] uppercase tracking-wide text-text-faint">
        Rare-type requests ({requests.length})
      </p>
      <div className="space-y-1.5">
        {requests.length === 0 && (
          <p className="px-2 py-4 text-[11px] text-text-faint">None yet.</p>
        )}
        {requests.map((r) => {
          const active = r.id === selectedId
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r.id)}
              className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                active
                  ? 'border-primary/30 bg-primary/10'
                  : 'border-line bg-[#0d111a] hover:border-primary/20'
              }`}
            >
              <p className="flex items-center justify-between text-[11px] font-semibold">
                <span className="truncate text-text-strong">{r.patient_name}</span>
                <span className="ml-2 shrink-0 font-bold text-primary">{r.blood_type}</span>
              </p>
              <p className="mt-0.5 truncate text-[10px] text-text-faint">{r.hospital}</p>
              <p className="mt-1 flex flex-wrap gap-1.5 text-[9px]">
                <span className={r.status === 'OPEN' ? 'text-success' : 'text-text-faint'}>
                  {r.status}
                </span>
                {!SLIP_OK.includes(r.slip_status) && (
                  <span className="text-warning">slip {r.slip_status}</span>
                )}
                {r.escalated && <span className="text-warning">escalated</span>}
              </p>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

/* ── Header: triage verdict, controls, live countdown ─────────────── */
function SelectedHeader({
  req, radar, live, busy, escalationSeconds, escalation, onDispatch, onEscalate,
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const openedAt = new Date(req.created_at).getTime()
  const elapsed = Math.max(0, Math.floor((now - openedAt) / 1000))
  const remaining = Math.max(0, escalationSeconds - elapsed)
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  const dispatched = req.dispatch_rounds > 0
  const slipCleared = SLIP_OK.includes(req.slip_status)
  const pct = Math.min(100, (elapsed / escalationSeconds) * 100)
  const escalated = req.escalated || live.status === 'escalated'

  return (
    <Card className="p-5" accent="primary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">
            {req.patient_name} · <span className="text-primary">{req.blood_type}</span>{' '}
            <span className="text-text-faint">{req.component}</span>
          </p>
          <p className="mt-1 text-[11px] text-text-faint">
            {req.hospital} · {radar?.hospital_zone ?? '—'} zone ·{' '}
            {req.severity.replace('_', ' ').toLowerCase()} · {req.dispatch_rounds} round(s)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDispatch} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />}
            Run city-wide override
          </Button>
          {!escalated && (
            <Button variant="ghost" onClick={onEscalate} disabled={busy}>
              <Siren className="size-4" /> Escalate now
            </Button>
          )}
        </div>
      </div>

      {/* Triage verdict — the first decision made about the request */}
      {radar && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px]">
          <span className="rounded-full border border-line px-2.5 py-1 text-text-faint">
            triage
          </span>
          <span className="text-text-faint">›</span>
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-semibold text-primary">
            {radar.rare_blood_override ? 'RARE — CityWideEmergencyService' : 'ExpandingRadiusService'}
          </span>
          <span className="text-text-faint">›</span>
          <span className="rounded-full border border-line px-2.5 py-1 text-text-muted">
            radius: none
          </span>
          <span className="text-text-faint">›</span>
          <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-text-muted">
            <BellRing className="size-3" /> push
            {radar.sms_alerts && (
              <>
                {' + '}
                <MessageSquare className="size-3" /> SMS
              </>
            )}
          </span>
        </div>
      )}

      {!slipCleared && (
        <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-[11px] text-warning">
          The doctor's slip is <b>{req.slip_status}</b>, so no dispatch is authorised — the
          override skips the radius, never the verification. Clear it in the{' '}
          <Link to="/admin" className="underline">admin console</Link>.
        </p>
      )}

      <div className="mt-4 rounded-lg border border-line bg-[#0d111a] p-4">
        {escalated ? (
          <>
            <p className="flex items-center gap-2 text-[11px] font-semibold text-warning">
              <Building2 className="size-3.5" /> ESCALATED — handed to external sourcing
            </p>
            <p className="mt-1.5 text-[10px] text-text-faint">
              {escalation?.reason ?? live.escalated?.reason ??
                'No donor of this type accepted city-wide within the timer.'}
            </p>
            {(escalation?.channels ?? live.escalated?.channels ?? []).map((ch) => (
              <p key={ch.channel} className="mt-1 flex justify-between text-[10px]">
                <span className="text-text-muted">{ch.channel}</span>
                <span className={ch.simulated ? 'text-warning' : 'text-success'}>
                  {ch.simulated ? 'simulated (no endpoint configured)' : 'delivered'}
                </span>
              </p>
            ))}
          </>
        ) : live.secured ? (
          <p className="text-[11px] text-success">
            Donor secured — travelling in from the {live.secured.zone} zone. The escalation timer
            has stopped.
          </p>
        ) : req.status !== 'OPEN' ? (
          <p className="text-[11px] text-text-faint">
            Request is {req.status} — the escalation timer only runs while it is open.
          </p>
        ) : !dispatched || !slipCleared ? (
          <p className="text-[11px] text-text-faint">
            The timer counts only requests that actually reached the donor network. Run the
            override first.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-muted">
                Nobody has accepted for {elapsed}s
              </span>
              <span className={`font-mono font-bold ${remaining ? 'text-warning' : 'text-primary'}`}>
                {remaining ? `${mm}:${ss}` : 'due — sweeping…'}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full transition-all ${remaining ? 'bg-warning' : 'bg-primary'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-[10px] text-text-faint">
              A server-side timer fires the webhooks — this panel is only watching.
            </p>
          </>
        )}
      </div>
    </Card>
  )
}

/* ── Live event log ───────────────────────────────────────────────── */
function EventLog({ live }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-text-muted">WebSocket feed</p>
        <span
          className={`flex items-center gap-1.5 text-[10px] ${
            live.status === 'reconnecting' ? 'text-warning' : 'text-success'
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${
              live.status === 'reconnecting' ? 'bg-warning' : 'bg-success'
            }`}
          />
          {live.status}
        </span>
      </div>
      <div className="mt-3 max-h-[220px] space-y-1.5 overflow-y-auto">
        {live.log.length === 0 && (
          <p className="text-[11px] text-text-faint">
            No events yet. Run the override and they arrive here as the server sends them.
          </p>
        )}
        {live.log.map((l) => (
          <p key={l.id} className="flex gap-2 text-[10px]">
            <span className="shrink-0 font-mono text-[#4b5563]">
              {new Date(l.at).toLocaleTimeString()}
            </span>
            <span className="text-text-muted">{l.text}</span>
          </p>
        ))}
      </div>
    </Card>
  )
}

/* ── Ripple counterfactual (aggregate counts only) ────────────────── */
function Counterfactual({ radar }) {
  const total = radar.totals.eligible
  const max = Math.max(1, total)
  const stages = radar.ripple_preview ?? []
  const last = stages[stages.length - 1]
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold text-text-muted">
        What the expanding ripple would have done
      </p>
      <div className="mt-4 space-y-2.5">
        {stages.map((s) => (
          <div key={s.radius_km} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-[10px] text-text-faint">
              {s.radius_km} km · t+{s.after_minutes}m
            </span>
            <div className="h-4 flex-1 overflow-hidden rounded bg-line">
              <div className="h-full rounded bg-[#4b5563]" style={{ width: `${(s.count / max) * 100}%` }} />
            </div>
            <span className="w-16 shrink-0 text-right text-[10px] text-text-muted">{s.count}</span>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-[10px] font-semibold text-primary">override · t+0</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-line">
            <div className="h-full rounded bg-primary" style={{ width: '100%' }} />
          </div>
          <span className="w-16 shrink-0 text-right text-[10px] font-semibold text-primary">
            {total}
          </span>
        </div>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-text-faint">
        The ripple reaches {stages[0]?.count ?? 0} of these donors immediately and would need{' '}
        {last?.after_minutes ?? 20} minutes to consider {last?.count ?? 0}. The override reaches
        all {total} at once — a rare type cannot be assumed to be nearby, so proximity is the
        wrong thing to spend minutes on.
      </p>
    </Card>
  )
}

/* ── Pool table (zones, never coordinates) ────────────────────────── */
function PoolTable({ donors, bloodType, sim }) {
  const rows = donors.filter((d) => d.role === 'donor' && d.blood_type === bloodType)
  const decisions = new Map((sim?.results ?? []).map((d) => [d.donor_id, d]))
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left text-[11px]">
        <thead className="border-b border-line text-text-faint">
          <tr>
            <th className="px-4 py-3 font-medium">Donor</th>
            <th className="px-4 py-3 font-medium">Zone</th>
            <th className="px-4 py-3 font-medium">In the pool?</th>
            <th className="px-4 py-3 font-medium">Last engine decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-text-faint">
                No donor of this blood type is registered yet.
              </td>
            </tr>
          )}
          {rows.map((r) => {
            const d = decisions.get(r.id)
            const eligible = r.status === 'ACTIVE' && r.eligibility?.eligible
            return (
              <tr key={r.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 text-text-strong">{r.name}</td>
                <td className="px-4 py-3 text-text-muted">{r.zone}</td>
                <td className="px-4 py-3">
                  {eligible ? (
                    <span className="text-success">eligible</span>
                  ) : (
                    <span className="text-text-faint">
                      excluded —{' '}
                      {r.status !== 'ACTIVE'
                        ? `account is ${r.status}`
                        : (r.eligibility?.reasons ?? []).join('; ') || 'not eligible'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {d ? (
                    <span className={d.pinged ? 'text-success' : 'text-text-faint'}>
                      {d.decision}
                      {d.sms && <span className="ml-1.5 text-text-faint">· SMS sent</span>}
                    </span>
                  ) : (
                    <span className="text-[#4b5563]">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="border-t border-line px-4 py-2.5 text-[10px] text-text-faint">
        Zone, not position. The public donor roster carries no coordinates and no phone number —
        an admin reads full records in the console.
      </p>
    </Card>
  )
}

/* ── Raw engine result ────────────────────────────────────────────── */
function EngineResult({ sim }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold text-text-muted">Engine response</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-3">
        <Row label="Dispatch mode" value={sim.dispatch_mode} />
        <Row label="Rare override" value={sim.rare_blood_override ? 'yes' : 'no'} />
        <Row label="Radius applied" value={sim.radius_km ? `${sim.radius_km} km` : 'none'} />
        <Row label="Candidates" value={String(sim.candidates)} />
        <Row label="Reachable" value={String(sim.reachable)} />
        <Row label="Pinged" value={String(sim.pinged)} />
        <Row label="Push delivery" value={sim.push_delivery ?? '—'} />
        {sim.blocked_reason && <Row label="Blocked" value={sim.blocked_reason} />}
      </dl>
    </Card>
  )
}

function Row({ label, value }) {
  return (
    <div>
      <dt className="text-text-faint">{label}</dt>
      <dd className="text-text-muted">{value}</dd>
    </div>
  )
}

/* ── Launch a rare emergency ──────────────────────────────────────── */
function LaunchPanel({ rareTypes, isAdmin, onLaunched }) {
  const [form, setForm] = useState({
    patient_name: 'Farzana Islam',
    hospital: 'Square Hospital',
    blood_type: 'AB-',
    component: 'PLATELETS',
    severity: 'LIFE_THREATENING',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [steps, setSteps] = useState([])
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function launch() {
    setBusy(true)
    setError(null)
    setSteps([])
    const note = (s) => alive.current && setSteps((v) => [...v, s])
    try {
      const coords = HOSPITALS[form.hospital] ?? HOSPITALS['Square Hospital']
      const req = await requestApi.create({
        ...form,
        units: 1,
        hospital_lat: coords.lat,
        hospital_lng: coords.lng,
      })
      note(`Request opened for ${form.patient_name} (${form.blood_type}).`)
      await adminApi.reviewSlip(req.id, 'VERIFY')
      note('Doctor’s slip verified — dispatch authorised.')
      note('Switching to the radar…')
      onLaunched(req.id)
    } catch (err) {
      setError(
        err.status === 401
          ? 'Your admin session has expired — sign in again to verify the slip.'
          : err.message,
      )
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  if (!isAdmin) {
    return (
      <Card className="mt-6 p-6 text-[12px] text-text-faint">
        Launching an emergency verifies its doctor's slip, which is an admin action.{' '}
        <Link to="/admin/login" className="text-primary underline">
          Sign in to the admin console
        </Link>{' '}
        and come back.
      </Card>
    )
  }

  return (
    <Card className="mt-6 max-w-2xl p-6">
      <p className="text-sm font-bold">Open a rare-blood emergency</p>
      <p className="mt-1 text-[11px] text-text-faint">
        Creates a real request, clears its slip, then runs the override live on the radar.
      </p>
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Patient name">
          <Input value={form.patient_name} onChange={set('patient_name')} />
        </Field>
        <Field label="Hospital">
          <Select value={form.hospital} onChange={set('hospital')}>
            {Object.keys(HOSPITALS).map((h) => <option key={h} value={h}>{h}</option>)}
          </Select>
        </Field>
        <Field label="Blood type" hint="Only negative types trigger the override">
          <Select value={form.blood_type} onChange={set('blood_type')}>
            {rareTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Component">
          <Select value={form.component} onChange={set('component')}>
            <option value="PLATELETS">Platelets</option>
            <option value="WHOLE_BLOOD">Whole Blood</option>
            <option value="PLASMA">Plasma</option>
          </Select>
        </Field>
        <Field label="Severity">
          <Select value={form.severity} onChange={set('severity')}>
            <option value="LIFE_THREATENING">Life-threatening</option>
            <option value="CRITICAL">Critical</option>
            <option value="NORMAL">Normal</option>
          </Select>
        </Field>
      </div>

      <Button className="mt-5" onClick={launch} disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Siren className="size-4" />}
        Launch &amp; broadcast city-wide
      </Button>

      {steps.map((s) => (
        <p key={s} className="mt-2 text-[11px] text-success">✓ {s}</p>
      ))}
      {error && (
        <p className="mt-3 flex items-center gap-2 text-[11px] text-primary">
          <TriangleAlert className="size-3.5" /> {error}
        </p>
      )}
    </Card>
  )
}

/* ── Escalation queue ─────────────────────────────────────────────── */
function EscalationQueue({ rareRequests, escalations, cfg }) {
  const escalated = rareRequests.filter((r) => r.escalated)
  const live = cfg?.integrations?.blood_bank || cfg?.integrations?.ngo_hotline

  return (
    <div className="mt-6 space-y-4">
      <Card className="p-5 text-[12px] leading-relaxed text-text-muted">
        A city-wide ping unanswered for{' '}
        <span className="font-semibold text-warning">
          {cfg?.dispatch?.rare_escalation_seconds ?? '…'} seconds
        </span>{' '}
        fires webhooks to national blood-bank APIs and partner NGO hotlines from a server-side
        sweep, so the family is never left with a dead end and no browser has to be open.{' '}
        {live ? (
          <span className="text-success">Partner delivery is live on this deployment.</span>
        ) : (
          <span className="text-warning">
            No partner endpoint is configured here, so each hand-off is recorded and marked
            simulated rather than claiming a delivery that never happened.
          </span>
        )}
      </Card>

      {escalated.length === 0 && (
        <Card className="p-6 text-center text-[11px] text-text-faint">
          Nothing has escalated yet.
        </Card>
      )}

      {escalated.map((r) => {
        const esc = escalations.find((e) => e.request_id === r.id)
        return (
          <Card key={r.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[12px] font-semibold">
                  {r.patient_name} · <span className="text-primary">{r.blood_type}</span>
                </p>
                <p className="text-[10px] text-text-faint">
                  {r.hospital} · opened {new Date(r.created_at).toLocaleString()}
                </p>
              </div>
              <Badge color={esc?.status === 'SOURCED' ? 'success' : 'warning'}>
                {esc?.status ?? 'ESCALATED'}
              </Badge>
            </div>
            {esc?.reason && <p className="mt-2 text-[10px] text-text-faint">{esc.reason}</p>}
            {esc?.channels?.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-line pt-2 text-[10px]">
                {esc.channels.map((ch) => (
                  <li key={ch.channel} className="flex justify-between">
                    <span className="text-text-muted">{ch.channel}</span>
                    <span className={ch.simulated ? 'text-warning' : 'text-success'}>
                      {ch.simulated ? 'simulated' : 'delivered'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )
      })}
    </div>
  )
}

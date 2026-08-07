import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Radio, Play, RotateCcw, User, Building2, Droplet, Clock, Loader2, TriangleAlert,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { AdminChips } from '../../components/RoleChips.jsx'
import { Card, Tabs, Button, Badge, Select } from '../../components/ui.jsx'
import { Chip } from '../../components/TopBar.jsx'
import { configApi, requestApi } from '../../lib/api.js'

const SEVERITY_COLOR = {
  LIFE_THREATENING: 'primary',
  CRITICAL: 'warning',
  NORMAL: 'admin',
}

function elapsedLabel(iso) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m ${secs % 60}s`
}

export default function GeoRipple() {
  const [tab, setTab] = useState(0)
  const [cfg, setCfg] = useState(null)
  const [requests, setRequests] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [result, setResult] = useState(null)
  const [logs, setLogs] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const all = await requestApi.list()
      setRequests(all)
      setSelectedId((cur) => cur || all.find((r) => r.status === 'OPEN')?.id || all[0]?.id || '')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    load()
    configApi.get().then(setCfg).catch(() => {})
  }, [load])

  const selected = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  )

  useEffect(() => {
    setResult(null)
    if (!selectedId) return
    requestApi.pingLogs(selectedId).then(setLogs).catch(() => setLogs([]))
  }, [selectedId])

  // Memoised so the fallback empty array is stable across renders.
  const ripple = useMemo(() => cfg?.dispatch?.ripple_stages ?? [], [cfg])
  const rare = cfg?.dispatch?.rare_blood_types ?? []
  const isRare = selected ? rare.includes(selected.blood_type) : false

  // Which stage the request has actually reached, from how long it has been open.
  const currentStage = useMemo(() => {
    if (!selected || !ripple.length) return 0
    const mins = (Date.now() - new Date(selected.created_at).getTime()) / 60000
    let stage = 1
    ripple.forEach((s, i) => {
      if (mins >= s.after_minutes) stage = i + 1
    })
    return stage
  }, [selected, ripple])

  async function dispatch() {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await requestApi.evaluate(selected.id)
      setResult(res)
      setLogs(await requestApi.pingLogs(selected.id).catch(() => []))
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const infoCards = selected
    ? [
        {
          icon: User, label: 'Patient', value: selected.patient_name,
          sub: `${selected.severity.replace(/_/g, ' ').toLowerCase()} · ${selected.status}`,
        },
        {
          icon: Building2, label: 'Hospital', value: selected.hospital,
          sub: selected.hospital_location
            ? `${selected.hospital_location.lat.toFixed(4)}, ${selected.hospital_location.lng.toFixed(4)}`
            : 'No coordinates on file',
        },
        {
          icon: Droplet, label: 'Blood Type Required', value: selected.blood_type,
          sub: `${selected.units} unit(s) · ${selected.component.replace(/_/g, ' ').toLowerCase()}`,
          valueColor: 'text-primary',
        },
        {
          icon: Clock, label: 'Request Time',
          value: new Date(selected.created_at).toLocaleTimeString(),
          sub: `Elapsed ${elapsedLabel(selected.created_at)}`, subColor: 'text-warning',
        },
      ]
    : []

  return (
    <Shell
      panel="DISPATCH ENGINE"
      panelColor="primary"
      right={
        <>
          <AdminChips />
          {selected && (
            <Chip className="hidden sm:inline-flex">
              <span className="font-semibold text-warning">
                REQ-{selected.id.slice(-6).toUpperCase()}
              </span>
            </Chip>
          )}
        </>
      }
    >
      <Tabs
        tabs={['Ripple Dashboard', 'Donor Pool', 'Dispatch Log']}
        active={tab}
        onChange={setTab}
      />

      <div className="pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10">
              <Radio className="size-5 text-primary" />
            </span>
            <div>
              <h1 className="text-lg font-bold">Expanding Geo-Ripple Dispatch</h1>
              <p className="text-xs text-text-faint">
                Spatial matching engine — staged radius expansion with driving-route override
              </p>
            </div>
          </div>
          {selected && (
            <div className="flex gap-2">
              <Badge color={SEVERITY_COLOR[selected.severity] ?? 'admin'} dot={false}>
                {selected.severity.replace(/_/g, ' ')}
              </Badge>
              <Badge color="admin" dot={false}>
                REQ-{selected.id.slice(-6).toUpperCase()}
              </Badge>
            </div>
          )}
        </div>

        <div className="mt-5 max-w-md">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Request
          </span>
          <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {requests.length === 0 && <option value="">No requests in the database</option>}
            {requests.map((r) => (
              <option key={r.id} value={r.id}>
                {r.patient_name} · {r.blood_type} · {r.hospital} ({r.status})
              </option>
            ))}
          </Select>
        </div>

        {error && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-[11px] text-primary">
            <TriangleAlert className="size-3.5 shrink-0" /> {error}
          </p>
        )}

        {/* Info cards */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {infoCards.map((c) => (
            <Card key={c.label} className="p-4">
              <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-faint">
                <c.icon className="size-3.5" /> {c.label}
              </p>
              <p className={`mt-2 text-base font-bold ${c.valueColor ?? 'text-white'}`}>{c.value}</p>
              <p className={`mt-1 text-[11px] ${c.subColor ?? 'text-text-faint'}`}>{c.sub}</p>
            </Card>
          ))}
        </div>

        {tab === 0 && (
          <Card className="mt-4 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-text-muted">Geo-Ripple Expansion Stages</p>
                <p className="mt-1 text-[11px] text-text-faint">
                  The radius widens automatically with how long the request has been open
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={dispatch} disabled={!selected || busy} className="px-4 py-2 text-xs">
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  Run Dispatch
                </Button>
                <Button variant="ghost" onClick={() => setResult(null)} className="px-4 py-2 text-xs">
                  <RotateCcw className="size-3.5" /> Clear
                </Button>
              </div>
            </div>

            {isRare ? (
              <div className="mt-6 rounded-xl border border-primary/30 bg-primary/[0.07] p-5">
                <p className="text-sm font-bold text-primary">City-wide override in effect</p>
                <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
                  {selected.blood_type} is a rare negative type, so the staged 3 → 5 → 10 km search
                  is skipped entirely and every eligible donor of that type across the city is
                  pinged at once. Rare types cannot be assumed to be available nearby.
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {ripple.map((s, i) => {
                  const n = i + 1
                  const reached = currentStage >= n
                  const pinged = result && result.radius_km === s.radius_km ? result.pinged : null
                  return (
                    <div key={s.radius_km} className="flex items-center gap-4">
                      <span
                        className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                          reached ? 'bg-success text-white' : 'bg-line text-text-faint'
                        }`}
                      >
                        {n}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <p
                            className={`text-sm font-semibold ${
                              reached ? 'text-success' : 'text-text-faint'
                            }`}
                          >
                            Stage {n} — {s.radius_km} km radius
                            {s.after_minutes > 0 && (
                              <span className="ml-2 text-[10px] font-normal text-text-faint">
                                after {s.after_minutes} min
                              </span>
                            )}
                          </p>
                          <span className="text-[10px] text-text-faint">
                            {pinged != null
                              ? `${pinged} donor(s) pinged`
                              : reached
                                ? 'reached'
                                : '—'}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                          <div
                            className={`h-full rounded-full bg-success transition-all duration-700 ${
                              reached ? 'w-full' : 'w-0'
                            }`}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {result && (
              <div className="mt-5 space-y-1.5 rounded-lg border border-line bg-[#0d111a] p-4 text-[11px]">
                <Row label="Dispatch mode" value={result.dispatch_mode} />
                <Row
                  label="Radius applied"
                  value={result.radius_km ? `${result.radius_km} km` : 'none (city-wide)'}
                />
                <Row label="Eligible candidates" value={String(result.candidates)} />
                <Row label="In range" value={String(result.reachable)} />
                <Row label="Pinged" value={String(result.pinged)} />
                <Row label="Push delivery" value={result.push_delivery ?? '—'} />
                {result.blocked_reason && <Row label="Blocked" value={result.blocked_reason} />}
              </div>
            )}

            <div className="mt-5 rounded-lg border border-admin/20 bg-admin/[0.05] px-4 py-3 text-[11px] text-text-muted">
              <span className="font-semibold text-admin">River-route override:</span>{' '}
              {/* Three states, not two — a key that is present but refused is a
                  different problem from no key at all, and telling an operator to
                  set a variable they already set sends them the wrong way. */}
              {cfg?.integrations?.maps ? (
                <>
                  the Maps API is answering, so straight-line radius is replaced with real
                  driving-route distance — a donor across the Buriganga with no nearby bridge is
                  correctly treated as far away.
                </>
              ) : cfg?.integrations?.maps_key_present ? (
                <>
                  <span className="font-semibold text-warning">
                    a Maps key is configured but Google refused it
                  </span>
                  , so the ripple is measuring straight-line distance. Donors across a river will
                  be treated as nearer than they can actually drive.{' '}
                  {cfg.integrations.maps_error && (
                    <span className="mt-1 block break-words text-[10px] text-text-faint">
                      {cfg.integrations.maps_error}
                    </span>
                  )}
                </>
              ) : (
                <>
                  no Maps API key is configured on this deployment, so distances fall back to
                  great-circle. Set <code>GOOGLE_MAPS_API_KEY</code> to use real driving-route
                  distance across rivers.
                </>
              )}
            </div>
          </Card>
        )}

        {tab === 1 && result && (
          <Card className="mt-4 p-6">
            <p className="text-sm font-semibold text-text-muted">Donor pool for this dispatch</p>
            <ul className="mt-4 space-y-1.5 text-[11px]">
              {result.results.map((d) => (
                <li key={d.donor_id} className="flex items-center justify-between gap-3">
                  <span className="text-text-strong">
                    {d.donor_name}
                    {d.distance_km != null && (
                      <span className="ml-2 text-text-faint">{d.distance_km} km</span>
                    )}
                  </span>
                  <span className={d.pinged ? 'text-success' : 'text-text-faint'}>{d.decision}</span>
                </li>
              ))}
            </ul>
            {result.out_of_range?.length > 0 && (
              <>
                <p className="mt-5 text-xs font-semibold text-text-muted">
                  Outside the current radius
                </p>
                <ul className="mt-2 space-y-1 text-[11px] text-text-faint">
                  {result.out_of_range.map((d) => (
                    <li key={d.donor_id} className="flex justify-between gap-3">
                      <span>{d.donor_name}</span>
                      <span>{d.distance_km} km</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {result.excluded?.length > 0 && (
              <>
                <p className="mt-5 text-xs font-semibold text-text-muted">
                  Excluded from the pool
                </p>
                <ul className="mt-2 space-y-1 text-[11px] text-text-faint">
                  {result.excluded.map((d) => (
                    <li key={d.donor_id}>
                      {d.donor_name} — {d.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        )}

        {tab === 1 && !result && (
          <Card className="mt-4 p-8 text-center text-[11px] text-text-faint">
            Run a dispatch to see the donor pool the engine actually built.
          </Card>
        )}

        {tab === 2 && (
          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full text-left text-[11px]">
              <thead className="border-b border-line text-text-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Donor</th>
                  <th className="px-4 py-3 font-medium">Decision</th>
                  <th className="px-4 py-3 font-medium">Distance</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-text-faint">
                      No dispatch decisions recorded for this request yet.
                    </td>
                  </tr>
                )}
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-line/60 last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-text-muted">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-text-strong">{l.donor_name}</td>
                    <td className="px-4 py-3">
                      <span className={l.pinged ? 'text-success' : 'text-text-faint'}>
                        {l.decision}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {l.distance_km != null ? `${l.distance_km.toFixed(1)} km` : '—'}
                    </td>
                    <td className="px-4 py-3 text-text-faint">{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </Shell>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-text-faint">{label}</span>
      <span className="text-right text-text-muted">{value}</span>
    </div>
  )
}

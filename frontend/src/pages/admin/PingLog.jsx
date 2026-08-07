import { useEffect, useMemo, useState } from 'react'
import { Activity, Loader2, TriangleAlert } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { AdminChips } from '../../components/RoleChips.jsx'
import { Card } from '../../components/ui.jsx'
import { requestApi } from '../../lib/api.js'

/** Filters map to the decisions the engine actually emits. */
const FILTERS = [
  { key: 'all', label: 'All Decisions', color: 'text-white', dot: 'bg-text-faint' },
  { key: 'delivered', label: 'Pinged', color: 'text-success', dot: 'bg-success' },
  { key: 'route', label: 'Route Match', color: 'text-admin', dot: 'bg-admin' },
  { key: 'breakthrough', label: 'Emergency Break', color: 'text-primary', dot: 'bg-primary' },
  { key: 'suppressed', label: 'Sleep Suppressed', color: 'text-donor', dot: 'bg-donor' },
]

const matches = (log, key) => {
  switch (key) {
    case 'delivered': return log.pinged
    case 'route': return log.decision === 'ROUTE_MATCH'
    case 'breakthrough': return log.decision === 'EMERGENCY_BREAKTHROUGH'
    case 'suppressed': return log.decision === 'SKIPPED_SLEEP'
    default: return true
  }
}

const HOURS = 48

export default function PingLog() {
  const [active, setActive] = useState('all')
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    requestApi
      .pingLogs()
      .then(setLogs)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [f.key, logs.filter((l) => matches(l, f.key)).length]),
      ),
    [logs],
  )

  const filtered = useMemo(() => logs.filter((l) => matches(l, active)), [logs, active])

  /* 48 hourly buckets ending now, coloured by the dominant decision. */
  const bars = useMemo(() => {
    const now = Date.now()
    const buckets = Array.from({ length: HOURS }, () => ({
      pinged: 0, suppressed: 0, route: 0, total: 0,
    }))
    logs.forEach((l) => {
      const hoursAgo = Math.floor((now - new Date(l.created_at).getTime()) / 3_600_000)
      if (hoursAgo < 0 || hoursAgo >= HOURS) return
      const b = buckets[HOURS - 1 - hoursAgo]
      b.total += 1
      if (l.decision === 'ROUTE_MATCH') b.route += 1
      else if (l.pinged) b.pinged += 1
      else b.suppressed += 1
    })
    const peak = Math.max(1, ...buckets.map((b) => b.total))
    return buckets.map((b) => ({
      ...b,
      height: b.total ? Math.max(8, (b.total / peak) * 100) : 3,
      cls:
        b.total === 0 ? 'bg-line'
          : b.route >= b.pinged && b.route >= b.suppressed ? 'bg-admin/60'
            : b.suppressed > b.pinged ? 'bg-donor/50'
              : 'bg-primary/60',
    }))
  }, [logs])

  const pingedTotal = counts.delivered ?? 0
  const successRate = logs.length ? Math.round((pingedTotal / logs.length) * 100) : 0
  const todayCount = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return logs.filter((l) => new Date(l.created_at) >= start).length
  }, [logs])
  const dndPierced = useMemo(() => logs.filter((l) => l.fcm_bypass_dnd).length, [logs])

  return (
    <Shell panel="ADMIN PANEL" panelColor="admin" right={<AdminChips label="System Admin" />}>
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 space-y-4 lg:w-[280px]">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/10">
              <Activity className="size-4 text-primary" />
            </span>
            <div>
              <h2 className="text-sm font-bold">Ping Activity Log</h2>
              <p className="text-[11px] text-text-faint">Full dispatch history &amp; outcomes</p>
            </div>
          </div>

          <Card className="p-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setActive(f.key)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-xs transition-colors ${
                  active === f.key ? 'bg-[#0d111a]' : 'hover:bg-[#0d111a]'
                }`}
              >
                <span className="flex items-center gap-2 text-text-muted">
                  <span className={`size-2 rounded-full ${f.dot}`} />
                  {f.label}
                </span>
                <span className={`font-bold ${f.color}`}>{counts[f.key] ?? 0}</span>
              </button>
            ))}
          </Card>

          <Card className="p-4">
            <p className="text-xs font-semibold text-text-muted">Quick Stats</p>
            <div className="mt-3 space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-text-faint">Ping-through rate</span>
                <span className="font-bold text-success">{successRate}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-success"
                  style={{ width: `${successRate}%` }}
                />
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-text-faint">DND-piercing pushes</span>
                <span className="font-bold text-admin">{dndPierced}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-faint">Today&apos;s decisions</span>
                <span className="font-bold text-white">{todayCount}</span>
              </div>
            </div>
          </Card>
        </aside>

        {/* Main */}
        <section className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10">
                <Activity className="size-5 text-primary" />
              </span>
              <div>
                <h1 className="text-lg font-bold">Ping Activity Log</h1>
                <p className="text-xs text-text-faint">
                  Real-time dispatch history &amp; donor response tracking
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <div
                  key={f.key}
                  className="rounded-lg border border-line bg-card px-3 py-2 text-center"
                >
                  <p className={`text-base font-bold ${f.color}`}>{counts[f.key] ?? 0}</p>
                  <p className="text-[9px] text-text-faint">{f.label}</p>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="mt-6 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-[11px] text-primary">
              <TriangleAlert className="size-3.5 shrink-0" /> {error}
            </p>
          )}

          <Card className="mt-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text-muted">48h Ping Volume Timeline</p>
                <p className="text-[11px] text-text-faint">
                  Dispatch activity over the last 48 hours
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-[10px] text-text-faint">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-primary/60" />Active pings
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-donor/50" />Sleep suppressed
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-sm bg-admin/60" />Route match
                </span>
              </div>
            </div>

            {loading ? (
              <p className="mt-6 flex items-center gap-2 text-[11px] text-text-faint">
                <Loader2 className="size-3.5 animate-spin" /> Loading dispatch history…
              </p>
            ) : (
              <>
                <div className="mt-6 flex h-40 items-end gap-[3px]">
                  {bars.map((b, i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-t ${b.cls} transition-opacity hover:opacity-100`}
                      style={{ height: `${b.height}%` }}
                      title={`${HOURS - 1 - i}h ago — ${b.total} decision(s)`}
                    />
                  ))}
                </div>
                <div className="mt-2 flex justify-between border-t border-line pt-2 text-[9px] text-text-faint">
                  <span>48h ago</span>
                  <span>36h ago</span>
                  <span>24h ago</span>
                  <span>12h ago</span>
                  <span>Now</span>
                </div>
              </>
            )}
          </Card>

          <Card className="mt-4 overflow-x-auto p-0">
            <table className="w-full text-left text-[11px]">
              <thead className="border-b border-line text-text-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Donor</th>
                  <th className="px-4 py-3 font-medium">Decision</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-text-faint">
                      No decisions match this filter yet.
                    </td>
                  </tr>
                )}
                {filtered.slice(0, 100).map((l) => (
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
                      {l.fcm_priority}
                      {l.fcm_bypass_dnd && <span className="ml-1.5 text-warning">· pierces DND</span>}
                      {l.delivery_simulated && (
                        <span className="ml-1.5 text-text-faint">· simulated</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-faint">{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      </div>
    </Shell>
  )
}

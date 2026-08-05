import { useState } from 'react'
import { Activity } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { AdminChips } from '../../components/RoleChips.jsx'
import { Card } from '../../components/ui.jsx'

const filters = [
  { key: 'all', label: 'All Pings', count: 847, color: 'text-white', dot: 'bg-text-faint' },
  { key: 'fulfilled', label: 'Fulfilled', count: 612, color: 'text-success', dot: 'bg-success' },
  { key: 'pending', label: 'Pending', count: 23, color: 'text-warning', dot: 'bg-warning' },
  { key: 'escalated', label: 'Escalated', count: 48, color: 'text-primary', dot: 'bg-primary' },
  { key: 'suppressed', label: 'Suppressed', count: 164, color: 'text-donor', dot: 'bg-donor' },
]

// 48 hourly bars, each split into a dominant category
const cats = ['bg-primary/60', 'bg-donor/50', 'bg-success/60']
const bars = Array.from({ length: 48 }, (_, i) => ({
  h: 30 + Math.round(50 * Math.abs(Math.sin(i / 3.5)) + (i % 5) * 4),
  c: cats[i % 3],
}))

export default function PingLog() {
  const [active, setActive] = useState('all')

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
            {filters.map((f) => (
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
                <span className={`font-bold ${f.color}`}>{f.count}</span>
              </button>
            ))}
          </Card>

          <Card className="p-4">
            <p className="text-xs font-semibold text-text-muted">Quick Stats</p>
            <div className="mt-3 space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-text-faint">Success Rate</span>
                <span className="font-bold text-success">72.3%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full w-[72%] rounded-full bg-success" />
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-text-faint">Avg Response</span>
                <span className="font-bold text-admin">7.3 min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-faint">Today's Pings</span>
                <span className="font-bold text-white">34</span>
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
              {filters.map((f) => (
                <div key={f.key} className="rounded-lg border border-line bg-card px-3 py-2 text-center">
                  <p className={`text-base font-bold ${f.color}`}>{f.count}</p>
                  <p className="text-[9px] text-text-faint">{f.label}</p>
                </div>
              ))}
            </div>
          </div>

          <Card className="mt-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text-muted">48h Ping Volume Timeline</p>
                <p className="text-[11px] text-text-faint">Dispatch activity over the last 48 hours</p>
              </div>
              <div className="flex flex-wrap gap-3 text-[10px] text-text-faint">
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-primary/60" />Active pings</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-donor/50" />Sleep suppressed</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-success/60" />Fulfilled</span>
              </div>
            </div>

            <div className="mt-6 flex h-40 items-end gap-[3px]">
              {bars.map((b, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-t ${b.c} transition-opacity hover:opacity-100 ${
                    active === 'all' ? '' : 'opacity-40'
                  }`}
                  style={{ height: `${b.h}%` }}
                  title={`${b.h} pings`}
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
          </Card>
        </section>
      </div>
    </Shell>
  )
}

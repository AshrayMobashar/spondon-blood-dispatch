import { useState } from 'react'
import { Radio, Play, RotateCcw, User, Building2, Droplet, Clock } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { AdminChips } from '../../components/RoleChips.jsx'
import { Card, Tabs, Button, Badge } from '../../components/ui.jsx'
import { Chip } from '../../components/TopBar.jsx'

const infoCards = [
  { icon: User, label: 'Patient', value: 'Mehedi Hassan', sub: 'Dengue · Patient Critical' },
  { icon: Building2, label: 'Hospital', value: 'Dhaka Medical College', sub: 'Dhaka, Bangladesh' },
  { icon: Droplet, label: 'Blood Type Required', value: 'B+', sub: '2 units needed', valueColor: 'text-primary' },
  { icon: Clock, label: 'Request Time', value: '14:32:00', sub: 'Elapsed 00:00', subColor: 'text-warning' },
]

const stages = [
  { n: 1, label: 'Stage 1 — 3 km Radius', pinged: '8 donors pinged' },
  { n: 2, label: 'Stage 2 — 5 km Radius', pinged: '17 donors pinged' },
  { n: 3, label: 'Stage 3 — 10 km Radius', pinged: '34 donors pinged' },
]

export default function GeoRipple() {
  const [tab, setTab] = useState(0)
  const [active, setActive] = useState(1) // highest reached stage

  return (
    <Shell
      panel="DISPATCH ENGINE"
      panelColor="primary"
      right={
        <>
          <AdminChips />
          <Chip className="hidden sm:inline-flex">
            <span className="font-semibold text-warning">REQ-2025-0847</span>
          </Chip>
        </>
      }
    >
      <Tabs
        tabs={['Ripple Dashboard', 'Donor Pool', 'River Override', 'Dispatch Log']}
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
                Spatial matching engine — staged radius expansion with river-route override
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge color="primary" dot={false}>CRITICAL</Badge>
            <Badge color="admin" dot={false}>REQ-2025-0847</Badge>
          </div>
        </div>

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

        {/* Expansion stages */}
        <Card className="mt-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-text-muted">Geo-Ripple Expansion Stages</p>
              <p className="mt-1 text-[11px] text-text-faint">
                Radius auto-expands every 10 minutes if no donor accepts
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setActive((s) => Math.min(3, s + 1))} className="px-4 py-2 text-xs">
                <Play className="size-3.5" /> Simulate Dispatch
              </Button>
              <Button variant="ghost" onClick={() => setActive(1)} className="px-4 py-2 text-xs">
                <RotateCcw className="size-3.5" /> Reset
              </Button>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {stages.map((s) => {
              const reached = active >= s.n
              const current = active === s.n
              return (
                <div key={s.n} className="flex items-center gap-4">
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      reached ? 'bg-success text-white' : 'bg-line text-text-faint'
                    }`}
                  >
                    {s.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className={`text-sm font-semibold ${reached ? 'text-success' : 'text-text-faint'}`}>
                        {s.label}
                      </p>
                      <span className="text-[10px] text-text-faint">{reached ? s.pinged : '—'}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                      <div
                        className={`h-full rounded-full bg-success transition-all duration-700 ${
                          reached ? (current ? 'w-full' : 'w-full') : 'w-0'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-5 rounded-lg border border-admin/20 bg-admin/[0.05] px-4 py-3 text-[11px] text-text-muted">
            <span className="font-semibold text-admin">River-route override:</span> near
            the Buriganga, straight-line radius is replaced with Maps API driving-route
            distance so every pinged donor has a realistic, reachable ETA.
          </div>
        </Card>
      </div>
    </Shell>
  )
}

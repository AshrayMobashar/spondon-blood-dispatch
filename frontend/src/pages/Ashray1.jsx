import { useState } from 'react'
import { Link } from 'react-router-dom'
import logo from '../assets/icons/logo.svg'
import userIcon from '../assets/icons/user.svg'
import pingsIcon from '../assets/icons/pings.svg'
import controlCenter from '../assets/icons/control-center.svg'
import moonSm from '../assets/icons/moon-sm.svg'
import moonLg from '../assets/icons/moon-lg.svg'
import commute from '../assets/icons/commute.svg'
import gps from '../assets/icons/gps.svg'
import dnd from '../assets/icons/dnd.svg'

/* ── Small building blocks ───────────────────────────────────────── */
function Toggle({ on, color = 'bg-donor' }) {
  const [checked, setChecked] = useState(on)
  return (
    <button
      type="button"
      onClick={() => setChecked((c) => !c)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
        checked ? `${color} border-transparent` : 'border-[#374151] bg-line'
      }`}
      aria-pressed={checked}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

const routeStops = [
  { n: 1, name: 'Home', place: 'Mirpur-10', active: true },
  { n: 2, name: 'Checkpoint', place: 'Farmgate', active: true },
  { n: 3, name: 'Hospital Zone', place: 'Shahbag', active: false },
  { n: 4, name: 'Office', place: 'Motijheel', active: false },
]

const tabs = ['Sleep Mode Engine', 'Commute-Aware Matching', 'Ping Activity Log']

const engineStats = [
  { label: 'Sleep Window', value: '23:00 – 07:00', sub: '8 hours protected', valueColor: 'text-white', subColor: 'text-donor' },
  { label: 'Emergency Override', value: 'OFF', sub: 'FCM bypass enabled', valueColor: 'text-text-faint', subColor: 'text-[#374151]' },
  { label: 'Sleep Mode', value: 'SLEEPING', sub: 'Pings suppressed', valueColor: 'text-donor', subColor: 'text-donor/60' },
  { label: 'OS DND State', value: 'DND OFF', sub: 'Phone reachable', valueColor: 'text-success', subColor: 'text-success/60' },
]

const flow = [
  { label: '🌙 Sleep Active', cls: 'border-donor/30 bg-donor/10 text-donor' },
  { label: '🔕 No Override', cls: 'border-[#374151]/40 bg-[#374151]/20 text-text-faint' },
  { label: '📱 Phone Open', cls: 'border-success/30 bg-success/10 text-success' },
  { label: '❌ Ping Blocked', cls: 'border-primary/30 bg-primary/10 text-primary' },
]

// 24h timeline: purple = sleep window bars, red = active ping bars
const timeline = [
  18, 18, 18, 18, 18, 18, 18, 24, 79, 70, 79, 82, 79, 62, 65, 44, 46, 71, 82,
  24, 24, 24, 24, 18,
]

function Chip({ children }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-text-muted">
      {children}
    </span>
  )
}

export default function Ashray1() {
  const [activeTab, setActiveTab] = useState(0)

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
              <span className="size-2 rounded-full bg-success" />
              Live Dispatch Active
            </Chip>
            <Chip>
              <img src={userIcon} alt="" className="size-3.5" />
              Rafiul Islam
              <span className="font-bold text-primary">O+</span>
            </Chip>
            <Chip>
              <img src={pingsIcon} alt="" className="size-3.5" />
              <span className="font-semibold text-warning">7 pings this week</span>
            </Chip>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex flex-col lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 border-b border-line lg:w-[340px] lg:border-b-0 lg:border-r">
          {/* Sidebar header */}
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
            {/* Sleep Mode card */}
            <div className="rounded-xl border border-donor/30 bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid size-7 place-items-center rounded-lg bg-donor/10">
                    <img src={moonSm} alt="" className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-semibold">Sleep Mode</p>
                    <p className="text-[10px] text-text-faint">23:00 – 07:00</p>
                  </div>
                </div>
                <Toggle on color="bg-donor" />
              </div>
              <div className="mt-4 rounded-lg border border-donor/15 bg-donor/[0.07] p-3">
                <label className="flex gap-2">
                  <input
                    type="checkbox"
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
                    <p className="text-[10px] text-text-faint">
                      Route-aware ping engine
                    </p>
                  </div>
                </div>
                <Toggle on color="bg-admin" />
              </div>

              <p className="mt-3 flex items-center gap-1.5 text-[10px] text-success">
                <img src={gps} alt="" className="size-2.5" />
                GPS tracking active — comparing live location
              </p>

              <div className="mt-2 space-y-2">
                {routeStops.map((s) => (
                  <div
                    key={s.n}
                    className={`flex items-center gap-3 rounded-lg border p-2.5 ${
                      s.active
                        ? 'border-admin/20 bg-admin/[0.07]'
                        : 'border-line bg-[#0d111a]'
                    }`}
                  >
                    <span
                      className={`grid size-5 shrink-0 place-items-center rounded-full text-[8px] font-bold text-white ${
                        s.active ? 'bg-admin' : 'bg-line'
                      }`}
                    >
                      {s.n}
                    </span>
                    <div className="flex-1">
                      <p
                        className={`text-[11px] font-medium ${
                          s.active ? 'text-text-strong' : 'text-text-faint'
                        }`}
                      >
                        {s.name}
                      </p>
                      <p
                        className={`text-[9px] ${
                          s.active ? 'text-admin' : 'text-[#374151]'
                        }`}
                      >
                        {s.place}
                      </p>
                    </div>
                    {s.active && (
                      <span className="size-1.5 rounded-full bg-success" />
                    )}
                  </div>
                ))}
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
                    <p className="text-[10px] text-text-faint">
                      Simulate phone DND state
                    </p>
                  </div>
                </div>
                <Toggle on={false} />
              </div>
            </div>

            {/* Donor Health Status card (rendered upright — Figma had it flipped) */}
            <div className="rounded-xl border border-line bg-card p-4">
              <p className="text-xs font-semibold text-text-muted">
                Donor Health Status
              </p>
              <div className="mt-3 grid grid-cols-2 gap-y-2 text-[10px]">
                <span className="font-bold text-primary">O+</span>
                <span className="text-right text-text-faint">Blood Type</span>
                <span className="font-semibold text-success">Eligible ✓</span>
                <span className="text-right text-text-faint">Cooldown Status</span>
                <span className="font-medium text-text-strong">42 days ago</span>
                <span className="text-right text-text-faint">Last Donation</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full w-[70%] rounded-full bg-success" />
              </div>
              <p className="mt-2 text-[9px] text-text-faint">
                42 / 60 day cooldown — 70% recovered
              </p>
            </div>

            <div className="rounded-xl border border-line bg-card p-4">
              <p className="flex items-center gap-2 text-[10px] text-success">
                <span className="size-1.5 rounded-full bg-success" />
                Phone is reachable — all pings delivered normally
              </p>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1">
          {/* Tabs */}
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
            {/* Left / center column */}
            <div>
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-donor/10">
                  <img src={moonLg} alt="" className="size-5" />
                </span>
                <div>
                  <h1 className="text-base font-bold">Sleep Mode Engine</h1>
                  <p className="text-xs text-text-faint">
                    Intelligent ping suppression with emergency override
                  </p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {engineStats.map((s) => (
                  <div
                    key={s.label}
                    className="rounded-xl border border-line bg-card p-4"
                  >
                    <p className="text-[10px] text-text-faint">{s.label}</p>
                    <p className={`mt-2 text-lg font-bold ${s.valueColor}`}>
                      {s.value}
                    </p>
                    <p className={`mt-1 text-[10px] ${s.subColor}`}>{s.sub}</p>
                  </div>
                ))}
              </div>

              {/* Decision flow */}
              <div className="mt-4 rounded-xl border border-line bg-card p-4">
                <p className="text-xs font-semibold text-text-muted">
                  Decision Flow — Current State
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {flow.map((f, i) => (
                    <div key={f.label} className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold ${f.cls}`}
                      >
                        {f.label}
                      </span>
                      {i < flow.length - 1 && (
                        <span className="text-text-faint">›</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right rail */}
            <div className="space-y-6">
              {/* 24h ping timeline */}
              <div className="rounded-xl border border-line bg-card p-4">
                <p className="text-xs font-semibold text-text-muted">
                  24h Ping Timeline
                </p>
                <div className="mt-4 flex h-24 items-end gap-[2px]">
                  {timeline.map((h, i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-t ${
                        h <= 18 ? 'bg-donor/30' : 'bg-primary/40'
                      }`}
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
                <div className="mt-1 flex justify-between border-t border-line pt-1 text-[8px] text-[#374151]">
                  <span>12AM</span>
                  <span>12PM</span>
                  <span>12AM</span>
                </div>
                <div className="mt-3 space-y-1.5 text-[9px] text-text-faint">
                  <p className="flex items-center gap-2">
                    <span className="size-2 rounded bg-donor/30" />
                    Sleep window
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="size-2 rounded bg-primary/40" />
                    Active pings
                  </p>
                </div>
              </div>

              {/* FCM priority logic */}
              <div className="rounded-xl border border-line bg-card p-4">
                <p className="text-xs font-semibold text-text-muted">
                  FCM Priority Logic
                </p>
                <div className="mt-4 space-y-3">
                  <p className="flex items-center gap-2 text-[10px] font-semibold text-primary">
                    <span className="grid size-4 place-items-center rounded-full bg-primary/10">
                      <span className="size-1.5 rounded-full bg-primary" />
                    </span>
                    CRITICAL
                  </p>
                  <p className="flex items-center gap-2 text-[10px] font-semibold text-warning">
                    <span className="grid size-4 place-items-center rounded-full bg-warning/10">
                      <span className="size-1.5 rounded-full bg-warning" />
                    </span>
                    URGENT
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

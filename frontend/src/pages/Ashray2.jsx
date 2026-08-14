import { useState } from 'react'
import { Link } from 'react-router-dom'
import logo from '../assets/icons/logo.svg'
import shieldLock from '../assets/icons/shield-lock.svg'
import lock from '../assets/icons/lock.svg'
import shieldCheck from '../assets/icons/shield-check.svg'
import check from '../assets/icons/check.svg'
import adminUser from '../assets/icons/admin-user.svg'
import rafiul from '../assets/avatars/rafiul.png'
import nadia from '../assets/avatars/nadia.png'
import karim from '../assets/avatars/karim.png'

const badges = [
  { label: 'ACID COMPLIANT', color: 'success' },
  { label: 'REAL-TIME LOCK', color: 'admin' },
  { label: 'NO-SHOW TRACKING', color: 'warning' },
  { label: 'APPEAL SYSTEM', color: 'primary' },
]

const badgeCls = {
  success: 'border-success/30 bg-success/[0.08] text-success',
  admin: 'border-admin/30 bg-admin/[0.08] text-admin',
  warning: 'border-warning/30 bg-warning/[0.08] text-warning',
  primary: 'border-primary/30 bg-primary/[0.08] text-primary',
}
const dotCls = {
  success: 'bg-success',
  admin: 'bg-admin',
  warning: 'bg-warning',
  primary: 'bg-primary',
}

const stats = [
  { dot: 'success', label: 'Locks Today', value: '247', sub: '↑ 12% from yesterday', subColor: 'text-success' },
  { dot: 'warning', label: 'No-Shows (30d)', value: '18', sub: '3 at risk of removal', subColor: 'text-warning' },
  { dot: 'primary', label: 'Race Conditions', value: '0', sub: 'Zero conflicts resolved', subColor: 'text-success' },
  { dot: 'donor', label: 'Appeals Pending', value: '3', sub: '1 awaiting admin review', subColor: 'text-donor' },
]

const tabs = [
  '🔒 Concurrency Lock',
  '⚠️ No-Show Tracking',
  '⚡ Race Condition',
  '📋 Appeal System',
]

const donors = [
  { avatar: rafiul, name: 'Rafiul Islam', dist: '1.2 km', note: null },
  { avatar: nadia, name: 'Nadia Hossain', dist: '2.4 km', note: '1 prior no-show' },
  { avatar: karim, name: 'Karim Uddin', dist: '3.1 km', note: null },
]

const txLog = [
  { time: '02:14:33', dot: 'admin', text: 'Ping dispatched to 3 donors', color: 'text-text-muted' },
  { time: '02:14:41', dot: 'success', text: 'Rafiul Islam — Accept packet received (server seq #1)', color: 'text-success' },
  { time: '02:14:41', dot: 'warning', text: 'Nadia Hossain — Accept packet received (server seq #2)', color: 'text-warning' },
  { time: '02:14:41', dot: 'success', text: 'ACID transaction: Lock awarded to Rafiul Islam', color: 'text-success' },
  { time: '02:14:41', dot: 'admin', text: 'Nadia Hossain shown polite rejection', color: 'text-text-muted' },
  { time: '02:14:42', dot: 'admin', text: 'Karim Uddin — Donor Secured shown', color: 'text-text-muted' },
]

const guarantees = [
  'Atomic database transaction on first Accept',
  'All other donors instantly see "Donor Secured"',
  'No duplicate travel — zero wasted donor trips',
]

export default function Ashray2() {
  const [activeTab, setActiveTab] = useState(0)

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink text-white">
      {/* Ambient glows */}
      <div className="pointer-events-none absolute left-0 top-0 size-[400px] rounded-full bg-primary opacity-[0.04] blur-[30px]" />
      <div className="pointer-events-none absolute left-[756px] top-[200px] size-[500px] rounded-full bg-donor opacity-5 blur-[35px]" />
      <div className="pointer-events-none absolute left-[502px] top-[694px] size-[300px] rounded-full bg-admin opacity-[0.04] blur-[25px]" />

      {/* Top bar */}
      <header className="relative z-20 border-b border-line">
        <div className="flex h-[61px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg bg-primary">
                <img src={logo} alt="" className="size-[18px]" />
              </span>
              <span className="text-xl font-bold tracking-tight">Spondon</span>
            </Link>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
              SYSTEM CORE
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-text-muted sm:inline-flex">
              <span className="size-[7px] rounded-full bg-success" />
              Live Dispatch Active
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-text-muted">
              <img src={adminUser} alt="" className="size-3.5" />
              Admin
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1256px] px-4 py-6 sm:px-6">
        {/* Page heading */}
        <div className="flex items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10">
            <img src={shieldLock} alt="" className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Concurrency Lock &amp; Flake-Out Accountability
            </h1>
            <p className="mt-1 text-[13px] text-text-faint">
              Real-time donor locking, ACID transaction guarantees, and no-show
              enforcement
            </p>
          </div>
        </div>

        {/* Status badges */}
        <div className="mt-6 flex flex-wrap gap-2">
          {badges.map((b) => (
            <span
              key={b.label}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold ${badgeCls[b.color]}`}
            >
              <span className={`size-1.5 rounded-full ${dotCls[b.color]}`} />
              {b.label}
            </span>
          ))}
        </div>

        {/* Stat cards */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-line bg-card p-5"
            >
              <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-faint">
                <span
                  className={`size-2 rounded-full ${dotCls[s.dot] ?? 'bg-donor'}`}
                />
                {s.label}
              </p>
              <p className="mt-3 text-[28px] font-bold leading-none">{s.value}</p>
              <p className={`mt-3 text-[10px] ${s.subColor}`}>{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="mt-8 flex overflow-x-auto border-b border-line">
          {tabs.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(i)}
              className={`shrink-0 border-b-2 px-6 py-3 text-xs font-semibold transition-colors ${
                activeTab === i
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-transparent text-text-faint hover:text-text-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content grid */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Live Request Lock Demo */}
          <div className="rounded-2xl border border-line bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-[10px] bg-primary/10">
                <img src={lock} alt="" className="size-[18px]" />
              </span>
              <div>
                <h2 className="text-sm font-bold">Live Request Lock Demo</h2>
                <p className="text-[11px] text-text-faint">
                  Simulate a real-time donor acceptance
                </p>
              </div>
            </div>

            {/* Request card */}
            <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-start justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Emergency Request #4821
                </p>
                <span className="rounded-full border border-primary/30 bg-primary/20 px-2.5 py-1 text-[10px] font-bold text-primary">
                  CRITICAL
                </span>
              </div>
              <p className="mt-2 text-[13px] font-semibold">
                O+ Blood — Dhaka Medical College
              </p>
              <div className="flex items-center justify-between">
                <p className="mt-1 text-[11px] text-text-faint">
                  Patient: Dengue hemorrhagic fever · 2 units needed
                </p>
                <span className="text-[10px] text-text-faint">02:14 AM</span>
              </div>
              <p className="mt-3 flex items-center gap-2 text-[11px] font-medium text-primary">
                <span className="size-1.5 rounded-full bg-primary" />
                Awaiting donor acceptance...
              </p>
            </div>

            {/* Pinged donors */}
            <p className="mt-6 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Pinged Donors (3)
            </p>
            <div className="mt-3 space-y-3">
              {donors.map((d) => (
                <div
                  key={d.name}
                  className="flex items-center gap-3 rounded-[10px] border border-line bg-[#0d111a] p-3"
                >
                  <img
                    src={d.avatar}
                    alt=""
                    className="size-9 shrink-0 rounded-full"
                  />
                  <div className="flex-1">
                    <p className="text-xs font-semibold">{d.name}</p>
                    <p className="flex items-center gap-2 text-[10px]">
                      <span className="font-bold text-primary">O+</span>
                      <span className="text-text-faint">{d.dist}</span>
                      {d.note && <span className="text-warning">{d.note}</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md bg-success px-3.5 py-1.5 text-[10px] font-semibold text-white transition-colors hover:brightness-110"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-line px-3.5 py-1.5 text-[10px] font-semibold text-text-faint transition-colors hover:text-white"
                  >
                    Decline
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="mt-6 w-full rounded-lg border border-line bg-[#0d111a] py-2.5 text-xs font-semibold text-text-faint transition-colors hover:text-white"
            >
              ↺ Reset Demo
            </button>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Transaction log */}
            <div className="rounded-2xl border border-line bg-card p-6">
              <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                <span className="size-2 rounded-full bg-success" />
                Transaction Log — Request #4821
              </p>
              <div className="mt-4">
                {txLog.map((row, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 border-b border-line py-2.5 last:border-0"
                  >
                    <span className="w-14 shrink-0 text-[10px] text-[#374151]">
                      {row.time}
                    </span>
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${dotCls[row.dot]}`}
                    />
                    <span className={`text-[11px] ${row.color}`}>{row.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Lock guarantee */}
            <div className="rounded-2xl border border-success/20 bg-card p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-7 place-items-center rounded-lg bg-success/10">
                  <img src={shieldCheck} alt="" className="size-3.5" />
                </span>
                <h3 className="text-[13px] font-bold">Lock Guarantee</h3>
              </div>
              <div className="mt-4 space-y-3">
                {guarantees.map((g) => (
                  <p key={g} className="flex items-center gap-3 text-[11px] text-text-strong">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success/10">
                      <img src={check} alt="" className="size-2.5" />
                    </span>
                    {g}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

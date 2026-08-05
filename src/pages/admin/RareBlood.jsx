import { useState } from 'react'
import { Droplet, Zap, Radio, Building2 } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, StatCard, Tabs, Badge } from '../../components/ui.jsx'
import { Chip } from '../../components/TopBar.jsx'
import { User } from 'lucide-react'

const stats = [
  { label: 'Radius search delay', value: '0s', sub: 'Bypassed entirely', color: 'primary' },
  { label: 'City coverage', value: '100%', sub: 'All eligible donors pinged', color: 'success' },
  { label: 'Escalation threshold', value: '90s', sub: 'Then external sourcing', color: 'warning' },
  { label: 'NGO partners', value: '4+', sub: 'Auto-contacted on fail', color: 'admin' },
]

const types = [
  { type: 'AB-', count: '12 donors in city', color: 'primary' },
  { type: 'O-', count: '18 donors in city', color: 'donor' },
  { type: 'B-', count: '24 donors in city', color: 'admin' },
  { type: 'A-', count: '31 donors in city', color: 'warning' },
]

const typeStyles = {
  primary: 'border-primary/30 text-primary',
  donor: 'border-donor/30 text-donor',
  admin: 'border-admin/30 text-admin',
  warning: 'border-warning/30 text-warning',
}

const steps = [
  { n: '01', color: 'bg-primary', icon: User, title: 'Request Received', body: 'Family submits emergency request specifying rare negative blood type (AB-, O-, B-, A-).', tag: 'Instant detection', tagColor: 'text-primary' },
  { n: '02', color: 'bg-donor', icon: Zap, title: 'Radius Bypass', body: '3km → 5km → 10km expanding search is completely skipped. No time wasted on proximity checks.', tag: 'Algorithm override', tagColor: 'text-donor' },
  { n: '03', color: 'bg-warning', icon: Radio, title: 'City-Wide Broadcast', body: 'Every eligible donor of that rare type across all of Dhaka is simultaneously pinged via FCM push.', tag: 'Simultaneous broadcast', tagColor: 'text-warning' },
  { n: '04', color: 'bg-admin', icon: Building2, title: 'External Escalation', body: 'If no donor responds, request auto-escalates to national blood-bank APIs and partner NGO hotlines.', tag: 'Never a dead end', tagColor: 'text-admin' },
]

export default function RareBlood() {
  const [tab, setTab] = useState(0)
  return (
    <Shell
      panel="RARE BLOOD OVERRIDE"
      panelColor="primary"
      right={
        <>
          <Chip>
            <span className="size-2 rounded-full bg-primary" />
            City-Wide Override Active
          </Chip>
          <Chip><User className="size-3.5" /> Admin</Chip>
        </>
      }
    >
      {/* Hero */}
      <div className="flex items-start gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10">
          <Droplet className="size-6 text-primary" />
        </span>
        <div>
          <Badge color="primary" dot={false} className="mb-2">
            CRITICAL FEATURE · Rare Blood Protocol v2.4
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight">
            Rare-Blood City-Wide Override
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-text-faint">
            When a negative blood type is requested, Spondon bypasses all proximity
            filters and instantly pings every eligible donor across the entire city —
            because rare types cannot wait for a 3&nbsp;km search to fail.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* Types */}
      <p className="mt-8 text-xs font-semibold text-text-muted">Rare Negative Blood Types Covered</p>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {types.map((t) => (
          <Card key={t.type} className={`flex items-center gap-3 p-4 ${typeStyles[t.color]}`}>
            <span className={`grid size-9 place-items-center rounded-lg text-sm font-bold ${typeStyles[t.color]} border`}>
              {t.type}
            </span>
            <span className="text-[11px] text-text-faint">{t.count}</span>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="mt-8">
        <Tabs
          tabs={['Override Engine', 'Live Simulation', 'Escalation Protocol', 'Technical Specs']}
          active={tab}
          onChange={setTab}
        />
      </div>

      {/* Steps */}
      <p className="mt-6 flex items-center gap-2 text-xs font-semibold text-primary">
        <span className="size-1.5 rounded-full bg-primary" /> HOW THE OVERRIDE WORKS
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <Card key={s.n} className="overflow-hidden p-0">
            <div className={`h-1 ${s.color}`} />
            <div className="p-5">
              <span className="grid size-9 place-items-center rounded-lg bg-[#0d111a]">
                <s.icon className="size-4 text-text-muted" />
              </span>
              <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
                Step {s.n}
              </p>
              <h3 className="mt-1 text-sm font-bold">{s.title}</h3>
              <p className="mt-2 text-[11px] leading-relaxed text-text-faint">{s.body}</p>
              <p className={`mt-3 flex items-center gap-1.5 text-[10px] font-semibold ${s.tagColor}`}>
                <span className={`size-1.5 rounded-full ${s.color}`} /> {s.tag}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </Shell>
  )
}

import { useState } from 'react'
import { Siren, User, Radio, HeartHandshake, Building2 } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, StatCard, Tabs, Badge } from '../../components/ui.jsx'
import { Chip } from '../../components/TopBar.jsx'

const stats = [
  { label: 'Phase 1 trigger', value: '30s', sub: 'Auto-escalation threshold', color: 'primary' },
  { label: 'NGO partners', value: '4+', sub: 'Auto-contacted on fail', color: 'donor' },
  { label: 'Escalation phases', value: '3', sub: 'Before admin override', color: 'warning' },
  { label: 'Unanswered requests', value: '0%', sub: 'Target SLA guarantee', color: 'admin' },
]

const steps = [
  { n: '01', t: 'T+0s', color: 'bg-primary', icon: User, title: 'Request Received', body: 'Family submits emergency blood request. System detects blood type, location, and urgency level instantly.', tag: 'Instant detection', tagColor: 'text-primary' },
  { n: '02', t: 'T+0s', color: 'bg-donor', icon: Radio, title: 'City-Wide Donor Ping', body: 'All eligible donors matching blood type are pinged simultaneously via push. No proximity filter for rare types.', tag: 'Algorithm override', tagColor: 'text-donor' },
  { n: '03', t: 'T+30s', color: 'bg-warning', icon: HeartHandshake, title: 'NGO Escalation', body: 'If no donor confirms within 30 seconds, 4+ NGO blood-bank partners are auto-contacted via call and SMS.', tag: 'Simultaneous broadcast', tagColor: 'text-warning' },
  { n: '04', t: 'T+60s', color: 'bg-admin', icon: Building2, title: 'Hospital Blood Bank', body: 'Nearest hospital blood banks are notified automatically. Admin override alert fires for manual sourcing if needed.', tag: 'Admin override ready', tagColor: 'text-admin' },
]

export default function Escalation() {
  const [tab, setTab] = useState(0)
  return (
    <Shell
      panel="ESCALATION PROTOCOL"
      panelColor="primary"
      right={
        <Chip>
          <span className="size-2 rounded-full bg-warning" />
          System Standby
        </Chip>
      }
    >
      {/* Hero */}
      <div className="flex items-start gap-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10">
          <Siren className="size-6 text-primary" />
        </span>
        <div>
          <Badge color="primary" dot={false} className="mb-2">
            CRITICAL SYSTEM · Protocol v3.1
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight">Escalation Protocol Engine</h1>
          <p className="mt-2 max-w-2xl text-sm text-text-faint">
            When a blood request goes unanswered, Spondon doesn't wait. A multi-phase
            escalation chain automatically triggers — from city-wide donor pings to NGO
            partners to hospital blood banks — ensuring no emergency is ever left
            without a response.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* Tabs */}
      <div className="mt-8">
        <Tabs
          tabs={['Overview', 'Phase Breakdown', 'Live Simulation', 'NGO Partners', 'Technical Specs']}
          active={tab}
          onChange={setTab}
        />
      </div>

      {/* Steps */}
      <p className="mt-6 flex items-center gap-2 text-xs font-semibold text-primary">
        <span className="size-1.5 rounded-full bg-primary" /> HOW THE ESCALATION WORKS
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
                Step {s.n} — {s.t}
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

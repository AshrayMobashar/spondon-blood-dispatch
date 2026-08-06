import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Siren, User, Radio, HeartHandshake, Building2, Loader2, TriangleAlert,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, StatCard, Tabs, Badge, Button } from '../../components/ui.jsx'
import { Chip } from '../../components/TopBar.jsx'
import { adminApi, configApi, getToken } from '../../lib/api.js'

const CHANNEL_LABEL = {
  'national-blood-bank': 'National blood-bank registry',
  'ngo-hotline': 'Partner NGO hotline',
}

export default function Escalation() {
  const [tab, setTab] = useState(0)
  const [cfg, setCfg] = useState(null)
  const [escalations, setEscalations] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)

  const signedIn = !!getToken()

  const load = useCallback(async () => {
    try {
      const c = await configApi.get()
      setCfg(c)
      if (signedIn) setEscalations(await adminApi.escalations())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [signedIn])

  useEffect(() => {
    load()
  }, [load])

  async function resolve(id, action) {
    setBusy(id)
    setError(null)
    try {
      await adminApi.resolveEscalation(id, action)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  const threshold = cfg?.dispatch?.rare_escalation_seconds
  const open = escalations.filter((e) => e.status === 'OPEN')
  const sourced = escalations.filter((e) => e.status === 'SOURCED')

  // Phase timings are derived from the one configured threshold, so this page
  // can never disagree with the engine (or with the Rare Blood page).
  const steps = [
    {
      n: '01', t: 'T+0s', color: 'bg-primary', icon: User, title: 'Request Received',
      body: 'Family submits an emergency request. The engine reads blood type, location and urgency immediately.',
      tag: 'Instant detection', tagColor: 'text-primary',
    },
    {
      n: '02', t: 'T+0s', color: 'bg-donor', icon: Radio, title: 'City-Wide Donor Ping',
      body: 'Every eligible donor of that type is pinged at once. Rare negative types skip the proximity filter entirely.',
      tag: 'Algorithm override', tagColor: 'text-donor',
    },
    {
      n: '03', t: `T+${threshold ?? '…'}s`, color: 'bg-warning', icon: HeartHandshake,
      title: 'External Escalation',
      body: `If no donor confirms within ${threshold ?? '…'} seconds, the national blood-bank registry and partner NGO hotlines are contacted automatically.`,
      tag: 'Auto-escalation', tagColor: 'text-warning',
    },
    {
      n: '04', t: 'Admin', color: 'bg-admin', icon: Building2, title: 'Admin Sourcing',
      body: 'The escalation lands in this console, where an admin tracks external sourcing through to a result.',
      tag: 'Never a dead end', tagColor: 'text-admin',
    },
  ]

  const stats = [
    {
      label: 'Escalation threshold', value: threshold ? `${threshold}s` : '…',
      sub: 'Unanswered city-wide ping', color: 'primary',
    },
    {
      label: 'Partner channels', value: '2',
      sub: cfg?.integrations?.blood_bank || cfg?.integrations?.ngo_hotline
        ? 'Live outbound delivery'
        : 'Recorded — no endpoint configured',
      color: 'donor',
    },
    {
      label: 'Open escalations', value: String(open.length),
      sub: 'Awaiting external sourcing', color: 'warning',
    },
    {
      label: 'Sourced externally', value: String(sourced.length),
      sub: 'Blood found off-network', color: 'admin',
    },
  ]

  return (
    <Shell
      panel="ESCALATION PROTOCOL"
      panelColor="primary"
      right={
        <Chip>
          <span className={`size-2 rounded-full ${open.length ? 'bg-primary' : 'bg-warning'}`} />
          {open.length ? `${open.length} open` : 'System Standby'}
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
            CRITICAL SYSTEM · Escalation Protocol
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight">Escalation Protocol Engine</h1>
          <p className="mt-2 max-w-2xl text-sm text-text-faint">
            When a rare-blood request goes unanswered city-wide, Spondon doesn&apos;t wait. The
            request is escalated automatically to national blood-bank APIs and partner NGO
            hotlines, so no emergency is ever left without a response.
          </p>
        </div>
      </div>

      {error && (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-[11px] text-primary">
          <TriangleAlert className="size-3.5 shrink-0" /> {error}
        </p>
      )}

      {!signedIn && (
        <p className="mt-6 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-[11px] text-warning">
          Sign in to the{' '}
          <Link to="/admin/login" className="underline">admin console</Link> to see the live
          escalation queue.
        </p>
      )}

      {/* Stats */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* Tabs */}
      <div className="mt-8">
        <Tabs tabs={['Phase Breakdown', 'Live Queue']} active={tab} onChange={setTab} />
      </div>

      {tab === 0 && (
        <>
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
        </>
      )}

      {tab === 1 && (
        <div className="mt-6 space-y-4">
          {loading && (
            <p className="flex items-center gap-2 text-[11px] text-text-faint">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </p>
          )}
          {!loading && escalations.length === 0 && (
            <Card className="p-8 text-center text-[11px] text-text-faint">
              No escalations recorded. A rare-type request that nobody answers within{' '}
              {threshold}s will appear here automatically.
            </Card>
          )}
          {escalations.map((e) => (
            <Card key={e.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    <span className="font-bold text-primary">{e.blood_type}</span> · {e.hospital}
                  </p>
                  <p className="mt-1 text-[11px] text-text-faint">{e.reason}</p>
                  <p className="mt-1 text-[10px] text-[#374151]">
                    Raised {new Date(e.created_at).toLocaleString()}
                  </p>
                </div>
                <Badge
                  color={
                    e.status === 'OPEN' ? 'warning' : e.status === 'SOURCED' ? 'success' : 'admin'
                  }
                >
                  {e.status}
                </Badge>
              </div>

              <ul className="mt-4 space-y-1.5 border-t border-line pt-3 text-[11px]">
                {e.channels.map((c, i) => (
                  <li key={`${c.channel}-${i}`} className="flex justify-between gap-3">
                    <span className="text-text-strong">
                      {CHANNEL_LABEL[c.channel] ?? c.channel}
                    </span>
                    <span
                      className={
                        c.delivered ? 'text-success' : c.simulated ? 'text-warning' : 'text-primary'
                      }
                    >
                      {c.delivered
                        ? `delivered${c.reference ? ` · ref ${c.reference}` : ''}`
                        : c.simulated
                          ? 'no endpoint configured'
                          : `failed${c.error ? ` — ${c.error}` : ''}`}
                    </span>
                  </li>
                ))}
              </ul>

              {e.status === 'OPEN' && signedIn && (
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="success"
                    disabled={busy === e.id}
                    onClick={() => resolve(e.id, 'SOURCED')}
                  >
                    {busy === e.id && <Loader2 className="size-4 animate-spin" />}
                    Blood sourced
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy === e.id}
                    onClick={() => resolve(e.id, 'CLOSE')}
                  >
                    Close
                  </Button>
                </div>
              )}

              {e.resolved_by && (
                <p className="mt-3 text-[10px] text-text-faint">
                  Resolved by {e.resolved_by} on {new Date(e.resolved_at).toLocaleString()}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </Shell>
  )
}

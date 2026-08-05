import { useNavigate } from 'react-router-dom'
import { ShieldCheck, FileUp, UserCog, CheckCircle2, Droplet } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { DonorChips } from '../../components/RoleChips.jsx'
import { Card, StatCard, Tabs, Button } from '../../components/ui.jsx'
import { useState } from 'react'

const flagRows = [
  { label: 'Cooldown Lock', value: 'CLEAR', color: 'text-success' },
  { label: 'Weight Lock', value: 'CLEAR', color: 'text-success' },
  { label: 'Geo-Ripple Pings', value: 'RECEIVING', color: 'text-admin' },
]

const profileRows = [
  ['Name', 'Rafiul Islam'],
  ['Blood Type', 'O+'],
  ['Weight', '68 kg'],
  ['Last Donation', '2025-01-15'],
  ['Type', 'Whole Blood (120d)'],
  ['Next Eligible', 'Now'],
]

const tabs = ['Cooldown Dashboard', 'Update Records', 'Weight Validation', 'Ping Activity Log']
const tabRoutes = ['/donor/eligibility', '/donor/records', '/donor/weight', '/admin/pings']

export default function EligibilityEngine() {
  const [tab, setTab] = useState(0)
  const navigate = useNavigate()

  return (
    <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 space-y-5 lg:w-[300px]">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg bg-primary/10">
                <ShieldCheck className="size-4 text-primary" />
              </span>
              <h2 className="text-sm font-bold">Eligibility Engine</h2>
            </div>
            <p className="mt-2 text-xs text-text-faint">
              Auto-pause &amp; cooldown management
            </p>
          </div>

          <Card className="p-4" accent="success">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold">Eligibility Flag</p>
                <p className="text-[11px] font-semibold text-success">ELIGIBLE — Active</p>
              </div>
              <span className="size-2.5 rounded-full bg-success" />
            </div>
            <div className="mt-4 space-y-2 border-t border-line pt-3">
              {flagRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between text-[11px]">
                  <span className="text-text-faint">{row.label}</span>
                  <span className={`font-semibold ${row.color}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <p className="text-xs font-bold">Donor Profile</p>
            <div className="mt-3 space-y-2">
              {profileRows.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-[11px]">
                  <span className="text-text-faint">{k}</span>
                  <span className={`font-medium ${v === 'Now' ? 'text-success' : v === 'O+' ? 'text-primary' : 'text-white'}`}>{v}</span>
                </div>
              ))}
            </div>
          </Card>

          <Button variant="outline" className="w-full">
            <FileUp className="size-4" /> Upload Medical Certificate
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => navigate('/admin/concurrency')}>
            <UserCog className="size-4" /> Admin Review Panel
          </Button>
        </aside>

        {/* Main */}
        <section className="min-w-0 flex-1">
          <Tabs
            tabs={tabs}
            active={tab}
            color="donor"
            onChange={(i) => {
              setTab(i)
              if (i !== 0) navigate(tabRoutes[i])
            }}
          />

          <div className="pt-6">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10">
                <ShieldCheck className="size-5 text-primary" />
              </span>
              <div>
                <h1 className="text-lg font-bold">Eligibility Cooldown Engine</h1>
                <p className="text-xs text-text-faint">
                  Live eligibility flag recalculated on every login and post-donation
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Eligibility Status" value="ELIGIBLE" sub="Receiving pings" color="success" />
              <StatCard label="Days Remaining" value="0 days" sub="of 120-day cooldown" color="warning" subColor="text-text-faint" />
              <StatCard label="Donation Type" value="Whole Blood" sub="120-day lock period" color="admin" subColor="text-text-faint" />
              <StatCard label="Weight Status" value="68 kg" sub="Above 50 kg threshold" color="success" />
            </div>

            <Card className="mt-4 p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-text-muted">Live Countdown to Eligibility</p>
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-success">
                  <span className="size-2 rounded-full bg-success" /> Eligible Now
                </span>
              </div>
              <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-success/20 bg-success/[0.05] py-10">
                <CheckCircle2 className="size-10 text-success" />
                <p className="mt-3 text-2xl font-bold text-success">0d : 00h : 00m</p>
                <p className="mt-1 text-xs text-text-faint">
                  Whole-blood cooldown of 120 days has fully elapsed
                </p>
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/[0.05] px-4 py-3 text-[11px] text-text-muted">
                <Droplet className="size-3.5 shrink-0 text-primary" />
                Platelet (apheresis) donations lock eligibility for only 14 days —
                far less depleting than whole blood.
              </div>
            </Card>
          </div>
        </section>
      </div>
    </Shell>
  )
}

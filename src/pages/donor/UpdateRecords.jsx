import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardEdit, Moon, Navigation, BellOff, CheckCircle2, Sparkles } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { DonorChips } from '../../components/RoleChips.jsx'
import { Card, Tabs, Toggle, Button, Field, Input, Select } from '../../components/ui.jsx'

const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const tabs = ['Update Records', 'Weight Validation', 'Ping Activity']
const tabRoutes = ['/donor/records', '/donor/weight', '/admin/pings']

const iconWrap = {
  donor: 'bg-donor/10 text-donor',
  admin: 'bg-admin/10 text-admin',
  primary: 'bg-primary/10 text-primary',
}

function SidebarToggle({ icon: Icon, title, sub, color, defaultOn }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-card p-4">
      <div className="flex items-center gap-3">
        <span className={`grid size-7 place-items-center rounded-lg ${iconWrap[color]}`}>
          <Icon className="size-3.5" />
        </span>
        <div>
          <p className="text-xs font-semibold">{title}</p>
          <p className="text-[10px] text-text-faint">{sub}</p>
        </div>
      </div>
      <Toggle defaultOn={defaultOn} color={color} />
    </div>
  )
}

export default function UpdateRecords() {
  const [tab, setTab] = useState(0)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    weight: '68',
    blood: 'O+',
    lastDonation: '2025-01-15',
    type: 'Whole Blood',
    route: 'Mirpur-10 → Farmgate → Motijheel',
  })
  const navigate = useNavigate()
  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value })
    setSaved(false)
  }

  return (
    <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar */}
        <aside className="w-full shrink-0 space-y-4 lg:w-[300px]">
          <div>
            <h2 className="text-sm font-bold">Donor Control Center</h2>
            <p className="mt-1 text-xs text-text-faint">
              Manage your availability &amp; smart ping preferences
            </p>
          </div>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-text-muted">Donor Health Status</p>
              <span className="font-bold text-primary">O+</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                ['BMI', '23.0', 'text-white'],
                ['Status', 'Normal', 'text-success'],
                ['Weight', '68 kg', 'text-white'],
              ].map(([k, v, c]) => (
                <div key={k}>
                  <p className={`text-sm font-bold ${c}`}>{v}</p>
                  <p className="text-[10px] text-text-faint">{k}</p>
                </div>
              ))}
            </div>
          </Card>

          <SidebarToggle icon={Moon} title="Sleep Mode" sub="23:00 – 07:00" color="donor" defaultOn />
          <SidebarToggle icon={Navigation} title="Commute Matching" sub="Route-aware ping engine" color="admin" defaultOn />
          <SidebarToggle icon={BellOff} title="OS Do Not Disturb" sub="Simulate phone DND state" color="primary" />
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
              <span className="grid size-9 place-items-center rounded-xl bg-donor/10">
                <ClipboardEdit className="size-5 text-donor" />
              </span>
              <div>
                <h1 className="text-lg font-bold">Update Donor Records</h1>
                <p className="text-xs text-text-faint">
                  Keep your medical profile accurate for optimal matching
                </p>
              </div>
            </div>

            <Card className="mt-6 max-w-2xl p-6">
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  setSaved(true)
                }}
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Weight (kg)" hint="Recalculates eligibility on save">
                    <Input value={form.weight} onChange={set('weight')} inputMode="decimal" />
                  </Field>
                  <Field label="Blood Type">
                    <Select value={form.blood} onChange={set('blood')}>
                      {bloodTypes.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Last Donation Date">
                    <Input type="date" value={form.lastDonation} onChange={set('lastDonation')} />
                  </Field>
                  <Field label="Donation Type">
                    <Select value={form.type} onChange={set('type')}>
                      <option>Whole Blood</option>
                      <option>Platelets (Apheresis)</option>
                      <option>Plasma</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Daily Commute Route" hint="Used for route-aware matching">
                  <Input value={form.route} onChange={set('route')} />
                </Field>

                <div className="flex items-center gap-2 rounded-lg border border-donor/20 bg-donor/[0.05] px-4 py-3 text-[11px] text-text-muted">
                  <Sparkles className="size-3.5 shrink-0 text-donor" />
                  Whole-blood locks eligibility for 120 days; platelets for only 14 —
                  we recalculate your cooldown automatically from these values.
                </div>

                <div className="flex items-center gap-3">
                  <Button type="submit">Save Records</Button>
                  {saved && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
                      <CheckCircle2 className="size-4" /> Records updated &amp; eligibility recalculated
                    </span>
                  )}
                </div>
              </form>
            </Card>
          </div>
        </section>
      </div>
    </Shell>
  )
}

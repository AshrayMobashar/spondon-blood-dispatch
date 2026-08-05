import { useState } from 'react'
import { Scale, User, ChevronRight, Plus, CheckCircle2, TriangleAlert, XCircle } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { DonorChips } from '../../components/RoleChips.jsx'
import { Card, Input } from '../../components/ui.jsx'

const donorRows = [
  ['Cooldown Status', 'Eligible ✓', 'text-success'],
  ['Last Donation', '42 days ago', 'text-white'],
  ['Location', 'Mirpur-10, Dhaka', 'text-admin'],
  ['Ping Activity', '7 this week', 'text-warning'],
]

const requirements = [
  { dot: 'bg-primary', title: 'Minimum Weight: 50 kg', body: 'WHO & Bangladesh Blood Transfusion Society standard' },
  { dot: 'bg-warning', title: 'Equivalent to 110 lbs', body: 'Applies to whole blood and platelet donation' },
  { dot: 'bg-warning', title: 'Caution: 50–55 kg range', body: 'Eligible but monitored — lower volume collected' },
  { dot: 'bg-success', title: 'Optimal: 55 kg and above', body: 'Full-donation volume, no restrictions' },
]

const rangeRows = [
  ['Below 50 kg', 'Not Eligible', 'text-primary', 'bg-primary'],
  ['50 – 55 kg', 'Caution Zone', 'text-warning', 'bg-warning'],
  ['55 kg and above', 'Fully Eligible', 'text-success', 'bg-success'],
]

function evaluate(kg) {
  if (!kg || Number.isNaN(kg)) return null
  if (kg < 50) return { label: 'Not Eligible', color: 'primary', icon: XCircle, msg: 'Below the 50 kg medical minimum — eligibility flag locked.' }
  if (kg < 55) return { label: 'Caution Zone', color: 'warning', icon: TriangleAlert, msg: 'Eligible, but a lower blood volume will be collected.' }
  return { label: 'Fully Eligible', color: 'success', icon: CheckCircle2, msg: 'Meets optimal weight — full donation volume, no restrictions.' }
}

const resultStyles = {
  primary: 'border-primary/30 bg-primary/10 text-primary',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  success: 'border-success/30 bg-success/10 text-success',
}

export default function WeightValidation() {
  const [unit, setUnit] = useState('kg')
  const [value, setValue] = useState('68')

  const num = parseFloat(value)
  const kg = unit === 'kg' ? num : num * 0.453592
  const result = evaluate(kg)

  return (
    <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
      {/* Breadcrumb */}
      <p className="flex items-center gap-1.5 text-xs text-text-faint">
        Donor Control Center <ChevronRight className="size-3" /> Eligibility Check{' '}
        <ChevronRight className="size-3" />{' '}
        <span className="font-semibold text-primary">Weight Validation</span>
      </p>

      <h1 className="mt-4 text-2xl font-bold">Weight Validation</h1>
      <p className="mt-1 text-sm text-text-faint">
        Verify donor weight eligibility before dispatching a blood or platelet
        request. Minimum 50 kg required by medical protocol.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        {/* Left column */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-primary/10">
                  <User className="size-4 text-primary" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Rafiul Islam</p>
                  <p className="text-[11px] text-text-faint">Registered Donor</p>
                </div>
              </div>
              <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                O+
              </span>
            </div>
            <div className="mt-4 space-y-2 border-t border-line pt-3">
              {donorRows.map(([k, v, c]) => (
                <div key={k} className="flex items-center justify-between text-xs">
                  <span className="text-text-faint">{k}</span>
                  <span className={`font-semibold ${c}`}>{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full w-[70%] rounded-full bg-success" />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] text-text-faint">
                <span>42 / 60 day cooldown</span>
                <span className="text-success">70% recovered</span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-md bg-primary/10">
                <Plus className="size-3.5 text-primary" />
              </span>
              <p className="text-sm font-semibold">Medical Requirements</p>
            </div>
            <div className="mt-4 space-y-3">
              {requirements.map((r) => (
                <div key={r.title} className="flex gap-3">
                  <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${r.dot}`} />
                  <div>
                    <p className="text-xs font-semibold text-text-strong">{r.title}</p>
                    <p className="text-[11px] text-text-faint">{r.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-semibold">Weight Range Reference</p>
            <div className="mt-3 space-y-2">
              {rangeRows.map(([range, label, textC, dotC]) => (
                <div key={range} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-2 text-text-muted">
                    <span className={`size-1.5 rounded-full ${dotC}`} />
                    {range}
                  </span>
                  <span className={`font-semibold ${textC}`}>{label}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 h-2 rounded-full bg-gradient-to-r from-primary via-warning to-success" />
            <div className="mt-1 flex justify-between text-[9px] text-text-faint">
              {['30', '40', '50', '60', '70', '80'].map((n) => (
                <span key={n}>{n}</span>
              ))}
            </div>
          </Card>
        </div>

        {/* Right column — interactive checker */}
        <div>
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/10">
                <Scale className="size-5 text-primary" />
              </span>
              <div>
                <h2 className="text-base font-bold">Enter Donor Weight</h2>
                <p className="text-xs text-text-faint">
                  Real-time eligibility check against WHO medical standards
                </p>
              </div>
            </div>

            <div className="mt-6">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                Weight Unit
              </p>
              <div className="inline-flex rounded-lg border border-line bg-[#0d111a] p-1">
                {['kg', 'lbs'].map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnit(u)}
                    className={`rounded-md px-5 py-1.5 text-sm font-semibold transition-colors ${
                      unit === u ? 'bg-primary text-white' : 'text-text-muted hover:text-white'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
                placeholder={`Weight in ${unit}`}
                className="text-lg"
              />
            </div>

            {result && (
              <div className={`mt-5 flex items-start gap-3 rounded-xl border p-4 ${resultStyles[result.color]}`}>
                <result.icon className="mt-0.5 size-5 shrink-0" />
                <div>
                  <p className="text-sm font-bold">{result.label}</p>
                  <p className="mt-0.5 text-[12px] opacity-90">{result.msg}</p>
                  <p className="mt-2 text-[11px] opacity-75">
                    ≈ {kg.toFixed(1)} kg / {(kg / 0.453592).toFixed(0)} lbs
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  )
}

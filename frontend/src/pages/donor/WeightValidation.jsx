import { useCallback, useEffect, useState } from 'react'
import {
  Scale, User, ChevronRight, Plus, CheckCircle2, TriangleAlert, XCircle, Loader2,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { DonorChips } from '../../components/RoleChips.jsx'
import { Card, Input, Button } from '../../components/ui.jsx'
import { configApi, donorApi } from '../../lib/api.js'
import { useSession } from '../../lib/session.js'

const FALLBACK = {
  min_weight_kg: 50,
  plausible_weight_min_kg: 30,
  plausible_weight_max_kg: 250,
  whole_blood_cooldown_days: 120,
  platelet_cooldown_days: 14,
}

// Above the medical minimum but close to it, a smaller volume is drawn. This
// is presentational guidance only — the engine's single threshold is min_weight_kg.
const CAUTION_MARGIN_KG = 5

const resultStyles = {
  primary: 'border-primary/30 bg-primary/10 text-primary',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  success: 'border-success/30 bg-success/10 text-success',
}

export default function WeightValidation() {
  const { account, loading: sessionLoading } = useSession({ role: 'donor' })
  const [rules, setRules] = useState(FALLBACK)
  const [elig, setElig] = useState(null)
  const [unit, setUnit] = useState('kg')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!account) return
    try {
      const e = await donorApi.eligibility(account.id)
      setElig(e)
      if (e.health?.weight_kg != null) setValue(String(e.health.weight_kg))
    } catch (err) {
      setError(err.message)
    }
  }, [account])

  useEffect(() => {
    load()
    configApi.get().then((c) => setRules(c.eligibility)).catch(() => {})
  }, [load])

  const num = parseFloat(value)
  const kg = unit === 'kg' ? num : num * 0.453592

  function evaluate(w) {
    if (!w || Number.isNaN(w)) return null
    if (w < rules.plausible_weight_min_kg || w > rules.plausible_weight_max_kg) {
      return {
        label: 'Implausible Entry',
        color: 'primary',
        icon: XCircle,
        msg: `Not a plausible weight — enter a value between ${rules.plausible_weight_min_kg} and ${rules.plausible_weight_max_kg} kg. Your saved weight will be kept until you correct this.`,
        blocked: true,
      }
    }
    if (w < rules.min_weight_kg) {
      return {
        label: 'Not Eligible',
        color: 'primary',
        icon: XCircle,
        msg: `Below the ${rules.min_weight_kg} kg medical minimum — eligibility flag locked.`,
      }
    }
    if (w < rules.min_weight_kg + CAUTION_MARGIN_KG) {
      return {
        label: 'Caution Zone',
        color: 'warning',
        icon: TriangleAlert,
        msg: 'Eligible, but a lower blood volume will be collected.',
      }
    }
    return {
      label: 'Fully Eligible',
      color: 'success',
      icon: CheckCircle2,
      msg: 'Meets optimal weight — full donation volume, no restrictions.',
    }
  }

  const result = evaluate(kg)

  async function save() {
    if (!account || busy || !result || result.blocked) return
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      const res = await donorApi.updateWeight(account.id, Number(kg.toFixed(1)))
      setSaved(res.message)
      setElig(res.eligibility)
    } catch (err) {
      setError(err.message)
      load()   // show what is actually stored
    } finally {
      setBusy(false)
    }
  }

  const health = elig?.health ?? {}
  const progress = elig?.progress ?? {}
  const cooldownLabel =
    health.last_donation_type === 'PLATELETS' ? 'platelet' : 'whole-blood'

  const requirements = [
    {
      dot: 'bg-primary',
      title: `Minimum Weight: ${rules.min_weight_kg} kg`,
      body: 'WHO & Bangladesh Blood Transfusion Society standard',
    },
    {
      dot: 'bg-warning',
      title: `Equivalent to ${Math.round(rules.min_weight_kg / 0.453592)} lbs`,
      body: 'Applies to whole blood and platelet donation',
    },
    {
      dot: 'bg-warning',
      title: `Caution: ${rules.min_weight_kg}–${rules.min_weight_kg + CAUTION_MARGIN_KG} kg range`,
      body: 'Eligible but monitored — lower volume collected',
    },
    {
      dot: 'bg-success',
      title: `Optimal: ${rules.min_weight_kg + CAUTION_MARGIN_KG} kg and above`,
      body: 'Full-donation volume, no restrictions',
    },
  ]

  const rangeRows = [
    [`Below ${rules.min_weight_kg} kg`, 'Not Eligible', 'text-primary', 'bg-primary'],
    [
      `${rules.min_weight_kg} – ${rules.min_weight_kg + CAUTION_MARGIN_KG} kg`,
      'Caution Zone', 'text-warning', 'bg-warning',
    ],
    [
      `${rules.min_weight_kg + CAUTION_MARGIN_KG} kg and above`,
      'Fully Eligible', 'text-success', 'bg-success',
    ],
  ]

  if (sessionLoading) {
    return (
      <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
        <div className="flex items-center gap-2 py-20 text-sm text-text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      </Shell>
    )
  }

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
        request. Minimum {rules.min_weight_kg} kg required by medical protocol.
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
                  <p className="text-sm font-semibold">{elig?.donor_name ?? account?.name}</p>
                  <p className="text-[11px] text-text-faint">Registered Donor</p>
                </div>
              </div>
              <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {elig?.blood_type ?? account?.blood_type}
              </span>
            </div>
            <div className="mt-4 space-y-2 border-t border-line pt-3">
              <Row
                k="Cooldown Status"
                v={elig?.countdown?.locked_by_cooldown ? 'In cooldown' : 'Eligible ✓'}
                c={elig?.countdown?.locked_by_cooldown ? 'text-warning' : 'text-success'}
              />
              <Row
                k="Last Donation"
                v={
                  health.last_donation_date
                    ? `${progress.elapsed_days} days ago`
                    : 'Never donated'
                }
                c="text-white"
              />
              <Row
                k="Weight Lock"
                v={elig?.underweight ? 'Active' : 'Clear'}
                c={elig?.underweight ? 'text-primary' : 'text-success'}
              />
              <Row k="Donations" v={String(health.donation_count ?? 0)} c="text-warning" />
            </div>

            {progress.total_days > 0 && (
              <div className="mt-4">
                <div className="h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full rounded-full ${
                      progress.percent >= 100 ? 'bg-success' : 'bg-warning'
                    }`}
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[10px] text-text-faint">
                  <span>
                    {progress.elapsed_days} / {progress.total_days} day {cooldownLabel} cooldown
                  </span>
                  <span className={progress.percent >= 100 ? 'text-success' : 'text-warning'}>
                    {progress.percent}% recovered
                  </span>
                </div>
              </div>
            )}
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
                onChange={(e) => {
                  setValue(e.target.value)
                  setSaved(null)
                  setError(null)
                }}
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

            <div className="mt-5 flex items-center gap-3">
              <Button onClick={save} disabled={!result || result.blocked || busy}>
                {busy && <Loader2 className="size-4 animate-spin" />} Save to my profile
              </Button>
              {saved && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
                  <CheckCircle2 className="size-4" /> {saved}
                </span>
              )}
            </div>
            {error && <p className="mt-3 text-[11px] text-primary">{error}</p>}
          </Card>
        </div>
      </div>
    </Shell>
  )
}

function Row({ k, v, c }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-faint">{k}</span>
      <span className={`font-semibold ${c}`}>{v}</span>
    </div>
  )
}

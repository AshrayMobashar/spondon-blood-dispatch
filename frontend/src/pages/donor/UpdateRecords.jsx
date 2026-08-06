import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardEdit, Moon, Navigation, BellOff, CheckCircle2, Sparkles,
  TriangleAlert, Loader2,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { DonorChips } from '../../components/RoleChips.jsx'
import { Card, Tabs, Toggle, Button, Field, Input, Select } from '../../components/ui.jsx'
import { configApi, donorApi } from '../../lib/api.js'
import { useSession } from '../../lib/session.js'

const tabs = ['Update Records', 'Weight Validation', 'Ping Activity']
const tabRoutes = ['/donor/records', '/donor/weight', '/admin/pings']

const iconWrap = {
  donor: 'bg-donor/10 text-donor',
  admin: 'bg-admin/10 text-admin',
  primary: 'bg-primary/10 text-primary',
}

const toDateInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')

function SidebarToggle({ icon: Icon, title, sub, color, on, onChange, disabled }) {
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
      {/* Keyed on the loaded value so the switch reflects the saved state
          once it arrives, rather than sticking at its initial guess. */}
      <Toggle key={String(on)} defaultOn={on} color={color} onChange={onChange} disabled={disabled} />
    </div>
  )
}

export default function UpdateRecords() {
  const [tab, setTab] = useState(0)
  const navigate = useNavigate()
  const { account, loading: sessionLoading } = useSession({ role: 'donor' })

  const [rules, setRules] = useState({ min_weight_kg: 50, whole_blood_cooldown_days: 120, platelet_cooldown_days: 14 })
  const [donor, setDonor] = useState(null)
  const [elig, setElig] = useState(null)
  const [form, setForm] = useState({ weight: '', lastDonation: '', type: 'WHOLE_BLOOD', route: '' })
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!account) return
    try {
      const [d, e] = await Promise.all([
        donorApi.get(account.id),
        donorApi.eligibility(account.id),
      ])
      setDonor(d)
      setElig(e)
      setForm({
        weight: d.health?.weight_kg != null ? String(d.health.weight_kg) : '',
        lastDonation: toDateInput(d.health?.last_donation_date),
        type: d.health?.last_donation_type || 'WHOLE_BLOOD',
        route: (d.commute_route?.segments ?? []).join(' → '),
      })
    } catch (err) {
      setError(err.message)
    }
  }, [account])

  useEffect(() => {
    load()
    configApi.get().then((c) => setRules(c.eligibility)).catch(() => {})
  }, [load])

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setSaved(null)
    setError(null)
  }

  const weightNum = parseFloat(form.weight)
  const implausible =
    form.weight !== '' &&
    (weightNum < rules.plausible_weight_min_kg || weightNum > rules.plausible_weight_max_kg)
  const underweight = !implausible && weightNum > 0 && weightNum < rules.min_weight_kg

  async function save(e) {
    e.preventDefault()
    if (busy || !account) return
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      // The server is the authority on plausibility — it rejects a typo and
      // keeps the stored weight, so nothing here half-saves.
      const res = await donorApi.updateHealth(account.id, {
        weight_kg: form.weight === '' ? null : weightNum,
        last_donation_date: form.lastDonation
          ? new Date(form.lastDonation).toISOString()
          : null,
        last_donation_type: form.lastDonation ? form.type : null,
      })
      setElig(res.eligibility)

      const segments = form.route.split(/[→>,]/).map((s) => s.trim()).filter(Boolean)
      if (segments.length) await donorApi.saveRoute(account.id, segments, 'Daily commute')
      else await donorApi.clearRoute(account.id).catch(() => {})

      setSaved(res.message)
      load()
    } catch (err) {
      setError(err.message)
      load()   // re-read, so the form shows what is actually stored
    } finally {
      setBusy(false)
    }
  }

  async function saveSleep(patch) {
    if (!account || !donor) return
    const sm = { ...donor.sleep_mode, ...patch }
    setDonor({ ...donor, sleep_mode: sm })
    try {
      await donorApi.saveSleepMode(account.id, {
        enabled: sm.enabled,
        start: sm.start,
        end: sm.end,
        allow_extreme_emergencies: sm.allow_extreme_emergencies,
        dnd_on: sm.dnd_on,
      })
    } catch (err) {
      setError(err.message)
      load()
    }
  }

  if (sessionLoading || (!donor && !error)) {
    return (
      <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
        <div className="flex items-center gap-2 py-20 text-sm text-text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading your records…
        </div>
      </Shell>
    )
  }

  const weight = donor?.health?.weight_kg
  const hasRoute = (donor?.commute_route?.segments ?? []).length > 0

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
              <span className="font-bold text-primary">{donor?.blood_type}</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Stat k="Weight" v={weight ? `${weight} kg` : '—'} c="text-white" />
              <Stat
                k="Status"
                v={elig?.eligible ? 'Eligible' : 'Locked'}
                c={elig?.eligible ? 'text-success' : 'text-warning'}
              />
              <Stat k="Donations" v={String(donor?.health?.donation_count ?? 0)} c="text-white" />
            </div>
          </Card>

          <SidebarToggle
            icon={Moon}
            title="Sleep Mode"
            sub={`${donor?.sleep_mode?.start ?? '23:00'} – ${donor?.sleep_mode?.end ?? '07:00'}`}
            color="donor"
            on={!!donor?.sleep_mode?.enabled}
            onChange={(v) => saveSleep({ enabled: v })}
          />
          <SidebarToggle
            icon={Navigation}
            title="Wake for Emergencies"
            sub="Life-threatening pings break through"
            color="admin"
            on={!!donor?.sleep_mode?.allow_extreme_emergencies}
            onChange={(v) => saveSleep({ allow_extreme_emergencies: v })}
          />
          <SidebarToggle
            icon={BellOff}
            title="OS Do Not Disturb"
            sub="Phone DND state"
            color="primary"
            on={!!donor?.sleep_mode?.dnd_on}
            onChange={(v) => saveSleep({ dnd_on: v })}
          />

          <p className="px-1 text-[10px] leading-relaxed text-text-faint">
            {hasRoute
              ? `Commute matching active on ${donor.commute_route.segments.length} segment(s).`
              : 'No commute route saved — add one below for route-aware matching.'}
          </p>
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
              <form className="space-y-4" onSubmit={save}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Weight (kg)" hint="Recalculates eligibility on save">
                    <Input value={form.weight} onChange={set('weight')} inputMode="decimal" />
                  </Field>
                  <Field label="Blood Type" hint="Contact an admin to change this">
                    <Input value={donor?.blood_type ?? ''} disabled />
                  </Field>
                  <Field label="Last Donation Date">
                    <Input type="date" value={form.lastDonation} onChange={set('lastDonation')} />
                  </Field>
                  <Field label="Donation Type">
                    <Select value={form.type} onChange={set('type')} disabled={!form.lastDonation}>
                      <option value="WHOLE_BLOOD">Whole Blood</option>
                      <option value="PLATELETS">Platelets (Apheresis)</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Daily Commute Route" hint="Used for route-aware matching">
                  <Input
                    value={form.route}
                    onChange={set('route')}
                    placeholder="e.g. Mirpur-10 → Farmgate → Motijheel"
                  />
                </Field>

                {implausible && (
                  <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-[11px] text-primary">
                    <TriangleAlert className="size-3.5 shrink-0" />
                    {weightNum}&nbsp;kg is not a plausible weight — enter a value between{' '}
                    {rules.plausible_weight_min_kg} and {rules.plausible_weight_max_kg} kg. Your
                    saved weight of {weight ?? '—'} kg will be kept until you correct this.
                  </p>
                )}
                {underweight && (
                  <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-[11px] text-warning">
                    <TriangleAlert className="size-3.5 shrink-0" />
                    Below the {rules.min_weight_kg} kg medical minimum — saving this will lock your
                    eligibility flag as a medical-risk factor.
                  </p>
                )}

                <div className="flex items-center gap-2 rounded-lg border border-donor/20 bg-donor/[0.05] px-4 py-3 text-[11px] text-text-muted">
                  <Sparkles className="size-3.5 shrink-0 text-donor" />
                  Whole blood locks eligibility for {rules.whole_blood_cooldown_days} days;
                  platelets for only {rules.platelet_cooldown_days} — your cooldown is recalculated
                  automatically from these values.
                </div>

                {error && (
                  <p className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-[11px] text-primary">
                    <TriangleAlert className="size-3.5 shrink-0" /> {error}
                  </p>
                )}

                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={busy || implausible}>
                    {busy && <Loader2 className="size-4 animate-spin" />} Save Records
                  </Button>
                  {saved && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
                      <CheckCircle2 className="size-4" /> {saved}
                    </span>
                  )}
                </div>

                {elig && !elig.eligible && (
                  <ul className="space-y-1 text-[11px] text-warning">
                    {elig.reasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                )}
              </form>
            </Card>

            <RecordDonation donorId={account?.id} rules={rules} onDone={load} />
          </div>
        </section>
      </div>
    </Shell>
  )
}

/**
 * The spec recalculates eligibility "after each donation" — this is that event.
 * Editing the date on the form above describes history; logging a donation here
 * arms the cooldown from now and increments the donation count.
 */
function RecordDonation({ donorId, rules, onDone }) {
  const [type, setType] = useState('WHOLE_BLOOD')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)

  const days =
    type === 'PLATELETS' ? rules.platelet_cooldown_days : rules.whole_blood_cooldown_days

  async function submit() {
    if (!donorId || busy) return
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const res = await donorApi.recordDonation(donorId, type, new Date().toISOString())
      setMsg(res.message)
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="mt-4 max-w-2xl p-6">
      <h2 className="text-sm font-bold">Just donated?</h2>
      <p className="mt-1 text-[11px] text-text-faint">
        Log it and the engine re-arms your cooldown from today — {days} days for{' '}
        {type === 'PLATELETS' ? 'apheresis platelets' : 'whole blood'}.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <Field label="What did you donate?">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="WHOLE_BLOOD">Whole Blood</option>
              <option value="PLATELETS">Platelets (Apheresis)</option>
            </Select>
          </Field>
        </div>
        <Button variant="outline" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Record donation
        </Button>
      </div>
      {msg && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-success">
          <CheckCircle2 className="size-3.5" /> {msg}
        </p>
      )}
      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-primary">
          <TriangleAlert className="size-3.5" /> {error}
        </p>
      )}
    </Card>
  )
}

function Stat({ k, v, c }) {
  return (
    <div>
      <p className={`text-sm font-bold ${c}`}>{v}</p>
      <p className="text-[10px] text-text-faint">{k}</p>
    </div>
  )
}

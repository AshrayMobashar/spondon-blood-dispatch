import { useCallback, useEffect, useState } from 'react'
import {
  Award, ShieldCheck, MapPin, Clock, Loader2, TriangleAlert, Trophy,
  Zap, RotateCcw, PauseCircle, Droplet, CheckCircle2,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { DonorChips } from '../../components/RoleChips.jsx'
import { Card, StatCard, Button, Badge, Field, Input, SectionHeader } from '../../components/ui.jsx'
import { GoldenBadge, GoldenSeal } from '../../components/GoldenBadge.jsx'
import { goldenApi } from '../../lib/api.js'
import { useSession } from '../../lib/session.js'

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—'

export default function GoldenDonor() {
  const { account, loading: sessionLoading } = useSession({ role: 'donor' })

  const [data, setData] = useState(null)
  const [roster, setRoster] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null)
  const [city, setCity] = useState('')

  const load = useCallback(async () => {
    if (!account) return
    try {
      const res = await goldenApi.me()
      setData(res)
      setCity(res.location.declared ? res.location.home_city : '')
      setError(null)
    } catch (err) {
      setError(err.message)
    }
    // The roll of honour is a nice-to-have; a failure here must not blank the
    // donor's own status, which is the reason they opened the page.
    try {
      setRoster(await goldenApi.roster())
    } catch {
      setRoster(null)
    }
  }, [account])

  useEffect(() => {
    load()
  }, [load])

  /* The restoration path. Opening the app is the whole proof of life the
     suspension was ever waiting on, so this is one button and no form. */
  const reactivate = async () => {
    setBusy(true)
    setFlash(null)
    try {
      const res = await goldenApi.heartbeat()
      setFlash({ ok: res.priority_restored, message: res.message })
      setData(res.golden)
    } catch (err) {
      setFlash({ ok: false, message: err.message })
    } finally {
      setBusy(false)
    }
  }

  const saveCity = async (e) => {
    e.preventDefault()
    setBusy(true)
    setFlash(null)
    try {
      const res = await goldenApi.setCity(city)
      setFlash({ ok: res.priority_active, message: res.message })
      setData(res.golden)
    } catch (err) {
      setFlash({ ok: false, message: err.message })
    } finally {
      setBusy(false)
    }
  }

  if (sessionLoading || (!data && !error)) {
    return (
      <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
        <div className="flex items-center gap-2 py-20 text-sm text-text-muted">
          <Loader2 className="size-4 animate-spin" /> Checking your Golden Donor status…
        </div>
      </Shell>
    )
  }

  if (error && !data) {
    return (
      <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
        <Card className="p-6" accent="primary">
          <p className="flex items-center gap-2 text-sm text-primary">
            <TriangleAlert className="size-4 shrink-0" /> {error}
          </p>
        </Card>
      </Shell>
    )
  }

  const { badge, progress, priority, activity, location, history, rules } = data
  const isGolden = badge.is_golden
  const active = badge.priority_active
  const suspended = isGolden && !active

  return (
    <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
      <SectionHeader
        icon={Award}
        color="warning"
        size="lg"
        title="Golden Donor Verification"
        subtitle={rules.summary}
      />

      {/* ── The badge itself ─────────────────────────────────────── */}
      <Card
        className={`relative mt-6 overflow-hidden p-8 ${
          isGolden ? 'border-warning/30' : ''
        }`}
      >
        {isGolden && (
          <>
            <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-warning/20 blur-[90px]" />
            <div className="pointer-events-none absolute -bottom-20 -left-16 size-64 rounded-full bg-amber-600/10 blur-[90px]" />
          </>
        )}

        <div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center">
          {isGolden ? (
            <GoldenSeal badge={badge} />
          ) : (
            <div className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-line bg-white/[0.03]">
              <Award className="size-8 text-text-faint" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold text-white">{data.donor_name}</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-donor/15 px-2.5 py-1 text-[10px] font-semibold text-donor">
                <Droplet className="size-3 fill-donor" /> {data.blood_type}
              </span>
              <GoldenBadge badge={badge} />
            </div>

            <p className="mt-3 text-sm text-text-muted">{priority.explanation}</p>

            {!isGolden && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] text-text-faint">
                  <span>
                    {progress.donations} of {progress.required} confirmed donations
                  </span>
                  <span>
                    {progress.remaining} more to earn the badge
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-warning to-amber-400 transition-all duration-700"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-text-faint">
                  Only a donation a hospital confirmed you attended counts — accepting a
                  request does not move this bar.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Suspension notice — the corner case, stated plainly. */}
        {suspended && (
          <div className="relative mt-6 rounded-xl border border-warning/30 bg-warning/[0.07] p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning">
              <PauseCircle className="size-4 shrink-0" />
              ICU priority is temporarily paused
            </p>
            <ul className="mt-3 space-y-1.5">
              {badge.suspended_reasons.map((reason) => (
                <li key={reason} className="flex gap-2 text-[13px] text-text-muted">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-warning" />
                  {reason}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-text-faint">
              Your badge is not affected — you earned it and you keep it. Only the
              front-of-queue placement on ICU dispatches is on hold, so the dispatcher
              does not spend its first seconds on a phone that may not answer.
            </p>
            {activity.is_dormant && (
              <Button
                onClick={reactivate}
                disabled={busy}
                className="mt-4 !bg-gradient-to-r !from-warning !to-amber-500 !text-ink"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                I'm back — restore my priority
              </Button>
            )}
          </div>
        )}

        {flash && (
          <p
            className={`relative mt-4 flex items-center gap-2 text-[13px] ${
              flash.ok ? 'text-success' : 'text-warning'
            }`}
          >
            {flash.ok ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : (
              <TriangleAlert className="size-4 shrink-0" />
            )}
            {flash.message}
          </p>
        )}
      </Card>

      {/* ── The three numbers behind the status ──────────────────── */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Confirmed donations"
          value={progress.donations}
          color="warning"
          sub={
            isGolden
              ? `Badge earned ${fmtDate(history.earned_at)}`
              : `${progress.remaining} more for the badge`
          }
        />
        <StatCard
          label="Last app activity"
          value={activity.days_since_seen === null ? '—' : `${activity.days_since_seen}d`}
          color={activity.is_dormant ? 'primary' : 'success'}
          sub={
            activity.is_dormant
              ? `Dormant — suspends after ${activity.dormant_after_days} days`
              : `${activity.days_until_dormant} days before dormancy`
          }
        />
        <StatCard
          label="Distance from city"
          value={
            location.km_from_city === null ? '—' : `${Math.round(location.km_from_city)} km`
          }
          color={location.relocated ? 'primary' : 'success'}
          sub={
            location.relocated
              ? `Outside the ${location.served_city} pool`
              : `Inside the ${location.radius_km} km ${location.served_city} pool`
          }
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ── Relocation ────────────────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            icon={MapPin}
            color="warning"
            title="Where you're based"
            subtitle={`The priority pool serves ${location.served_city}. Tell us if that changes — and tell us again when you come back.`}
          />
          <form onSubmit={saveCity} className="mt-5 space-y-4">
            <Field
              label="Current city"
              hint="Leave blank to clear the declaration and let your GPS decide."
            >
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={location.served_city}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="outline" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
                Save location
              </Button>
              {location.declared && (
                <Badge color={location.relocated ? 'warning' : 'success'}>
                  Declared: {location.home_city}
                </Badge>
              )}
            </div>
          </form>
          <p className="mt-4 text-[11px] text-text-faint">
            Moving away pauses your priority; it does not touch your badge. Moving back
            restores it immediately — we trust what you tell us rather than waiting for
            your phone to report a fix from the new address.
          </p>
        </Card>

        {/* ── How the priority works ────────────────────────────── */}
        <Card className="p-6">
          <SectionHeader
            icon={Zap}
            color="warning"
            title="What the badge buys you"
            subtitle="Priority placement on the dispatches where seconds matter most."
          />
          <ul className="mt-5 space-y-4">
            <Rule
              icon={ShieldCheck}
              title={`${rules.min_donations} confirmed donations`}
              body="Earns the verified badge. Only arrivals a hospital confirmed count, so the badge cannot be farmed by accepting requests and not turning up."
            />
            <Rule
              icon={Zap}
              title="First in the queue on ICU cases"
              body={`When a request is flagged ICU (or logged as ${rules.priority_severities
                .join(' / ')
                .replaceAll('_', ' ')
                .toLowerCase()}), proven donors are pinged before everyone else. Nobody is dropped — the badge decides who hears first, not who hears at all.`}
            />
            <Rule
              icon={Clock}
              title={`${rules.dormant_after_days} days of silence pauses it`}
              body="A donor the app has not seen in six months may not answer tonight. Opening the app restores the priority at once."
            />
            <Rule
              icon={MapPin}
              title={`Leaving ${rules.home_city} pauses it`}
              body={`Outside a ${rules.city_radius_km} km radius you cannot reach the hospital in time, so the queue moves on. Coming back restores it.`}
            />
          </ul>
        </Card>
      </div>

      {/* ── The roll of honour ───────────────────────────────────── */}
      {roster && roster.count > 0 && (
        <Card className="mt-6 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-6">
            <SectionHeader
              icon={Trophy}
              color="warning"
              title="Verified Golden Donors"
              subtitle={`${roster.active} with active ICU priority · ${roster.suspended} temporarily paused`}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-text-faint">
                  <th className="px-6 py-3 font-semibold">#</th>
                  <th className="px-6 py-3 font-semibold">Donor</th>
                  <th className="px-6 py-3 font-semibold">Blood</th>
                  <th className="px-6 py-3 font-semibold">Donations</th>
                  <th className="px-6 py-3 font-semibold">ICU priority</th>
                </tr>
              </thead>
              <tbody>
                {roster.donors.map((d, i) => (
                  <tr
                    key={d.donor_id}
                    className={`border-b border-line/60 last:border-0 ${
                      d.donor_id === data.donor_id ? 'bg-warning/[0.06]' : ''
                    }`}
                  >
                    <td className="px-6 py-3 text-text-faint">{i + 1}</td>
                    <td className="px-6 py-3">
                      <span className="font-medium text-white">{d.donor_name}</span>
                      {d.university && (
                        <span className="ml-2 text-[11px] text-text-faint">{d.university}</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-text-muted">{d.blood_type}</td>
                    <td className="px-6 py-3 text-text-muted">{d.donations}</td>
                    <td className="px-6 py-3">
                      <Badge color={d.priority_active ? 'success' : 'warning'}>
                        {d.priority_active ? 'Active' : 'Paused'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-6 py-4 text-[11px] text-text-faint">
            Paused holders are listed rather than hidden — they earned the badge and this
            is a record of that. Why any individual's priority is paused is between that
            donor and the dispatcher, and is never shown here.
          </p>
        </Card>
      )}
    </Shell>
  )
}

function Rule({ icon: Icon, title, body }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-warning/10">
        <Icon className="size-3.5 text-warning" />
      </span>
      <div>
        <p className="text-[13px] font-semibold text-white">{title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-text-faint">{body}</p>
      </div>
    </li>
  )
}

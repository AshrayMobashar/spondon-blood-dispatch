import { useCallback, useEffect, useState } from 'react'
import {
  Car, Bike, Loader2, MapPin, Clock, Ticket, TriangleAlert, CheckCircle2,
  Users, Copy, Check, Heart,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { DonorChips } from '../../components/RoleChips.jsx'
import { Card, Badge, Button, SectionHeader } from '../../components/ui.jsx'
import { bountyApi } from '../../lib/api.js'
import { useSession } from '../../lib/session.js'

/* Module 3.4 — Post-Donation Ride Community Bounty.
 *
 * One page, two audiences. A donor who just gave platelets watches their own
 * ride home at the top; everyone else scrolls to the community board below and
 * offers one. Which half matters is decided by the data, not by a role switch,
 * because the same person is both on different days. */

export default function RideBounties() {
  const { account, loading: sessionLoading } = useSession({ role: 'donor' })

  const [mine, setMine] = useState(null)
  const [board, setBoard] = useState(null)
  const [rules, setRules] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [flash, setFlash] = useState(null)

  const load = useCallback(async () => {
    if (!account) return
    try {
      const [m, b] = await Promise.all([bountyApi.mine(), bountyApi.list()])
      setMine(m)
      setBoard(b)
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [account])

  useEffect(() => { load() }, [load])

  // An open bounty is a 15-minute countdown; without a refresh the board keeps
  // showing rides that were taken or expired minutes ago.
  useEffect(() => {
    const t = setInterval(() => { load() }, 15000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    bountyApi.rules().then(setRules).catch(() => setRules(null))
  }, [])

  async function act(fn, id, okMessage) {
    setBusy(id)
    setFlash(null)
    try {
      await fn(id)
      setFlash({ tone: 'success', text: okMessage })
      await load()
    } catch (err) {
      setFlash({ tone: 'warning', text: err.message })
    } finally {
      setBusy(null)
    }
  }

  if (sessionLoading || (!mine && !error)) {
    return (
      <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
        <p className="text-sm text-text-muted">
          <Loader2 className="inline size-4 animate-spin" /> Loading ride bounties…
        </p>
      </Shell>
    )
  }

  const active = mine?.active ?? null
  const promoRide = mine?.latest_promo ?? null
  const rows = board?.bounties ?? []

  return (
    <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
      <div className="max-w-4xl space-y-8">
        <SectionHeader
          icon={Car}
          color="donor"
          title="Ride Home Bounties"
          subtitle={
            rules?.summary ??
            'A lift home for donors who just gave platelets — offered by the community.'
          }
        />

        {error && (
          <Card className="flex items-center gap-2 border-primary/40 p-4 text-sm text-primary">
            <TriangleAlert className="size-4 shrink-0" /> {error}
          </Card>
        )}

        {flash && (
          <Card className={`flex items-center gap-2 p-4 text-sm ${
            flash.tone === 'success' ? 'text-success' : 'text-warning'
          }`}>
            {flash.tone === 'success'
              ? <CheckCircle2 className="size-4 shrink-0" />
              : <TriangleAlert className="size-4 shrink-0" />}
            {flash.text}
          </Card>
        )}

        {/* ── Your ride home ───────────────────────────────────────── */}
        {(active || promoRide) && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-text-muted">Your ride home</h2>
            {active && <MyRide bounty={active} rules={rules}
                               busy={busy === active.id}
                               onComplete={() => act(bountyApi.complete, active.id,
                                 'Ride closed out. Thank you for donating.')} />}
            {!active && promoRide && <PromoCard bounty={promoRide} />}
          </section>
        )}

        {/* ── The community board ──────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-muted">
              Donors near you who need a lift
            </h2>
            {board && (
              <Badge color={board.can_drive ? 'donor' : 'warning'} dot={false}>
                {board.can_drive
                  ? `${board.vehicle_type === 'bike' ? 'Bike' : 'Car'} registered`
                  : 'No vehicle on your profile'}
              </Badge>
            )}
          </div>

          {board && !board.can_drive && (
            <Card className="border-warning/30 p-4 text-xs text-warning">
              Add a car or bike under Update Records to offer someone a ride home.
            </Card>
          )}

          {rows.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-sm text-text-muted">No one needs a ride right now.</p>
              <p className="mt-2 text-xs text-text-faint">
                A bounty appears here the moment a platelet donation finishes within{' '}
                {rules ? `${rules.radius_km} km` : 'range'} of you.
              </p>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {rows.map((b) => (
              <BountyCard
                key={b.id}
                bounty={b}
                canDrive={board?.can_drive}
                busy={busy === b.id}
                onAccept={() => act(bountyApi.accept, b.id,
                  'Thank you — the donor has been told you are on your way.')}
                onComplete={() => act(bountyApi.complete, b.id, 'Ride closed out.')}
              />
            ))}
          </div>
        </section>
      </div>
    </Shell>
  )
}

/* ── The donor's own bounty, still running or already answered ────── */
function MyRide({ bounty, rules, busy, onComplete }) {
  if (bounty.status === 'ACCEPTED') {
    return (
      <Card accent="success" className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 font-bold text-success">
              <CheckCircle2 className="size-4" /> {bounty.driver_name} is driving you home
            </p>
            <p className="mt-1 text-xs text-text-muted">
              Meet them outside {bounty.hospital}
              {bounty.driver_vehicle ? ` — look for a ${bounty.driver_vehicle}` : ''}.
            </p>
            {bounty.driver_phone && (
              <p className="mt-2 text-xs text-text-faint">
                Call them on <span className="font-semibold text-white">{bounty.driver_phone}</span>
              </p>
            )}
          </div>
          <Button variant="ghost" onClick={onComplete} disabled={busy} className="shrink-0 text-xs">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Got home
          </Button>
        </div>
      </Card>
    )
  }

  // Still OPEN — the community has been asked and the clock is running.
  return (
    <Card accent="donor" className="p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-bold text-donor">
            <Users className="size-4" /> Asking {bounty.alerted_count} neighbour
            {bounty.alerted_count === 1 ? '' : 's'} for a lift
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Thank you for donating. If nobody is free within{' '}
            {rules?.window_minutes ?? bounty.window_minutes} minutes we will send you a
            free {rules?.partners?.join(' / ') ?? 'ride-share'} code instead — you will not
            be left stranded.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] uppercase tracking-wide text-text-faint">Time left</p>
          <p className="text-lg font-bold text-white">
            <Countdown seconds={bounty.seconds_remaining} />
          </p>
        </div>
      </div>
    </Card>
  )
}

/* ── The corner case, made visible: nobody came, here is your code ── */
function PromoCard({ bounty }) {
  const [copied, setCopied] = useState(false)
  const promo = bounty.promo
  if (!promo?.code) return null

  async function copy() {
    try {
      await navigator.clipboard.writeText(promo.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Card accent="warning" className="p-5">
      <p className="flex items-center gap-2 font-bold text-warning">
        <Ticket className="size-4" /> Your ride home is covered
      </p>
      <p className="mt-1 text-xs text-text-muted">
        No community driver was free, so here is a {promo.partner} ride on us.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <code className="flex-1 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-center text-lg font-bold tracking-[0.2em] text-white">
          {promo.code}
        </code>
        <Button variant="ghost" onClick={copy} className="shrink-0 text-xs">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-text-faint">
        <span>Partner: <span className="text-text-muted">{promo.partner}</span></span>
        {promo.value_bdt != null && (
          <span>Covers up to <span className="text-text-muted">৳{promo.value_bdt}</span></span>
        )}
        {promo.expires_at && (
          <span>
            Valid until{' '}
            <span className="text-text-muted">
              {new Date(promo.expires_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </span>
        )}
        {promo.simulated && (
          <span className="text-warning">
            Demo code — no ride-share partner key is configured.
          </span>
        )}
      </div>
    </Card>
  )
}

/* ── One bounty on the community board ────────────────────────────── */
function BountyCard({ bounty, canDrive, busy, onAccept, onComplete }) {
  const mineToDrive = bounty.viewer_is_driver
  const Vehicle = bounty.driver_vehicle === 'bike' ? Bike : Car

  return (
    <Card className="p-5" accent={mineToDrive ? 'success' : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-bold">
            <Heart className="size-3.5 text-primary" /> {bounty.donor_name}
          </h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
            <MapPin className="size-3.5" /> {bounty.hospital}
          </p>
        </div>
        <Badge color={bounty.status === 'OPEN' ? 'warning' : 'success'} dot={false}>
          {bounty.status === 'OPEN' ? 'Needs a lift' : 'You are driving'}
        </Badge>
      </div>

      <p className="mt-3 text-[11px] text-text-faint">
        Just finished a platelet donation.
        {bounty.alerted_count > 1 && ` ${bounty.alerted_count} neighbours asked.`}
      </p>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
        <span className="flex items-center gap-1.5 text-[10px] text-text-faint">
          <Clock className="size-3" />
          {bounty.status === 'OPEN'
            ? <>Closes in <Countdown seconds={bounty.seconds_remaining} /></>
            : 'Accepted'}
        </span>

        {bounty.status === 'OPEN' ? (
          <Button
            onClick={onAccept}
            disabled={busy || !canDrive}
            title={canDrive ? undefined : 'Add a car or bike to your profile first'}
            className="px-4 py-1.5 text-xs"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Car className="size-3.5" />}
            Offer a ride
          </Button>
        ) : mineToDrive ? (
          <Button variant="ghost" onClick={onComplete} disabled={busy} className="px-4 py-1.5 text-xs">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Vehicle className="size-3.5" />}
            Dropped off
          </Button>
        ) : (
          <span className="text-xs font-bold text-success">Covered</span>
        )}
      </div>
    </Card>
  )
}

/* Counts down from a server-supplied number of seconds, so a clock skewed
 * against the server cannot show a window that never closes. */
function Countdown({ seconds }) {
  const [left, setLeft] = useState(seconds ?? 0)
  useEffect(() => { setLeft(seconds ?? 0) }, [seconds])
  useEffect(() => {
    if (left <= 0) return
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [left])
  if (left <= 0) return <span>0m 0s</span>
  return <span>{Math.floor(left / 60)}m {left % 60}s</span>
}

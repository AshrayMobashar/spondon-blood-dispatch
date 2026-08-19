/** Live En-Route Tracker — what the family watches once a donor is locked in.
 *
 *  The screen has one job beyond drawing a map: never imply it knows more than
 *  it does. A family refreshing this page every ten seconds at 3 a.m. will read
 *  the ETA as a promise, so the page distinguishes three states that a naive
 *  implementation would collapse into one:
 *
 *    1. Live          — recent fix, ETA counting down against a server timestamp
 *    2. Signal lost   — the donor's phone dropped off; icon frozen, ETA amber
 *                       and held at its last value, with the reason stated
 *    3. Tracker offline — *this browser* lost its connection, so we cannot even
 *                       claim (2). Different cause, different message.
 *
 *  State 2 is the specified corner case. State 3 is its mirror image and is
 *  just as capable of stranding someone in front of a stale number, so it gets
 *  its own banner rather than being allowed to masquerade as "live".
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import {
  Activity, Clock, Hospital, Loader2, MapPin, Navigation, RadioTower,
  ShieldAlert, TriangleAlert, WifiOff,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import TrackerMap from '../../components/TrackerMap.jsx'
import MaskedCallPanel from '../../components/MaskedCallPanel.jsx'
import RequestPicker from '../../components/RequestPicker.jsx'
import { Badge, Card, SectionHeader } from '../../components/ui.jsx'
import { ageLabel, useTripFeed } from '../../lib/trip.js'
import { useSession } from '../../lib/session.js'

export default function LiveTracker() {
  const params = useParams()
  const [search, setSearch] = useSearchParams()
  const { account, loading: sessionLoading } = useSession()

  // The request id can arrive in the path or the query string; a family
  // following a link from a notification has one, a family arriving cold does
  // not, so the page also just asks.
  const requestId = params.requestId || search.get('request') || ''

  const { trip, context, connection, denied, notFound, log } = useTripFeed(requestId)

  if (sessionLoading) {
    return (
      <Shell panel="FAMILY VIEW">
        <div className="flex items-center gap-2 py-20 text-sm text-text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      </Shell>
    )
  }

  if (!requestId || notFound) {
    return (
      <Shell panel="FAMILY VIEW">
        <RequestPicker
          role="family"
          account={account}
          onPick={(id) => setSearch({ request: id })}
          notice={notFound ? 'That request ID does not exist. Pick one below instead.' : null}
        />
      </Shell>
    )
  }

  if (denied) {
    return (
      <Shell panel="FAMILY VIEW">
        <Card accent="primary" className="mx-auto max-w-lg p-6">
          <SectionHeader icon={ShieldAlert} title="Not your request" subtitle={denied} />
          <p className="mt-4 text-[12px] leading-relaxed text-text-faint">
            A donor's live position is shown only to the family who opened the request and to
            the donor themselves. Knowing a request ID is not enough — otherwise anyone who
            saw one could watch a stranger travel.
          </p>
          <Link to="/" className="mt-4 inline-block text-[12px] text-primary underline">
            Back to home
          </Link>
        </Card>
      </Shell>
    )
  }

  return (
    <Shell panel="FAMILY VIEW">
      <SectionHeader
        icon={Navigation}
        size="lg"
        title="Your donor is on the way"
        subtitle={
          context?.donor_name
            ? `${context.donor_name} accepted your request and is travelling to ${context.hospital}.`
            : 'Following your secured donor in real time.'
        }
      />

      <ConnectionBanner connection={connection} trip={trip} />

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <TrackerMap
              donor={trip?.last_location ?? null}
              hospital={context?.hospital_location ?? null}
              trail={trip?.trail ?? []}
              stale={Boolean(trip?.stale)}
              arrived={trip?.status === 'ARRIVED'}
            />
          </Card>

          <EtaPanel trip={trip} context={context} connection={connection} />
        </div>

        <div className="space-y-5">
          <MaskedCallPanel
            requestId={requestId}
            role="family"
            peerName={context?.donor_name}
          />
          <ActivityLog log={log} />
        </div>
      </div>
    </Shell>
  )
}

/* ── Banners ─────────────────────────────────────────────────────── */
function ConnectionBanner({ connection, trip }) {
  // Ordering matters. Our own dead socket is the more fundamental problem: if
  // this browser cannot hear the server, we cannot even vouch for the freeze
  // state, so that message wins over the donor-signal one.
  if (connection === 'reconnecting' || connection === 'connecting') {
    return (
      <Banner
        tone="warning"
        icon={WifiOff}
        title="Tracker offline — reconnecting"
        body="This device has lost its connection to Spondon, so what you see below may be out
              of date. Nothing has happened to your donor; we just cannot hear about it right now."
      />
    )
  }

  if (trip?.stale) {
    return (
      <Banner
        tone="warning"
        icon={TriangleAlert}
        title={trip.message || 'Donor signal lost, relying on last known location'}
        body={`Their phone stopped reporting ${ageLabel(
          trip.seconds_since_fix,
        )}. The marker is frozen where they were, and the arrival time below is held at its last
        value rather than counting down. This usually means a tunnel, a lift, or a weak cell —
        they are still on their way.`}
      />
    )
  }

  if (trip?.status === 'ARRIVED') {
    return (
      <Banner
        tone="success"
        icon={Hospital}
        title="Your donor has arrived"
        body="They have reached the hospital. Use the call button if you still need to find each other."
      />
    )
  }

  return null
}

function Banner({ tone, icon: Icon, title, body }) {
  const ring =
    tone === 'success'
      ? 'border-success/30 bg-success/10 text-success'
      : 'border-warning/30 bg-warning/10 text-warning'
  return (
    <div className={`mt-5 flex items-start gap-3 rounded-xl border p-4 ${ring}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="text-[12px] font-semibold">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{body}</p>
      </div>
    </div>
  )
}

/* ── ETA ─────────────────────────────────────────────────────────── */
function EtaPanel({ trip, context, connection }) {
  const stale = Boolean(trip?.stale) || connection === 'reconnecting'

  // While the fix is live the server hands us an absolute arrival timestamp and
  // we count towards it, so the number stays right across a sleeping tab. The
  // moment it goes stale that timestamp is withheld — deliberately — and we
  // fall back to displaying the frozen figure without ageing it. An ETA that
  // keeps ticking for a donor nobody has heard from would walk itself down to
  // "arriving now" and be believed.
  const [secondsLeft, setSecondsLeft] = useState(null)
  const etaAt = trip?.eta_at

  useEffect(() => {
    if (!etaAt) {
      setSecondsLeft(null)
      return undefined
    }
    const end = new Date(etaAt).getTime()
    const tick = () => setSecondsLeft(Math.max(0, Math.round((end - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [etaAt])

  const display = useMemo(() => {
    if (!trip) return '—'
    if (trip.status === 'ARRIVED') return 'Arrived'
    if (!stale && secondsLeft != null) {
      const mins = Math.floor(secondsLeft / 60)
      return mins >= 1 ? `${mins} min` : 'Under a minute'
    }
    if (trip.eta_minutes != null) return `${trip.eta_minutes} min`
    return '—'
  }, [trip, stale, secondsLeft])

  const waiting = !trip?.last_location

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-faint">
            <Clock className="size-3.5" />
            Estimated arrival
          </p>
          <p
            className={`mt-2 text-[34px] font-bold leading-none ${
              stale ? 'text-warning' : 'text-white'
            }`}
          >
            {waiting ? 'Waiting' : display}
          </p>
          <p className="mt-2 text-[11px] text-text-faint">
            {waiting
              ? 'Waiting for your donor’s first location.'
              : stale
                ? `Last calculated ${ageLabel(trip?.seconds_since_fix)} — not updating.`
                : 'Updating live as they travel.'}
          </p>
        </div>

        <Badge color={stale ? 'warning' : trip?.status === 'ARRIVED' ? 'success' : 'success'}>
          {stale ? 'Stale data' : trip?.status === 'ARRIVED' ? 'Arrived' : 'Live tracking'}
        </Badge>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          icon={MapPin}
          label="Distance"
          value={trip?.distance_km != null ? `${trip.distance_km} km` : '—'}
          note={trip?.distance_source === 'driving' ? 'by road' : 'estimated road distance'}
          stale={stale}
        />
        <Metric
          icon={Activity}
          label="Speed"
          value={trip?.speed_kmh != null ? `${trip.speed_kmh} km/h` : '—'}
          note="recent average"
          stale={stale}
        />
        <Metric
          icon={RadioTower}
          label="Last update"
          value={ageLabel(trip?.seconds_since_fix)}
          note={`${trip?.updates ?? 0} received`}
          stale={stale}
        />
        <Metric
          icon={Hospital}
          label="Destination"
          value={context?.hospital ?? '—'}
          note={context?.request_status ?? ''}
          stale={false}
        />
      </div>

      {trip?.signal_drops > 0 && !stale && (
        <p className="mt-4 text-[11px] text-text-faint">
          Their connection has dropped {trip.signal_drops}{' '}
          {trip.signal_drops === 1 ? 'time' : 'times'} on this trip and recovered each time.
        </p>
      )}
    </Card>
  )
}

function Metric({ icon: Icon, label, value, note, stale }) {
  return (
    <div className="rounded-lg border border-line bg-ink/40 p-3">
      <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-text-faint">
        <Icon className="size-3" />
        {label}
      </p>
      <p className={`mt-1.5 truncate text-[13px] font-semibold ${stale ? 'text-warning' : 'text-white'}`}>
        {value}
      </p>
      {note && <p className="mt-0.5 truncate text-[10px] text-text-faint">{note}</p>}
    </div>
  )
}

function ActivityLog({ log }) {
  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-faint">
        <Activity className="size-3.5" />
        Activity
      </p>
      {log.length === 0 ? (
        <p className="mt-3 text-[11px] text-text-faint">Nothing to report yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {log.map((entry) => (
            <li key={entry.id} className="flex gap-2 text-[11px] text-text-muted">
              <span className="shrink-0 text-text-faint">
                {new Date(entry.at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span>{entry.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

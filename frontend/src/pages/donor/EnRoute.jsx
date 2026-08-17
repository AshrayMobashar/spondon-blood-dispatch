/** EnRoute — the donor's side of the live tracker.
 *
 *  This is the page that produces the data the family's dashboard consumes. It
 *  reports the donor's position every few seconds while they travel, and its
 *  interesting behaviour is what it does when that reporting fails.
 *
 *  A phone in a Dhaka underpass does not stop knowing where it is — it stops
 *  being able to *say*. So a failed upload is buffered locally, not discarded,
 *  and flushed in one ordered batch when the connection returns. The family's
 *  trail is then redrawn along the road actually travelled instead of jumping
 *  from the tunnel mouth to wherever the donor surfaced. The server orders the
 *  flush by the phone's own `recorded_at` for exactly this reason.
 *
 *  The "simulate signal loss" switch is a demo affordance and labelled as one.
 *  It stops uploads while the browser keeps generating fixes, which is precisely
 *  what a dead uplink looks like from here — so the corner case is reproducible
 *  on a laptop without walking into a basement.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import {
  CheckCircle2, CloudOff, Loader2, MapPin, Navigation, Play, Radio, Square,
  TriangleAlert, Upload,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import TrackerMap from '../../components/TrackerMap.jsx'
import MaskedCallPanel from '../../components/MaskedCallPanel.jsx'
import { DonorChips } from '../../components/RoleChips.jsx'
import RequestPicker from '../../components/RequestPicker.jsx'
import { Badge, Button, Card, SectionHeader, Toggle } from '../../components/ui.jsx'
import { tripApi } from '../../lib/api.js'
import { captureLocation } from '../../lib/geo.js'
import { ageLabel, useTripFeed } from '../../lib/trip.js'
import { useSession } from '../../lib/session.js'

const REPORT_MS = 10_000
// A buffer, not a log: enough to bridge a few minutes of dead uplink without
// letting a long outage grow an unbounded array on a phone.
const MAX_BUFFER = 120

export default function EnRoute() {
  const params = useParams()
  const [search, setSearch] = useSearchParams()
  const { account, loading: sessionLoading } = useSession({ role: 'donor' })

  const requestId = params.requestId || search.get('request') || ''

  const { trip, context, connection, denied, notFound, log } = useTripFeed(requestId)

  const [sharing, setSharing] = useState(false)
  const [cutSignal, setCutSignal] = useState(false)
  const [buffered, setBuffered] = useState(0)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState(null)

  const buffer = useRef([])
  const cutRef = useRef(cutSignal)
  cutRef.current = cutSignal

  /* ── Reporting ─────────────────────────────────────────────────── */
  const flushBuffer = useCallback(async () => {
    if (!buffer.current.length) return
    const pending = buffer.current
    buffer.current = []
    setBuffered(0)
    try {
      const res = await tripApi.flush(requestId, pending)
      setStatus(
        `Reconnected — sent ${res.accepted} of ${res.submitted} buffered position${
          res.submitted === 1 ? '' : 's'
        }.`,
      )
    } catch (err) {
      // Put them back. Losing the buffer on a failed flush would erase exactly
      // the stretch of road the family is missing.
      buffer.current = pending.concat(buffer.current).slice(-MAX_BUFFER)
      setBuffered(buffer.current.length)
      setError(err.message)
    }
  }, [requestId])

  const reportOnce = useCallback(async () => {
    let fix
    try {
      fix = await captureLocation({ timeout: 8000 })
    } catch (err) {
      setError(err.message)
      return
    }

    const point = { ...fix, recorded_at: new Date().toISOString() }

    if (cutRef.current) {
      // The uplink is down. The fix is still good — hold it.
      buffer.current = [...buffer.current, point].slice(-MAX_BUFFER)
      setBuffered(buffer.current.length)
      return
    }

    try {
      if (buffer.current.length) await flushBuffer()
      const res = await tripApi.report(requestId, point)
      setError(null)
      setStatus(
        res.accepted
          ? null
          : `Last fix was not used: ${res.reason}`,
      )
    } catch (err) {
      // A network failure is indistinguishable from the simulated cut, and is
      // handled the same way: keep the fix rather than drop it.
      buffer.current = [...buffer.current, point].slice(-MAX_BUFFER)
      setBuffered(buffer.current.length)
      setError(err.message)
    }
  }, [requestId, flushBuffer])

  useEffect(() => {
    if (!sharing || !requestId) return undefined
    reportOnce()
    const id = setInterval(reportOnce, REPORT_MS)
    return () => clearInterval(id)
  }, [sharing, requestId, reportOnce])

  // Restoring the uplink flushes immediately rather than waiting for the next
  // tick — the family has been staring at a frozen icon and every second of
  // extra delay is one they spend not knowing.
  useEffect(() => {
    if (!cutSignal && sharing) flushBuffer()
  }, [cutSignal, sharing, flushBuffer])

  const start = async () => {
    setError(null)
    try {
      await tripApi.start(requestId)
      setSharing(true)
    } catch (err) {
      setError(err.message)
    }
  }

  const arrive = async () => {
    try {
      await flushBuffer()
      await tripApi.arrived(requestId)
      setSharing(false)
      setStatus('Arrival reported — the family has been told you are here.')
    } catch (err) {
      setError(err.message)
    }
  }

  /* ── Render ────────────────────────────────────────────────────── */
  if (sessionLoading) {
    return (
      <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
        <div className="flex items-center gap-2 py-20 text-sm text-text-muted">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      </Shell>
    )
  }

  // No id, or an id that resolves to nothing — both are answered the same way:
  // show the donor the requests they actually secured.
  if (!requestId || notFound) {
    return (
      <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
        <RequestPicker
          role="donor"
          account={account}
          onPick={(id) => setSearch({ request: id })}
          notice={notFound ? 'That request ID does not exist. Pick one below instead.' : null}
        />
      </Shell>
    )
  }

  if (denied) {
    return (
      <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
        <Card accent="primary" className="mx-auto max-w-lg p-6">
          <SectionHeader icon={TriangleAlert} title="Not your request" subtitle={denied} />
          <Link to="/donor/eligibility" className="mt-4 inline-block text-[12px] text-primary underline">
            Back to your dashboard
          </Link>
        </Card>
      </Shell>
    )
  }

  const arrived = trip?.status === 'ARRIVED'

  return (
    <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
      <SectionHeader
        icon={Navigation}
        size="lg"
        color="donor"
        title="You're on the way"
        subtitle={
          context?.hospital
            ? `Sharing your position with the family at ${context.hospital}.`
            : 'Sharing your position with the family who need you.'
        }
      />

      {cutSignal && sharing && (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-warning">
          <CloudOff className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="text-[12px] font-semibold">Uplink down — holding {buffered} fix{buffered === 1 ? '' : 'es'}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
              Your phone is still recording where you are; it just cannot send it. The family
              sees your last known position with a warning, not a guess. Everything held here
              is sent in order the moment you reconnect.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <TrackerMap
              donor={trip?.last_location ?? null}
              hospital={context?.hospital_location ?? null}
              trail={trip?.trail ?? []}
              stale={Boolean(trip?.stale)}
              arrived={arrived}
            />
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-faint">
                  <Radio className="size-3.5" />
                  Location sharing
                </p>
                <p className="mt-2 text-[15px] font-semibold text-white">
                  {arrived
                    ? 'Arrived'
                    : sharing
                      ? cutSignal
                        ? 'Recording, not sending'
                        : 'Broadcasting every 10 seconds'
                      : 'Not sharing yet'}
                </p>
                <p className="mt-1 text-[11px] text-text-faint">
                  {trip?.updates ?? 0} sent · last {ageLabel(trip?.seconds_since_fix)}
                  {trip?.rejected_updates ? ` · ${trip.rejected_updates} discarded as implausible` : ''}
                </p>
              </div>

              <div className="flex gap-2">
                {!sharing && !arrived && (
                  <Button variant="success" onClick={start}>
                    <Play className="size-4" />
                    Start sharing
                  </Button>
                )}
                {sharing && (
                  <>
                    <Button variant="ghost" onClick={() => setSharing(false)}>
                      <Square className="size-4" />
                      Pause
                    </Button>
                    <Button variant="success" onClick={arrive}>
                      <CheckCircle2 className="size-4" />
                      I've arrived
                    </Button>
                  </>
                )}
              </div>
            </div>

            {buffered > 0 && !cutSignal && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-warning">
                <Upload className="size-3.5" /> Sending {buffered} buffered position(s)…
              </p>
            )}
            {status && <p className="mt-3 text-[11px] text-success">{status}</p>}
            {error && <p className="mt-3 text-[11px] text-primary">{error}</p>}

            {/* Demo affordance — labelled, so nobody mistakes it for a feature. */}
            <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-dashed border-line/70 bg-ink/30 p-3">
              <div>
                <p className="text-[11px] font-semibold text-white">Simulate losing signal</p>
                <p className="mt-1 text-[10px] leading-relaxed text-text-faint">
                  Keeps recording fixes but stops sending them, exactly as a dead uplink would.
                  Leave it on for {'>'}45s and the family's tracker freezes and turns amber.
                </p>
              </div>
              <Toggle color="warning" onChange={setCutSignal} />
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <MaskedCallPanel
            requestId={requestId}
            role="donor"
            peerName={context?.requester_name}
          />

          <Card className="p-5">
            <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-faint">
              <MapPin className="size-3.5" />
              Trip activity
            </p>
            {log.length === 0 ? (
              <p className="mt-3 text-[11px] text-text-faint">Nothing yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {log.map((e) => (
                  <li key={e.id} className="flex gap-2 text-[11px] text-text-muted">
                    <span className="shrink-0 text-text-faint">
                      {new Date(e.at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span>{e.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-[10px] leading-relaxed text-text-faint">
              Your position is shown only to the family who opened this request, and only
              until you arrive. It is never added to the public dispatch radar.
            </p>
          </Card>

          {connection === 'reconnecting' && (
            <Badge color="warning">Tracker socket reconnecting…</Badge>
          )}
        </div>
      </div>
    </Shell>
  )
}

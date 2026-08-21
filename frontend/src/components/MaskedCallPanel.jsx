/** MaskedCallPanel — the temporary call channel between a family and their donor.
 *
 *  Two things are happening here and it is worth keeping them apart.
 *
 *  **The channel is real.** The session, the authorisation check, the number
 *  masking and the atomic allocation of a GSM proxy number all live on the
 *  server and work exactly as shipped.
 *
 *  **The media leg is simulated.** Carrying actual voice needs a WebRTC peer
 *  connection and a TURN server, which this build does not have. So the quality
 *  meter below is driven by a simulated signal level rather than real
 *  `RTCPeerConnection.getStats()`. The panel says so on screen rather than
 *  implying a call is being carried.
 *
 *  What that simulation buys is the corner case, which is otherwise impossible
 *  to demonstrate on a laptop: drag the signal down to what a basement hospital
 *  corridor does to 3G, and the panel watches its own leg degrade, decides on
 *  its own that VOIP is not going to recover, and hands the conversation to a
 *  GSM proxy number without either party doing anything. Swapping the meter for
 *  real getStats() output is a change to `sampleQuality` and nothing else.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Phone, PhoneOff, ShieldCheck, SignalHigh, SignalLow, Wifi, WifiOff } from 'lucide-react'
import { callApi } from '../lib/api.js'
import { Badge, Button, Card } from './ui.jsx'

/* ── The simulated media leg ─────────────────────────────────────── */
/**
 * Turn a 0–5 signal-bar level into the call-quality numbers a real WebRTC
 * stats read would give you. Deliberately noisy: a threshold that only fires on
 * clean synthetic data is not a threshold that survives contact with a real
 * network.
 *
 * Replace this with `pc.getStats()` when a real peer connection exists — the
 * rest of the component only cares about the shape it returns.
 */
function sampleQuality(bars) {
  const jitter = () => (Math.random() - 0.5) * 0.6
  const mos = Math.max(1, Math.min(5, 1 + bars * 0.78 + jitter()))
  const packetLoss = Math.max(0, Math.min(100, (5 - bars) * 7 + Math.random() * 6))
  const rtt = 60 + (5 - bars) * 190 + Math.random() * 80
  return { mos: +mos.toFixed(2), packet_loss_pct: +packetLoss.toFixed(1), rtt_ms: Math.round(rtt) }
}

const STATE = {
  IDLE: 'IDLE',
  CONNECTING: 'CONNECTING',
  IN_CALL: 'IN_CALL',
  ENDED: 'ENDED',
}

export default function MaskedCallPanel({ requestId, role = 'family', peerName }) {
  const [session, setSession] = useState(null)
  const [state, setState] = useState(STATE.IDLE)
  const [quality, setQuality] = useState(null)
  const [bars, setBars] = useState(4)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [switching, setSwitching] = useState(false)

  // Consecutive bad samples. The fallback deliberately waits for a run of them:
  // one bad second is a blip, and yanking two people onto a different transport
  // for it is worse than the stutter they'd have heard.
  const badRun = useRef(0)
  const barsRef = useRef(bars)
  barsRef.current = bars

  const floor = session?.quality_floor
  const onGsm = session?.mode === 'GSM_FALLBACK'

  /* ── Channel lifecycle ─────────────────────────────────────────── */
  const openChannel = useCallback(async () => {
    setError(null)
    try {
      // Idempotent server-side: a refresh mid-conversation rejoins the existing
      // channel instead of opening a second one against the same donor.
      const s = await callApi.open(requestId)
      setSession(s)
      return s
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [requestId])

  useEffect(() => {
    let alive = true
    callApi
      .get(requestId)
      .then((s) => alive && s?.session_id && setSession(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [requestId])

  const startCall = async () => {
    setState(STATE.CONNECTING)
    badRun.current = 0
    const s = session?.session_id ? session : await openChannel()
    if (!s?.session_id) {
      setState(STATE.IDLE)
      return
    }
    setNotice(null)
    setTimeout(() => setState(STATE.IN_CALL), 700)
  }

  const endCall = async () => {
    setState(STATE.ENDED)
    setQuality(null)
    if (session?.session_id) {
      try {
        await callApi.end(session.session_id, 'COMPLETED')
      } catch {
        /* the channel expires on its own; a failed hang-up must not stick */
      }
    }
    setSession((s) => (s ? { ...s, status: 'ENDED', room: null } : s))
  }

  /* ── The corner case: watch our own leg, and act on it ─────────── */
  const escalateToGsm = useCallback(
    async (evidence, reason) => {
      if (!session?.session_id || switching) return
      setSwitching(true)
      try {
        const updated = await callApi.fallback(session.session_id, { reason, ...evidence })
        setSession(updated)
        setNotice(
          updated.reused
            ? 'Already on the backup phone line.'
            : 'Internet call quality was too poor — the call moved to a temporary phone line.',
        )
      } catch (err) {
        // Pool exhausted, or the server refused. Say so plainly: telling
        // someone to keep struggling with a leg that is already failing is
        // useless, but so is pretending a number was allocated.
        setError(err.message)
      } finally {
        setSwitching(false)
        badRun.current = 0
      }
    },
    [session, switching],
  )

  useEffect(() => {
    if (state !== STATE.IN_CALL || !floor) return undefined

    const timer = setInterval(() => {
      const q = sampleQuality(barsRef.current)
      setQuality(q)

      // Once we are on GSM the media leg no longer matters — the conversation
      // is riding the carrier's voice network, not this one.
      if (onGsm) return

      const bad = q.mos < floor.min_mos || q.packet_loss_pct > floor.max_packet_loss_pct
      badRun.current = bad ? badRun.current + 1 : 0

      if (badRun.current >= floor.degraded_seconds) {
        escalateToGsm(q, 'POOR_NETWORK')
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [state, floor, onGsm, escalateToGsm])

  /* ── Render ────────────────────────────────────────────────────── */
  const inCall = state === STATE.IN_CALL
  const label = peerName || session?.peer_label || (role === 'family' ? 'Donor' : 'Family')

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-faint">
            <ShieldCheck className="size-3.5 text-success" />
            Direct connect · numbers hidden
          </p>
          <h2 className="mt-2 text-base font-bold text-white">{label}</h2>
          <p className="mt-1 text-[11px] text-text-faint">
            {session?.peer_masked
              ? `Their line ends ${session.peer_masked.slice(-2)} — that is all either of you ever sees.`
              : 'Neither of you will see the other’s number.'}
          </p>
        </div>
        <Badge color={onGsm ? 'warning' : 'success'}>
          {onGsm ? 'Phone line' : 'Internet call'}
        </Badge>
      </div>

      {!session?.session_id && !error && (
        <p className="mt-4 text-[11px] text-text-faint">
          The call button unlocks as soon as a donor accepts this request.
        </p>
      )}

      {/* ── Call controls ── */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!inCall ? (
          <Button variant="success" onClick={startCall} disabled={state === STATE.CONNECTING}>
            <Phone className="size-4" />
            {state === STATE.CONNECTING ? 'Connecting…' : `Call ${role === 'family' ? 'donor' : 'family'}`}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={endCall}
            className="!bg-gradient-to-r !from-rose-600 !to-rose-700"
          >
            <PhoneOff className="size-4" />
            End call
          </Button>
        )}

        {inCall && !onGsm && (
          <Button
            variant="ghost"
            onClick={() => escalateToGsm(quality || {}, 'USER_REQUESTED')}
            disabled={switching}
          >
            {switching ? 'Switching…' : 'Switch to phone line'}
          </Button>
        )}
      </div>

      {/* ── The GSM fallback, once it has fired ── */}
      {onGsm && session?.dial_number && (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-4">
          <p className="flex items-center gap-2 text-[11px] font-semibold text-warning">
            <SignalLow className="size-4" />
            Backup phone line active
          </p>
          <p className="mt-2 text-lg font-bold tracking-wide text-white">
            {session.dial_number}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-text-faint">
            Both of you dial this number and you will reach each other. It belongs to Spondon,
            not to either of you, and it stops working the moment this request is closed.
            {session.fallback_reason === 'POOR_NETWORK' &&
              ' The switch happened automatically — the internet call was failing.'}
          </p>
          {session.bridge === 'simulated' && (
            <p className="mt-2 text-[10px] text-text-faint">
              No telephony provider is configured in this build, so the number is allocated and
              reserved but no call is placed.
            </p>
          )}
        </div>
      )}

      {notice && <p className="mt-3 text-[11px] text-success">{notice}</p>}
      {error && <p className="mt-3 text-[11px] text-primary">{error}</p>}

      {/* ── Live quality meter ── */}
      {inCall && quality && (
        <div className="mt-4 space-y-2 rounded-lg border border-line bg-ink/40 p-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-text-faint">
            <span className="flex items-center gap-1.5">
              {quality.mos >= (floor?.min_mos ?? 2.5) ? (
                <SignalHigh className="size-3.5 text-success" />
              ) : (
                <SignalLow className="size-3.5 text-warning" />
              )}
              Call quality
            </span>
            <span>{onGsm ? 'GSM leg — not measured' : `MOS ${quality.mos}`}</span>
          </div>
          {!onGsm && (
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <Meter label="Quality" value={quality.mos} suffix="/5"
                     bad={quality.mos < (floor?.min_mos ?? 2.5)} />
              <Meter label="Packet loss" value={quality.packet_loss_pct} suffix="%"
                     bad={quality.packet_loss_pct > (floor?.max_packet_loss_pct ?? 8)} />
              <Meter label="Latency" value={quality.rtt_ms} suffix="ms"
                     bad={quality.rtt_ms > 400} />
            </div>
          )}
          {!onGsm && badRun.current > 0 && (
            <p className="text-[10px] text-warning">
              Poor for {badRun.current}s — switching to a phone line at{' '}
              {floor?.degraded_seconds}s.
            </p>
          )}
        </div>
      )}

      {/* ── Demo control ── */}
      <div className="mt-4 rounded-lg border border-dashed border-line/70 bg-ink/30 p-3">
        <label className="flex items-center justify-between text-[10px] uppercase tracking-wide text-text-faint">
          <span className="flex items-center gap-1.5">
            {bars > 2 ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
            Simulated signal strength
          </span>
          <span>{bars}/5</span>
        </label>
        <input
          type="range"
          min={0}
          max={5}
          step={1}
          value={bars}
          onChange={(e) => setBars(Number(e.target.value))}
          className="mt-2 w-full accent-primary"
        />
        <p className="mt-1.5 text-[10px] leading-relaxed text-text-faint">
          Stands in for a real WebRTC stats feed. Drop it to 0–1 during a call to reproduce a
          hospital basement and watch the fallback fire on its own.
        </p>
      </div>
    </Card>
  )
}

function Meter({ label, value, suffix, bad }) {
  return (
    <div className="rounded-md border border-line bg-card/40 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-text-faint">{label}</p>
      <p className={`mt-0.5 font-semibold ${bad ? 'text-warning' : 'text-white'}`}>
        {value}
        <span className="ml-0.5 text-[9px] text-text-faint">{suffix}</span>
      </p>
    </div>
  )
}

/** MaskedCallPanel — the temporary call channel between a family and their donor.
 *
 *  The media leg is real now. One side rings, the other sees an incoming call
 *  and answers, and from that moment the two browsers carry live audio directly
 *  between them over WebRTC — see `lib/voice.js` for how, and for why that needs
 *  no telephony vendor and costs nothing per minute.
 *
 *  Everything that made the channel *safe* is unchanged: the server still
 *  decides who may open it, neither party ever sees the other's number, and the
 *  quality watcher still hands a failing call to a GSM proxy number. What
 *  changed is that the watcher reads `RTCPeerConnection.getStats()` instead of a
 *  simulated signal bar, so the fallback now fires on the network the user
 *  actually has.
 *
 *  The demo slider survives deliberately, as an *override*: a hospital basement
 *  is not reproducible from a desk, and the corner case still has to be
 *  demonstrable. It is labelled as a forced condition rather than presented as a
 *  measurement.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Mic, MicOff, Phone, PhoneIncoming, PhoneOff, ShieldCheck,
  SignalHigh, SignalLow, Wifi, WifiOff,
} from 'lucide-react'
import { callApi } from '../lib/api.js'
import { PHASE, useVoiceCall } from '../lib/voice.js'
import { Badge, Button, Card } from './ui.jsx'

/** Forced impairment for the demo override — same shape a real sample has. */
function forcedQuality(bars) {
  const jitter = () => (Math.random() - 0.5) * 0.6
  const mos = Math.max(1, Math.min(5, 1 + bars * 0.78 + jitter()))
  const packetLoss = Math.max(0, Math.min(100, (5 - bars) * 7 + Math.random() * 6))
  const rtt = 60 + (5 - bars) * 190 + Math.random() * 80
  return {
    mos: +mos.toFixed(2),
    packet_loss_pct: +packetLoss.toFixed(1),
    rtt_ms: Math.round(rtt),
    forced: true,
  }
}

export default function MaskedCallPanel({ requestId, role = 'family', peerName }) {
  const [session, setSession] = useState(null)
  const [quality, setQuality] = useState(null)
  const [bars, setBars] = useState(5)
  const [forceDemo, setForceDemo] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [switching, setSwitching] = useState(false)

  // Consecutive bad samples. The fallback waits for a run of them: one bad
  // second is a blip, and moving two people onto a different transport for it
  // is worse than the stutter they would have heard.
  const badRun = useRef(0)
  const forceRef = useRef({ on: false, bars: 5 })
  forceRef.current = { on: forceDemo, bars }

  const floor = session?.quality_floor
  const onGsm = session?.mode === 'GSM_FALLBACK'
  const sessionRef = useRef(session)
  sessionRef.current = session
  const switchingRef = useRef(switching)
  switchingRef.current = switching

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

  // Both sides open the channel on mount rather than on the call button. The
  // receiving side has to be listening on the signalling socket *before* the
  // other party rings — otherwise the ring lands nowhere and the patient never
  // sees an incoming call at all.
  useEffect(() => {
    let alive = true
    callApi
      .get(requestId)
      .then((s) => {
        if (!alive) return
        if (s?.session_id) setSession(s)
        else openChannel()
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [requestId, openChannel])

  /* ── The corner case: watch our own leg, and act on it ─────────── */
  const escalateToGsm = useCallback(async (evidence, reason) => {
    const live = sessionRef.current
    if (!live?.session_id || switchingRef.current) return
    setSwitching(true)
    try {
      const updated = await callApi.fallback(live.session_id, {
        reason,
        mos: evidence?.mos,
        packet_loss_pct: evidence?.packet_loss_pct,
        rtt_ms: evidence?.rtt_ms,
      })
      setSession(updated)
      setNotice(
        updated.reused
          ? 'Already on the backup phone line.'
          : 'Internet call quality was too poor — the call moved to a temporary phone line.',
      )
    } catch (err) {
      // Pool exhausted, or the server refused. Say so plainly: telling someone
      // to keep struggling with a leg that is already failing is useless, but
      // so is pretending a number was allocated.
      setError(err.message)
    } finally {
      setSwitching(false)
      badRun.current = 0
    }
  }, [])

  /** One sample from the live peer connection, once per second. */
  const handleQuality = useCallback(
    (sample) => {
      const q = forceRef.current.on ? forcedQuality(forceRef.current.bars) : sample
      setQuality(q)

      // Once we are on GSM the media leg no longer matters — the conversation
      // is riding the carrier's voice network, not this one.
      if (sessionRef.current?.mode === 'GSM_FALLBACK') return

      const limits = sessionRef.current?.quality_floor
      if (!limits) return

      if (q.failed) {
        escalateToGsm(q, 'NO_MEDIA')
        return
      }

      // Silence counts as failure. A stalled connection reports flawless
      // numbers precisely because nothing is arriving to be lost.
      const bad =
        q.silent || q.mos < limits.min_mos || q.packet_loss_pct > limits.max_packet_loss_pct
      badRun.current = bad ? badRun.current + 1 : 0
      if (badRun.current >= limits.degraded_seconds) {
        escalateToGsm(q, q.silent ? 'NO_MEDIA' : 'POOR_NETWORK')
      }
    },
    [escalateToGsm],
  )

  const voice = useVoiceCall({
    session,
    onQuality: handleQuality,
    onPeerHangup: () => {
      setNotice('The call ended.')
      setQuality(null)
      badRun.current = 0
    },
  })

  /* ── Render ────────────────────────────────────────────────────── */
  const { phase } = voice
  const inCall = phase === PHASE.IN_CALL
  const ringingIn = phase === PHASE.RINGING_IN
  const ringingOut = phase === PHASE.RINGING_OUT
  const connecting = phase === PHASE.CONNECTING
  const label = peerName || session?.peer_label || (role === 'family' ? 'Donor' : 'Family')
  const peerWord = role === 'family' ? 'donor' : 'family'

  const startCall = () => {
    setNotice(null)
    setError(null)
    voice.ring()
  }

  const endCall = async () => {
    voice.hangup()
    setQuality(null)
    badRun.current = 0
    // On a VOIP call the channel is deliberately left open: a dropped call is
    // very often re-dialled within seconds, and re-provisioning would make the
    // second attempt slower than the first for no gain. It closes on arrival,
    // or on its TTL.
    //
    // A GSM leg is the exception. It is holding a number from a small shared
    // pool, and a number nobody hands back is a line another family cannot get.
    if (!sessionRef.current?.session_id || sessionRef.current.mode !== 'GSM_FALLBACK') return
    try {
      await callApi.end(sessionRef.current.session_id, 'COMPLETED')
      setSession((s) => (s ? { ...s, status: 'ENDED', mode: 'VOIP', dial_number: null } : s))
    } catch {
      /* the channel expires on its own; a failed hang-up must not stick */
    }
  }

  return (
    <Card className="p-5">
      {/* Remote audio sink — hidden, but it is the element that actually makes
          the other person audible. */}
      <audio ref={voice.remoteAudioRef} autoPlay playsInline className="hidden" />

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
          {onGsm ? 'Phone line' : inCall ? 'Live · internet call' : 'Internet call'}
        </Badge>
      </div>

      {!session?.session_id && !error && (
        <p className="mt-4 text-[11px] text-text-faint">
          The call button unlocks as soon as a donor accepts this request.
        </p>
      )}

      {session?.session_id && !inCall && !ringingIn && !connecting && (
        <p className="mt-3 text-[11px] text-text-faint">
          {voice.peerPresent
            ? `${label} has this screen open — they will see it ring.`
            : `${label} is not on their tracker screen right now. Ring anyway, or switch to the phone line.`}
        </p>
      )}

      {/* ── Incoming call ── */}
      {ringingIn && (
        <div className="mt-4 animate-pulse rounded-lg border border-success/40 bg-success/10 p-4">
          <p className="flex items-center gap-2 text-[11px] font-semibold text-success">
            <PhoneIncoming className="size-4" />
            {label} is calling you
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="success" onClick={voice.accept}>
              <Phone className="size-4" />
              Answer
            </Button>
            <Button
              variant="primary"
              className="!bg-gradient-to-r !from-rose-600 !to-rose-700"
              onClick={voice.reject}
            >
              <PhoneOff className="size-4" />
              Decline
            </Button>
          </div>
        </div>
      )}

      {/* ── Call controls ── */}
      {!ringingIn && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!inCall && !ringingOut && !connecting ? (
            <Button variant="success" onClick={startCall} disabled={!session?.session_id}>
              <Phone className="size-4" />
              Call {peerWord}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={endCall}
              className="!bg-gradient-to-r !from-rose-600 !to-rose-700"
            >
              <PhoneOff className="size-4" />
              {inCall ? 'End call' : 'Cancel'}
            </Button>
          )}

          {inCall && (
            <Button variant="ghost" onClick={voice.toggleMute}>
              {voice.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              {voice.muted ? 'Unmute' : 'Mute'}
            </Button>
          )}

          {(inCall || ringingOut) && !onGsm && (
            <Button
              variant="ghost"
              onClick={() => escalateToGsm(quality || {}, 'USER_REQUESTED')}
              disabled={switching}
            >
              {switching ? 'Switching…' : 'Switch to phone line'}
            </Button>
          )}
        </div>
      )}

      {ringingOut && (
        <p className="mt-3 text-[11px] text-text-faint">
          Ringing {peerWord}… an incoming call is showing on their screen.
        </p>
      )}
      {connecting && <p className="mt-3 text-[11px] text-text-faint">Connecting audio…</p>}

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
            {session.fallback_reason === 'NO_MEDIA' &&
              ' The switch happened automatically — no audio path could be established.'}
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
      {(error || voice.error) && (
        <p className="mt-3 text-[11px] text-primary">{error || voice.error}</p>
      )}

      {/* ── Live quality meter — measured, not simulated ── */}
      {inCall && quality && (
        <div className="mt-4 space-y-2 rounded-lg border border-line bg-ink/40 p-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-text-faint">
            <span className="flex items-center gap-1.5">
              {quality.mos >= (floor?.min_mos ?? 2.5) ? (
                <SignalHigh className="size-3.5 text-success" />
              ) : (
                <SignalLow className="size-3.5 text-warning" />
              )}
              Call quality{quality.forced ? ' · forced' : ''}
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

      {/* ── Demo override ── */}
      <div className="mt-4 rounded-lg border border-dashed border-line/70 bg-ink/30 p-3">
        <label className="flex items-center justify-between text-[10px] uppercase tracking-wide text-text-faint">
          <span className="flex items-center gap-1.5">
            {forceDemo ? <WifiOff className="size-3.5" /> : <Wifi className="size-3.5" />}
            Force poor network (demo)
          </span>
          <input
            type="checkbox"
            checked={forceDemo}
            onChange={(e) => setForceDemo(e.target.checked)}
            className="accent-primary"
          />
        </label>
        {forceDemo && (
          <>
            <input
              type="range" min={0} max={5} step={1} value={bars}
              onChange={(e) => setBars(Number(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
            <p className="mt-1 text-[10px] text-text-faint">Forced signal {bars}/5</p>
          </>
        )}
        <p className="mt-1.5 text-[10px] leading-relaxed text-text-faint">
          Off, the meter reads the real peer connection. On, it overrides those readings so the
          hospital-basement fallback can be reproduced from a desk — drop it to 0–1 during a live
          call and watch the switch fire on its own.
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

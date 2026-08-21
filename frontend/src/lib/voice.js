/** The real voice leg behind Direct-Connect calling.
 *
 *  Until now the panel measured a simulated signal bar. This module replaces it
 *  with an actual `RTCPeerConnection`: the donor's microphone reaches the
 *  family's speaker and back, and the quality numbers that drive the GSM
 *  fallback are read from `getStats()` instead of invented.
 *
 *  **Why this costs nothing.** WebRTC audio is peer-to-peer. The only things a
 *  server has to provide are a way for the two browsers to exchange their
 *  session descriptions — which is Spondon's own `/ws/call` socket, already
 *  authenticated for exactly these two people — and STUN, which is free and
 *  public because all it does is tell a browser how its own address looks from
 *  the outside. No telephony vendor, no per-minute rate, no audio through
 *  Spondon.
 *
 *  **Where it still fails.** When both peers are behind symmetric NAT there is
 *  no direct path and the audio would need a TURN relay, which is the one piece
 *  nobody gives away at scale. The connection then fails outright rather than
 *  going quiet — and that is reported as `NO_MEDIA`, which is precisely the
 *  condition the GSM proxy fallback was built for. The corner case has a real
 *  trigger now instead of a slider.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getUserToken } from './api.js'

const HTTP_BASE = import.meta.env.VITE_API_URL || 'http://localhost:1184'
const WS_BASE = HTTP_BASE.replace(/^http/, 'ws')

export const PHASE = {
  IDLE: 'IDLE',
  RINGING_OUT: 'RINGING_OUT',
  RINGING_IN: 'RINGING_IN',
  CONNECTING: 'CONNECTING',
  IN_CALL: 'IN_CALL',
  ENDED: 'ENDED',
  FAILED: 'FAILED',
}

const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302'] }]

/* ── Quality ─────────────────────────────────────────────────────────
 * The ITU E-model, reduced to the two impairments a mobile network actually
 * inflicts on a voice call: delay and loss. Producing a MOS here rather than
 * exposing raw counters means the fallback threshold in `config.CALL_MIN_MOS`
 * keeps its meaning — it is the same 1–5 scale a telco would quote.
 */
function estimateMos({ rttMs, jitterMs, lossPct }) {
  const effectiveLatency = rttMs + jitterMs * 2 + 10
  let r =
    93.2 -
    (effectiveLatency < 160
      ? effectiveLatency / 40
      : (effectiveLatency - 120) / 10)
  // Loss hurts far more than latency on a voice codec: a call at 20% loss is
  // unusable long before its round trip is.
  r -= lossPct * 2.5
  r = Math.max(0, Math.min(100, r))
  const mos = 1 + 0.035 * r + (r * (r - 60) * (100 - r) * 7) / 1_000_000
  return Math.max(1, Math.min(5, mos))
}

/** Read one sample from the live peer connection. Null until audio flows. */
async function readStats(pc, previous) {
  if (!pc) return null
  let received = 0
  let lost = 0
  let jitterMs = 0
  let rttMs = 0
  let haveInbound = false

  const report = await pc.getStats()
  report.forEach((s) => {
    if (s.type === 'inbound-rtp' && s.kind === 'audio') {
      haveInbound = true
      received = s.packetsReceived ?? 0
      lost = s.packetsLost ?? 0
      jitterMs = (s.jitter ?? 0) * 1000
    }
    if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.currentRoundTripTime) {
      rttMs = s.currentRoundTripTime * 1000
    }
  })
  if (!haveInbound) return null

  // Deltas, not totals. Cumulative loss makes a call that recovered look
  // permanently broken, so the fallback would fire on history rather than on
  // what the person is hearing right now.
  const dReceived = Math.max(0, received - (previous?.received ?? 0))
  const dLost = Math.max(0, lost - (previous?.lost ?? 0))
  const denom = dReceived + dLost
  const lossPct = denom > 0 ? (dLost / denom) * 100 : 0

  return {
    raw: { received, lost },
    mos: +estimateMos({ rttMs, jitterMs, lossPct }).toFixed(2),
    packet_loss_pct: +lossPct.toFixed(1),
    rtt_ms: Math.round(rttMs),
    jitter_ms: +jitterMs.toFixed(1),
    // A stalled connection reports beautiful numbers because nothing is
    // arriving to be lost. Silence is a failure, not perfect quality.
    silent: dReceived === 0,
  }
}

/**
 * Drive one call session's media leg.
 *
 * `onQuality` receives a sample per second; the panel feeds it to the existing
 * degradation watcher, so the GSM fallback logic is untouched — it simply now
 * runs on measurements instead of a slider.
 */
export function useVoiceCall({ session, onQuality, onPeerHangup }) {
  const [phase, setPhase] = useState(PHASE.IDLE)
  const [peerPresent, setPeerPresent] = useState(false)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState(null)

  const socketRef = useRef(null)
  const pcRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const pendingIce = useRef([])
  const statsPrev = useRef(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const onQualityRef = useRef(onQuality)
  onQualityRef.current = onQuality
  const onPeerHangupRef = useRef(onPeerHangup)
  onPeerHangupRef.current = onPeerHangup

  const sessionId = session?.session_id || null
  const iceServers = session?.ice_servers?.length ? session.ice_servers : DEFAULT_ICE

  const send = useCallback((message) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }, [])

  /* ── Teardown ──────────────────────────────────────────────────── */
  const teardownMedia = useCallback(() => {
    pcRef.current?.close()
    pcRef.current = null
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    statsPrev.current = null
    pendingIce.current = []
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
  }, [])

  /* ── Peer connection ───────────────────────────────────────────── */
  const buildPeer = useCallback(async () => {
    let stream
    try {
      // Asked for at call time, not on page load: a family staring at a tracker
      // should not be prompted for their microphone until they actually ring.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
    } catch {
      setError(
        window.isSecureContext
          ? 'Microphone permission was denied — allow it in your browser to talk.'
          : 'Voice needs a secure context. Open the app on localhost or over HTTPS.',
      )
      setPhase(PHASE.FAILED)
      return null
    }
    localStreamRef.current = stream

    const pc = new RTCPeerConnection({ iceServers })
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))

    pc.ontrack = (e) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0]
        remoteAudioRef.current.play?.().catch(() => {})
      }
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'ice', candidate: e.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setPhase(PHASE.IN_CALL)
      if (pc.connectionState === 'failed') {
        // No path between the two networks. Honest failure — and the exact
        // signal the GSM fallback wants.
        setError('No direct audio path between your networks.')
        setPhase(PHASE.FAILED)
        onQualityRef.current?.({ mos: 1, packet_loss_pct: 100, rtt_ms: 0, failed: true })
      }
    }
    pcRef.current = pc
    return pc
  }, [iceServers, send])

  /* ── Signalling ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!sessionId) return undefined
    const token = getUserToken()
    if (!token) return undefined

    const socket = new WebSocket(
      `${WS_BASE}/ws/call?session_id=${sessionId}&token=${encodeURIComponent(token)}`,
    )
    socketRef.current = socket
    let closed = false

    socket.onmessage = async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.data)
      } catch {
        return
      }

      switch (msg.type) {
        case 'joined':
          setPeerPresent(Boolean(msg.peer_present))
          break
        case 'peer_joined':
          setPeerPresent(true)
          break
        case 'peer_left':
          setPeerPresent(false)
          if (phaseRef.current === PHASE.IN_CALL || phaseRef.current === PHASE.CONNECTING) {
            teardownMedia()
            setPhase(PHASE.ENDED)
            onPeerHangupRef.current?.('PEER_DISCONNECTED')
          }
          break

        case 'ring':
          // Someone is calling. Ignore a ring that arrives mid-call rather than
          // dropping the conversation already in progress.
          if (phaseRef.current === PHASE.IDLE || phaseRef.current === PHASE.ENDED) {
            setError(null)
            setPhase(PHASE.RINGING_IN)
          }
          break

        case 'reject':
          teardownMedia()
          setPhase(PHASE.ENDED)
          setError('The other side declined the call.')
          break

        case 'accept': {
          // We rang, they picked up: we are the offerer.
          if (phaseRef.current !== PHASE.RINGING_OUT) return
          setPhase(PHASE.CONNECTING)
          const pc = await buildPeer()
          if (!pc) return
          const offer = await pc.createOffer({ offerToReceiveAudio: true })
          await pc.setLocalDescription(offer)
          send({ type: 'offer', sdp: pc.localDescription.sdp })
          break
        }

        case 'offer': {
          const pc = pcRef.current || (await buildPeer())
          if (!pc) return
          await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp })
          // Candidates can outrun the description they belong to.
          for (const c of pendingIce.current) await pc.addIceCandidate(c).catch(() => {})
          pendingIce.current = []
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          send({ type: 'answer', sdp: pc.localDescription.sdp })
          break
        }

        case 'answer': {
          const pc = pcRef.current
          if (!pc) return
          await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp })
          for (const c of pendingIce.current) await pc.addIceCandidate(c).catch(() => {})
          pendingIce.current = []
          break
        }

        case 'ice': {
          const pc = pcRef.current
          if (!msg.candidate) return
          if (pc?.remoteDescription?.type) {
            await pc.addIceCandidate(msg.candidate).catch(() => {})
          } else {
            pendingIce.current.push(msg.candidate)
          }
          break
        }

        case 'hangup':
          teardownMedia()
          setPhase(PHASE.ENDED)
          onPeerHangupRef.current?.('PEER_HUNG_UP')
          break

        default:
          break
      }
    }

    socket.onclose = (e) => {
      if (closed) return
      setPeerPresent(false)
      if (e.code === 4401) setError('Sign in again to use the call channel.')
      if (e.code === 4403) setError('You are not a participant in this call.')
    }

    return () => {
      closed = true
      socket.close()
      socketRef.current = null
      teardownMedia()
    }
  }, [sessionId, buildPeer, send, teardownMedia])

  /* ── Quality sampling ──────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== PHASE.IN_CALL) return undefined
    const timer = setInterval(async () => {
      const sample = await readStats(pcRef.current, statsPrev.current)
      if (!sample) return
      statsPrev.current = sample.raw
      onQualityRef.current?.(sample)
    }, 1000)
    return () => clearInterval(timer)
  }, [phase])

  /* ── Controls ──────────────────────────────────────────────────── */
  const ring = useCallback(() => {
    if (!sessionId) return
    setError(null)
    setPhase(PHASE.RINGING_OUT)
    send({ type: 'ring' })
  }, [sessionId, send])

  const accept = useCallback(async () => {
    setPhase(PHASE.CONNECTING)
    // Build our side before answering so the offer that follows lands on a
    // peer connection that already has a microphone track attached.
    const pc = await buildPeer()
    if (!pc) return
    send({ type: 'accept' })
  }, [buildPeer, send])

  const reject = useCallback(() => {
    send({ type: 'reject' })
    teardownMedia()
    setPhase(PHASE.IDLE)
  }, [send, teardownMedia])

  const hangup = useCallback(() => {
    send({ type: 'hangup' })
    teardownMedia()
    setPhase(PHASE.ENDED)
  }, [send, teardownMedia])

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks?.()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMuted(!track.enabled)
  }, [])

  return {
    phase,
    peerPresent,
    muted,
    error,
    remoteAudioRef,
    ring,
    accept,
    reject,
    hangup,
    toggleMute,
    reset: () => setPhase(PHASE.IDLE),
  }
}

/** WebSocket client for the live dispatch feed (City-Wide Radar).
 *
 *  The rare-blood override reaches the whole city at once — a page that polls
 *  can only ever show the aftermath, so the radar is driven by a socket that
 *  pushes one event per donor reached.
 *
 *  The server sends zone names and counts, never identities or coordinates, so
 *  nothing sensitive is held in the browser to begin with.
 */
import { useEffect, useRef, useState } from 'react'

const HTTP_BASE = import.meta.env.VITE_API_URL || 'http://localhost:1184'
const WS_BASE = HTTP_BASE.replace(/^http/, 'ws')

/** Open the feed for one request, or the city-wide feed when `requestId` is null. */
export function openDispatchFeed(requestId, onEvent) {
  const url = `${WS_BASE}/ws/dispatch${requestId ? `?request_id=${requestId}` : ''}`
  let socket = null
  let retry = null
  let closed = false
  let attempt = 0

  const connect = () => {
    if (closed) return
    socket = new WebSocket(url)

    socket.onopen = () => {
      attempt = 0
      onEvent({ event: 'socket_open' })
    }
    socket.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data))
      } catch {
        /* a malformed frame must not tear the radar down */
      }
    }
    socket.onclose = () => {
      if (closed) return
      onEvent({ event: 'socket_closed' })
      // Back off, but stay responsive: an emergency is exactly when the tab
      // must not be left silently disconnected.
      const wait = Math.min(8000, 500 * 2 ** attempt++)
      retry = setTimeout(connect, wait)
    }
    socket.onerror = () => socket?.close()
  }

  connect()

  return () => {
    closed = true
    clearTimeout(retry)
    socket?.close()
  }
}

/**
 * React binding: live radar state assembled from the event stream.
 *
 * Returns `{ status, reached, zones, secured, escalated, log }` where `zones`
 * maps a zone name to how many donors there have been pinged this broadcast.
 */
export function useDispatchFeed(requestId) {
  const [state, setState] = useState(() => initial())
  // Kept in a ref so a burst of events in one tick cannot drop updates.
  const seq = useRef(0)

  useEffect(() => {
    if (!requestId) return undefined
    setState(initial())
    const close = openDispatchFeed(requestId, (e) => {
      seq.current += 1
      setState((s) => reduce(s, e, seq.current))
    })
    return close
  }, [requestId])

  return state
}

function initial() {
  return {
    status: 'connecting',
    reached: 0,
    zones: {},
    poolSize: null,
    secured: null,
    escalated: null,
    lastEventAt: null,
    log: [],
  }
}

function reduce(s, e, id) {
  const note = (text) => [{ id, text, at: Date.now() }, ...s.log].slice(0, 40)

  switch (e.event) {
    case 'socket_open':
      return { ...s, status: 'live' }
    case 'socket_closed':
      return { ...s, status: 'reconnecting' }
    case 'connected':
      return { ...s, status: 'live', log: note('Radar connected — watching for pings.') }
    case 'broadcast_started':
      return {
        ...s,
        status: 'broadcasting',
        reached: 0,
        zones: {},
        poolSize: e.pool_size ?? null,
        secured: null,
        lastEventAt: Date.now(),
        log: note(
          e.dispatch_mode === 'CITYWIDE_RARE'
            ? `City-wide override opened for ${e.blood_type} — no radius applied.`
            : `Ripple opened at ${e.radius_km} km.`,
        ),
      }
    case 'donor_pinged':
      return {
        ...s,
        reached: e.reached_so_far ?? s.reached + 1,
        zones: { ...s.zones, [e.zone]: e.zone_count ?? (s.zones[e.zone] ?? 0) + 1 },
        lastEventAt: Date.now(),
        log: note(
          `Donor reached in ${e.zone}${e.channels?.sms ? ' (push + SMS)' : ' (push)'}.`,
        ),
      }
    case 'broadcast_complete':
      return {
        ...s,
        status: 'complete',
        reached: e.reached ?? s.reached,
        lastEventAt: Date.now(),
        log: note(
          `Broadcast complete — ${e.reached} donor(s) across ${e.zones?.length ?? 0} zone(s).`,
        ),
      }
    case 'donor_secured':
      return {
        ...s,
        status: 'secured',
        secured: { zone: e.from_zone, hospitalZone: e.hospital_zone, at: e.secured_at },
        lastEventAt: Date.now(),
        log: note(`Donor secured — travelling from ${e.from_zone}.`),
      }
    case 'escalated':
      return {
        ...s,
        status: 'escalated',
        escalated: { reason: e.reason, channels: e.channels ?? [] },
        lastEventAt: Date.now(),
        log: note('Nobody answered in time — escalated to blood banks and NGO hotlines.'),
      }
    default:
      return s
  }
}

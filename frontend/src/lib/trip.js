/** Client for the private en-route tracker feed (`/ws/trip`).
 *
 *  Separate from `realtime.js` on purpose. That socket drives the public
 *  City-Wide Radar and is fed zone names and counts; this one carries a donor's
 *  street position to the one family entitled to see it, so it authenticates
 *  and the server refuses anyone who is not a participant.
 *
 *  The hard part here is not the transport, it is refusing to lie. Two
 *  independent things can go wrong and they must not be conflated:
 *
 *    • **The donor's phone lost signal.** The server says so (`trip_signal_lost`)
 *      and the tracker freezes the icon, flags the ETA and shows the message.
 *    • **This browser lost the socket.** Nobody can tell us anything at all.
 *      Falling back to polling covers a flaky socket, but if even that fails we
 *      have to say the tracking itself is offline rather than leave a stale ETA
 *      on screen looking authoritative.
 *
 *  Both end in a screen that admits what it doesn't know. What must never
 *  happen is a confidently-ticking countdown built on a position nobody has
 *  confirmed in minutes.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getUserToken, tripApi } from './api.js'

const HTTP_BASE = import.meta.env.VITE_API_URL || 'http://localhost:1184'
const WS_BASE = HTTP_BASE.replace(/^http/, 'ws')

/** Poll interval used when the socket is unavailable. */
const POLL_MS = 5000

/** Open the private feed for one request. Returns a close function. */
export function openTripFeed(requestId, onEvent) {
  const token = getUserToken()
  if (!requestId || !token) return () => {}

  const url = `${WS_BASE}/ws/trip?request_id=${encodeURIComponent(
    requestId,
  )}&token=${encodeURIComponent(token)}`

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
        /* one malformed frame must not tear the tracker down */
      }
    }
    socket.onclose = (e) => {
      if (closed) return
      // 4401/4403 are the server refusing this viewer. Retrying cannot fix
      // that, and a reconnect loop against a permission error just burns
      // battery on a phone during an emergency.
      if (e.code === 4401 || e.code === 4403 || e.code === 4404) {
        onEvent({ event: 'socket_denied', reason: e.reason, code: e.code })
        return
      }
      onEvent({ event: 'socket_closed' })
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
 * Live tracker state for one request.
 *
 * Returns `{ trip, context, connection, denied, log, refresh }`:
 *   • `trip`       — the server's view: position, ETA, and whether it is stale
 *   • `connection` — this browser's link: 'live' | 'reconnecting' | 'denied'
 *   • `log`        — a short human-readable history for the activity panel
 */
export function useTripFeed(requestId) {
  const [trip, setTrip] = useState(null)
  const [context, setContext] = useState(null)
  const [connection, setConnection] = useState('connecting')
  const [denied, setDenied] = useState(null)
  // A missing request and a forbidden one are different problems with different
  // fixes — "you picked the wrong id" vs "this isn't yours" — so they are kept
  // apart rather than collapsed into one unhelpful error string.
  const [notFound, setNotFound] = useState(false)
  const [log, setLog] = useState([])
  const seq = useRef(0)

  const note = useCallback((text) => {
    seq.current += 1
    const id = seq.current
    setLog((l) => [{ id, text, at: Date.now() }, ...l].slice(0, 30))
  }, [])

  const refresh = useCallback(async () => {
    if (!requestId) return null
    try {
      const res = await tripApi.get(requestId)
      setContext(res)
      setTrip(res.trip)
      setNotFound(false)
      return res
    } catch (err) {
      if (err.status === 403) setDenied(err.message)
      if (err.status === 404) setNotFound(true)
      return null
    }
  }, [requestId])

  // Load once up front. Staleness is evaluated server-side at read time, so a
  // family opening the page after their donor already went quiet sees the
  // frozen state immediately rather than a confident ETA that corrects itself
  // a few seconds later.
  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!requestId) return undefined

    const close = openTripFeed(requestId, (e) => {
      switch (e.event) {
        case 'socket_open':
          setConnection('live')
          break
        case 'socket_closed':
          setConnection('reconnecting')
          break
        case 'socket_denied':
          setConnection('denied')
          if (e.code === 4404) setNotFound(true)
          else setDenied(e.reason || 'You are not a participant in this request.')
          break
        case 'connected':
          setConnection('live')
          if (e.trip) setTrip(e.trip)
          note('Tracker connected.')
          break
        case 'trip_started':
          setTrip(e.trip)
          note('Donor started travelling.')
          break
        case 'trip_update':
          setTrip(e.trip)
          break
        case 'trip_signal_lost':
          setTrip(e.trip)
          note(e.message || 'Donor signal lost.')
          break
        case 'trip_signal_restored':
          setTrip(e.trip)
          note('Donor signal restored — tracking is live again.')
          break
        case 'trip_arrived':
          setTrip(e.trip)
          note('Donor has arrived at the hospital.')
          break
        case 'call_mode_changed':
          note('Call switched to a backup phone line.')
          break
        case 'call_ended':
          note('Call channel closed.')
          break
        default:
          break
      }
    })
    return close
  }, [requestId, note])

  // A request that does not exist will never start existing, so polling for it
  // is just noise on someone's battery.
  useEffect(() => {
    if (notFound) setConnection('denied')
  }, [notFound])

  // Polling backstop. A socket that has dropped tells us nothing at all, and a
  // family staring at an unchanging screen deserves better than waiting for it
  // to come back on its own.
  useEffect(() => {
    if (connection === 'live' || connection === 'denied') return undefined
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [connection, refresh])

  return { trip, context, connection, denied, notFound, log, refresh }
}

/** "4 min" / "just now" — how old the last fix is, in words. */
export function ageLabel(seconds) {
  if (seconds == null) return 'never'
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  const mins = Math.floor(seconds / 60)
  return `${mins} min ${Math.round(seconds % 60)}s ago`
}

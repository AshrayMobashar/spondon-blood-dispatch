/** Fetch client for the Spondon API (FastAPI on :1184).
 *
 *  Two independent sessions live here, in separate storage keys:
 *    • the admin console's JWT   (adminApi)
 *    • an end user's JWT         (authApi / donorApi / patientApi)
 *  Keeping them apart means signing out of one never disturbs the other, and a
 *  user token is never accidentally sent to an admin endpoint.
 */

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:1184'

const TOKEN_KEY = 'spondon_admin_token'
const ADMIN_KEY = 'spondon_admin'
const USER_TOKEN_KEY = 'spondon_user_token'
const USER_KEY = 'spondon_user'

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

/* ── Sessions ────────────────────────────────────────────────────── */
const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key))
  } catch {
    return null
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const getAdmin = () => readJson(ADMIN_KEY)
export const setSession = (token, admin) => {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(ADMIN_KEY, JSON.stringify(admin))
}
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(ADMIN_KEY)
}

export const getUserToken = () => localStorage.getItem(USER_TOKEN_KEY)
export const getUser = () => readJson(USER_KEY)
export const setUserSession = (token, account) => {
  localStorage.setItem(USER_TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(account))
}
export const clearUserSession = () => {
  localStorage.removeItem(USER_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

/* ── Transport ───────────────────────────────────────────────────── */
function messageFrom(data, fallback) {
  const d = data?.detail ?? data?.message
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((e) => e.msg || JSON.stringify(e)).join('; ')
  if (d && typeof d === 'object') return d.message || JSON.stringify(d)
  return fallback
}

/** `auth` picks which session signs the request: 'admin', 'user', or false. */
async function request(path, { method = 'GET', body, auth = 'admin' } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth === 'admin') {
    const t = getToken()
    if (t) headers.Authorization = `Bearer ${t}`
  } else if (auth === 'user') {
    const t = getUserToken()
    if (t) headers.Authorization = `Bearer ${t}`
  }

  let res
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(
      `Cannot reach the backend at ${BASE} — start it with "python -m app.main" in backend/.`,
      0,
    )
  }

  if (res.status === 401 && auth) {
    // Only clear the session that was actually used, so an expired admin token
    // does not sign a donor out of their own dashboard.
    if (auth === 'admin') clearSession()
    else clearUserSession()
    throw new ApiError('Session expired — please sign in again.', 401)
  }

  const data = await res.json().catch(() => null)
  if (res.status === 503) {
    // The API answered — it is the database behind it that is down. Saying
    // "backend unreachable" here would send someone to restart a server that
    // is already running.
    throw new ApiError(
      messageFrom(data, 'The database is unavailable. Is MongoDB running?'),
      503,
      data,
    )
  }
  if (!res.ok) throw new ApiError(messageFrom(data, res.statusText), res.status, data)
  return data
}

/* ── Platform config ─────────────────────────────────────────────── */
/** The rule constants the engine enforces (cooldown lengths, ripple radii,
 *  escalation window). Pages render these instead of hard-coding their own, so
 *  a screen can never advertise a threshold the backend does not use. */
export const configApi = {
  get: () => request('/config', { auth: false }),
  /** The published city zones the radar draws. Donor positions are generalised
   *  to these server-side — the browser never receives a donor's coordinates. */
  zones: () => request('/zones', { auth: false }),
}

/* ── Registration & authentication ───────────────────────────────── */
export const authApi = {
  /** `pendingRequest` carries emergency details typed before sign-in, so they
   *  survive verification and fire automatically. */
  requestOtp: (phone, purpose = 'LOGIN', pendingRequest = null) =>
    request('/auth/otp/request', {
      method: 'POST',
      auth: false,
      body: { phone, purpose, pending_request: pendingRequest },
    }),
  verifyOtp: (phone, code) =>
    request('/auth/otp/verify', { method: 'POST', auth: false, body: { phone, code } }),
  register: (payload) =>
    request('/auth/register', { method: 'POST', auth: false, body: payload }),
  me: () => request('/auth/me', { auth: 'user' }),
}

/* ── Donor ───────────────────────────────────────────────────────── */
export const donorApi = {
  eligibility: (id) => request(`/donors/${id}/eligibility`, { auth: 'user' }),
  myEligibility: () => request('/me/eligibility', { auth: 'user' }),
  health: (id) => request(`/donors/${id}/health`, { auth: 'user' }),
  updateWeight: (id, weightKg) =>
    request(`/donors/${id}/weight`, {
      method: 'PUT', auth: 'user', body: { weight_kg: weightKg },
    }),
  updateHealth: (id, body) =>
    request(`/donors/${id}/health`, { method: 'PATCH', auth: 'user', body }),
  recordDonation: (id, donationType, donatedAt) =>
    request(`/donors/${id}/donations`, {
      method: 'POST', auth: 'user',
      body: { donation_type: donationType, donated_at: donatedAt },
    }),
  certificates: (id) => request(`/donors/${id}/certificates`, { auth: 'user' }),
  uploadCertificate: (id, body) =>
    request(`/donors/${id}/certificates`, { method: 'POST', auth: 'user', body }),

  sleepMode: (id) => request(`/donors/${id}/sleep-mode`, { auth: 'user' }),
  saveSleepMode: (id, body) =>
    request(`/donors/${id}/sleep-mode`, { method: 'PUT', auth: 'user', body }),
  /** `points` are optional map coordinates for the segments; when a donor draws
   *  their route on the Leaflet map we save both so it can be redrawn, while the
   *  named `segments` stay the thing the engine matches on. */
  saveRoute: (id, segments, label, points = null) =>
    request(`/donors/${id}/commute-route`, {
      method: 'PUT', auth: 'user', body: { segments, label, points },
    }),
  /** The donor's route + live fix + active pings around it — the one call the
   *  commute map renders from. */
  nearbyPings: (id) => request(`/donors/${id}/nearby-pings`, { auth: 'user' }),
  /** Pause/resume route matching. Unlike clearRoute this keeps the segments,
   *  so switching it back on needs no re-entry. */
  toggleRoute: (id, enabled) =>
    request(`/donors/${id}/commute-route/toggle?enabled=${enabled}`, {
      method: 'POST', auth: 'user',
    }),
  clearRoute: (id) =>
    request(`/donors/${id}/commute-route`, { method: 'DELETE', auth: 'user' }),
  updateLocation: (id, lat, lng, roadSegment) =>
    request(`/donors/${id}/location`, {
      method: 'PUT', auth: 'user', body: { lat, lng, road_segment: roadSegment },
    }),
  reliability: (id) => request(`/donors/${id}/reliability`, { auth: 'user' }),
  get: (id) => request(`/donors/${id}`, { auth: 'user' }),
  list: () => request('/donors', { auth: false }),
}

/* ── Patient / requests ──────────────────────────────────────────── */
export const requestApi = {
  create: (body) => request('/requests', { method: 'POST', auth: 'user', body }),
  list: () => request('/requests', { auth: false }),
  get: (id) => request(`/requests/${id}`, { auth: false }),
  uploadSlip: (id, image, mime) =>
    request(`/requests/${id}/slip`, { method: 'POST', auth: 'user', body: { image, mime } }),
  dispatch: (id) => request(`/requests/${id}/dispatch`, { method: 'POST', auth: 'user' }),
  evaluate: (id, now) =>
    request('/dispatch/evaluate', {
      method: 'POST', auth: false, body: { request_id: id, now: now || null },
    }),
  /** Zone-level summary for the City-Wide Radar — aggregates only. */
  radar: (id) => request(`/requests/${id}/radar`, { auth: false }),
  escalate: (id) => request(`/requests/${id}/escalate`, { method: 'POST', auth: 'user' }),
  accept: (id, donorId) =>
    request(`/requests/${id}/accept`, {
      method: 'POST', auth: 'user', body: { donor_id: donorId },
    }),
  arrival: (id, donorId, showedUp) =>
    request(`/requests/${id}/arrival`, {
      method: 'POST', auth: 'user', body: { donor_id: donorId, showed_up: showedUp },
    }),
  appeal: (donorId, requestId, reason) =>
    request('/appeals', {
      method: 'POST', auth: 'user', body: { donor_id: donorId, request_id: requestId, reason },
    }),
  pingLogs: (requestId) =>
    request(`/ping-logs${requestId ? `?request_id=${requestId}` : ''}`, { auth: false }),
}

/* ── Live En-Route Tracker ───────────────────────────────────────── */
/** Only the family who opened a request and the donor who accepted it can
 *  reach any of these — the server enforces it, so a 403 here is the feature
 *  working, not a bug. */
export const tripApi = {
  start: (requestId) =>
    request(`/requests/${requestId}/trip/start`, { method: 'POST', auth: 'user' }),
  /** One fix. Answers 200 with `accepted: false` for a rejected sample (GPS
   *  drift, out-of-order replay) — the phone can't act on a rejection, so it
   *  isn't an error, it just sends the next good fix. */
  report: (requestId, point) =>
    request(`/requests/${requestId}/trip/location`, {
      method: 'POST', auth: 'user', body: point,
    }),
  /** Flush fixes buffered while the phone had no connection, oldest first. */
  flush: (requestId, points) =>
    request(`/requests/${requestId}/trip/batch`, {
      method: 'POST', auth: 'user', body: { points },
    }),
  get: (requestId) => request(`/requests/${requestId}/trip`, { auth: 'user' }),
  arrived: (requestId) =>
    request(`/requests/${requestId}/trip/arrived`, { method: 'POST', auth: 'user' }),
}

/* ── Direct-Connect Masked Calling ───────────────────────────────── */
export const callApi = {
  /** Idempotent: both parties call this on load, and a refresh mid-call must
   *  rejoin the existing channel rather than open a second one. */
  open: (requestId) =>
    request(`/requests/${requestId}/call`, { method: 'POST', auth: 'user' }),
  get: (requestId) => request(`/requests/${requestId}/call`, { auth: 'user' }),
  /** Hand the failing VOIP leg over to a temporary GSM number. Same session,
   *  same participants — only the transport moves. */
  fallback: (sessionId, evidence) =>
    request(`/calls/${sessionId}/fallback`, {
      method: 'POST', auth: 'user', body: evidence,
    }),
  end: (sessionId, reason = 'COMPLETED') =>
    request(`/calls/${sessionId}/end`, { method: 'POST', auth: 'user', body: { reason } }),
  pool: () => request('/calls/pool', { auth: false }),
}

/* ── Admin console ───────────────────────────────────────────────── */
export const adminApi = {
  login: (email, password) =>
    request('/admin/login', { method: 'POST', body: { email, password }, auth: false }),
  me: () => request('/admin/me'),
  overview: () => request('/admin/overview'),
  requests: () => request('/admin/requests'),
  patchRequest: (id, body) => request(`/admin/requests/${id}`, { method: 'PATCH', body }),
  deleteRequest: (id) => request(`/admin/requests/${id}`, { method: 'DELETE' }),
  reviewSlip: (id, action, note) =>
    request(`/admin/requests/${id}/slip`, { method: 'POST', body: { action, note } }),
  donors: () => request('/admin/donors'),
  patchDonor: (id, body) => request(`/admin/donors/${id}`, { method: 'PATCH', body }),
  moderate: (id, action, reason) =>
    request(`/admin/donors/${id}/moderate`, { method: 'POST', body: { action, reason } }),
  certificates: (status) =>
    request(`/admin/certificates${status ? `?status=${status}` : ''}`),
  reviewCertificate: (id, action, note) =>
    request(`/admin/certificates/${id}/review`, { method: 'POST', body: { action, note } }),
  escalations: () => request('/admin/escalations'),
  resolveEscalation: (id, action, note) =>
    request(`/admin/escalations/${id}/resolve`, { method: 'POST', body: { action, note } }),
  appeals: (status) =>
    request(`/admin/appeals${status ? `?status=${status}` : ''}`),
  resolveAppeal: (id, action, adminName) =>
    request(`/appeals/${id}/resolve`, { method: 'POST', body: { action, admin: adminName || 'admin' } }),
}

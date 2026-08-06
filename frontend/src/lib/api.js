/** Thin fetch client for the Spondon admin API (FastAPI on :1184).
 *  Holds the JWT in localStorage and attaches it as a Bearer token. */

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:1184'
const TOKEN_KEY = 'spondon_admin_token'
const ADMIN_KEY = 'spondon_admin'

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const getAdmin = () => {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_KEY))
  } catch {
    return null
  }
}
export const setSession = (token, admin) => {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(ADMIN_KEY, JSON.stringify(admin))
}
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(ADMIN_KEY)
}

function messageFrom(data, fallback) {
  const d = data?.detail ?? data?.message
  if (typeof d === 'string') return d
  if (d && typeof d === 'object') return d.message || JSON.stringify(d)
  return fallback
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth) {
    const t = getToken()
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
    throw new ApiError('Cannot reach the backend — is it running on :1184?', 0)
  }

  if (res.status === 401 && auth) {
    clearSession()
    throw new ApiError('Session expired — please sign in again.', 401)
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(messageFrom(data, res.statusText), res.status, data)
  return data
}

// Feature 3 — Eligibility Cooldown & Auto-Pause Engine.
// Donor methods are public (auth: false); admin methods reuse the JWT.
export const eligibilityApi = {
  // Recalculate the flag (call on login / when the dashboard opens).
  loginRecalc: (donorId) =>
    request(`/donors/${donorId}/eligibility/login-recalc`, { method: 'POST', auth: false }),
  // Read current status + live countdown.
  get: (donorId) =>
    request(`/donors/${donorId}/eligibility`, { auth: false }),
  // Save a new weight — returns { accepted:false, reason } on a rejected typo.
  updateWeight: (donorId, weightKg) =>
    request(`/donors/${donorId}/eligibility/weight`, {
      method: 'PUT', body: { weight_kg: weightKg }, auth: false,
    }),
  // Record a donation to start the cooldown (WHOLE_BLOOD or PLATELET).
  recordDonation: (donorId, donationType, donationDate) =>
    request(`/donors/${donorId}/eligibility/donation`, {
      method: 'POST', body: { donation_type: donationType, donation_date: donationDate }, auth: false,
    }),
  // Upload a medical certificate for admin review (early-unlock request).
  uploadCertificate: (donorId, fileUrl, note, claimedDonationDate) =>
    request(`/donors/${donorId}/eligibility/certificate`, {
      method: 'POST',
      body: { file_url: fileUrl, note, claimed_donation_date: claimedDonationDate },
      auth: false,
    }),
  // Admin: the review queue and the approve/reject decision (JWT required).
  listCertificates: (status) =>
    request(`/admin/eligibility/certificates${status ? `?status=${status}` : ''}`),
  reviewCertificate: (certId, action, correctedDonationDate, note) =>
    request(`/admin/eligibility/certificates/${certId}/review`, {
      method: 'POST',
      body: { action, corrected_donation_date: correctedDonationDate, note },
    }),
}

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
  moderate: (id, action, reason) =>
    request(`/admin/donors/${id}/moderate`, { method: 'POST', body: { action, reason } }),
}

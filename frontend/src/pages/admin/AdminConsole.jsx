import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, LogOut, RefreshCw, TriangleAlert,
  CheckCircle2, XCircle, Ban, EyeOff, RotateCcw, Trash2, Loader2, WifiOff,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, StatCard, Tabs, Button, Badge } from '../../components/ui.jsx'
import { Chip } from '../../components/TopBar.jsx'
import { adminApi, getAdmin, getToken, clearSession } from '../../lib/api.js'

/* ── status → colour maps ─────────────────────────────────────────── */
const slipColor = {
  VERIFIED: 'success', OCR_CONFIRMED: 'success',
  NEEDS_REVIEW: 'warning', PENDING: 'warning', REJECTED: 'primary',
}
const acctColor = { ACTIVE: 'success', BANNED: 'primary', SHADOW_BANNED: 'donor' }
const acctLabel = { ACTIVE: 'Active', BANNED: 'Banned', SHADOW_BANNED: 'Shadow-banned' }
const certColor = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'primary' }
const escColor = { OPEN: 'warning', SOURCED: 'success', CLOSED: 'admin' }

const TABS = [
  'Emergency Ripples', 'Slip Verification', 'Accounts',
  'Medical Certificates', 'Escalations',
]

export default function AdminConsole() {
  const navigate = useNavigate()
  const admin = getAdmin()

  const [tab, setTab] = useState(0)
  const [overview, setOverview] = useState(null)
  const [requests, setRequests] = useState([])
  const [donors, setDonors] = useState([])
  const [certificates, setCertificates] = useState([])
  const [escalations, setEscalations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null) // { kind: 'ok'|'err', text }
  const [busyId, setBusyId] = useState('')

  const flash = (kind, text) => {
    setNotice({ kind, text })
    setTimeout(() => setNotice(null), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [o, r, d, c, e] = await Promise.all([
        adminApi.overview(),
        adminApi.requests(),
        adminApi.donors(),
        adminApi.certificates(),
        adminApi.escalations(),
      ])
      setOverview(o)
      setRequests(r)
      setDonors(d)
      setCertificates(c)
      setEscalations(e)
    } catch (err) {
      if (err.status === 401) {
        clearSession()
        navigate('/admin/login')
        return
      }
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    if (!getToken()) {
      navigate('/admin/login')
      return
    }
    load()
  }, [load, navigate])

  const signOut = () => {
    clearSession()
    navigate('/admin/login')
  }

  /* ── mutations ── */
  const act = async (id, fn, okMsg) => {
    setBusyId(id)
    try {
      const res = await fn()
      flash('ok', okMsg(res))
      await load()
    } catch (err) {
      if (err.status === 401) return signOut()
      flash('err', err.message)
    } finally {
      setBusyId('')
    }
  }

  const reviewSlip = (r, action) =>
    act(r.id, () => adminApi.reviewSlip(r.id, action), (res) => res.message)
  const setReqStatus = (r, status) =>
    act(r.id, () => adminApi.patchRequest(r.id, { status }), () => `Request set to ${status}.`)
  const toggleBroadcast = (r) =>
    act(r.id, () => adminApi.patchRequest(r.id, { broadcast: !r.broadcast }),
      () => (r.broadcast ? 'Broadcast muted.' : 'Broadcast restored.'))
  const deleteReq = (r) =>
    act(r.id, () => adminApi.deleteRequest(r.id), () => 'Request deleted.')
  const moderate = (d, action, reason) =>
    act(d.id, () => adminApi.moderate(d.id, action, reason), (res) => res.message)
  const reviewCert = (c, action) =>
    act(c.id, () => adminApi.reviewCertificate(c.id, action), (res) => res.message)
  const resolveEsc = (e, action) =>
    act(e.id, () => adminApi.resolveEscalation(e.id, action),
      () => `Escalation marked ${action === 'SOURCED' ? 'sourced' : 'closed'}.`)

  if (loading && !overview) {
    return (
      <ConsoleShell admin={admin} onReload={load} onSignOut={signOut}>
        <div className="flex items-center justify-center gap-3 py-24 text-text-faint">
          <Loader2 className="size-5 animate-spin" /> Loading console…
        </div>
      </ConsoleShell>
    )
  }

  if (error && !overview) {
    return (
      <ConsoleShell admin={admin} onReload={load} onSignOut={signOut}>
        <Card className="mx-auto mt-10 max-w-lg p-8 text-center" accent="primary">
          <WifiOff className="mx-auto size-8 text-primary" />
          <h2 className="mt-3 text-lg font-bold">Backend unreachable</h2>
          <p className="mt-1 text-sm text-text-faint">{error}</p>
          <p className="mt-3 text-[11px] text-text-faint">
            Start it with{' '}
            <code className="rounded bg-[#0d111a] px-1.5 py-0.5 text-admin">python -m app.main</code>{' '}
            in <code className="rounded bg-[#0d111a] px-1.5 py-0.5">backend/</code> (port 1184).
          </p>
          <Button className="mt-5" variant="primary" onClick={load}>
            <RefreshCw className="size-4" /> Retry
          </Button>
        </Card>
      </ConsoleShell>
    )
  }

  return (
    <ConsoleShell admin={admin} onReload={load} onSignOut={signOut}>
      {/* notice */}
      {notice && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs ${
            notice.kind === 'ok'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-primary/30 bg-primary/10 text-primary'
          }`}
        >
          {notice.kind === 'ok' ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
          {notice.text}
        </div>
      )}

      {/* stat row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Active Ripples" value={overview.active_ripples} sub={`${overview.requests_total} total requests`} color="admin" subColor="text-text-faint" />
        <StatCard label="Shadow-muted" value={overview.muted_ripples} sub="look active, not broadcast" color="donor" subColor="text-text-faint" />
        <StatCard label="Slips to Review" value={overview.slips_needs_review} sub="OCR could not confirm" color="warning" subColor="text-text-faint" />
        <StatCard label="Banned / Shadow" value={`${overview.banned} / ${overview.shadow_banned}`} sub={`${overview.donors_total} accounts`} color="primary" subColor="text-text-faint" />
        <StatCard label="Certificates" value={overview.certificates_pending} sub="awaiting cooldown review" color="warning" subColor="text-text-faint" />
        <StatCard label="Escalations" value={overview.escalations_open} sub={`${overview.ineligible_donors} donors locked`} color="primary" subColor="text-text-faint" />
      </div>

      {overview.integrations && <IntegrationBar integrations={overview.integrations} />}

      <div className="mt-6">
        <Tabs tabs={TABS} active={tab} color="admin" onChange={setTab} />
      </div>

      <div className="pt-6">
        {tab === 0 && <RipplesTab requests={requests} busyId={busyId} onStatus={setReqStatus} onToggle={toggleBroadcast} onDelete={deleteReq} />}
        {tab === 1 && <SlipsTab requests={requests} busyId={busyId} onReview={reviewSlip} />}
        {tab === 2 && <AccountsTab donors={donors} busyId={busyId} onModerate={moderate} />}
        {tab === 3 && <CertificatesTab certificates={certificates} busyId={busyId} onReview={reviewCert} />}
        {tab === 4 && <EscalationsTab escalations={escalations} busyId={busyId} onResolve={resolveEsc} />}
      </div>
    </ConsoleShell>
  )
}

/* ── which external integrations are actually live ───────────────── */
const INTEGRATION_LABEL = {
  sms: 'SMS OTP', fcm: 'FCM push', ocr: 'Slip OCR',
  maps: 'Maps routing', blood_bank: 'Blood banks', ngo_hotline: 'NGO hotlines',
}

function IntegrationBar({ integrations }) {
  // A key that is present but rejected is the dangerous state: it looks
  // configured while every call silently falls back. Call it out separately
  // from "not configured".
  const failing = integrations.maps_key_present && !integrations.maps

  return (
    <div className="mt-4 rounded-lg border border-line bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-text-faint">Integrations</span>
        {Object.entries(INTEGRATION_LABEL).map(([key, label]) => {
          const broken = key === 'maps' && failing
          return (
            <span
              key={key}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                integrations[key]
                  ? 'border-success/30 bg-success/10 text-success'
                  : broken
                    ? 'border-warning/30 bg-warning/10 text-warning'
                    : 'border-line bg-[#0d111a] text-text-faint'
              }`}
              title={
                integrations[key]
                  ? 'Live'
                  : broken
                    ? integrations.maps_error
                    : 'Not configured — results are simulated'
              }
            >
              <span
                className={`size-1.5 rounded-full ${
                  integrations[key] ? 'bg-success' : broken ? 'bg-warning' : 'bg-[#374151]'
                }`}
              />
              {label}
              {broken && ' — key rejected'}
            </span>
          )
        })}
      </div>
      {failing && (
        <p className="mt-2 text-[10px] text-warning">
          A Maps key is configured but Google refused it, so the ripple is measuring
          straight-line distance. {integrations.maps_error}
        </p>
      )}
    </div>
  )
}

/* ── page shell with admin top-bar ───────────────────────────────── */
function ConsoleShell({ admin, onReload, onSignOut, children }) {
  return (
    <Shell
      panel="ADMINISTRATION"
      panelColor="admin"
      right={
        <>
          <Chip className="hidden sm:inline-flex">
            <ShieldCheck className="size-3.5 text-admin" />
            <span className="font-semibold text-white">{admin?.name || 'Admin'}</span>
          </Chip>
          <button
            type="button"
            onClick={onReload}
            className="grid size-9 place-items-center rounded-lg border border-line text-text-muted transition-colors hover:text-white"
            aria-label="Reload"
          >
            <RefreshCw className="size-4" />
          </button>
          <Button variant="ghost" onClick={onSignOut} className="px-3 py-2 text-xs">
            <LogOut className="size-3.5" /> Sign out
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-admin/10">
          <ShieldCheck className="size-5 text-admin" />
        </span>
        <div>
          <h1 className="text-lg font-bold">Admin Console</h1>
          <p className="text-xs text-text-faint">
            Role &amp; access management — review ripples, override slips, moderate accounts
          </p>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </Shell>
  )
}

/* ── reusable table wrapper ──────────────────────────────────────── */
function TableCard({ title, subtitle, head, children }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <p className="text-sm font-semibold">{title}</p>
        {subtitle && <p className="mt-0.5 text-[11px] text-text-faint">{subtitle}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-text-faint">
              {head.map((h) => (
                <th key={h} className="px-5 py-3 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Card>
  )
}

const spin = (id, busyId) => busyId === id

/* ── Tab 1: emergency ripples ────────────────────────────────────── */
function RipplesTab({ requests, busyId, onStatus, onToggle, onDelete }) {
  const [confirmId, setConfirmId] = useState('')
  return (
    <TableCard
      title="Every emergency ripple across the city"
      subtitle="Live from the database. Broadcast = OFF means the request looks active to the user but never reaches donors (shadow ban)."
      head={['Patient / Hospital', 'Type', 'Severity', 'Status', 'Broadcast', 'Requester', 'Actions']}
    >
      {requests.map((r) => (
        <tr key={r.id} className="border-b border-line/60 last:border-0">
          <td className="px-5 py-3">
            <p className="font-semibold text-white">{r.patient_name}</p>
            <p className="text-[11px] text-text-faint">{r.hospital}</p>
          </td>
          <td className="px-5 py-3"><span className="font-bold text-primary">{r.blood_type}</span></td>
          <td className="px-5 py-3">
            <span className={r.severity === 'LIFE_THREATENING' ? 'text-primary' : r.severity === 'CRITICAL' ? 'text-warning' : 'text-text-muted'}>
              {r.severity.replace('_', ' ')}
            </span>
          </td>
          <td className="px-5 py-3">
            <select
              value={r.status}
              disabled={spin(r.id, busyId)}
              onChange={(e) => onStatus(r, e.target.value)}
              className="rounded-md border border-line bg-[#0d111a] px-2 py-1 text-[11px] text-white outline-none focus:border-admin/60"
            >
              {['OPEN', 'LOCKED', 'FULFILLED', 'NO_SHOW'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {r.secured_donor_name && r.status !== 'OPEN' && (
              <p className="mt-1 text-[10px] text-admin font-semibold whitespace-nowrap">
                Locked to: {r.secured_donor_name}
              </p>
            )}
          </td>
          <td className="px-5 py-3">
            <button
              type="button"
              disabled={spin(r.id, busyId)}
              onClick={() => onToggle(r)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                r.broadcast
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-donor/40 bg-donor/10 text-donor'
              }`}
            >
              <span className={`size-1.5 rounded-full ${r.broadcast ? 'bg-success' : 'bg-donor'}`} />
              {r.broadcast ? 'Broadcasting' : 'Shadow-muted'}
            </button>
          </td>
          <td className="px-5 py-3 text-text-muted">{r.requester_name || '—'}</td>
          <td className="px-5 py-3">
            {confirmId === r.id ? (
              <span className="inline-flex items-center gap-2">
                <button onClick={() => { onDelete(r); setConfirmId('') }} className="text-[11px] font-semibold text-primary">Confirm</button>
                <button onClick={() => setConfirmId('')} className="text-[11px] text-text-faint">Cancel</button>
              </span>
            ) : (
              <button
                type="button"
                disabled={spin(r.id, busyId)}
                onClick={() => setConfirmId(r.id)}
                className="inline-flex items-center gap-1 text-[11px] text-text-faint hover:text-primary"
              >
                <Trash2 className="size-3.5" /> Delete
              </button>
            )}
          </td>
        </tr>
      ))}
    </TableCard>
  )
}

/* ── Tab 2: slip verification ────────────────────────────────────── */
function SlipsTab({ requests, busyId, onReview }) {
  const pending = requests.filter((r) => ['NEEDS_REVIEW', 'PENDING'].includes(r.slip_status))
  const reviewed = requests.filter((r) => !['NEEDS_REVIEW', 'PENDING'].includes(r.slip_status))

  return (
    <div className="space-y-6">
      <TableCard
        title="Doctor's slips awaiting manual override"
        subtitle="OCR could not confirm these. Verify to admit the request, or reject to pull it from the network."
        head={['Patient / Hospital', 'Type', 'OCR Confidence', 'Slip Status', 'Override']}
      >
        {pending.length === 0 ? (
          <tr><td colSpan={5} className="px-5 py-8 text-center text-text-faint">Nothing awaiting review 🎉</td></tr>
        ) : pending.map((r) => (
          <tr key={r.id} className="border-b border-line/60 last:border-0">
            <td className="px-5 py-3">
              <p className="font-semibold text-white">{r.patient_name}</p>
              <p className="text-[11px] text-text-faint">{r.hospital}</p>
            </td>
            <td className="px-5 py-3"><span className="font-bold text-primary">{r.blood_type}</span></td>
            <td className="px-5 py-3">
              <ConfidenceBar value={r.ocr_confidence} />
              {r.ocr_notes && (
                <p className="mt-1.5 max-w-[220px] text-[10px] leading-tight text-warning">
                  <TriangleAlert className="mb-0.5 mr-1 inline size-3" />
                  {r.ocr_notes}
                </p>
              )}
            </td>
            <td className="px-5 py-3"><Badge color={slipColor[r.slip_status]} dot={false}>{r.slip_status.replace('_', ' ')}</Badge></td>
            <td className="px-5 py-3">
              <div className="flex gap-2">
                <button
                  disabled={spin(r.id, busyId)}
                  onClick={() => onReview(r, 'VERIFY')}
                  className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success hover:bg-success/20"
                >
                  <CheckCircle2 className="size-3.5" /> Verify
                </button>
                <button
                  disabled={spin(r.id, busyId)}
                  onClick={() => onReview(r, 'REJECT')}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"
                >
                  <XCircle className="size-3.5" /> Reject
                </button>
              </div>
            </td>
          </tr>
        ))}
      </TableCard>

      <TableCard title="Already resolved" head={['Patient / Hospital', 'Type', 'Slip Status', 'Reviewed by']}>
        {reviewed.map((r) => (
          <tr key={r.id} className="border-b border-line/60 last:border-0">
            <td className="px-5 py-3">
              <p className="font-semibold text-white">{r.patient_name}</p>
              <p className="text-[11px] text-text-faint">{r.hospital}</p>
            </td>
            <td className="px-5 py-3"><span className="font-bold text-primary">{r.blood_type}</span></td>
            <td className="px-5 py-3"><Badge color={slipColor[r.slip_status]} dot={false}>{r.slip_status.replace('_', ' ')}</Badge></td>
            <td className="px-5 py-3 text-text-muted">{r.slip_reviewed_by || 'OCR engine'}</td>
          </tr>
        ))}
      </TableCard>
    </div>
  )
}

function ConfidenceBar({ value }) {
  if (value == null) return <span className="text-text-faint">—</span>
  const pct = Math.round(value * 100)
  const color = pct >= 80 ? 'bg-success' : pct >= 60 ? 'bg-warning' : 'bg-primary'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={pct >= 80 ? 'text-success' : pct >= 60 ? 'text-warning' : 'text-primary'}>{pct}%</span>
    </div>
  )
}

/* ── Tab 3: accounts ─────────────────────────────────────────────── */
function AccountsTab({ donors, busyId, onModerate }) {
  const pureDonors = donors.filter(d => d.role === 'donor')
  const patients = donors.filter(d => d.role === 'patient')

  const renderTable = (list, title, subtitle) => (
    <TableCard
      title={title}
      subtitle={subtitle}
      head={['Account', 'Type', 'Phone', 'Flagged', 'Status', 'Actions']}
    >
      {list.length === 0 ? (
        <tr><td colSpan="6" className="px-5 py-8 text-center text-text-faint">No accounts found</td></tr>
      ) : list.map((d) => (
        <tr key={d.id} className="border-b border-line/60 last:border-0">
          <td className="px-5 py-3">
            <p className="font-semibold text-white">{d.name}</p>
            {d.status_reason && <p className="text-[11px] text-text-faint">{d.status_reason}</p>}
          </td>
          <td className="px-5 py-3"><span className="font-bold text-primary">{d.blood_type || '—'}</span></td>
          <td className="px-5 py-3 text-text-muted">{d.phone || '—'}</td>
          <td className="px-5 py-3">
            <span className={d.flagged_fake_requests > 0 ? 'font-semibold text-warning' : 'text-text-faint'}>
              {d.flagged_fake_requests}
            </span>
          </td>
          <td className="px-5 py-3"><Badge color={acctColor[d.status]} dot>{acctLabel[d.status]}</Badge></td>
          <td className="px-5 py-3">
            <div className="flex flex-wrap gap-1.5">
              {d.status !== 'BANNED' && (
                <ModButton disabled={spin(d.id, busyId)} icon={Ban} label="Ban"
                  cls="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                  onClick={() => onModerate(d, 'BAN', 'Banned from admin console')} />
              )}
              {d.status !== 'SHADOW_BANNED' && (
                <ModButton disabled={spin(d.id, busyId)} icon={EyeOff} label="Shadow-ban"
                  cls="border-donor/40 bg-donor/10 text-donor hover:bg-donor/20"
                  onClick={() => onModerate(d, 'SHADOW_BAN', 'Flagged for fake requests')} />
              )}
              {d.status !== 'ACTIVE' && (
                <ModButton disabled={spin(d.id, busyId)} icon={RotateCcw} label="Reinstate"
                  cls="border-success/30 bg-success/10 text-success hover:bg-success/20"
                  onClick={() => onModerate(d, 'REINSTATE')} />
              )}
            </div>
          </td>
        </tr>
      ))}
    </TableCard>
  )

  return (
    <div className="space-y-6">
      {renderTable(pureDonors, "Registered Donors", "Verified accounts opted into the emergency ping network.")}
      {renderTable(patients, "Registered Patients / Family", "Accounts registered solely to submit requests.")}
    </div>
  )
}

function ModButton({ icon: Icon, label, cls, onClick, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 ${cls}`}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  )
}

/* ── Tab 4: medical certificates (early cooldown release) ────────── */
function CertificatesTab({ certificates, busyId, onReview }) {
  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—')
  return (
    <TableCard
      title="Medical certificates appealing a cooldown"
      subtitle="A donor locked out by a mistyped donation date can upload a timestamped certificate. Approving it releases the cooldown early — if the certificate carries a corrected date, that date is written and the engine simply recomputes."
      head={['Donor', 'Reason', 'Issued', 'Corrected date', 'Status', 'Actions']}
    >
      {certificates.length === 0 && (
        <tr>
          <td colSpan={6} className="px-5 py-8 text-center text-text-faint">
            No certificates submitted.
          </td>
        </tr>
      )}
      {certificates.map((c) => (
        <tr key={c.id} className="border-b border-line/60 last:border-0">
          <td className="px-5 py-3">
            <p className="font-semibold text-white">{c.donor_name ?? '—'}</p>
            <p className="text-[11px] text-text-faint">
              submitted {new Date(c.created_at).toLocaleString()}
            </p>
          </td>
          <td className="max-w-[260px] px-5 py-3 text-text-muted">
            {c.note || <span className="text-text-faint">no note</span>}
            {c.image && (
              <a
                href={c.image}
                target="_blank"
                rel="noreferrer"
                className="ml-2 text-admin underline"
              >
                view scan
              </a>
            )}
          </td>
          <td className="px-5 py-3 text-text-muted">{fmt(c.issued_at)}</td>
          <td className="px-5 py-3 text-text-muted">{fmt(c.corrected_donation_date)}</td>
          <td className="px-5 py-3">
            <Badge color={certColor[c.status] ?? 'warning'}>{c.status}</Badge>
          </td>
          <td className="px-5 py-3">
            {c.status === 'PENDING' ? (
              <div className="flex flex-wrap gap-1.5">
                <ModButton
                  disabled={spin(c.id, busyId)} icon={CheckCircle2} label="Approve"
                  cls="border-success/30 bg-success/10 text-success hover:bg-success/20"
                  onClick={() => onReview(c, 'APPROVE')}
                />
                <ModButton
                  disabled={spin(c.id, busyId)} icon={XCircle} label="Reject"
                  cls="border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                  onClick={() => onReview(c, 'REJECT')}
                />
              </div>
            ) : (
              <span className="text-[11px] text-text-faint">
                {c.reviewed_by} · {fmt(c.reviewed_at)}
              </span>
            )}
          </td>
        </tr>
      ))}
    </TableCard>
  )
}

/* ── Tab 5: rare-blood escalations ───────────────────────────────── */
function EscalationsTab({ escalations, busyId, onResolve }) {
  return (
    <TableCard
      title="Rare-blood requests escalated off-network"
      subtitle="A city-wide rare-type ping that goes unanswered is handed to national blood-bank APIs and partner NGO hotlines, so a family is never left with a dead end."
      head={['Type / Hospital', 'Reason', 'Channels', 'Status', 'Actions']}
    >
      {escalations.length === 0 && (
        <tr>
          <td colSpan={5} className="px-5 py-8 text-center text-text-faint">
            No escalations recorded.
          </td>
        </tr>
      )}
      {escalations.map((e) => (
        <tr key={e.id} className="border-b border-line/60 last:border-0">
          <td className="px-5 py-3">
            <p className="font-bold text-primary">{e.blood_type}</p>
            <p className="text-[11px] text-text-faint">{e.hospital}</p>
            <p className="text-[10px] text-[#374151]">
              {new Date(e.created_at).toLocaleString()}
            </p>
          </td>
          <td className="max-w-[240px] px-5 py-3 text-text-muted">{e.reason}</td>
          <td className="px-5 py-3">
            <ul className="space-y-1 text-[11px]">
              {e.channels.map((c, i) => (
                <li key={`${c.channel}-${i}`}>
                  <span className="text-text-muted">{c.channel}</span>{' '}
                  <span
                    className={
                      c.delivered ? 'text-success' : c.simulated ? 'text-warning' : 'text-primary'
                    }
                  >
                    {c.delivered ? 'delivered' : c.simulated ? 'not configured' : 'failed'}
                  </span>
                </li>
              ))}
            </ul>
          </td>
          <td className="px-5 py-3">
            <Badge color={escColor[e.status] ?? 'warning'}>{e.status}</Badge>
          </td>
          <td className="px-5 py-3">
            {e.status === 'OPEN' ? (
              <div className="flex flex-wrap gap-1.5">
                <ModButton
                  disabled={spin(e.id, busyId)} icon={CheckCircle2} label="Sourced"
                  cls="border-success/30 bg-success/10 text-success hover:bg-success/20"
                  onClick={() => onResolve(e, 'SOURCED')}
                />
                <ModButton
                  disabled={spin(e.id, busyId)} icon={XCircle} label="Close"
                  cls="border-line bg-[#0d111a] text-text-muted hover:text-white"
                  onClick={() => onResolve(e, 'CLOSE')}
                />
              </div>
            ) : (
              <span className="text-[11px] text-text-faint">{e.resolved_by}</span>
            )}
          </td>
        </tr>
      ))}
    </TableCard>
  )
}

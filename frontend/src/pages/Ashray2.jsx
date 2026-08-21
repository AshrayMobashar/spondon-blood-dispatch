import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { requestApi, adminApi } from '../lib/api.js'

import logo from '../assets/icons/logo.svg'
import shieldLock from '../assets/icons/shield-lock.svg'
import lock from '../assets/icons/lock.svg'
import shieldCheck from '../assets/icons/shield-check.svg'
import check from '../assets/icons/check.svg'
import adminUser from '../assets/icons/admin-user.svg'
import rafiul from '../assets/avatars/rafiul.png'
import nadia from '../assets/avatars/nadia.png'
import karim from '../assets/avatars/karim.png'

const avatars = [rafiul, nadia, karim]

const badges = [
  { label: 'ACID COMPLIANT', color: 'success' },
  { label: 'REAL-TIME LOCK', color: 'admin' },
  { label: 'NO-SHOW TRACKING', color: 'warning' },
  { label: 'APPEAL SYSTEM', color: 'primary' },
]

const badgeCls = {
  success: 'border-success/30 bg-success/[0.08] text-success',
  admin: 'border-admin/30 bg-admin/[0.08] text-admin',
  warning: 'border-warning/30 bg-warning/[0.08] text-warning',
  primary: 'border-primary/30 bg-primary/[0.08] text-primary',
}
const dotCls = {
  success: 'bg-success',
  admin: 'bg-admin',
  warning: 'bg-warning',
  primary: 'bg-primary',
}

const stats = [
  { dot: 'success', label: 'Locks Today', value: '247', sub: '↑ 12% from yesterday', subColor: 'text-success' },
  { dot: 'warning', label: 'No-Shows (30d)', value: '18', sub: '3 at risk of removal', subColor: 'text-warning' },
  { dot: 'primary', label: 'Race Conditions', value: '0', sub: 'Zero conflicts resolved', subColor: 'text-success' },
  { dot: 'donor', label: 'Appeals Pending', value: '3', sub: '1 awaiting admin review', subColor: 'text-donor' },
]

const tabs = [
  '🔒 Concurrency Lock',
  '⚠️ No-Show Tracking',
  '⚡ Race Condition',
  '📋 Appeal System',
]

const guarantees = [
  'Atomic database transaction on first Accept',
  'All other donors instantly see "Donor Secured"',
  'No duplicate travel — zero wasted donor trips',
]

export default function Ashray2() {
  const [activeTab, setActiveTab] = useState(0)
  const [request, setRequest] = useState(null)
  const [donors, setDonors] = useState([])
  const [txLog, setTxLog] = useState([])
  const [appeals, setAppeals] = useState([])
  const [loading, setLoading] = useState(false)
  const initialized = useRef(false)

  const logTx = (text, dot, color) => {
    setTxLog((prev) => [
      ...prev,
      { time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }), text, dot, color }
    ])
  }

  const resetDemo = async () => {
    setLoading(true)
    setTxLog([])
    setDonors([])
    setRequest(null)
    setAppeals([])
    try {
      // 1. Create a mock request
      logTx('Initializing live demo request...', 'admin', 'text-text-muted')
      const reqRes = await requestApi.create({
        patient_name: 'Mehedi Hassan',
        hospital: 'Dhaka Medical College',
        blood_type: 'O+',
        component: 'PLATELETS',
        units: 2,
        severity: 'CRITICAL',
        road_segment: 'Shahbagh',
        hospital_lat: 23.7261,
        hospital_lng: 90.3969,
      })
      
      // Override slip to authorise dispatch
      await requestApi.uploadSlip(reqRes.id, 'data:image/jpeg;base64,mock', 'image/jpeg')
      await adminApi.reviewSlip(reqRes.id, 'VERIFY', 'Demo auto-verify')
      
      setRequest(reqRes)

      // 2. Dispatch
      logTx('Ping dispatched to donors', 'admin', 'text-text-muted')
      await requestApi.dispatch(reqRes.id)
      
      // 3. Fetch pinged donors (simulate with fake accounts if dispatch found none)
      // Since it's a demo, if the real DB doesn't have nearby O+ donors, we might need to mock them, 
      // but let's assume the DB has seeded donors (01711000001 etc).
      // We will just fetch pingLogs. If empty, we'll manually fetch 3 donors and pretend they were pinged.
      let pings = await requestApi.pingLogs(reqRes.id)
      if (pings.length === 0) {
        logTx('No live pings found, falling back to seeded demo donors', 'warning', 'text-warning')
        // need a way to get donors, maybe adminApi.donors()
        const donorList = await adminApi.donors()
        pings = donorList.slice(0, 3).map((d, i) => ({
          donor_id: d.id,
          donor_name: d.name,
          distance_km: (1.2 + i * 0.8).toFixed(1),
          avatar: avatars[i % avatars.length]
        }))
      } else {
        pings = pings.slice(0, 3).map((p, i) => ({
          ...p,
          avatar: avatars[i % avatars.length],
          distance_km: p.distance_km ? p.distance_km.toFixed(1) : '2.0'
        }))
      }
      
      setDonors(pings)
      
    } catch (err) {
      logTx(`Demo setup error: ${err.message}`, 'warning', 'text-warning')
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      resetDemo()
    }
  }, [])

  const handleAccept = async (donor) => {
    if (!request) return
    logTx(`${donor.donor_name} — Accept packet received`, 'warning', 'text-warning')
    try {
      await requestApi.accept(request.id, donor.donor_id)
      logTx(`ACID transaction: Lock awarded to ${donor.donor_name}`, 'success', 'text-success')
      setRequest(prev => ({ ...prev, status: 'LOCKED', secured_donor_id: donor.donor_id, secured_donor_name: donor.donor_name }))
    } catch (err) {
      if (err.status === 409) {
        logTx(`${donor.donor_name} shown polite rejection: Donor Secured`, 'admin', 'text-text-muted')
      } else {
        logTx(`Error: ${err.message}`, 'warning', 'text-warning')
      }
    }
  }

  const handleRaceCondition = async () => {
    if (!request || donors.length < 2) return
    logTx(`Simulating simultaneous accepts from ${donors[0].donor_name} & ${donors[1].donor_name}`, 'warning', 'text-warning')
    
    // Fire simultaneously
    Promise.allSettled([
      requestApi.accept(request.id, donors[0].donor_id).then(() => logTx(`Lock awarded to ${donors[0].donor_name}`, 'success', 'text-success')).catch(e => logTx(`${donors[0].donor_name} rejected: ${e.message}`, 'admin', 'text-text-muted')),
      requestApi.accept(request.id, donors[1].donor_id).then(() => logTx(`Lock awarded to ${donors[1].donor_name}`, 'success', 'text-success')).catch(e => logTx(`${donors[1].donor_name} rejected: ${e.message}`, 'admin', 'text-text-muted'))
    ]).then(async () => {
      // Refresh request
      const reqStr = await requestApi.get(request.id)
      setRequest(reqStr)
    })
  }

  const handleNoShow = async () => {
    if (!request || request.status !== 'LOCKED') return
    try {
      await requestApi.arrival(request.id, request.secured_donor_id, false)
      logTx(`${request.secured_donor_name} marked as NO-SHOW.`, 'warning', 'text-warning')
      setRequest(prev => ({ ...prev, status: 'NO_SHOW' }))
    } catch (err) {
      logTx(`No-show error: ${err.message}`, 'warning', 'text-warning')
    }
  }
  
  const handleFulfill = async () => {
    if (!request || request.status !== 'LOCKED') return
    try {
      await requestApi.arrival(request.id, request.secured_donor_id, true)
      logTx(`${request.secured_donor_name} arrived and fulfilled request.`, 'success', 'text-success')
      setRequest(prev => ({ ...prev, status: 'FULFILLED' }))
    } catch (err) {
      logTx(`Arrival error: ${err.message}`, 'warning', 'text-warning')
    }
  }

  const handleFileAppeal = async () => {
    if (!request || request.status !== 'NO_SHOW') return
    try {
      await requestApi.appeal(request.secured_donor_id, request.id, "Stuck in severe traffic due to rally.")
      logTx(`Appeal filed for ${request.secured_donor_name}`, 'primary', 'text-primary')
      fetchAppeals()
    } catch (err) {
      logTx(`Appeal error: ${err.message}`, 'warning', 'text-warning')
    }
  }

  const fetchAppeals = async () => {
    try {
      const res = await adminApi.appeals('PENDING')
      setAppeals(res)
    } catch (err) {
      console.error(err)
    }
  }
  
  const resolveAppeal = async (appealId, action) => {
    try {
      await adminApi.resolveAppeal(appealId, action, 'admin.demo')
      logTx(`Appeal ${action} for ID ${appealId}`, action === 'CLEAR' ? 'success' : 'warning', action === 'CLEAR' ? 'text-success' : 'text-warning')
      fetchAppeals()
    } catch (err) {
      logTx(`Resolve error: ${err.message}`, 'warning', 'text-warning')
    }
  }

  useEffect(() => {
    if (activeTab === 3) fetchAppeals()
  }, [activeTab])

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink text-white">
      {/* Ambient glows */}
      <div className="pointer-events-none absolute left-0 top-0 size-[400px] rounded-full bg-primary opacity-[0.04] blur-[30px]" />
      <div className="pointer-events-none absolute left-[756px] top-[200px] size-[500px] rounded-full bg-donor opacity-5 blur-[35px]" />
      <div className="pointer-events-none absolute left-[502px] top-[694px] size-[300px] rounded-full bg-admin opacity-[0.04] blur-[25px]" />

      {/* Top bar */}
      <header className="relative z-20 border-b border-line">
        <div className="flex h-[61px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Link to="/" className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg bg-primary">
                <img src={logo} alt="" className="size-[18px]" />
              </span>
              <span className="text-xl font-bold tracking-tight">Spondon</span>
            </Link>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
              SYSTEM CORE
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-text-muted sm:inline-flex">
              <span className="size-[7px] rounded-full bg-success" />
              Live Dispatch Active
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-text-muted">
              <img src={adminUser} alt="" className="size-3.5" />
              Admin
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1256px] px-4 py-6 sm:px-6">
        {/* Page heading */}
        <div className="flex items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10">
            <img src={shieldLock} alt="" className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Concurrency Lock &amp; Flake-Out Accountability
            </h1>
            <p className="mt-1 text-[13px] text-text-faint">
              Real-time donor locking, ACID transaction guarantees, and no-show
              enforcement
            </p>
          </div>
        </div>

        {/* Status badges */}
        <div className="mt-6 flex flex-wrap gap-2">
          {badges.map((b) => (
            <span
              key={b.label}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold ${badgeCls[b.color]}`}
            >
              <span className={`size-1.5 rounded-full ${dotCls[b.color]}`} />
              {b.label}
            </span>
          ))}
        </div>

        {/* Stat cards */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-line bg-card p-5"
            >
              <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-faint">
                <span
                  className={`size-2 rounded-full ${dotCls[s.dot] ?? 'bg-donor'}`}
                />
                {s.label}
              </p>
              <p className="mt-3 text-[28px] font-bold leading-none">{s.value}</p>
              <p className={`mt-3 text-[10px] ${s.subColor}`}>{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="mt-8 flex overflow-x-auto border-b border-line">
          {tabs.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(i)}
              className={`shrink-0 border-b-2 px-6 py-3 text-xs font-semibold transition-colors ${
                activeTab === i
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-transparent text-text-faint hover:text-text-muted'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content grid */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          
          {/* Left Column Controls */}
          <div className="rounded-2xl border border-line bg-card p-6 flex flex-col">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-[10px] bg-primary/10">
                <img src={lock} alt="" className="size-[18px]" />
              </span>
              <div>
                <h2 className="text-sm font-bold">Interactive Demo: {tabs[activeTab]}</h2>
                <p className="text-[11px] text-text-faint">
                  Execute actions against the live database
                </p>
              </div>
            </div>

            {/* Request card */}
            <div className="mt-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-start justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Emergency Request {request ? `#${request.id.slice(-4)}` : 'Loading...'}
                </p>
                <span className="rounded-full border border-primary/30 bg-primary/20 px-2.5 py-1 text-[10px] font-bold text-primary">
                  {request ? request.status : 'WAIT'}
                </span>
              </div>
              <p className="mt-2 text-[13px] font-semibold">
                {request ? `${request.blood_type} Blood — ${request.hospital}` : '...'}
              </p>
              <div className="flex items-center justify-between">
                <p className="mt-1 text-[11px] text-text-faint">
                  Patient: {request ? request.patient_name : '...'} · {request ? request.units : '-'} units
                </p>
              </div>
              <p className="mt-3 flex items-center gap-2 text-[11px] font-medium text-primary">
                <span className={`size-1.5 rounded-full ${request?.status === 'LOCKED' ? 'bg-success' : 'bg-primary'}`} />
                {request?.status === 'OPEN' ? 'Awaiting donor acceptance...' : request?.status === 'LOCKED' ? `Secured by ${request.secured_donor_name}` : `Status: ${request?.status}`}
              </p>
            </div>

            {/* Tab Specific Content */}
            <div className="mt-6 flex-1">
              
              {/* Tab 0: Concurrency Lock */}
              {activeTab === 0 && (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    Pinged Donors ({donors.length})
                  </p>
                  <div className="mt-3 space-y-3">
                    {donors.map((d) => (
                      <div
                        key={d.donor_id}
                        className="flex items-center gap-3 rounded-[10px] border border-line bg-[#0d111a] p-3"
                      >
                        <img
                          src={d.avatar}
                          alt=""
                          className="size-9 shrink-0 rounded-full"
                        />
                        <div className="flex-1">
                          <p className="text-xs font-semibold">{d.donor_name}</p>
                          <p className="flex items-center gap-2 text-[10px]">
                            <span className="text-text-faint">{d.distance_km} km</span>
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={request?.status !== 'OPEN'}
                          onClick={() => handleAccept(d)}
                          className="rounded-md bg-success px-3.5 py-1.5 text-[10px] font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-50"
                        >
                          Accept
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Tab 1: No-Show Tracking */}
              {activeTab === 1 && (
                <div className="space-y-4">
                  <p className="text-sm text-text-faint">After a donor secures a request, track their arrival.</p>
                  <button
                    onClick={handleNoShow}
                    disabled={request?.status !== 'LOCKED'}
                    className="w-full rounded-md bg-warning/20 border border-warning/50 text-warning py-3 text-xs font-bold disabled:opacity-50"
                  >
                    Mark Secured Donor as NO-SHOW
                  </button>
                  <button
                    onClick={handleFulfill}
                    disabled={request?.status !== 'LOCKED'}
                    className="w-full rounded-md bg-success/20 border border-success/50 text-success py-3 text-xs font-bold disabled:opacity-50"
                  >
                    Mark Secured Donor as ARRIVED
                  </button>
                </div>
              )}

              {/* Tab 2: Race Condition */}
              {activeTab === 2 && (
                <div className="space-y-4">
                  <p className="text-sm text-text-faint">Simulate an exact millisecond race condition between two donors clicking Accept.</p>
                  <button
                    onClick={handleRaceCondition}
                    disabled={request?.status !== 'OPEN' || donors.length < 2}
                    className="w-full rounded-md bg-primary/20 border border-primary/50 text-primary py-3 text-xs font-bold disabled:opacity-50"
                  >
                    Simulate Simultaneous Accepts
                  </button>
                </div>
              )}

              {/* Tab 3: Appeal System */}
              {activeTab === 3 && (
                <div className="space-y-4 flex flex-col h-full">
                  <button
                    onClick={handleFileAppeal}
                    disabled={request?.status !== 'NO_SHOW'}
                    className="w-full rounded-md bg-primary border border-primary text-white py-3 text-xs font-bold disabled:opacity-50"
                  >
                    File Appeal for {request?.secured_donor_name || 'Donor'}
                  </button>
                  
                  <div className="mt-6 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-2">
                      Pending Appeals ({appeals.length})
                    </p>
                    <div className="space-y-2 max-h-[150px] overflow-y-auto">
                      {appeals.map(a => (
                        <div key={a.id} className="p-3 border border-line rounded-lg bg-[#0d111a] flex justify-between items-center">
                          <div>
                            <p className="text-xs font-bold">{a.donor_name}</p>
                            <p className="text-[10px] text-text-faint">Reason: {a.reason}</p>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => resolveAppeal(a.id, 'CLEAR')} className="px-2 py-1 bg-success/20 text-success rounded text-[10px] font-bold">CLEAR</button>
                            <button onClick={() => resolveAppeal(a.id, 'REJECT')} className="px-2 py-1 bg-warning/20 text-warning rounded text-[10px] font-bold">REJECT</button>
                          </div>
                        </div>
                      ))}
                      {appeals.length === 0 && <p className="text-[11px] text-text-faint italic">No pending appeals.</p>}
                    </div>
                  </div>
                </div>
              )}

            </div>

            <button
              type="button"
              onClick={resetDemo}
              disabled={loading}
              className="mt-6 w-full shrink-0 rounded-lg border border-line bg-[#0d111a] py-2.5 text-xs font-semibold text-text-faint transition-colors hover:text-white disabled:opacity-50"
            >
              {loading ? 'Setting up...' : '↺ Reset Demo Request'}
            </button>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Transaction log */}
            <div className="rounded-2xl border border-line bg-card p-6 h-[340px] flex flex-col">
              <p className="flex items-center gap-2 text-xs font-semibold text-text-muted">
                <span className="size-2 rounded-full bg-success" />
                Transaction Log — Request {request ? `#${request.id.slice(-4)}` : '...'}
              </p>
              <div className="mt-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                {txLog.map((row, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 border-b border-line py-2.5 last:border-0"
                  >
                    <span className="w-14 shrink-0 text-[10px] text-[#374151] pt-0.5">
                      {row.time}
                    </span>
                    <span
                      className={`size-1.5 shrink-0 rounded-full mt-1.5 ${dotCls[row.dot] || 'bg-admin'}`}
                    />
                    <span className={`text-[11px] ${row.color}`}>{row.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Lock guarantee */}
            <div className="rounded-2xl border border-success/20 bg-card p-6">
              <div className="flex items-center gap-3">
                <span className="grid size-7 place-items-center rounded-lg bg-success/10">
                  <img src={shieldCheck} alt="" className="size-3.5" />
                </span>
                <h3 className="text-[13px] font-bold">System Guarantees</h3>
              </div>
              <div className="mt-4 space-y-3">
                {guarantees.map((g) => (
                  <p key={g} className="flex items-center gap-3 text-[11px] text-text-strong">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-success/10">
                      <img src={check} alt="" className="size-2.5" />
                    </span>
                    {g}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

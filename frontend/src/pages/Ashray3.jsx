import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { requestApi, adminApi } from '../lib/api.js'
import logo from '../assets/icons/logo.svg'

import rafiul from '../assets/avatars/rafiul.png'
import nadia from '../assets/avatars/nadia.png'
import karim from '../assets/avatars/karim.png'

const avatars = [rafiul, nadia, karim]

export default function Ashray3() {
  const [request, setRequest] = useState(null)
  const [donors, setDonors] = useState([])
  const [securedDonorInfo, setSecuredDonorInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState([])
  const initialized = useRef(false)

  const addLog = (msg) => {
    setLog(prev => [...prev, { time: new Date().toLocaleTimeString(), text: msg }])
  }

  const createRequest = async () => {
    setLoading(true)
    setLog([])
    setDonors([])
    setSecuredDonorInfo(null)
    setRequest(null)
    
    try {
      addLog("Patient submitting emergency request...")
      const reqRes = await requestApi.create({
        patient_name: 'Mehedi Hassan',
        hospital: 'Dhaka Medical College',
        blood_type: 'O+',
        component: 'WHOLE_BLOOD',
        units: 2,
        severity: 'CRITICAL',
        road_segment: 'Shahbagh',
        hospital_lat: 23.7261,
        hospital_lng: 90.3969,
      })
      
      addLog("Simulating admin slip verification...")
      await requestApi.uploadSlip(reqRes.id, 'data:image/jpeg;base64,mock', 'image/jpeg')
      await adminApi.reviewSlip(reqRes.id, 'VERIFY', 'Demo auto-verify')
      
      setRequest(reqRes)
      addLog("Dispatching ping to nearby donors...")
      await requestApi.dispatch(reqRes.id)
      
      // Fetch donors to show on right side
      let pings = await requestApi.pingLogs(reqRes.id)
      if (pings.length === 0) {
        // Mock donors if empty
        const donorList = await adminApi.donors()
        pings = donorList.slice(0, 3).map((d, i) => ({
          donor_id: d.id,
          donor_name: d.name,
          phone: d.phone,
          distance_km: (1.2 + i * 0.8).toFixed(1),
          avatar: avatars[i % avatars.length]
        }))
      } else {
        // Fetch full donor info to get phone numbers
        const donorList = await adminApi.donors()
        pings = pings.slice(0, 3).map((p, i) => {
          const dFull = donorList.find(d => d.id === p.donor_id)
          return {
            ...p,
            phone: dFull ? dFull.phone : '01700000000',
            avatar: avatars[i % avatars.length],
            distance_km: p.distance_km ? p.distance_km.toFixed(1) : '2.0'
          }
        })
      }
      
      setDonors(pings)
      addLog("Request OPEN. Awaiting donor acceptance.")
    } catch (err) {
      addLog(`Error: ${err.message}`)
    }
    setLoading(false)
  }

  const handleAccept = async (donor) => {
    if (!request) return
    addLog(`Donor ${donor.donor_name} clicked ACCEPT.`)
    try {
      await requestApi.accept(request.id, donor.donor_id)
      addLog(`Server granted lock to ${donor.donor_name}.`)
      setRequest(prev => ({ ...prev, status: 'LOCKED', secured_donor_id: donor.donor_id, secured_donor_name: donor.donor_name }))
      setSecuredDonorInfo(donor)
      addLog(`Patient received donor information.`)
    } catch (err) {
      addLog(`Accept failed: ${err.message}`)
    }
  }

  const handleDecline = async (donor) => {
    if (!request) return
    addLog(`Donor ${donor.donor_name} clicked DECLINE.`)
    try {
      await requestApi.decline(request.id, donor.donor_id)
      setDonors(prev => prev.map(d => d.donor_id === donor.donor_id ? { ...d, declined: true } : d))
    } catch (err) {
      addLog(`Decline failed: ${err.message}`)
    }
  }

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      createRequest()
    }
  }, [])

  return (
    <div className="min-h-screen bg-ink text-white p-6">
      <header className="mb-8 flex items-center justify-between border-b border-line pb-4">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-primary">
              <img src={logo} alt="" className="size-[18px]" />
            </span>
            <span className="text-xl font-bold tracking-tight">Spondon Demo</span>
          </Link>
          <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
            Patient ↔ Donor Flow
          </span>
        </div>
        <button onClick={createRequest} disabled={loading} className="rounded border border-line bg-card px-4 py-2 text-sm font-semibold transition hover:bg-white/5 disabled:opacity-50">
          {loading ? 'Resetting...' : '↺ Reset Demo'}
        </button>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Patient View */}
        <div className="rounded-xl border border-line bg-card p-6">
          <h2 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
            <span className="size-3 rounded-full bg-primary" /> Patient View
          </h2>
          
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 mb-6">
            <p className="text-xs font-bold uppercase text-primary">Live Emergency Request</p>
            <h3 className="mt-2 text-lg font-semibold">{request?.blood_type || 'O+'} Blood — {request?.hospital || 'Dhaka Medical College'}</h3>
            <p className="text-sm text-text-muted mt-1">Patient: {request?.patient_name || '...'} • {request?.units || '-'} Units</p>
            <div className="mt-4 inline-block rounded bg-primary/20 px-3 py-1 text-xs font-bold text-primary">
              Status: {request?.status || 'AWAITING DISPATCH'}
            </div>
          </div>

          <div className="min-h-[150px] rounded-lg border border-line bg-ink p-4">
            {request?.status === 'OPEN' && (
              <div className="flex items-center gap-3 text-warning">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-warning"></span>
                </span>
                <p className="text-sm font-semibold">Broadcasting to donors... Waiting for acceptance.</p>
              </div>
            )}
            {request?.status === 'LOCKED' && securedDonorInfo && (
              <div className="animate-in fade-in zoom-in duration-300">
                <h4 className="text-sm font-bold text-success mb-3 flex items-center gap-2">
                  <span className="size-2 rounded-full bg-success" /> Donor Secured!
                </h4>
                <div className="rounded-lg border border-success/30 bg-success/10 p-4">
                  <div className="flex items-center gap-4">
                    <img src={securedDonorInfo.avatar} alt="" className="size-12 rounded-full border border-success/50" />
                    <div>
                      <p className="font-bold text-white">{securedDonorInfo.donor_name}</p>
                      <p className="text-sm text-success font-mono mt-1">{securedDonorInfo.phone}</p>
                      <p className="text-xs text-text-muted mt-1">{securedDonorInfo.distance_km} km away</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Donor View */}
        <div className="rounded-xl border border-line bg-card p-6">
          <h2 className="text-lg font-bold text-success mb-4 flex items-center gap-2">
            <span className="size-3 rounded-full bg-success" /> Donor View
          </h2>

          <p className="text-xs font-semibold uppercase text-text-muted mb-4">Incoming Alerts ({donors.length})</p>
          
          <div className="space-y-4">
            {donors.map(d => (
              <div key={d.donor_id} className="rounded-lg border border-line bg-ink p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <img src={d.avatar} alt="" className="size-8 rounded-full" />
                    <div>
                      <p className="text-sm font-bold">{d.donor_name}</p>
                      <p className="text-xs text-text-faint">{d.distance_km} km away</p>
                    </div>
                  </div>
                  {d.declined && <span className="text-xs font-bold text-text-muted">DECLINED</span>}
                </div>

                {!d.declined && (
                  <div className="rounded border border-primary/20 bg-primary/5 p-3 mb-3">
                    <p className="text-sm font-semibold text-primary">Emergency Request: O+ Blood</p>
                    <p className="text-xs text-text-muted">Dhaka Medical College • 2 Units</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    disabled={request?.status !== 'OPEN' || d.declined}
                    onClick={() => handleDecline(d)}
                    className="flex-1 rounded-lg border border-line bg-card py-2 text-xs font-bold transition hover:bg-white/5 disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    disabled={request?.status !== 'OPEN' || d.declined}
                    onClick={() => handleAccept(d)}
                    className="flex-1 rounded-lg bg-success py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    Accept
                  </button>
                </div>
              </div>
            ))}
            {donors.length === 0 && <p className="text-sm text-text-faint">No pings received yet.</p>}
          </div>
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-line bg-card p-4">
        <h3 className="text-xs font-bold text-text-muted uppercase mb-3">System Log</h3>
        <div className="h-32 overflow-y-auto space-y-2 text-xs font-mono">
          {log.map((l, i) => (
            <div key={i} className="text-text-faint">
              <span className="text-text-muted mr-2">[{l.time}]</span>
              <span className={l.text.includes('Error') ? 'text-primary' : l.text.includes('granted') ? 'text-success' : 'text-white'}>{l.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

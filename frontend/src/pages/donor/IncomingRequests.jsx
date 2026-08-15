import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Activity, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { requestApi, donorApi, getAccount } from '../../lib/api.js'

export default function IncomingRequests() {
  const navigate = useNavigate()
  const account = getAccount()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true)
      const data = await requestApi.incoming()
      setRequests(data)
    } catch (err) {
      if (err.status === 401) navigate('/auth')
      else setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    if (!account) {
      navigate('/auth')
      return
    }
    loadRequests()
    
    // Poll every 10 seconds to catch new dispatches
    const interval = setInterval(loadRequests, 10000)
    return () => clearInterval(interval)
  }, [account, navigate, loadRequests])

  const handleAccept = async (reqId) => {
    setBusy(reqId)
    try {
      await requestApi.accept(reqId, account.id)
      alert("Request Secured! You are now locked into this request.")
      setRequests(prev => prev.filter(r => r.id !== reqId))
    } catch (err) {
      if (err.status === 409) {
        alert("Donor Secured: Another donor accepted this request first.")
        setRequests(prev => prev.filter(r => r.id !== reqId))
      } else {
        alert(`Error: ${err.message}`)
      }
    } finally {
      setBusy('')
    }
  }

  const handleDecline = async (reqId) => {
    setBusy(reqId)
    try {
      await requestApi.decline(reqId, account.id)
      setRequests(prev => prev.filter(r => r.id !== reqId))
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setBusy('')
    }
  }

  return (
    <Shell panel="DONOR" panelColor="donor" right={
      <div className="flex items-center gap-4">
        <Link to="/donor/profile" className="text-xs font-semibold text-text-muted hover:text-white transition">My Profile</Link>
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-full bg-success animate-pulse" />
          <span className="text-xs font-bold text-success uppercase tracking-wide">Network Active</span>
        </div>
      </div>
    }>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary">
            <Activity className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Incoming Requests</h1>
            <p className="text-xs text-text-faint">Emergencies broadcasting to your area</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {loading && requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <div className="size-6 border-2 border-donor border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm">Scanning network...</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-6 text-center text-primary">
            <AlertCircle className="mx-auto size-6 mb-2" />
            <p className="text-sm font-bold">Failed to load requests</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="rounded-full bg-ink p-4 mb-4">
              <CheckCircle2 className="size-8 text-success opacity-80" />
            </div>
            <h3 className="text-sm font-bold text-white">No active emergencies</h3>
            <p className="text-xs text-text-faint mt-1 max-w-sm">
              We will notify you immediately via push or SMS when a patient needs {account?.blood_type} blood nearby.
            </p>
          </div>
        ) : (
          requests.map(req => (
            <div key={req.id} className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-card p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-2.5 py-1 text-[10px] font-bold tracking-wide text-primary uppercase">
                  <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                  {req.severity.replace('_', ' ')}
                </span>
              </div>
              
              <div className="mb-6 max-w-xl">
                <p className="text-sm font-bold text-primary mb-1">Emergency: {req.blood_type} Blood Needed</p>
                <h3 className="text-xl font-bold text-white mb-2">{req.hospital}</h3>
                
                <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm text-text-muted">
                  <p><span className="text-text-faint mr-1">Patient:</span> {req.patient_name}</p>
                  <p><span className="text-text-faint mr-1">Required:</span> {req.units} Units</p>
                  <p className="flex items-center gap-1"><Clock className="size-3.5" /> Dispatched {new Date(req.created_at).toLocaleTimeString()}</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  disabled={busy === req.id}
                  onClick={() => handleDecline(req.id)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-lg border border-line bg-ink px-6 py-2.5 text-sm font-bold text-text-muted hover:text-white transition disabled:opacity-50"
                >
                  <XCircle className="size-4" /> Decline
                </button>
                <button
                  disabled={busy === req.id}
                  onClick={() => handleAccept(req.id)}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-2.5 text-sm font-bold text-white shadow-[0_0_15px_rgba(220,38,38,0.4)] hover:brightness-110 transition disabled:opacity-50"
                >
                  {busy === req.id ? 'Securing...' : 'Accept Request'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </Shell>
  )
}

import { useState, useEffect } from 'react'
import { bountyApi } from '../../lib/api.js'
import Shell from '../../components/Shell.jsx'
import { DonorChips } from '../../components/RoleChips.jsx'
import { Car, Loader2, MapPin, CheckCircle2, Clock } from 'lucide-react'

export default function RideBounties() {
  const [bounties, setBounties] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [accepting, setAccepting] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    try {
      const res = await bountyApi.list()
      setBounties(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleAccept(id) {
    setAccepting(id)
    try {
      await bountyApi.accept(id)
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setAccepting(null)
    }
  }

  return (
    <Shell panel="DONOR PANEL" panelColor="donor" right={<DonorChips />}>
      <div className="max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-donor/10 text-donor">
            <Car className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold">Community Ride Bounties</h1>
            <p className="text-sm text-text-faint">Offer a ride home to donors who just finished a Platelets session.</p>
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-primary">{error}</p>}
        {loading && <p className="text-sm text-text-muted"><Loader2 className="inline size-4 animate-spin" /> Loading bounties...</p>}

        {!loading && bounties.length === 0 && (
          <div className="rounded-xl border border-line bg-card p-8 text-center">
            <p className="text-sm text-text-muted">No open ride bounties right now.</p>
            <p className="mt-2 text-xs text-text-faint">Bounties appear here automatically when a Platelet donation finishes.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {bounties.map(b => (
            <div key={b.id} className="rounded-xl border border-line bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-bold">{b.donor_name}</h3>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
                    <MapPin className="size-3.5" /> {b.hospital}
                  </p>
                </div>
                {b.status === 'OPEN' ? (
                  <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-bold text-warning">OPEN</span>
                ) : (
                  <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">ACCEPTED</span>
                )}
              </div>
              
              <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
                <div className="flex items-center gap-1.5 text-[10px] text-text-faint">
                  <Clock className="size-3" />
                  Expires in <TimeLeft date={b.expires_at} />
                </div>
                {b.status === 'OPEN' ? (
                  <button
                    onClick={() => handleAccept(b.id)}
                    disabled={accepting === b.id}
                    className="flex items-center gap-1.5 rounded-lg bg-donor px-4 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    {accepting === b.id ? <Loader2 className="size-3.5 animate-spin" /> : <Car className="size-3.5" />}
                    Offer Ride
                  </button>
                ) : (
                  <p className="text-xs font-bold text-success">You are driving them!</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  )
}

function TimeLeft({ date }) {
  const [ms, setMs] = useState(new Date(date).getTime() - Date.now())
  useEffect(() => {
    const t = setInterval(() => setMs(new Date(date).getTime() - Date.now()), 1000)
    return () => clearInterval(t)
  }, [date])
  if (ms <= 0) return <span>Expired</span>
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return <span>{m}m {s}s</span>
}

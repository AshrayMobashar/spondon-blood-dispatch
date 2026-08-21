import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { User, Phone, MapPin, Droplet, ArrowLeft, Save, Loader2 } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card, Button, Input } from '../../components/ui.jsx'
import { GoldenBadge } from '../../components/GoldenBadge.jsx'
import { authApi, goldenApi } from '../../lib/api.js'

export default function DonorProfile() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [golden, setGolden] = useState(null)
  
  useEffect(() => {
    authApi.me()
      .then((res) => {
        setData(res.account)
        setName(res.account.name || '')
        setAddress(res.account.address || '')
        setLoading(false)
      })
      .catch((err) => {
        if (err.status === 401) navigate('/login')
        setLoading(false)
      })

    // The badge is decoration here — the profile must still render for a
    // patient account, or when the golden endpoint is unavailable.
    goldenApi
      .me()
      .then((res) => setGolden(res.badge))
      .catch(() => setGolden(null))
  }, [navigate])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await authApi.updateProfile({ name, address })
      setData(res.account)
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Shell panel="DONOR TERMINAL" panelColor="donor">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-donor" />
        </div>
      </Shell>
    )
  }

  return (
    <Shell panel="DONOR TERMINAL" panelColor="donor">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={() => navigate('/donor/eligibility')}
          className="flex size-10 items-center justify-center rounded-full border border-line bg-card text-text-faint transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Your Profile</h1>
          <p className="text-sm text-text-faint">Manage your personal information securely.</p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl">
        {/* Banner */}
        <div className="relative mb-8 overflow-hidden rounded-2xl border border-donor/30 bg-donor/10 p-8 text-center shadow-lg shadow-donor/5">
          <div className="absolute -right-12 -top-12 size-48 rounded-full bg-donor/20 blur-3xl" />
          <div className="absolute -bottom-12 -left-12 size-48 rounded-full bg-donor/20 blur-3xl" />
          
          <div className="relative mx-auto mb-4 flex size-20 items-center justify-center rounded-full border-4 border-ink bg-donor text-white shadow-xl">
            <User className="size-10" />
          </div>
          <h2 className="text-2xl font-bold text-white">{data?.name}</h2>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-donor/20 px-3 py-1 text-xs font-semibold text-donor">
              <Droplet className="size-3.5 fill-donor" /> {data?.blood_type}
            </span>
            {/* Verified Golden Donor badge — the profile is where the spec puts it. */}
            {golden?.is_golden && (
              <Link to="/donor/golden">
                <GoldenBadge badge={golden} />
              </Link>
            )}
          </div>
        </div>

        {/* Edit Form */}
        <Card className="p-6">
          <form onSubmit={save} className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-text-muted flex items-center gap-2">
                  <User className="size-3.5" /> Full Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-ink"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-text-muted flex items-center gap-2">
                  <Phone className="size-3.5" /> Mobile Number
                </label>
                <Input
                  value={data?.phone}
                  disabled
                  className="bg-ink/50 text-text-muted cursor-not-allowed"
                />
                <p className="text-[10px] text-text-faint">Phone number is verified and locked.</p>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-text-muted flex items-center gap-2">
                  <MapPin className="size-3.5" /> Primary Address
                </label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. 12/A Mirpur Road, Dhaka"
                  className="bg-ink"
                />
              </div>
            </div>

            <div className="flex items-center justify-end border-t border-line pt-6">
              <Button type="submit" variant="donor" disabled={saving || (!name.trim())}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save Changes
              </Button>
            </div>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-text-faint">
          Your information is strictly confidential. Patients will only see your name and phone number 
          if you explicitly accept their emergency blood request.
        </p>
      </div>
    </Shell>
  )
}

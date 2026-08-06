import { useEffect, useState } from 'react'
import { User, Zap } from 'lucide-react'
import { Chip } from './TopBar.jsx'
import { getAdmin, getUser, requestApi } from '../lib/api.js'

/** The signed-in end user, read straight from the stored session.
 *  These chips are decoration around a page that does its own loading, so a
 *  missing session shows a neutral placeholder rather than forcing a redirect. */
function useStoredUser() {
  const [user, setUser] = useState(() => getUser())
  useEffect(() => {
    // Pick up a sign-in that happened in another tab.
    const sync = () => setUser(getUser())
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  return user
}

export function DonorChips() {
  const user = useStoredUser()
  const [weekPings, setWeekPings] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    const cutoff = Date.now() - 7 * 86_400_000
    requestApi
      .pingLogs()
      .then((logs) =>
        setWeekPings(
          logs.filter(
            (l) => l.donor_id === user.id && l.pinged && new Date(l.created_at) >= cutoff,
          ).length,
        ),
      )
      .catch(() => setWeekPings(null))
  }, [user?.id])

  return (
    <>
      <Chip className="hidden md:inline-flex">
        <span className="size-2 rounded-full bg-success" />
        Live Dispatch Active
      </Chip>
      <Chip>
        <User className="size-3.5" />
        {user?.name ?? 'Not signed in'}
        {user?.blood_type && <span className="font-bold text-primary">{user.blood_type}</span>}
      </Chip>
      {weekPings !== null && (
        <Chip className="hidden sm:inline-flex">
          <Zap className="size-3.5 text-warning" />
          <span className="font-semibold text-warning">{weekPings} pings this week</span>
        </Chip>
      )}
    </>
  )
}

export function PatientChips({ name, blood }) {
  const user = useStoredUser()
  const label = name ?? user?.name ?? 'Not signed in'
  const type = blood ?? user?.blood_type

  return (
    <>
      <Chip className="hidden md:inline-flex">
        <span className="size-2 rounded-full bg-primary" />
        Emergency Request Active
      </Chip>
      <Chip>
        <User className="size-3.5" />
        {label}
        {type && <span className="font-bold text-primary">{type}</span>}
      </Chip>
    </>
  )
}

export function AdminChips({ label }) {
  const admin = getAdmin()
  return (
    <>
      <Chip className="hidden sm:inline-flex">
        <span className="size-2 rounded-full bg-success" />
        Live Dispatch Active
      </Chip>
      <Chip>
        <User className="size-3.5" />
        {label ?? admin?.name ?? 'Admin'}
      </Chip>
    </>
  )
}

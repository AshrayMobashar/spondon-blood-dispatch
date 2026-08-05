import { User, Zap } from 'lucide-react'
import { Chip } from './TopBar.jsx'

export function DonorChips() {
  return (
    <>
      <Chip className="hidden md:inline-flex">
        <span className="size-2 rounded-full bg-success" />
        Live Dispatch Active
      </Chip>
      <Chip>
        <User className="size-3.5" />
        Rafiul Islam
        <span className="font-bold text-primary">O+</span>
      </Chip>
      <Chip className="hidden sm:inline-flex">
        <Zap className="size-3.5 text-warning" />
        <span className="font-semibold text-warning">7 pings this week</span>
      </Chip>
    </>
  )
}

export function PatientChips({ name = 'Mehedi Hassan', blood = 'B+' }) {
  return (
    <>
      <Chip className="hidden md:inline-flex">
        <span className="size-2 rounded-full bg-primary" />
        Emergency Request Active
      </Chip>
      <Chip>
        <User className="size-3.5" />
        {name}
        <span className="font-bold text-primary">{blood}</span>
      </Chip>
    </>
  )
}

export function AdminChips({ label = 'Admin' }) {
  return (
    <>
      <Chip className="hidden sm:inline-flex">
        <span className="size-2 rounded-full bg-success" />
        Live Dispatch Active
      </Chip>
      <Chip>
        <User className="size-3.5" />
        {label}
      </Chip>
    </>
  )
}

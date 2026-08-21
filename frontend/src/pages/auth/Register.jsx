import { Link } from 'react-router-dom'
import { Droplet, HeartHandshake, Building2, ArrowRight } from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import { Card } from '../../components/ui.jsx'

const roles = [
  {
    to: '/register/patient',
    icon: Droplet,
    accent: 'primary',
    title: 'Patient / Family',
    body: 'Submit emergency blood requests, upload the doctor’s slip, and track your donor in real time.',
  },
  {
    to: '/register/donor',
    icon: HeartHandshake,
    accent: 'donor',
    title: 'Blood Donor',
    body: 'Complete your health profile, set availability and sleep mode, and receive targeted emergency pings.',
  },
]

const styles = {
  primary: { icon: 'bg-primary/10 text-primary', border: 'hover:border-primary/40', arrow: 'text-primary' },
  donor: { icon: 'bg-donor/10 text-donor', border: 'hover:border-donor/40', arrow: 'text-donor' },
  admin: { icon: 'bg-admin/10 text-admin', border: 'hover:border-admin/40', arrow: 'text-admin' },
}

export default function Register() {
  return (
    <Shell center max="max-w-2xl">
      <div className="w-full text-center">
        <h1 className="text-3xl font-bold">Create your account</h1>
        <p className="mt-2 text-sm text-text-faint">
          Choose your role to get started — registration takes under a minute.
        </p>
      </div>

      <div className="mx-auto mt-10 grid w-full grid-cols-1 gap-4 md:grid-cols-2">
        {roles.map((r) => {
          const s = styles[r.accent]
          return (
            <Link key={r.title} to={r.to}>
              <Card
                className={`h-full border-line p-6 transition-colors ${s.border}`}
              >
                <span className={`grid size-11 place-items-center rounded-xl ${s.icon}`}>
                  <r.icon className="size-5" />
                </span>
                <h2 className="mt-4 text-base font-semibold">{r.title}</h2>
                <p className="mt-2 text-xs leading-relaxed text-text-faint">
                  {r.body}
                </p>
                <span className={`mt-4 inline-flex items-center gap-1 text-xs font-semibold ${s.arrow}`}>
                  Continue <ArrowRight className="size-3.5" />
                </span>
              </Card>
            </Link>
          )
        })}
      </div>

      <p className="mt-8 text-center text-xs text-text-faint">
        Already registered?{' '}
        <Link to="/login" className="font-semibold text-primary">
          Sign in
        </Link>
      </p>
    </Shell>
  )
}

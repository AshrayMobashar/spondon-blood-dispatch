import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar.jsx'
import emergencyBolt from '../assets/icons/emergency-bolt-hero.svg'
import emergencyBoltSm from '../assets/icons/emergency-bolt-sm.svg'
import emergencyBanner from '../assets/icons/emergency-banner.svg'
import registration from '../assets/icons/registration.svg'
import patient from '../assets/icons/patient.svg'
import donor from '../assets/icons/donor.svg'
import admin from '../assets/icons/admin.svg'

const stats = [
  { value: '12,400+', label: 'Registered Donors', color: 'text-primary' },
  { value: '98.2%', label: 'Match Success Rate', color: 'text-success' },
  { value: '4.7 min', label: 'Avg. Response Time', color: 'text-admin' },
  { value: '8 Types', label: 'Blood Types Covered', color: 'text-warning' },
]

const roles = [
  {
    icon: patient,
    title: 'Patient / Family',
    body: "Register and submit emergency blood requests with hospital details, blood type, and doctor's slip. Track your donor in real time.",
    cta: 'Register as Patient →',
    accent: 'primary',
    to: '/register/patient',
  },
  {
    icon: donor,
    title: 'Blood Donor',
    body: 'Complete your health profile, set availability, manage sleep mode, and receive targeted emergency pings near your location.',
    cta: 'Register as Donor →',
    accent: 'donor',
    to: '/register/donor',
  },
  {
    icon: admin,
    title: 'Hospital / Admin',
    body: 'Monitor the live dispatch canvas, verify medical slips, manage donor eligibility, and oversee the city-wide blood network.',
    cta: 'Register as Admin →',
    accent: 'admin',
    to: '/register',
  },
]

const steps = [
  {
    n: '1',
    title: 'Enter Phone',
    body: 'Provide your Bangladeshi mobile number. No email required.',
    color: 'text-primary',
    ring: 'border-primary/30 bg-primary/10',
  },
  {
    n: '2',
    title: 'Verify OTP',
    body: 'Receive a 6-digit SMS code via SSL Wireless gateway.',
    color: 'text-warning',
    ring: 'border-warning/30 bg-warning/10',
  },
  {
    n: '3',
    title: 'Health Profile',
    body: 'Donors complete weight, blood type, and last donation date.',
    color: 'text-donor',
    ring: 'border-donor/30 bg-donor/10',
  },
  {
    n: '4',
    title: 'Dashboard',
    body: 'Access your personalized role-based dashboard instantly.',
    color: 'text-success',
    ring: 'border-success/30 bg-success/10',
  },
]

const accentStyles = {
  primary: {
    card: 'border-primary/30',
    iconWrap: 'bg-primary/10',
    cta: 'border-primary/30 bg-primary/10 text-primary',
  },
  donor: {
    card: 'border-donor/30',
    iconWrap: 'bg-donor/10',
    cta: 'border-donor/30 bg-donor/10 text-donor',
  },
  admin: {
    card: 'border-admin/30',
    iconWrap: 'bg-admin/10',
    cta: 'border-admin/30 bg-admin/10 text-admin',
  },
}

export default function Ashray0() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-ink text-white">
      {/* Ambient glows */}
      <div className="pointer-events-none absolute -left-24 -top-24 size-[500px] rounded-full bg-primary opacity-[0.04] blur-[40px]" />
      <div className="pointer-events-none absolute left-[756px] top-[474px] size-[600px] rounded-full bg-donor opacity-5 blur-[50px]" />
      <div className="pointer-events-none absolute left-[502px] top-[350px] size-[400px] rounded-full bg-admin opacity-[0.04] blur-[35px]" />

      <div className="relative">
        <Navbar />

        <main className="mx-auto max-w-[1256px] px-6">
          {/* Hero */}
          <section className="flex flex-col items-center pt-24 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
              <span className="size-2 rounded-full bg-primary/40" />
              Algorithm-Driven Emergency Blood Dispatch — Bangladesh
            </span>

            <h1 className="mt-6 text-5xl font-bold leading-tight tracking-tight sm:text-[48px]">
              Save Lives with
              <br />
              <span className="text-primary">Precision</span>
              <br />
              Blood Matching
            </h1>

            <p className="mt-6 max-w-[660px] text-lg leading-relaxed text-text-faint">
              Spondon connects patients with the nearest eligible blood donor
              using spatial matching, biological compatibility, and real-time
              emergency pings — eliminating the chaos of social media broadcasts
              during Dengue season.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/register"
                className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
              >
                Create Account
              </Link>
              <Link
                to="/login"
                className="rounded-full border border-line bg-card px-6 py-3 text-sm font-medium text-text-muted transition-colors hover:text-white"
              >
                Sign In
              </Link>
              <Link
                to="/register/patient"
                className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-6 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                <img src={emergencyBolt} alt="" className="size-3.5" />
                Emergency Request
              </Link>
            </div>
          </section>

          {/* Stats */}
          <section className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-line bg-card px-5 py-5"
              >
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="mt-1 text-xs text-text-faint">{s.label}</div>
              </div>
            ))}
          </section>

          {/* Roles */}
          <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {roles.map((r) => {
              const a = accentStyles[r.accent]
              return (
                <div
                  key={r.title}
                  className={`flex flex-col rounded-xl border bg-card p-6 ${a.card}`}
                >
                  <span
                    className={`grid size-10 place-items-center rounded-[10px] ${a.iconWrap}`}
                  >
                    <img src={r.icon} alt="" className="size-5" />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-white">
                    {r.title}
                  </h3>
                  <p className="mt-2 flex-1 text-xs leading-relaxed text-text-faint">
                    {r.body}
                  </p>
                  <Link
                    to={r.to}
                    className={`mt-4 inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold ${a.cta} transition-colors hover:brightness-125`}
                  >
                    {r.cta}
                  </Link>
                </div>
              )
            })}
          </section>

          {/* How registration works */}
          <section className="mt-6 rounded-2xl border border-line bg-card p-8">
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg bg-primary/10">
                <img src={registration} alt="" className="size-4" />
              </span>
              <h2 className="text-base font-bold text-white">
                How Registration Works
              </h2>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step) => (
                <div key={step.n}>
                  <span
                    className={`grid size-7 place-items-center rounded-full border text-xs font-bold ${step.ring} ${step.color}`}
                  >
                    {step.n}
                  </span>
                  <h4 className="mt-4 text-sm font-semibold text-text-strong">
                    {step.title}
                  </h4>
                  <p className="mt-2 text-xs leading-relaxed text-text-faint">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Emergency banner */}
          <section className="mb-24 mt-6 flex flex-col items-start gap-4 rounded-xl border border-primary/40 bg-primary/[0.06] p-6 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/20">
                <img src={emergencyBanner} alt="" className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-primary">
                  Emergency? Don't have an account?
                </p>
                <p className="mt-1 max-w-[851px] text-xs leading-relaxed text-text-faint">
                  Enter your blood request details first — we'll capture them,
                  verify your identity via OTP, then fire the emergency ping
                  automatically. You never re-enter anything.
                </p>
              </div>
            </div>
            <Link
              to="/register/patient"
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
            >
              <img
                src={emergencyBoltSm}
                alt=""
                className="size-3 brightness-0 invert"
              />
              Start Emergency Request
            </Link>
          </section>
        </main>
      </div>
    </div>
  )
}

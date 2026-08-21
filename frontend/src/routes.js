import {
  Home,
  LogIn,
  UserPlus,
  FileText,
  Moon,
  ShieldCheck,
  ClipboardEdit,
  Scale,
  Radio,
  Lock,
  Activity,
  Droplet,
  Siren,
  Trophy,
  Award,
  Navigation,
  PhoneCall,
} from 'lucide-react'

/** Single source of truth for navigation. Route elements live in App.jsx. */
export const routeGroups = [
  {
    label: 'General',
    items: [
      { to: '/', label: 'Home / Landing', icon: Home },
      // Public: donors, patients and visitors all read the same board, so it
      // sits in General rather than under a role.
      { to: '/leaderboard', label: 'View Leaderboard', icon: Trophy },
      { to: '/login', label: 'Login', icon: LogIn },
      { to: '/register', label: 'Register', icon: UserPlus },
    ],
  },
  {
    label: 'Patient / Family',
    color: 'primary',
    items: [
      { to: '/register/patient', label: 'Patient Sign-up', icon: UserPlus },
      { to: '/patient/ocr', label: "Doctor's Slip OCR", icon: FileText },
      { to: '/patient/track', label: 'Live En-Route Tracker', icon: Navigation },
    ],
  },
  {
    label: 'Donor',
    color: 'donor',
    items: [
      { to: '/register/donor', label: 'Donor Sign-up', icon: UserPlus },
      { to: '/donor/sleep', label: 'Sleep Mode Engine', icon: Moon },
      { to: '/donor/eligibility', label: 'Eligibility Cooldown', icon: ShieldCheck },
      { to: '/donor/records', label: 'Update Records', icon: ClipboardEdit },
      { to: '/donor/weight', label: 'Weight Validation', icon: Scale },
      { to: '/donor/en-route', label: 'En-Route Sharing', icon: PhoneCall },
      { to: '/donor/golden', label: 'Golden Donor Status', icon: Award },
    ],
  },
  {
    label: 'Admin / System',
    color: 'admin',
    items: [
      { to: '/admin', label: 'Admin Console (live)', icon: ShieldCheck },
      { to: '/admin/dispatch', label: 'Geo-Ripple Dispatch', icon: Radio },
      { to: '/admin/concurrency', label: 'Concurrency Lock', icon: Lock },
      { to: '/admin/pings', label: 'Ping Activity Log', icon: Activity },
      { to: '/admin/rare-blood', label: 'Rare-Blood Override', icon: Droplet },
      { to: '/admin/escalation', label: 'Escalation Protocol', icon: Siren },
    ],
  },
]

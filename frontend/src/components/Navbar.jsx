import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu } from 'lucide-react'
import logo from '../assets/icons/logo.svg'
import SiteMenu from './SiteMenu.jsx'

const pill =
  'inline-flex items-center rounded-full border border-line bg-card px-4 py-1.5 text-xs text-text-muted transition-colors hover:text-white'

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-ink/95 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-[1256px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="grid size-9 place-items-center rounded-lg border border-line text-text-muted transition-colors hover:text-white"
              aria-label="Open menu"
            >
              <Menu className="size-4" />
            </button>
            <Link to="/" className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg bg-primary">
                <img src={logo} alt="" className="size-[18px]" />
              </span>
              <span className="text-xl font-bold tracking-tight text-white">
                Spondon
              </span>
            </Link>
            <span className="hidden rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-primary sm:inline-flex">
              EMERGENCY DISPATCH
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden items-center gap-2 rounded-full border border-line bg-card px-4 py-1.5 text-xs text-text-muted md:inline-flex">
              <span className="size-2 rounded-full bg-success" />
              Live Dispatch Active
            </span>
            <NavLink to="/login" className={pill}>
              Sign In
            </NavLink>
            <NavLink
              to="/register"
              className="inline-flex items-center rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
            >
              Register
            </NavLink>
          </div>
        </nav>
      </header>
      <SiteMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  )
}

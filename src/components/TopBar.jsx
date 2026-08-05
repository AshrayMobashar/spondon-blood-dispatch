import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import logo from '../assets/icons/logo.svg'
import { accents } from './accents.js'
import SiteMenu from './SiteMenu.jsx'

/** Reusable top navigation bar.
 *  panel       – small badge label next to the logo (e.g. "DONOR PANEL")
 *  panelColor  – accent key for the badge
 *  right       – React node rendered on the right (chips / actions)
 */
export default function TopBar({ panel, panelColor = 'primary', right }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const a = accents[panelColor]

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1256px] items-center justify-between gap-4 px-4 sm:px-6">
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
            {panel && (
              <span
                className={`hidden rounded-full border px-3 py-1 text-[11px] font-semibold sm:inline-flex ${a.ring} ${a.text}`}
              >
                {panel}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {right ?? (
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-text-muted">
                <span className="size-2 rounded-full bg-success" />
                Live Dispatch Active
              </span>
            )}
          </div>
        </div>
      </header>

      <SiteMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  )
}

/** Small chip used in TopBar right slots. */
export function Chip({ children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs text-text-muted ${className}`}
    >
      {children}
    </span>
  )
}

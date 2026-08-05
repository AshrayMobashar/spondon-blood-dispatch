import { NavLink } from 'react-router-dom'
import { X } from 'lucide-react'
import { routeGroups } from '../routes.js'
import { accents } from './accents.js'

export default function SiteMenu({ open, onClose }) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-50 bg-black/60 transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />
      {/* Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[300px] max-w-[85vw] overflow-y-auto border-r border-line bg-ink transition-transform ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <span className="text-sm font-bold text-white">Navigate</span>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg border border-line text-text-muted hover:text-white"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="space-y-6 p-5">
          {routeGroups.map((group) => {
            const a = accents[group.color ?? 'primary']
            return (
              <div key={group.label}>
                <p className={`mb-2 text-[10px] font-semibold uppercase tracking-wide ${group.color ? a.text : 'text-text-faint'}`}>
                  {group.label}
                </p>
                <ul className="space-y-1">
                  {group.items.map(({ to, label, icon: Icon }) => (
                    <li key={to}>
                      <NavLink
                        to={to}
                        end={to === '/'}
                        onClick={onClose}
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                            isActive
                              ? 'bg-card text-white'
                              : 'text-text-muted hover:bg-card hover:text-white'
                          }`
                        }
                      >
                        <Icon className="size-4 shrink-0" />
                        {label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </nav>
      </aside>
    </>
  )
}

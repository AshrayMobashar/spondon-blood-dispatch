import { NavLink } from 'react-router-dom'
import { X, LogOut } from 'lucide-react'
import { routeGroups } from '../routes.js'
import { accents } from './accents.js'
import { getUser, getAdmin, getUserToken, getToken } from '../lib/api.js'

function getRole() {
  const admin = getAdmin()
  if (admin?.role) return 'admin'
  const adminToken = getToken()
  if (adminToken) return 'admin'

  const user = getUser()
  if (user?.role) return user.role

  const token = getUserToken()
  if (token) {
    try {
      const base64Url = token.split('.')[1]
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
      const jsonPayload = decodeURIComponent(
        window.atob(base64).split('').map(function(c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        }).join('')
      )
      const payload = JSON.parse(jsonPayload)
      if (payload.role) return payload.role
    } catch (e) {
      console.error('Failed to parse JWT', e)
    }
  }
  return 'guest'
}

export default function SiteMenu({ open, onClose }) {
  const role = getRole()

  const filteredGroups = routeGroups.map(group => {
    const items = group.items.filter(item => {
      // Hide auth items when logged in
      if (role !== 'guest' && ['/login', '/register', '/register/patient', '/register/donor'].includes(item.to)) {
        return false
      }
      return true
    })

    if (role === 'donor' && group.label === 'Patient / Family') return null
    if (role === 'patient' && group.label === 'Donor') return null
    if (role !== 'admin' && group.label === 'Admin / System') return null
    if (role === 'admin' && (group.label === 'Donor' || group.label === 'Patient / Family')) return null

    if (items.length === 0) return null

    return { ...group, items }
  }).filter(Boolean)

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
        className={`fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-ink transition-transform ${
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

        <nav className="flex-1 space-y-6 p-5">
          {filteredGroups.map((group) => {
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

        {/* Logout button */}
        <div className="border-t border-line p-5">
          <button
            type="button"
            onClick={() => {
              window.localStorage.removeItem('spondon_user_token')
              window.localStorage.removeItem('spondon_user')
              window.localStorage.removeItem('spondon_admin_token')
              window.localStorage.removeItem('spondon_admin')
              window.location.href = '/login'
            }}
            className="flex w-full items-center gap-3 rounded-lg border border-primary/20 bg-primary/10 px-3 py-2.5 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            <LogOut className="size-4 shrink-0" />
            Log out
          </button>
        </div>
      </aside>
    </>
  )
}

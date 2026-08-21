import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { accents } from './accents.js'

/** A calendar that selects a *month* and nothing else.
 *
 *  No day grid and no year spinner: the leaderboard is scored per calendar
 *  month, so a day is meaningless here, and a year control could be spun
 *  forwards into months that have not happened yet. The picker instead renders
 *  exactly the months the API says it publishes — which is why an upcoming
 *  month is not merely disabled, it is absent.
 *
 *  `months` are the server's window objects: { key, label, short_label, year,
 *  is_current }, oldest first.
 */
export default function MonthPicker({ months, value, onChange, color = 'admin' }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef(null)
  // Accent classes come from the shared map, never from a template string:
  // Tailwind only ships classes it can see written out in the source, so a
  // `text-${color}` would compile to nothing at all.
  const a = accents[color] ?? accents.admin

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e) => {
      if (!wrapper.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = months.find((m) => m.key === value)

  // Newest first: the month someone wants is almost always the recent one, so
  // it should not be at the bottom of the grid.
  const cells = [...months].reverse()

  // Years are shown as quiet dividers rather than as a control — the window
  // straddles two calendar years and a reader still needs to tell them apart.
  let lastYear = null

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex items-center gap-2.5 rounded-full border border-line bg-card px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-white/20"
      >
        <CalendarDays className={`size-4 ${a.text}`} />
        {selected?.label ?? 'Select month'}
        <ChevronDown
          className={`size-3.5 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a month"
          className="glass absolute right-0 z-30 mt-2 w-[300px] rounded-xl border-line p-3 shadow-2xl"
        >
          <p className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
            Published months
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {cells.map((m) => {
              const isSelected = m.key === value
              const showYear = m.year !== lastYear
              lastYear = m.year
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    onChange(m.key)
                    setOpen(false)
                  }}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`rounded-lg border px-2 py-2 text-center transition-colors ${
                    isSelected
                      ? `${a.ring} text-white`
                      : 'border-transparent text-text-muted hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="block text-[13px] font-semibold">{m.short_label}</span>
                  <span
                    className={`block text-[9px] ${
                      showYear || isSelected ? 'text-text-faint' : 'text-transparent'
                    }`}
                  >
                    {m.year}
                  </span>
                  {m.is_current && (
                    <span className={`mt-0.5 block text-[8px] font-bold uppercase ${a.text}`}>
                      Live
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="mt-3 border-t border-line px-1 pt-2 text-[10px] leading-relaxed text-text-faint">
            The last {months.length} months. Upcoming months are not listed — a
            month that has not happened has nothing to rank.
          </p>
        </div>
      )}
    </div>
  )
}

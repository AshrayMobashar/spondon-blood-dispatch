import { useRef, useState } from 'react'
import { accents } from './accents.js'

/* ── Card ────────────────────────────────────────────────────────── */
export function Card({ className = '', children, accent }) {
  const border = accent ? accents[accent].ring.split(' ')[0] : 'border-line'
  return (
    <div className={`rounded-xl border ${border} bg-card ${className}`}>
      {children}
    </div>
  )
}

/* ── Badge / status pill ─────────────────────────────────────────── */
export function Badge({ color = 'primary', dot = true, children, className = '' }) {
  const a = accents[color]
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold ${a.ring} ${a.text} ${className}`}
    >
      {dot && <span className={`size-1.5 rounded-full ${a.dot}`} />}
      {children}
    </span>
  )
}

/* ── Stat card ───────────────────────────────────────────────────── */
export function StatCard({ label, value, sub, color = 'primary', subColor }) {
  const a = accents[color]
  return (
    <Card className="p-5">
      <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-faint">
        <span className={`size-2 rounded-full ${a.dot}`} />
        {label}
      </p>
      <p className="mt-3 text-[28px] font-bold leading-none text-white">{value}</p>
      {sub && <p className={`mt-3 text-[10px] ${subColor ?? a.text}`}>{sub}</p>}
    </Card>
  )
}

/* ── Button ──────────────────────────────────────────────────────── */
export function Button({ variant = 'primary', className = '', as = 'button', ...props }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-primary text-white hover:bg-primary/90',
    ghost: 'border border-line bg-card text-text-muted hover:text-white',
    outline: 'border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20',
    success: 'bg-success text-white hover:brightness-110',
  }
  const Comp = as
  return <Comp className={`${base} ${variants[variant]} px-5 py-2.5 ${className}`} {...props} />
}

/* ── Toggle switch ───────────────────────────────────────────────── */
export function Toggle({ defaultOn = false, color = 'donor', onChange }) {
  const [on, setOn] = useState(defaultOn)
  const bg = accents[color].dot
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        const v = !on
        setOn(v)
        onChange?.(v)
      }}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
        on ? `${bg} border-transparent` : 'border-[#374151] bg-line'
      }`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
          on ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

/* ── Tabs ────────────────────────────────────────────────────────── */
export function Tabs({ tabs, active, onChange, color = 'primary' }) {
  const a = accents[color]
  return (
    <div className="flex overflow-x-auto border-b border-line">
      {tabs.map((t, i) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(i)}
          className={`shrink-0 border-b-2 px-6 py-3 text-xs font-semibold transition-colors ${
            active === i
              ? `${a.text} border-current ${a.soft}`
              : 'border-transparent text-text-faint hover:text-text-muted'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

/* ── Form field ──────────────────────────────────────────────────── */
export function Field({ label, hint, children }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {label}
        </span>
      )}
      {children}
      {hint && <span className="mt-1 block text-[11px] text-text-faint">{hint}</span>}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border border-line bg-[#0d111a] px-4 py-2.5 text-sm text-white placeholder:text-text-faint outline-none transition-colors focus:border-primary/60'

export function Input({ className = '', ...props }) {
  return <input className={`${inputCls} ${className}`} {...props} />
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`${inputCls} ${className}`} {...props}>
      {children}
    </select>
  )
}

/* ── OTP boxes ───────────────────────────────────────────────────── */
export function OtpInput({ length = 6, onComplete, onChange }) {
  const [vals, setVals] = useState(Array(length).fill(''))
  const refs = useRef([])

  const set = (i, v) => {
    if (!/^\d?$/.test(v)) return
    const next = [...vals]
    next[i] = v
    setVals(next)
    onChange?.(next.join(''))
    if (v && i < length - 1) refs.current[i + 1]?.focus()
    if (next.every((d) => d !== '')) onComplete?.(next.join(''))
  }

  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !vals[i] && i > 0) refs.current[i - 1]?.focus()
  }

  return (
    <div className="flex justify-center gap-2">
      {vals.map((v, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={v}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          inputMode="numeric"
          maxLength={1}
          className="size-12 rounded-lg border border-line bg-[#0d111a] text-center text-lg font-bold text-white outline-none focus:border-primary/60"
        />
      ))}
    </div>
  )
}

/* ── Section header (icon + title + subtitle) ────────────────────── */
export function SectionHeader({ icon: Icon, title, subtitle, color = 'primary', size = 'md' }) {
  const a = accents[color]
  const iconBox = size === 'lg' ? 'size-10 rounded-xl' : 'size-8 rounded-lg'
  const titleCls = size === 'lg' ? 'text-2xl' : 'text-base'
  return (
    <div className="flex items-start gap-3">
      {Icon && (
        <span className={`grid ${iconBox} shrink-0 place-items-center ${a.soft}`}>
          <Icon className={`${size === 'lg' ? 'size-5' : 'size-4'} ${a.text}`} />
        </span>
      )}
      <div>
        <h1 className={`${titleCls} font-bold tracking-tight text-white`}>{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-text-faint">{subtitle}</p>}
      </div>
    </div>
  )
}

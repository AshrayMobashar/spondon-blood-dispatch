import { Award, ShieldCheck, PauseCircle, Lock } from 'lucide-react'

/** The verified Golden Donor badge, in the three states it can be in.
 *
 *  The distinction the whole feature turns on is visual here too: a suspended
 *  holder still shows a gold badge, because they still earned it — only the
 *  "ICU priority" line beneath it goes quiet. Greying out the badge itself
 *  would tell a donor who moved to Chittagong that their three donations had
 *  been taken back, which is not what happened.
 */
export function GoldenBadge({ badge, size = 'md', className = '' }) {
  if (!badge) return null
  const { is_golden: isGolden, priority_active: active } = badge

  const pad = size === 'lg' ? 'px-4 py-2 text-xs' : 'px-3 py-1 text-[10px]'
  const icon = size === 'lg' ? 'size-4' : 'size-3.5'

  if (!isGolden) {
    return (
      <span
        className={`inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] font-semibold text-text-faint ${pad} ${className}`}
      >
        <Lock className={icon} /> Not yet a Golden Donor
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border font-semibold ${pad} ${className} ${
        active
          ? 'border-warning/40 bg-gradient-to-r from-warning/20 to-amber-500/10 text-warning shadow-[0_0_20px_-6px] shadow-warning/50'
          : 'border-warning/25 bg-warning/[0.07] text-warning/70'
      }`}
    >
      <Award className={`${icon} ${active ? 'fill-warning/30' : ''}`} />
      Golden Donor
      {active ? (
        <ShieldCheck className={`${icon} shrink-0`} />
      ) : (
        <PauseCircle className={`${icon} shrink-0 opacity-70`} />
      )}
    </span>
  )
}

/** The large seal for a profile banner — badge plus what it currently buys. */
export function GoldenSeal({ badge, className = '' }) {
  if (!badge?.is_golden) return null
  const active = badge.priority_active
  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div
        className={`relative grid size-16 place-items-center rounded-full border-2 ${
          active
            ? 'border-warning/60 bg-gradient-to-br from-warning/30 to-amber-600/10 shadow-[0_0_30px_-8px] shadow-warning/70'
            : 'border-warning/25 bg-warning/[0.06]'
        }`}
      >
        <Award className={`size-8 ${active ? 'text-warning' : 'text-warning/50'}`} />
      </div>
      <p
        className={`text-[10px] font-semibold uppercase tracking-wider ${
          active ? 'text-warning' : 'text-warning/60'
        }`}
      >
        {active ? 'ICU Priority Active' : 'Priority Paused'}
      </p>
    </div>
  )
}

export default GoldenBadge

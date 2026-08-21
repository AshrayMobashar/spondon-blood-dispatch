import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Trophy, Loader2, TriangleAlert, Timer, Users, Droplet, Zap,
  ChevronUp, ChevronDown, Minus, Sparkles, Scale,
} from 'lucide-react'
import Shell from '../../components/Shell.jsx'
import MonthPicker from '../../components/MonthPicker.jsx'
import { Card, StatCard } from '../../components/ui.jsx'
import { Chip } from '../../components/TopBar.jsx'
import { leaderboardApi } from '../../lib/api.js'

/** Medal colours for the podium. Below third it is just a rank number. */
const MEDALS = [
  { ring: 'border-warning/40 bg-warning/10', text: 'text-warning', label: 'Gold' },
  { ring: 'border-white/20 bg-white/5', text: 'text-text-strong', label: 'Silver' },
  { ring: 'border-primary/40 bg-primary/10', text: 'text-primary', label: 'Bronze' },
]

/** How often the live month refreshes itself. A settled month never changes,
 *  so it is fetched once and left alone. */
const LIVE_REFRESH_MS = 30_000

export default function VarsityLeaderboard() {
  // The month lives in the URL, not in component state, so a standing is
  // shareable — a campus can link to the month it won rather than telling
  // people which one to click. Back and forward move between months for free.
  const [params, setParams] = useSearchParams()
  const monthParam = params.get('month')          // null = the month in progress

  const [months, setMonths] = useState([])
  const [current, setCurrent] = useState(null)
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // The window comes from the server, so the month picker can never offer a
  // month the API would refuse.
  useEffect(() => {
    leaderboardApi
      .months()
      .then((res) => {
        setMonths(res.months)
        setCurrent(res.current)
      })
      .catch((err) => setError(err.message))
  }, [])

  const load = useCallback(
    async (key, { quiet = false } = {}) => {
      if (!quiet) setLoading(true)
      try {
        // A bare `/leaderboard` sends no month and the API answers with the one
        // in progress, so the URL stays honest as time passes: the same link
        // means "now", not "August 2026 forever".
        const data = await leaderboardApi.board(key)
        setBoard(data)
        setError(null)
      } catch (err) {
        // A month outside the published window (a stale shared link, a typo)
        // fails here. The picker stays on screen above this, so the reader can
        // pick a real month instead of hitting a dead end.
        setError(err.message)
        if (!quiet) setBoard(null)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    load(monthParam)
  }, [monthParam, load])

  /** Write the chosen month into the URL; the effect above does the fetching. */
  const chooseMonth = useCallback(
    (key) => {
      const next = new URLSearchParams(params)
      // `/leaderboard` with no parameter is the canonical live board, so
      // choosing the current month cleans the parameter off rather than
      // freezing today's date into a bookmark.
      if (key === current) next.delete('month')
      else next.set('month', key)
      setParams(next)                      // pushes, so Back returns to the previous month
    },
    [params, current, setParams],
  )

  // Only the month in progress can gain a fulfilment while you are looking at
  // it; polling a closed month would be pure noise.
  useEffect(() => {
    if (!board?.is_current_month) return
    const timer = setInterval(() => load(monthParam, { quiet: true }), LIVE_REFRESH_MS)
    return () => clearInterval(timer)
  }, [board?.is_current_month, monthParam, load])

  const entries = board?.entries ?? []
  const scored = entries.filter((e) => e.fulfilled > 0)
  const unscored = entries.filter((e) => e.fulfilled === 0)
  const leader = scored[0]
  const topScore = leader?.fulfilled ?? 0

  return (
    <Shell
      panel="LEADERBOARD"
      panelColor="admin"
      right={
        <Chip>
          <span className="size-2 rounded-full bg-success" />
          {board?.is_current_month ? 'Live this month' : 'Final standings'}
        </Chip>
      }
    >
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-admin/10">
            <Trophy className="size-5 text-admin" />
          </span>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">
              Varsity Node Leaderboard
            </h1>
            <p className="mt-1 text-[13px] text-text-faint">
              Which campus answered the most emergencies — ranked by requests their
              students actually fulfilled.
            </p>
          </div>
        </div>
        {months.length > 0 && (
          <MonthPicker
            months={months}
            // `board.month` is the month the server actually answered with, so a
            // bare URL highlights the live month without the page having to
            // work out today's date for itself.
            value={monthParam ?? board?.month ?? current}
            onChange={chooseMonth}
            color="admin"
          />
        )}
      </div>

      {error && (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-[11px] text-primary">
          <TriangleAlert className="size-3.5 shrink-0" /> {error}
        </p>
      )}

      {loading && !board ? (
        <div className="flex items-center gap-2 py-24 text-sm text-text-muted">
          <Loader2 className="size-4 animate-spin" /> Counting this month&apos;s donations…
        </div>
      ) : board ? (
        <>
          {/* Month banner */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight text-white">{board.label}</h2>
            {board.is_current_month ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[10px] font-semibold text-success">
                <span className="size-1.5 animate-pulse rounded-full bg-success" />
                Month in progress
              </span>
            ) : (
              <span className="rounded-full border border-line bg-card px-3 py-1 text-[10px] font-semibold text-text-muted">
                Closed
              </span>
            )}
            {board.ties.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-admin/30 bg-admin/10 px-3 py-1 text-[10px] font-semibold text-admin">
                <Scale className="size-3" />
                {board.ties.length} tie{board.ties.length > 1 ? 's' : ''} broken on response time
              </span>
            )}
          </div>

          {/* Month totals */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Requests fulfilled"
              value={board.totals.fulfilled}
              sub={`${board.totals.units} units donated`}
              color="primary"
            />
            <StatCard
              label="Campuses scoring"
              value={board.totals.universities_scored}
              sub={`of ${board.totals.universities_listed} registered nodes`}
              color="admin"
            />
            <StatCard
              label="Students who donated"
              value={board.totals.donors}
              sub="counted once per campus"
              color="donor"
            />
            <StatCard
              label="Avg response"
              value={formatSeconds(board.totals.avg_response_seconds)}
              sub="ping → acceptance, all nodes"
              color="success"
            />
          </div>

          {/* Podium */}
          {scored.length > 0 && (
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {scored.slice(0, 3).map((entry, i) => (
                <Podium key={entry.university} entry={entry} place={i} />
              ))}
            </div>
          )}

          {/* Full standings */}
          <Card className="mt-6 p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-white">Full standings</p>
                <p className="text-[11px] text-text-faint">
                  One point per fulfilled request — an accepted request that never
                  reached the hospital scores nothing.
                </p>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-text-faint">
                {board.totals.universities_listed} nodes
              </span>
            </div>

            {scored.length === 0 ? (
              <p className="px-5 py-10 text-center text-[13px] text-text-faint">
                No campus fulfilled a request in {board.label} yet.
              </p>
            ) : (
              <ul>
                {scored.map((entry) => (
                  <Row key={entry.university} entry={entry} topScore={topScore} />
                ))}
              </ul>
            )}

            {unscored.length > 0 && (
              <div className="border-t border-line px-5 py-4">
                <p className="text-[10px] uppercase tracking-wide text-text-faint">
                  No fulfilments in {board.label}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {unscored.map((e) => (
                    <span
                      key={e.university}
                      title={e.university}
                      className="rounded-full border border-line bg-card px-3 py-1 text-[11px] text-text-muted"
                    >
                      {e.short_name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* The corner case, stated in plain language */}
          <Card className="mt-4 p-5" accent="admin">
            <div className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-admin/10">
                <Scale className="size-4 text-admin" />
              </span>
              <div>
                <p className="text-sm font-semibold text-white">How ties are broken</p>
                <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
                  {board.tie_break_rule} Response time is measured from the moment the
                  ping reached a student&apos;s phone to the moment they secured the
                  request — so a campus that answers faster, rather than merely first,
                  takes the higher rank.
                </p>
              </div>
            </div>
          </Card>

          <p className="mt-4 text-center text-[10px] text-text-faint">
            Campus totals only. The board never publishes a donor&apos;s name, number
            or location.
          </p>
        </>
      ) : null}
    </Shell>
  )
}

/* ── Podium card for the top three ───────────────────────────────── */
function Podium({ entry, place }) {
  const medal = MEDALS[place]
  return (
    <div className={`glass rounded-xl ${medal.ring} p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[10px] font-bold uppercase tracking-wide ${medal.text}`}>
            #{entry.rank} · {medal.label}
          </p>
          <p className="mt-1 truncate text-lg font-bold text-white" title={entry.university}>
            {entry.short_name}
          </p>
          <p className="truncate text-[11px] text-text-faint" title={entry.university}>
            {entry.university}
          </p>
        </div>
        <Trophy className={`size-6 shrink-0 ${medal.text}`} />
      </div>

      <div className="mt-4 flex items-end gap-4">
        <div>
          <p className="text-[28px] font-bold leading-none text-white">{entry.fulfilled}</p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-text-faint">fulfilled</p>
        </div>
        <div className="flex-1 space-y-1.5 text-[11px]">
          <p className="flex items-center gap-1.5 text-text-muted">
            <Timer className="size-3.5 text-text-faint" />
            {entry.avg_response_label ?? '—'} avg
          </p>
          <p className="flex items-center gap-1.5 text-text-muted">
            <Users className="size-3.5 text-text-faint" />
            {entry.donors} of {entry.registered_students} students
          </p>
        </div>
      </div>

      {entry.tie_broken && (
        <p className="mt-4 flex items-start gap-1.5 rounded-lg border border-admin/30 bg-admin/10 px-3 py-2 text-[10px] leading-relaxed text-admin">
          <Zap className="mt-px size-3 shrink-0" />
          {entry.tie_break_note}
        </p>
      )}
    </div>
  )
}

/* ── One standings row ───────────────────────────────────────────── */
function Row({ entry, topScore }) {
  const width = topScore ? Math.max(4, (entry.fulfilled / topScore) * 100) : 0
  return (
    <li className="border-b border-line/60 px-5 py-4 last:border-0">
      <div className="flex items-center gap-4">
        <span
          className={`w-7 shrink-0 text-center text-sm font-bold ${
            entry.rank <= 3 ? 'text-warning' : 'text-text-faint'
          }`}
        >
          {entry.rank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-bold text-white">{entry.short_name}</span>
            <span className="truncate text-[11px] text-text-faint">{entry.university}</span>
            {entry.tie_broken && (
              <span className="inline-flex items-center gap-1 rounded-full border border-admin/30 bg-admin/10 px-2 py-0.5 text-[9px] font-semibold text-admin">
                <Scale className="size-2.5" /> tie-break
              </span>
            )}
            {entry.previous_rank === null && (
              <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[9px] font-semibold text-success">
                <Sparkles className="size-2.5" /> new
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-gradient-to-r from-admin to-donor"
              style={{ width: `${width}%` }}
            />
          </div>
        </div>

        <div className="hidden w-24 shrink-0 text-right sm:block">
          <p className="flex items-center justify-end gap-1.5 text-[11px] text-text-muted">
            <Timer className="size-3 text-text-faint" />
            {entry.avg_response_label ?? '—'}
          </p>
          <p className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-text-faint">
            <Users className="size-3" />
            {entry.donors}/{entry.registered_students}
          </p>
        </div>

        <div className="w-16 shrink-0 text-right">
          <p className="flex items-center justify-end gap-1 text-base font-bold text-white">
            <Droplet className="size-3.5 text-primary" />
            {entry.fulfilled}
          </p>
          <Movement value={entry.movement} isNew={entry.previous_rank === null} />
        </div>
      </div>

      {entry.tie_break_note && (
        <p className="ml-11 mt-2 text-[10px] leading-relaxed text-text-faint">
          {entry.tie_break_note}
        </p>
      )}
    </li>
  )
}

/** Rank change against last month. "New" is not a climb from nowhere. */
function Movement({ value, isNew }) {
  if (isNew) {
    return <p className="mt-1 text-[10px] text-text-faint">first month</p>
  }
  if (!value) {
    return (
      <p className="mt-1 flex items-center justify-end gap-0.5 text-[10px] text-text-faint">
        <Minus className="size-3" /> held
      </p>
    )
  }
  const up = value > 0
  return (
    <p
      className={`mt-1 flex items-center justify-end gap-0.5 text-[10px] font-semibold ${
        up ? 'text-success' : 'text-primary'
      }`}
    >
      {up ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
      {Math.abs(value)}
    </p>
  )
}

function formatSeconds(seconds) {
  if (seconds === null || seconds === undefined) return '—'
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  return minutes ? `${minutes}m ${total % 60}s` : `${total}s`
}

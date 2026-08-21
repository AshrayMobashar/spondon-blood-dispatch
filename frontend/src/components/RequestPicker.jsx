/** RequestPicker — "which emergency?", answered from the user's own data.
 *
 *  Both live-channel pages need a request id, and the first version made the
 *  user paste one. That was wrong: a donor who just tapped Accept on their
 *  phone, and a family who just watched their screen say "Donor Secured",
 *  both already know exactly which emergency they mean — they simply have no
 *  reason to know its database id. Asking for one turns a two-tap flow into a
 *  hunt through an admin console, and gets you "Blood request not found" when
 *  the guess is wrong.
 *
 *  So the picker lists the requests this account is actually a party to:
 *  a donor sees the ones they secured, a family the ones they opened. Manual
 *  entry stays as a fallback for a marker or a shared link, but it is no longer
 *  the way in.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Droplet, Hospital, Loader2, Navigation, Search } from 'lucide-react'
import { requestApi } from '../lib/api.js'
import { Badge, Button, Card, Field, Input, SectionHeader } from './ui.jsx'

const STATUS_COLOR = {
  LOCKED: 'success',
  FULFILLED: 'success',
  OPEN: 'warning',
  NO_SHOW: 'primary',
}

export default function RequestPicker({
  role = 'family',
  account,
  onPick,
  title,
  subtitle,
  notice,
}) {
  const [rows, setRows] = useState(null)
  // Open requests this donor is actually allowed to take. Kept separate from
  // `rows` because they are a different offer: one is "resume a journey you
  // already committed to", the other is "commit to a new one".
  const [acceptable, setAcceptable] = useState([])
  // Matching requests the donor cannot yet take — shown so they understand
  // *why*, instead of tapping Accept and getting a bare server error.
  const [locked, setLocked] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    if (!account?.id) return
    try {
      const all = await requestApi.list()
      // The tracker and the call channel only exist once a donor is locked in,
      // so an OPEN request is deliberately not offered as something to track —
      // there is nothing to follow yet and it would just be a dead-end tap.
      setRows(
        all.filter((r) =>
          role === 'donor'
            ? r.secured_donor_id === account.id
            : r.requester_id === account.id && r.status !== 'OPEN',
        ),
      )
      // Blood type is the one filter worth applying client-side: the server
      // will refuse a mismatch anyway, and offering a button that can only
      // fail is worse than not offering it. Eligibility gets the same
      // treatment — a donor who is on cooldown or under the weight
      // threshold should see *why* a request isn't tappable, not discover
      // it only after the server's 403 comes back.
      setAcceptable(
        role === 'donor'
          ? all.filter((r) => r.status === 'OPEN' && r.blood_type === account.blood_type && account.eligible)
          : [],
      )
      setLocked(
        role === 'donor' && !account.eligible
          ? all.filter((r) => r.status === 'OPEN' && r.blood_type === account.blood_type)
          : [],
      )
    } catch (err) {
      setError(err.message)
    }
  }, [account?.id, account?.blood_type, account?.eligible, role])

  useEffect(() => {
    load()
  }, [load])

  const accept = async (id) => {
    setBusy(id)
    setError(null)
    try {
      await requestApi.accept(id, account.id)
      onPick(id)
    } catch (err) {
      // 409 is the concurrency lock doing its job — someone else got there
      // first — and it deserves the polite wording, not a raw error.
      setError(
        err.status === 409
          ? 'Another donor accepted that one first. Pick another.'
          : err.message,
      )
      await load()
    } finally {
      setBusy(null)
    }
  }

  const empty = rows && rows.length === 0

  return (
    <Card className="mx-auto max-w-2xl p-6">
      <SectionHeader
        icon={Navigation}
        color={role === 'donor' ? 'donor' : 'primary'}
        title={title || (role === 'donor' ? 'Share your journey' : 'Track your donor')}
        subtitle={
          subtitle ||
          (role === 'donor'
            ? 'Pick the request you accepted.'
            : 'Pick the emergency you want to follow.')
        }
      />

      {notice && (
        <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          {notice}
        </p>
      )}

      {!rows && !error && (
        <p className="mt-5 flex items-center gap-2 text-[12px] text-text-muted">
          <Loader2 className="size-4 animate-spin" /> Finding your requests…
        </p>
      )}

      {error && <p className="mt-5 text-[12px] text-primary">{error}</p>}

      {empty && (
        <p className="mt-5 text-[12px] leading-relaxed text-text-faint">
          {role === 'donor'
            ? 'You have not secured any requests yet.'
            : 'None of your requests have a donor yet. This page comes alive the moment someone accepts — until then, the dispatch is still searching.'}
        </p>
      )}

      {/* Open requests this donor could take right now. This is what makes the
          page self-serve: without it a donor can only ever arrive here from a
          push notification, which is unhelpful in a demo and fragile in real
          use if the notification is missed. */}
      {role === 'donor' && acceptable.length > 0 && (
        <div className="mt-6">
          <p className="text-[10px] uppercase tracking-wide text-text-faint">
            Open requests matching your {account?.blood_type} — accept to start
          </p>
          <ul className="mt-3 space-y-2">
            {acceptable.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-donor/30 bg-donor/5 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-white">
                    {r.patient_name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-3 text-[11px] text-text-faint">
                    <span className="inline-flex items-center gap-1">
                      <Hospital className="size-3" />
                      {r.hospital}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Droplet className="size-3" />
                      {r.blood_type}
                    </span>
                    {r.severity && <span>{r.severity.replace('_', ' ').toLowerCase()}</span>}
                  </p>
                </div>
                <Button
                  variant="success"
                  onClick={() => accept(r.id)}
                  disabled={busy === r.id}
                  className="shrink-0"
                >
                  {busy === r.id ? 'Accepting…' : 'Accept'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {role === 'donor' && rows && acceptable.length === 0 && locked.length === 0 && (
        <p className="mt-4 text-[11px] leading-relaxed text-text-faint">
          There are no open {account?.blood_type} requests right now. A request only appears
          here if its blood type matches yours — that check is enforced by the server, not
          just hidden in this list.
        </p>
      )}

      {/* Matching requests the donor can't take yet — shown locked, with the
          reason, instead of silently omitted or offered as a button that
          would only fail server-side. */}
      {role === 'donor' && locked.length > 0 && (
        <div className="mt-6">
          <p className="text-[10px] uppercase tracking-wide text-warning">
            Matching your {account?.blood_type} — locked until you're eligible
          </p>
          <ul className="mt-3 space-y-2">
            {locked.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-warning/20 bg-warning/5 px-4 py-3 opacity-70"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-white">
                    {r.patient_name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-3 text-[11px] text-text-faint">
                    <span className="inline-flex items-center gap-1">
                      <Hospital className="size-3" />
                      {r.hospital}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Droplet className="size-3" />
                      {r.blood_type}
                    </span>
                  </p>
                </div>
                <Link
                  to="/donor/eligibility"
                  className="shrink-0 rounded-md border border-warning/30 px-3 py-1.5 text-[11px] font-semibold text-warning hover:bg-warning/10"
                >
                  Why?
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-text-faint">
            You're not currently eligible to donate — check your Eligibility page for the
            cooldown or weight reason, then come back here.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="mt-5 space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r.id)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-ink/40 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-white/5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-white">
                    {r.patient_name}
                  </p>
                  <p className="mt-0.5 flex items-center gap-3 text-[11px] text-text-faint">
                    <span className="inline-flex items-center gap-1">
                      <Hospital className="size-3" />
                      {r.hospital}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Droplet className="size-3" />
                      {r.blood_type}
                    </span>
                  </p>
                  {role === 'family' && r.secured_donor_name && (
                    <p className="mt-0.5 truncate text-[11px] text-success">
                      {r.secured_donor_name} is coming
                    </p>
                  )}
                </div>
                <Badge color={STATUS_COLOR[r.status] || 'primary'}>{r.status}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Fallback for a link or a QR code that carried an id. */}
      <details className="mt-6">
        <summary className="cursor-pointer text-[11px] text-text-faint hover:text-text-muted">
          Or enter a request ID
        </summary>
        <div className="mt-3 flex gap-2">
          <Field label="">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value.trim())}
              placeholder="65f1a2b3c4d5e6f7a8b9c0d1"
            />
          </Field>
          <Button onClick={() => onPick(draft)} disabled={!draft} className="shrink-0 self-end">
            <Search className="size-4" />
            Open
          </Button>
        </div>
      </details>
    </Card>
  )
}

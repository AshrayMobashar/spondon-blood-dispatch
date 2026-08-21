# Spondon Backend — REST APIs (Student 23101184)

FastAPI + Beanie (async MongoDB ODM). **Runs on port `1184`** (last four digits of
student ID 23101184).

## What's implemented

| Requirement | Where |
|---|---|
| Registration, Authentication & Profile (OTP) | `app/routers/auth.py` |
| M1.1 — Eligibility Cooldown & Auto-Pause | `app/eligibility.py`, `app/routers/donor_health.py` |
| M1.2 — Smart Ping: Sleep Mode & Commute Matching | `app/services.py`, `app/routers/smart_ping.py` |
| M1.3 — Rare-Blood City-Wide Override + escalation | `app/dispatch.py` |
| M2.1 — Expanding Geo-Ripple (3/5/10 km) | `app/dispatch.py` |
| M2.2 — Concurrency Lock & Accountability | `app/routers/concurrency.py` |
| M2.3 — Doctor's-Slip OCR verification | `app/routers/concurrency.py`, `app/integrations.py` |
| Admin Role & Access Management (ban / shadow ban) | `app/routers/admin.py` |
| M3.1 — Live En-Route Tracker | `app/tracking.py`, `app/routers/tracking.py` |
| M3.2 — Direct-Connect Masked Calling | `app/masking.py`, `app/routers/calling.py` |

Interactive reference: **`http://localhost:1184/docs`** (generated from the code, so it
never goes stale). Narrative reference with samples → [`API_DOCS.md`](./API_DOCS.md).

## Prerequisites
- Python 3.11+
- MongoDB running at `mongodb://localhost:27017` (change in `.env` if needed)

## Setup & run
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate               # Windows  (source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
cp .env.example .env
python seed_admin.py                 # demo accounts, requests, one pending certificate
python -m app.main
```
Server: `http://localhost:1184` · Swagger UI: `http://localhost:1184/docs`

## Configuration

All rule constants live in `app/config.py` and are overridable from `.env` — cooldown
lengths, the weight threshold, ripple radii, the escalation window, the OTP TTL, and the
timezone. `GET /api/config` serves them to the frontend, so a screen can never display a
threshold the engine does not actually enforce.

### External integrations are optional

Six integrations (SMS, FCM, OpenAI OCR, Google Maps, national blood banks, NGO hotlines)
are each enabled by setting their key in `.env`. With a key absent, the adapter reports
`simulated: true` rather than pretending to have delivered anything, and the platform
still runs end to end. `GET /api/config` lists exactly which are live, and the admin
console shows the same as a status bar.

Two consequences worth knowing when running locally with nothing configured:

- **No SMS gateway** → the OTP comes back in the API response as `dev_code`, and the UI
  displays it with a warning saying why. Set `SMS_API_KEY` and this stops immediately.
- **No OCR engine** → every uploaded slip is routed to the human review queue rather than
  being given an invented confidence score. That is the same path a genuinely illegible
  slip takes, so the corner case is exercised either way.

## Verify from the CLI

```bash
python -m app.main      # terminal 1
python smoke_test.py    # terminal 2
```

`smoke_test.py` is an assertion harness, not a print-everything script: each check names
the requirement it covers and the run exits non-zero if any regress. It currently covers
**43 checks**, including every corner case — the implausible-weight rejection on both the
sign-up and update paths, the certificate-driven early cooldown release, the emergency
breakthrough with a DND-piercing push, the off-segment route ping, the rare-blood
city-wide override, the simultaneous-accept race, ban enforcement, and the shadow ban.

## Project layout
```
backend/
  app/
    main.py            # FastAPI app, CORS, startup, GET /api/config
    config.py          # every tunable rule constant + integration keys
    db.py              # Motor client + Beanie init
    models.py          # Account, BloodRequest, PingLog, Appeal, Admin,
                       #   OtpChallenge, MedicalCertificate, Escalation
    schemas.py         # Pydantic request bodies
    security.py        # bcrypt, JWTs (admin/user/registration-ticket), OTP hashing
    services.py        # helpers, local-time maths, decide_ping() rule engine
    eligibility.py     # the cooldown / weight engine — sole writer of the flag
    dispatch.py        # gates → pool → reach → decision, plus escalation
    integrations.py    # SMS, FCM, OCR, Maps, blood-bank & NGO adapters
    tracking.py        # ETA + signal-freshness maths (pure, no I/O)
    masking.py         # number masking + atomic GSM proxy-number pool
    realtime.py        # public radar feed + private per-trip rooms
    routers/
      auth.py          # OTP, registration, login, captured-request corner case
      donor_health.py  # eligibility, weight, donations, certificates
      smart_ping.py    # sleep mode, commute route, location, dispatch
      concurrency.py   # requests, slip OCR, atomic accept, arrivals, appeals
      admin.py         # console: ripples, slips, moderation, certs, escalations
      tracking.py      # trip start / position / batch replay / arrival
      calling.py       # masked call channel, GSM fallback, teardown
  requirements.txt
  .env.example
  seed_admin.py
  smoke_test.py
  Spondon.postman_collection.json
  API_DOCS.md
```


## Module 3 — the two live channels

Both open automatically the moment a donor wins the concurrency lock, so the
family's screen goes from "searching" to a working dashboard in one step.

### M3.1 — Live En-Route Tracker

`POST /api/requests/{id}/trip/location` from the donor's phone; the family reads
`GET /api/requests/{id}/trip` or watches `ws://…/ws/trip?request_id=…&token=…`.

Three rules govern every value it returns:

* **Last known, never extrapolated.** The icon is drawn where the donor actually
  was. Advancing it along a guessed heading would make the tracker most
  confident exactly when it knows least.
* **A stale ETA is frozen, not aged.** Once the phone goes quiet the ETA holds
  its last value and is flagged. Note that `eta_at` — the absolute arrival
  timestamp a client would count down to — is *withheld* while stale. Sending it
  would let the browser reinvent the live tracking this state exists to deny.
* **Reject before you trust.** A fix implying >160 km/h, or one recorded before
  a fix already stored, is dropped rather than allowed to teleport the icon.

**Corner case — the donor's phone loses its connection.** A background sweep
(`TRIP_SWEEP_SECONDS`) notices silence beyond `TRIP_STALE_AFTER_SECONDS` and
pushes `trip_signal_lost`. This has to be *pushed*: a family sitting on an open
tracker makes no further requests once the socket goes quiet, so read-time
staleness alone would leave a live-looking ETA on screen indefinitely. Only the
transition is announced, so ten minutes out of coverage produces one banner.

The other half of the same case is the reconnect: a phone that buffered fixes in
an underpass flushes them to `/trip/batch`, which orders them by the phone's own
`recorded_at` so the trail is redrawn along the road actually travelled.

### M3.2 — Direct-Connect Masked Calling

`POST /api/requests/{id}/call` opens a channel; `POST /api/calls/{id}/fallback`
moves it to GSM.

Neither party's number appears in the call session, its audit trail, or the
server log — participants are stored as account ids, and real numbers are read
from `Account` at dial time and discarded. A dump of `call_sessions` reveals who
spoke to whom about which emergency and no way to ring either of them.

**Corner case — VOIP fails on a weak in-building signal.** The client measures
its own leg and, after `CALL_DEGRADED_SECONDS` below the quality floor, calls
`/fallback`. The **same session** switches to a borrowed number from the pool —
same id, same participants, same audit trail, so it is one conversation that
changed transport rather than a new call. Both parties dial that number; the
bridge routes by who is calling.

Two details that matter:

* The pool is a Mongo collection, claimed with a conditional
  `find_one_and_update` — the same primitive as the donor lock. Two calls
  degrading in the same second must not be handed the same number, or each
  family reaches the other's donor.
* Both clients detect the same bad network and both call `/fallback`. The second
  is a no-op returning the existing number; otherwise the pool drains at two
  numbers per call and the pair ends up on different lines.

Numbers are returned to the pool on hang-up, on arrival, and on TTL expiry.

### Not yet real

The GSM leg is simulated unless `VOICE_BRIDGE_URL` is set — the number is
allocated and reserved, but no call is placed, and the API says
`"bridge": "simulated"` rather than implying otherwise. The frontend's VOIP
quality meter is likewise a stand-in for `RTCPeerConnection.getStats()`, which
needs a peer connection and a TURN server this build does not have. Everything
else — sessions, authorisation, masking, allocation, fallback — is real.

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
python seed_leaderboard.py           # universities + 13 months of leaderboard history
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
    models.py          # Account, BloodRequest, PingLog, Appeal, Admin, University,
                       #   OtpChallenge, MedicalCertificate, Escalation
    schemas.py         # Pydantic request bodies
    security.py        # bcrypt, JWTs (admin/user/registration-ticket), OTP hashing
    services.py        # helpers, local-time maths, decide_ping() rule engine
    eligibility.py     # the cooldown / weight engine — sole writer of the flag
    dispatch.py        # gates → pool → reach → decision, plus escalation
    integrations.py    # SMS, FCM, OCR, Maps, blood-bank & NGO adapters
    leaderboard.py     # varsity month windows, scoring aggregation, tie-break
    routers/
      auth.py          # OTP, registration, login, captured-request corner case
      donor_health.py  # eligibility, weight, donations, certificates
      smart_ping.py    # sleep mode, commute route, location, dispatch
      concurrency.py   # requests, slip OCR, atomic accept, arrivals, appeals
      leaderboard.py   # public monthly varsity ranking + month window
      admin.py         # console: ripples, slips, moderation, certs, escalations
  requirements.txt
  .env.example
  seed_admin.py
  seed_leaderboard.py
  smoke_test.py
  Spondon.postman_collection.json
  API_DOCS.md
```

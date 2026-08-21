# Spondon — Emergency Blood Dispatch

An algorithm-driven emergency blood-dispatch platform for Bangladesh (CSE471 project).
Spondon connects patients with the nearest eligible donor using spatial matching,
biological compatibility, and real-time emergency pings — replacing the chaos of
social-media blood appeals during Dengue season.

## Repository structure

```
spondon-blood-dispatch/
├── frontend/        React + Vite + Tailwind CSS v4 single-page app
│   ├── src/         pages, components, API client (src/lib/api.js)
│   └── ...
└── backend/         FastAPI + Beanie (MongoDB ODM) REST API
    ├── app/         models, routers, engines, integrations, security (JWT)
    ├── seed_admin.py
    ├── seed_leaderboard.py
    ├── smoke_test.py
    └── postman/     Postman collection for the API
```

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite, Tailwind CSS v4, react-router-dom, lucide-react |
| Backend | FastAPI, Beanie (async MongoDB ODM), MongoDB, PyJWT + bcrypt |

## Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.11+
- **MongoDB** running locally on `mongodb://localhost:27017`

---

## Backend setup

```bash
cd backend

# 1. Create & activate a virtual environment
python -m venv .venv
# Windows:
.venv/Scripts/activate
# macOS / Linux:
# source .venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env          # then edit if needed

# 4. Seed demo data (admin account + sample donors & requests)
python seed_admin.py
python seed_leaderboard.py    # varsity nodes + 13 months of leaderboard history

# 5. Run the API (port 1184)
python -m app.main
```

The API serves on **http://localhost:1184**; interactive docs at **http://localhost:1184/docs**.

Key `.env` settings (see `backend/.env.example` for the full list):

| Key | Default | Purpose |
|-----|---------|---------|
| `PORT` | `1184` | API port |
| `MONGODB_URI` | `mongodb://localhost:27017` | Mongo connection |
| `DB_NAME` | `spondon` | Database name |
| `APP_TIMEZONE` | `Asia/Dhaka` | Sleep-Mode windows are wall-clock local times |
| `JWT_SECRET` | dev fallback | Token signing key — **set a long random value in production** |
| `CORS_ORIGINS` | `http://localhost:5173` | Browser origins allowed to call the API |
| `WHOLE_BLOOD_COOLDOWN_DAYS` | `120` | Eligibility lock after whole blood |
| `PLATELET_COOLDOWN_DAYS` | `14` | Eligibility lock after apheresis |
| `MIN_DONOR_WEIGHT_KG` | `50` | Medical-risk weight threshold |
| `RARE_ESCALATION_SECONDS` | `180` | Unanswered rare-blood ping → external sourcing (lower it for a demo) |
| `ESCALATION_SWEEP_SECONDS` | `20` | How often the server sweeps for those dead ends |
| `RARE_SMS_ALERTS` | `true` | Send SMS alongside the push on a city-wide rare ping |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | — | Twilio SMS; used ahead of the local gateway when set |

Verify the whole thing with `python smoke_test.py` against a running server — 55
assertions, one per requirement and corner case, including a live WebSocket subscriber that
checks the radar feed leaks no donor identity or coordinate.

## Frontend setup

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Other scripts: `npm run build` (production build), `npm run preview`, `npm run lint`.

The frontend talks to the backend at `http://localhost:1184` by default. To point at a
different backend, set `VITE_API_URL` (e.g. create `frontend/.env` with
`VITE_API_URL=http://localhost:1184`).

---

## Signing in

**End users** (donors and patients) have no password. Identity is a Bangladeshi phone
number proven by an SMS one-time code, so registration and login both go through OTP.
Seeded demo numbers are `01711000001` … `01711000008`.

> With no SMS gateway configured, the API returns the code in its response and the UI
> shows it with a warning explaining why. Set `SMS_API_KEY` in `.env` and that stops.

**Admin console** — a dedicated, secure panel backed by the live database with JWT auth.

- **URL:** http://localhost:5173/admin (redirects to `/admin/login` when signed out)
- **Demo login:** `admin@spondon.com` / `spondon123`

Capabilities:

- **Review every emergency ripple** across the city (live from MongoDB)
- **Override OCR slip verification** the engine could not confirm (verify / reject)
- **Ban accounts** that abuse the system — enforced in dispatch *and* on accept
- **Shadow ban** — a flagged account keeps submitting requests that still appear
  active on its own screen, but those requests are silently never broadcast to donors
- **Review medical certificates** that appeal an over-long cooldown, releasing it early
- **Track rare-blood escalations** handed to national blood banks and NGO hotlines

> The demo credentials and dev `JWT_SECRET` are for local use only — replace them
> before deploying anywhere real.

---

## Features

**Registration, Authentication & Profile** — phone-number identity verified by a
server-generated, hashed, single-use OTP. Donors complete a health-profiling step;
patients go straight to a fast-track request dashboard. A logged-out family can start
typing an emergency and have it fire automatically the moment they verify, without
re-entering the hospital or blood details.

**Eligibility Cooldown & Auto-Pause** — one live flag per donor, recalculated after every
donation, on every login, and on read. Whole blood locks it for 120 days, platelets for
14. Weight below 50 kg locks it independently. An implausible entry (5 kg for 50) is
rejected outright and the last valid weight is kept. A donor locked out by a mistyped
date can upload a timestamped certificate for an admin to clear.

**Smart Ping** — sleep-mode suppression evaluated in *local* time, with a
life-threatening-only override that raises a high-priority push flagged to pierce the
phone's own Do Not Disturb. A saved commute route is an upgrade, never a filter: on your
segment you get a proactive ping — even from outside the current ripple radius, since
being on the road already means zero extra travel — and off it you still get the standard
one. Matching can be paused without discarding the route.

**Expanding Geo-Ripple** — 3 km, widening to 5 km at ten minutes and 10 km at twenty,
measured by real driving distance when a Maps key is configured so a river between two
points counts properly.

**Rare-Blood City-Wide Override** — triage routes a negative type to the city-wide service
instead of the ripple, reaching every eligible donor of that type at once by push *and* SMS
(a rare type may have only a handful of matching donors, so one stale FCM token is a donor
lost). The broadcast streams to the family's **City-Wide Radar** over a WebSocket at
`/ws/dispatch?request_id=…` — one `donor_pinged` event per donor reached, so the map lights
up as it happens rather than after the fact. If nobody accepts within the timer, a
server-side sweep fires webhooks to national blood-bank APIs and partner NGO hotlines rather
than dead-ending; no client has to be watching.

> **Privacy.** The radar never receives a donor's identity or coordinates. Every position is
> generalised server-side to one of the published city zones (`GET /api/zones`) before it is
> broadcast, and the public donor roster carries no phone number or location either. A donor
> volunteering to give blood should not have their home address rendered on a stranger's map.

**Doctor's-Slip OCR** — no dispatch reaches a donor until the requisition slip is
confirmed. An unreadable slip is never auto-rejected; it goes to a human queue.

**Concurrency Lock & Accountability** — the first donor to accept atomically locks a
request (`find_one_and_update` compare-and-swap); no-show tracking and appeals.

**Admin Role & Access Management** — the console described above.

### Google Maps

Two independent uses, each with its own key setting:

| Where | Key | Used for | Needs |
|---|---|---|---|
| Backend | `GOOGLE_MAPS_API_KEY` in `backend/.env` | Real driving distance for the geo-ripple, so a river between two points counts | **Routes API** + billing |
| Frontend | `VITE_GOOGLE_MAPS_API_KEY` in `frontend/.env` | The City-Wide Radar's map | **Maps JavaScript API** + billing |

The backend tries the Routes API first and falls back to the legacy Distance Matrix, since a
project is usually entitled to one or the other. If both are refused it falls back to
great-circle distance and `GET /api/config` reports `maps: false` with the reason — a key
that is present but rejected shows as **"key rejected"** in the admin console rather than
masquerading as a live integration. The radar does the same: if Google refuses the browser
key, it falls back to a schematic radar rather than leaving a blank grey box.

> A Maps JS key is visible in page source by definition. Restrict it by HTTP referrer in the
> Google Cloud console — that restriction, not secrecy, is what protects it.

### External integrations

Six integrations are optional and each is enabled by setting its key in `.env`: SMS
(OTP), Firebase Cloud Messaging (pings), OpenAI (slip OCR), Google Maps (driving
distance), and national blood-bank / NGO endpoints (escalation). When a key is absent
the adapter reports itself as simulated instead of claiming a delivery that never
happened. `GET /api/config` lists which are live, and the admin console shows the same
as a status bar — so a demo is never mistaken for a live integration.

## License

Coursework project — not licensed for production use.

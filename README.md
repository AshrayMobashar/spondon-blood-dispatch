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
    ├── app/         models, routers, security (JWT), services
    ├── seed_admin.py
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

# 5. Run the API (port 1184)
python -m app.main
```

The API serves on **http://localhost:1184**; interactive docs at **http://localhost:1184/docs**.

`.env` keys (see `backend/.env.example`):

| Key | Default | Purpose |
|-----|---------|---------|
| `PORT` | `1184` | API port |
| `MONGODB_URI` | `mongodb://localhost:27017` | Mongo connection |
| `DB_NAME` | `spondon` | Database name |
| `JWT_SECRET` | dev fallback | Admin token signing key — **set a long random value in production** |
| `ADMIN_TOKEN_TTL_HOURS` | `12` | Admin session length |

---

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

## Admin console

A dedicated, secure admin panel — the "administration body" — backed by the live
database with JWT authentication.

- **URL:** http://localhost:5173/admin (redirects to `/admin/login` when signed out)
- **Demo login:** `admin@spondon.com` / `spondon123`

Capabilities:

- **Review every emergency ripple** across the city (live from MongoDB)
- **Override OCR slip verification** the engine could not confirm (verify / reject)
- **Ban accounts** that abuse the system
- **Shadow ban** — a flagged account keeps submitting requests that still appear
  active on its own screen, but those requests are silently never broadcast to donors

> The demo credentials and dev `JWT_SECRET` are for local use only — replace them
> before deploying anywhere real.

---

## Features

- **Smart Ping** — sleep-mode ping suppression (11pm–7am) with emergency override, and
  commute-aware matching that pings donors travelling a road segment near a request.
- **Concurrency Lock & Accountability** — the first donor to accept atomically locks a
  request (`find_one_and_update` compare-and-swap); no-show tracking and appeals.
- **Admin Role & Access Management** — the admin console described above.

## License

Coursework project — not licensed for production use.

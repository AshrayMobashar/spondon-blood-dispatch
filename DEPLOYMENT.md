# Deploying Spondon

The live deployment is one Vercel project serving both halves from one origin,
against MongoDB Atlas.

```
Vercel project  ->  frontend  (Vite SPA, static)
                ->  backend   (FastAPI, Python function)
MongoDB Atlas   ->  database
```

`vercel.json` at the repo root is what makes that one project rather than two:
it declares a `frontend` and a `backend` service and routes between them.

| Path | Goes to |
|---|---|
| `/api/*` | backend |
| `/ws/*` | backend — the dispatch, trip and call sockets |
| `/docs`, `/redoc`, `/openapi.json` | backend — the interactive API docs |
| everything else | frontend |

The order matters: the last rule is a catch-all, so anything the backend owns
has to be listed above it. `/ws/*` in particular was missing at first, which
left the radar and tracker sockets being answered by the SPA's `index.html`.

One origin also means **CORS never comes into play** — the browser is calling
the same host it loaded the page from. `CORS_ORIGINS` only matters if you split
the two halves across hosts.

---

## What serverless changes, stated plainly

Two claims in the feature docs stop being true on Vercel. Both are visible in
`GET /api/health` under `sweeps`, so you never have to guess which mode a
deployment is in.

**The timed sweeps are driven by requests, not by a clock.** `escalation_watcher`,
`trip_watcher` and `bounty_watcher` are `while True` loops; a suspended instance
does not reliably wake to run them. `app/serverless.py` runs the same four
sweeps off incoming requests instead, each still honouring its own interval.

This degrades rather than breaks, and only because no deadline in this codebase
lives in an in-process timer — `expires_at` on a bounty, `escalation_due` on a
rare request and the last-ping time on a trip are all facts in the database,
compared against the clock at sweep time. A sweep that happens late still
reaches the right verdict. **But with nobody using the app, nothing sweeps at
all**: a donor owed a ride code at 14:03 gets it when the next request arrives.

The sweep is awaited inside the request, which is not an accident. Scheduling it
with `asyncio.create_task` so the caller would not wait does not work here — the
instance freezes once the response is written and the task is never resumed.

**WebSockets reconnect on the function's duration limit.** They do work: Vercel
supports them on Python functions. But a function has a maximum duration (60 s
on Hobby), so a held-open socket is cut at that ceiling. `realtime.js`,
`trip.js` and `voice.js` all reconnect with exponential backoff, so the radar
and tracker recover on their own — with a blip at each cycle.

If either of those matters more than the convenience of one host, `render.yaml`
still describes the always-on deployment, where both behave as the docs say.

---

## 1. MongoDB Atlas

1. Create a free **M0** cluster at <https://www.mongodb.com/atlas>.
2. **Database Access** -> add a user with a password. Copy both.
3. **Network Access** -> add `0.0.0.0/0`. Vercel functions have no fixed egress
   IP, so an allowlist cannot be narrowed here. This is the weakest link in the
   setup: the cluster is reachable from anywhere that has the password. Use a
   long generated password, and never commit the URI.
4. Copy the SRV connection string:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/spondon?retryWrites=true&w=majority`

> The API never echoes this string back. `db.safe_uri()` strips the password
> before it reaches `/api/health` or a 503 hint, both of which are public and
> unauthenticated. If you add another place that reports the URI, route it
> through `safe_uri()` too.

Seed the database once, from a machine with the URI in its environment:

```bash
cd backend
MONGODB_URI='mongodb+srv://...' python seed_admin.py
MONGODB_URI='mongodb+srv://...' python seed_leaderboard.py
MONGODB_URI='mongodb+srv://...' python seed_golden.py
MONGODB_URI='mongodb+srv://...' python seed_bounty.py
```

There is no shell on Vercel to run these from, which is why they run locally
against the remote cluster rather than on the host.

## 2. The Vercel project

1. **Add New -> Project**, import this repo. Leave **Root Directory** at the
   repo root — the root `vercel.json` builds both services from there. Setting
   it to `frontend` or `backend` gets you one half and a 404 for the other.
2. Set two environment variables:

   | Key | Value |
   |---|---|
   | `MONGODB_URI` | the Atlas SRV string from step 1 |
   | `VITE_API_URL` | the deployment's own origin, e.g. `https://spondon.vercel.app` |

3. Redeploy after setting them.

### `VITE_API_URL` is the origin, not a path

Vite inlines this at **build** time, so changing it needs a redeploy, not a
restart — and the value must be the full origin with scheme.

The client composes requests as `` `${BASE}/api${path}` `` and derives the
socket URL as `BASE.replace(/^http/, 'ws')`. Setting it to `/api` therefore
produces `/api/api/health` — every call 404s while the site still loads and
looks healthy — and leaves the socket URL with no scheme to rewrite. Setting it
to the origin produces `https://host/api/health` and `wss://host/ws/dispatch`.

Because it is the deployment's own origin, these are same-origin requests
despite being absolute.

## 3. Python runtime notes

`backend/app/main.py` is a supported FastAPI entrypoint, so no wrapper module is
needed; `vercel.json` names it explicitly under the `backend` service.
`.python-version` pins 3.12 and `backend/.vercelignore` keeps the local `.venv`
and the ad-hoc `test_*.py` / `check_*.py` probes out of the upload.

The database connection is opened **awaited** on a serverless host rather than
retried in the background. The background retry is right for an always-on
server — it boots immediately and says the database is down — but a cold
function is handed a request the moment lifespan returns, so the readiness guard
would reject it while Beanie was still binding. That failure is confusing on
sight, because `/api/health` pings the client directly and reports the database
as fine at the same moment every data route returns 503.

---

## Environment variables

| Where | Key | Value |
|---|---|---|
| Vercel | `MONGODB_URI` | Atlas SRV string (secret) |
| Vercel | `VITE_API_URL` | the deployment's own origin |
| Vercel | `GOOGLE_MAPS_API_KEY` | optional — Routes API, for driving distance |
| Vercel | `VITE_GOOGLE_MAPS_API_KEY` | optional — Maps JavaScript API, for the radar map |
| Vercel | `CORS_ORIGINS` | only needed if the frontend is served from another host |

The two Maps keys are independent and separately optional — each unset key
degrades one feature to its fallback rather than breaking it. `VITE_GOOGLE_MAPS_API_KEY`
ships in the bundle by definition; restrict it by HTTP referrer in the Google
Cloud console. Everything else has a working default; the full lists with
explanations are in `backend/.env.example` and `frontend/.env.example`.

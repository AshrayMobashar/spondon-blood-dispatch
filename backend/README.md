# Spondon Backend — REST APIs (Student 23101184)

FastAPI + Beanie (async MongoDB ODM) backend for two Spondon features.
**Runs on port `1184`** (last four digits of student ID 23101184).

## Features & endpoints
- **Feature 1 — Smart Ping: Sleep Mode & Commute-Aware Matching** (`app/routers/smart_ping.py`)
- **Feature 2 — Concurrency Lock & Flake-Out Accountability** (`app/routers/concurrency.py`)

Full API reference with code snippets & sample responses → [`API_DOCS.md`](./API_DOCS.md).

## Prerequisites
- Python 3.11+
- MongoDB running at `mongodb://localhost:27017` (change in `.env` if needed)

## Setup & run
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate               # Windows  (source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
python -m app.main
```
Server: `http://localhost:1184` · Swagger UI: `http://localhost:1184/docs`

## Test in Postman
1. Import **`Spondon.postman_collection.json`**.
2. Run the requests top-to-bottom — "Create donor" / "Create request" calls auto-save the
   returned `id` into collection variables (`donor_id`, `request_id`, …) used by later
   requests, so the whole collection is runnable without copy-pasting IDs.
3. The collection variable `baseUrl` defaults to `http://localhost:1184`.

## Verify from the CLI
`python smoke_test.py` exercises every endpoint against the running server and prints
each request/response, including both corner cases (emergency breakthrough with FCM
DND-bypass, and a simultaneous-accept race that yields exactly one winner + one 409).

## Project layout
```
backend/
  app/
    main.py            # FastAPI app, CORS, startup, uvicorn on 1184
    db.py              # Motor client + Beanie init
    models.py          # Beanie documents: Donor, BloodRequest, PingLog, Appeal
    schemas.py         # Pydantic request bodies
    services.py        # id/serialize helpers + decide_ping() rule engine
    routers/
      smart_ping.py    # Feature 1
      concurrency.py   # Feature 2
  requirements.txt
  .env                 # PORT=1184, MONGODB_URI, DB_NAME
  smoke_test.py
  Spondon.postman_collection.json
  API_DOCS.md
```

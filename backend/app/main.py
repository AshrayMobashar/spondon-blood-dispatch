"""Spondon backend — FastAPI + Beanie (async MongoDB ODM).

Run:  python -m app.main      (serves on port 1184 = last 4 digits of ID 23101184)
Docs: http://localhost:1184/docs
"""
import os
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routers import smart_ping, concurrency, admin, eligibility_router

load_dotenv()
PORT = int(os.getenv("PORT", "1184"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="Spondon API",
    version="1.0.0",
    description="Emergency blood-dispatch APIs — Feature 1 (Smart Ping) & Feature 2 (Concurrency & Accountability).",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(smart_ping.router, prefix="/api", tags=["Feature 1 — Smart Ping"])
app.include_router(concurrency.router, prefix="/api", tags=["Feature 2 — Concurrency & Accountability"])
app.include_router(eligibility_router.router, prefix="/api", tags=["Feature 3 — Eligibility Cooldown & Auto-Pause"])
app.include_router(admin.router, prefix="/api", tags=["Admin — Role & Access Management"])


@app.get("/", tags=["meta"])
async def root():
    return {"service": "Spondon API", "port": PORT, "docs": "/docs"}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, reload=False)

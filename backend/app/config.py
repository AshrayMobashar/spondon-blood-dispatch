"""Central configuration — every tunable rule constant and integration key.

Two reasons this module exists:

1.  The dispatch rules (sleep window, cooldown lengths, ripple radii, escalation
    threshold) were previously scattered as magic numbers across routers and
    hard-coded strings in the UI, which let the two drift apart. They now live
    here and are served to the frontend via `GET /api/config`, so a page can
    never display a threshold the engine does not actually use.

2.  Every external integration (SMS, FCM, OCR, Maps, blood banks) is optional.
    Each adapter reports whether it is really configured, so the API can be
    honest about what is a live call and what is a local simulation.
"""
import logging
import os
from datetime import timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("spondon.config")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


# ── Server ───────────────────────────────────────────────────────────
PORT = _int("PORT", 1184)

# ── Time ─────────────────────────────────────────────────────────────
# Sleep Mode windows are wall-clock times a donor set on their phone in Dhaka.
# Comparing them against UTC shifts the window by six hours, so all local-time
# maths goes through this zone.
APP_TIMEZONE = os.getenv("APP_TIMEZONE", "Asia/Dhaka")
# Fixed-offset fallbacks, used only if the IANA database is missing (bare
# Windows installs ship none — `pip install tzdata` supplies it). Dhaka has no
# DST, so the fixed offset is exact rather than an approximation.
_FALLBACK_OFFSETS = {"Asia/Dhaka": 6, "Asia/Kolkata": 5.5, "UTC": 0}

try:
    TZ = ZoneInfo(APP_TIMEZONE)
except ZoneInfoNotFoundError:
    hours = _FALLBACK_OFFSETS.get(APP_TIMEZONE)
    if hours is None:
        raise
    log.warning(
        "IANA timezone data unavailable; using a fixed UTC%+g offset for %s. "
        "Install the 'tzdata' package for the real zone.", hours, APP_TIMEZONE,
    )
    TZ = timezone(timedelta(hours=hours), APP_TIMEZONE)

# ── Eligibility Cooldown & Auto-Pause Engine (Module 1, Feature 1) ───
WHOLE_BLOOD_COOLDOWN_DAYS = _int("WHOLE_BLOOD_COOLDOWN_DAYS", 120)
PLATELET_COOLDOWN_DAYS = _int("PLATELET_COOLDOWN_DAYS", 14)
MIN_DONOR_WEIGHT_KG = _float("MIN_DONOR_WEIGHT_KG", 50.0)
# Anything outside this range is a typo (5 kg / 700 kg), not a real weight:
# the entry is rejected and the last valid stored weight is kept.
PLAUSIBLE_WEIGHT_MIN_KG = _float("PLAUSIBLE_WEIGHT_MIN_KG", 30.0)
PLAUSIBLE_WEIGHT_MAX_KG = _float("PLAUSIBLE_WEIGHT_MAX_KG", 250.0)

WHOLE_BLOOD = "WHOLE_BLOOD"
PLATELETS = "PLATELETS"
COOLDOWN_DAYS = {
    WHOLE_BLOOD: WHOLE_BLOOD_COOLDOWN_DAYS,
    PLATELETS: PLATELET_COOLDOWN_DAYS,
}

# ── Smart Ping (Module 1, Feature 2) ─────────────────────────────────
# A saved commute route only earns a ping while the donor's GPS fix is both on
# the matching segment AND recent enough to still mean "they are there now".
LOCATION_STALE_AFTER_MINUTES = _int("LOCATION_STALE_AFTER_MINUTES", 15)

# ── Expanding Geo-Ripple (Module 2, Feature 1) ───────────────────────
# (elapsed minutes since the request opened, radius in km)
RIPPLE_STAGES = [(0, 3.0), (10, 5.0), (20, 10.0)]

# ── Rare-Blood City-Wide Override (Module 1, Feature 3) ──────────────
RARE_BLOOD_TYPES = {"O-", "A-", "B-", "AB-"}
# Seconds a city-wide rare-blood ping goes unanswered before the request is
# escalated to national blood banks and partner NGO hotlines. Three minutes is
# long enough for a donor to reach their phone and short enough that external
# sourcing still has time to matter; shorten it in .env for a live demo.
RARE_ESCALATION_SECONDS = _int("RARE_ESCALATION_SECONDS", 180)
# A rare type may have only a handful of matching donors city-wide, so the ping
# goes out by SMS as well as push rather than relying on a live FCM token.
RARE_SMS_ALERTS = os.getenv("RARE_SMS_ALERTS", "true").lower() in ("1", "true", "yes")
# How often the server sweeps for rare requests that have passed that threshold.
# The escalation is meant to be automatic, so it must not depend on a client
# happening to re-evaluate the dispatch.
ESCALATION_SWEEP_SECONDS = _int("ESCALATION_SWEEP_SECONDS", 20)

# ── OTP ──────────────────────────────────────────────────────────────
OTP_TTL_SECONDS = _int("OTP_TTL_SECONDS", 300)
OTP_MAX_ATTEMPTS = _int("OTP_MAX_ATTEMPTS", 5)
OTP_LENGTH = 6

# ── Auth tokens ──────────────────────────────────────────────────────
JWT_SECRET = os.getenv("JWT_SECRET", "spondon-dev-secret-change-me-in-production-please")
JWT_ALGORITHM = "HS256"
ADMIN_TOKEN_TTL_HOURS = _int("ADMIN_TOKEN_TTL_HOURS", 12)
USER_TOKEN_TTL_HOURS = _int("USER_TOKEN_TTL_HOURS", 720)   # 30 days on a phone

# ── External integrations (all optional) ─────────────────────────────
SMS_API_KEY = os.getenv("SMS_API_KEY")               # SSL Wireless or similar
SMS_API_URL = os.getenv("SMS_API_URL")
SMS_SENDER_ID = os.getenv("SMS_SENDER_ID", "SPONDON")
SMS_COUNTRY_CODE = os.getenv("SMS_COUNTRY_CODE", "+880")

# Twilio, used ahead of the local gateway when both are set.
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_FROM = os.getenv("TWILIO_FROM")               # e.g. +8801XXXXXXXXX

FCM_SERVER_KEY = os.getenv("FCM_SERVER_KEY")         # Firebase Cloud Messaging
FCM_ENDPOINT = os.getenv("FCM_ENDPOINT", "https://fcm.googleapis.com/fcm/send")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")         # doctor's-slip OCR
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
# Below this confidence a slip cannot be auto-approved and goes to the human
# review queue instead of being rejected.
OCR_CONFIDENCE_THRESHOLD = _float("OCR_CONFIDENCE_THRESHOLD", 0.75)

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")   # driving-route distance
BLOOD_BANK_API_URL = os.getenv("BLOOD_BANK_API_URL")     # national registry
BLOOD_BANK_API_KEY = os.getenv("BLOOD_BANK_API_KEY")
NGO_HOTLINE_API_URL = os.getenv("NGO_HOTLINE_API_URL")   # partner NGO dispatch

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if o.strip()
]

# Dev convenience: return the OTP in the API response when no SMS gateway is
# wired up, so the demo is usable. Must be off once SMS_API_KEY is set.
EXPOSE_OTP_IN_RESPONSE = os.getenv("EXPOSE_OTP_IN_RESPONSE", "auto")


def expose_otp() -> bool:
    if EXPOSE_OTP_IN_RESPONSE == "auto":
        return not bool(SMS_API_KEY)
    return EXPOSE_OTP_IN_RESPONSE.lower() in ("1", "true", "yes")


def public_config() -> dict:
    """The rule constants the frontend renders, so UI copy can never drift."""
    return {
        "timezone": APP_TIMEZONE,
        "eligibility": {
            "whole_blood_cooldown_days": WHOLE_BLOOD_COOLDOWN_DAYS,
            "platelet_cooldown_days": PLATELET_COOLDOWN_DAYS,
            "min_weight_kg": MIN_DONOR_WEIGHT_KG,
            "plausible_weight_min_kg": PLAUSIBLE_WEIGHT_MIN_KG,
            "plausible_weight_max_kg": PLAUSIBLE_WEIGHT_MAX_KG,
        },
        "dispatch": {
            "ripple_stages": [{"after_minutes": m, "radius_km": r} for m, r in RIPPLE_STAGES],
            "location_stale_after_minutes": LOCATION_STALE_AFTER_MINUTES,
            "rare_blood_types": sorted(RARE_BLOOD_TYPES),
            "rare_escalation_seconds": RARE_ESCALATION_SECONDS,
            "rare_sms_alerts": RARE_SMS_ALERTS,
        },
        "otp": {"length": OTP_LENGTH, "ttl_seconds": OTP_TTL_SECONDS},
    }

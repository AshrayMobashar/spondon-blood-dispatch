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

# ── Live En-Route Tracker (Module 3, Feature 1) ──────────────────────
# How often the donor's phone is expected to post a fix while travelling.
TRIP_PING_INTERVAL_SECONDS = _int("TRIP_PING_INTERVAL_SECONDS", 10)
# Silence longer than this means the phone has lost its connection. It is a
# multiple of the ping interval, not an independent guess: one dropped packet
# on a Dhaka 3G cell must not flash "signal lost" at a family already panicking,
# but four in a row is a real outage and saying nothing would be worse.
TRIP_STALE_AFTER_SECONDS = _int("TRIP_STALE_AFTER_SECONDS", 45)
# How often the server sweeps live trips for that silence. The freeze has to be
# announced by the server on its own timer — a family whose *own* connection is
# fine would otherwise sit watching a moving icon that stopped being real
# minutes ago, because no event ever arrives to say so.
TRIP_SWEEP_SECONDS = _int("TRIP_SWEEP_SECONDS", 5)
# Within this many metres of the hospital the donor is treated as arrived.
TRIP_ARRIVAL_RADIUS_M = _float("TRIP_ARRIVAL_RADIUS_M", 120.0)
# Points kept for the drawn trail. A cap, because a document that grows without
# one eventually stops being writable mid-trip.
TRIP_TRAIL_MAX_POINTS = _int("TRIP_TRAIL_MAX_POINTS", 60)
# Fallback speed for the first ETA, before enough movement exists to measure
# one. Dhaka's average traffic speed, not a highway figure.
TRIP_DEFAULT_SPEED_KMH = _float("TRIP_DEFAULT_SPEED_KMH", 18.0)
# Measured speed is clamped into this band. Below the floor a donor stopped at
# one light would produce an ETA of hours; above the ceiling one bad GPS jump
# would promise an arrival that cannot happen.
TRIP_MIN_SPEED_KMH = _float("TRIP_MIN_SPEED_KMH", 6.0)
TRIP_MAX_SPEED_KMH = _float("TRIP_MAX_SPEED_KMH", 60.0)
# A fix implying more than this is GPS drift or a spoof, not travel: it is
# rejected rather than allowed to teleport the icon across the city.
TRIP_IMPLAUSIBLE_SPEED_KMH = _float("TRIP_IMPLAUSIBLE_SPEED_KMH", 160.0)
# Straight-line km → road km when the Maps API is not available. Dhaka's street
# grid is not a straight line to anywhere.
TRIP_ROAD_FACTOR = _float("TRIP_ROAD_FACTOR", 1.35)

# ── Golden Donor Verification (Module 3, Feature 3) ──────────────────
# Three confirmed donations earn the badge. It is a *proven* count — only an
# arrival the hospital confirmed increments it, so the badge cannot be farmed
# by accepting requests and never turning up.
GOLDEN_DONOR_MIN_DONATIONS = _int("GOLDEN_DONOR_MIN_DONATIONS", 3)
# Six months of silence and the priority is suspended. The badge itself is
# never taken away — it was earned — but a donor the app has not seen since
# February must not be first in the queue for an ICU case tonight, because the
# seconds spent ringing a phone nobody opens are seconds the patient pays for.
GOLDEN_DORMANT_AFTER_DAYS = _int("GOLDEN_DORMANT_AFTER_DAYS", 180)
# The city the priority pool serves. A donor who has moved away is not less
# proven — they are simply not reachable in time for a Dhaka ICU.
GOLDEN_HOME_CITY = os.getenv("GOLDEN_HOME_CITY", "Dhaka")
# Centre of Dhaka and the radius that still counts as "in the city". Wide
# enough to include Savar and Keraniganj, which are commutable; narrow enough
# that Chattogram is plainly outside.
GOLDEN_CITY_LAT = _float("GOLDEN_CITY_LAT", 23.7806)
GOLDEN_CITY_LNG = _float("GOLDEN_CITY_LNG", 90.4074)
GOLDEN_CITY_RADIUS_KM = _float("GOLDEN_CITY_RADIUS_KM", 40.0)
# Which requests actually trigger the priority ordering. Severity alone is the
# fallback; a request explicitly flagged `icu` counts regardless of severity.
GOLDEN_PRIORITY_SEVERITIES = {
    s.strip().upper()
    for s in os.getenv("GOLDEN_PRIORITY_SEVERITIES", "LIFE_THREATENING").split(",")
    if s.strip()
}

# ── Direct-Connect Masked Calling (Module 3, Feature 2) ──────────────
# A call channel outlives neither the emergency nor the day. It is torn down on
# arrival; this is the backstop for a request nobody ever closes.
CALL_SESSION_TTL_MINUTES = _int("CALL_SESSION_TTL_MINUTES", 180)
# VOIP quality floor. Below either of these for CALL_DEGRADED_SECONDS the
# client stops waiting and asks the server for the GSM proxy leg.
CALL_MIN_MOS = _float("CALL_MIN_MOS", 2.5)                  # 1.0–5.0, ITU scale
CALL_MAX_PACKET_LOSS_PCT = _float("CALL_MAX_PACKET_LOSS_PCT", 8.0)
CALL_DEGRADED_SECONDS = _int("CALL_DEGRADED_SECONDS", 5)
# Pool of local GSM numbers the bridge can rent out. Each is lent to exactly one
# live call, then returned — which is why the pool can be small and why a
# released number's mapping stops resolving immediately.
GSM_PROXY_NUMBERS = [
    n.strip()
    for n in os.getenv(
        "GSM_PROXY_NUMBERS", "+8809612000101,+8809612000102,+8809612000103,+8809612000104"
    ).split(",")
    if n.strip()
]
# Telephony provider for the GSM leg (Twilio's proxy/voice API in production).
# Unset means the bridge is simulated locally and says so.
VOICE_BRIDGE_URL = os.getenv("VOICE_BRIDGE_URL")
VOICE_BRIDGE_KEY = os.getenv("VOICE_BRIDGE_KEY")

# ── The VOIP leg itself (WebRTC) ─────────────────────────────────────
# The media never touches this server: the two browsers negotiate a peer
# connection and the audio flows directly between them. All the backend lends
# them is a signalling relay (`/ws/call`) and this list of ICE servers.
#
# STUN is free and public — it only tells a browser what its own public address
# looks like from outside, so nothing private passes through it. That is enough
# for the large majority of connections.
#
# TURN is the exception case: when both sides sit behind symmetric NAT (some
# mobile carriers, hospital guest wifi) no direct path exists and the audio has
# to be relayed. TURN relays cost bandwidth and so are not given away freely at
# scale; leave these unset and calls simply fail on those networks — which is
# exactly the corner case the GSM fallback below already exists to catch.
STUN_SERVERS = [
    s.strip()
    for s in os.getenv(
        "STUN_SERVERS",
        "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302",
    ).split(",")
    if s.strip()
]
TURN_URLS = [u.strip() for u in os.getenv("TURN_URLS", "").split(",") if u.strip()]
TURN_USERNAME = os.getenv("TURN_USERNAME")
TURN_CREDENTIAL = os.getenv("TURN_CREDENTIAL")


def ice_servers() -> list[dict]:
    """RTCPeerConnection configuration handed to both participants."""
    servers: list[dict] = []
    if STUN_SERVERS:
        servers.append({"urls": STUN_SERVERS})
    if TURN_URLS:
        servers.append({
            "urls": TURN_URLS,
            "username": TURN_USERNAME or "",
            "credential": TURN_CREDENTIAL or "",
        })
    return servers

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

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")         # doctor's-slip OCR + CBC triage
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
# Below this confidence a slip cannot be auto-approved and goes to the human
# review queue instead of being rejected.
OCR_CONFIDENCE_THRESHOLD = _float("OCR_CONFIDENCE_THRESHOLD", 0.75)

# ── CBC Triage (platelet-trend analysis) ─────────────────────────────
# Minimum number of valid CBC uploads in a session before the AI issues a
# HOLD_OFF or DISPATCH_NOW verdict. Fewer than this yields INCONCLUSIVE.
CBC_MIN_REPORTS = _int("CBC_MIN_REPORTS", 2)

# ── Post-Donation Ride Community Bounty (Module 3, Feature 4) ────────
# A platelet donor leaves depleted, so the moment their arrival is confirmed
# the community is asked for a lift home. The window below is how long that
# ask stays open before the promo-code fallback fires — the corner case that
# guarantees nobody is left standing outside a hospital at night.
BOUNTY_WINDOW_MINUTES = _int("BOUNTY_WINDOW_MINUTES", 15)
# How far from the hospital a community driver can be and still be asked.
BOUNTY_RADIUS_KM = _float("BOUNTY_RADIUS_KM", 5.0)
# How often the server sweeps for bounties whose window has run out. Like the
# rare-blood escalation, the fallback has to be automatic: it must not wait for
# the donor's phone to be awake and asking.
BOUNTY_SWEEP_SECONDS = _int("BOUNTY_SWEEP_SECONDS", 15)
# Vehicle types that make an account a candidate community driver.
BOUNTY_VEHICLE_TYPES = ("car", "bike")
# Ride-sharing partners the subsidy is drawn against, in preference order.
RIDE_PARTNERS = [
    p.strip() for p in os.getenv("RIDE_PARTNERS", "Pathao,Uber").split(",") if p.strip()
]
# Printed on the front of every generated code so a donor reading it aloud to a
# driver can say where it came from.
BOUNTY_PROMO_PREFIX = os.getenv("BOUNTY_PROMO_PREFIX", "SPONDON")
# How long an issued promo code stays redeemable.
BOUNTY_PROMO_TTL_HOURS = _int("BOUNTY_PROMO_TTL_HOURS", 24)
# Face value of the subsidy, in BDT — what the partnership covers.
BOUNTY_PROMO_VALUE_BDT = _int("BOUNTY_PROMO_VALUE_BDT", 300)

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
        "golden_donor": {
            "min_donations": GOLDEN_DONOR_MIN_DONATIONS,
            "dormant_after_days": GOLDEN_DORMANT_AFTER_DAYS,
            "home_city": GOLDEN_HOME_CITY,
            "city_radius_km": GOLDEN_CITY_RADIUS_KM,
            "priority_severities": sorted(GOLDEN_PRIORITY_SEVERITIES),
        },
        "tracking": {
            "ping_interval_seconds": TRIP_PING_INTERVAL_SECONDS,
            "stale_after_seconds": TRIP_STALE_AFTER_SECONDS,
            "arrival_radius_m": TRIP_ARRIVAL_RADIUS_M,
            "trail_max_points": TRIP_TRAIL_MAX_POINTS,
        },
        "calling": {
            "session_ttl_minutes": CALL_SESSION_TTL_MINUTES,
            "min_mos": CALL_MIN_MOS,
            "max_packet_loss_pct": CALL_MAX_PACKET_LOSS_PCT,
            "degraded_seconds": CALL_DEGRADED_SECONDS,
            "proxy_pool_size": len(GSM_PROXY_NUMBERS),
            "media": "webrtc",
            "stun_servers": len(STUN_SERVERS),
            "turn_configured": bool(TURN_URLS),
        },
        "otp": {"length": OTP_LENGTH, "ttl_seconds": OTP_TTL_SECONDS},
        "cbc_triage": {"min_reports": CBC_MIN_REPORTS},
        "ride_bounty": {
            "window_minutes": BOUNTY_WINDOW_MINUTES,
            "radius_km": BOUNTY_RADIUS_KM,
            "vehicle_types": list(BOUNTY_VEHICLE_TYPES),
            "partners": RIDE_PARTNERS,
            "promo_value_bdt": BOUNTY_PROMO_VALUE_BDT,
            "promo_ttl_hours": BOUNTY_PROMO_TTL_HOURS,
        },
    }

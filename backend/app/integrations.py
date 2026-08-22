"""Adapters for the five external services the platform depends on.

Every adapter follows the same contract:

  * it exposes `configured()` — True only when real credentials are present;
  * its send/parse call returns a dict that always carries `simulated`, so a
    caller (and the admin console) can tell a real delivery from a local
    stand-in;
  * it never raises on transport failure — it returns `delivered: False` with
    the error, because a dead SMS gateway must not take down registration.

With no credentials configured the platform still works end to end, but it says
so rather than pretending. In particular an un-configured OCR engine does *not*
fabricate a confidence score: it returns NEEDS_REVIEW and the slip goes to the
human queue, which is the specified fallback for an unreadable slip anyway.
"""
import logging
import math
import os
import secrets
import time
from typing import Optional

import httpx

from . import config

log = logging.getLogger("spondon.integrations")

_TIMEOUT = httpx.Timeout(10.0)


# ── SMS gateway (OTP + rare-blood emergency alerts) ──────────────────
def twilio_configured() -> bool:
    return bool(config.TWILIO_ACCOUNT_SID and config.TWILIO_AUTH_TOKEN and config.TWILIO_FROM)


def sms_configured() -> bool:
    """True when *some* SMS transport is wired up — Twilio or a local gateway."""
    return twilio_configured() or bool(config.SMS_API_KEY and config.SMS_API_URL)


def sms_provider() -> Optional[str]:
    if twilio_configured():
        return "twilio"
    if config.SMS_API_KEY and config.SMS_API_URL:
        return "sms-gateway"
    return None


def _e164(phone: str) -> str:
    """`01711000001` → `+8801711000001`. Twilio will not accept the local form."""
    p = phone.strip().replace(" ", "")
    if p.startswith("+"):
        return p
    if p.startswith("0"):
        return f"{config.SMS_COUNTRY_CODE}{p[1:]}"
    return f"{config.SMS_COUNTRY_CODE}{p}"


async def _send_twilio(phone: str, message: str) -> dict:
    """Twilio's REST API is a form POST with basic auth — no SDK needed."""
    url = (
        f"https://api.twilio.com/2010-04-01/Accounts/"
        f"{config.TWILIO_ACCOUNT_SID}/Messages.json"
    )
    data = {"To": _e164(phone), "From": config.TWILIO_FROM, "Body": message}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.post(
                url, data=data,
                auth=(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN),
            )
        return {
            "delivered": res.status_code < 400,
            "simulated": False,
            "provider": "twilio",
            "status_code": res.status_code,
            "sid": (res.json() or {}).get("sid") if res.status_code < 400 else None,
        }
    except Exception as exc:
        log.warning("Twilio delivery failed: %s", exc)
        return {"delivered": False, "simulated": False, "provider": "twilio", "error": str(exc)}


async def send_sms(phone: str, message: str) -> dict:
    """Deliver an SMS through whichever transport is configured."""
    provider = sms_provider()
    if provider is None:
        log.info("[sms:simulated] to=%s body=%s", phone, message)
        return {
            "delivered": False,
            "simulated": True,
            "provider": None,
            "note": "No SMS transport configured — set TWILIO_* or SMS_API_URL + SMS_API_KEY.",
        }
    if provider == "twilio":
        return await _send_twilio(phone, message)

    payload = {
        "api_token": config.SMS_API_KEY,
        "sid": config.SMS_SENDER_ID,
        "msisdn": phone,
        "sms": message,
        "csms_id": secrets.token_hex(8),
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.post(config.SMS_API_URL, json=payload)
        return {
            "delivered": res.status_code < 400,
            "simulated": False,
            "provider": "sms-gateway",
            "status_code": res.status_code,
        }
    except httpx.HTTPError as exc:
        log.warning("SMS delivery failed: %s", exc)
        return {"delivered": False, "simulated": False, "provider": "sms-gateway", "error": str(exc)}


async def send_emergency_sms(phone: Optional[str], *, blood_type: str, hospital: str,
                             component: str) -> Optional[dict]:
    """Second channel for a city-wide rare-blood ping.

    A push notification assumes the app is installed and its token still valid.
    For a rare type there may be only a handful of matching donors in the whole
    city, so losing one to a stale FCM token is not acceptable — SMS goes out
    alongside the push rather than instead of it.
    """
    if not phone:
        return None
    return await send_sms(
        phone,
        f"SPONDON EMERGENCY: {blood_type} {component.replace('_', ' ').lower()} needed now at "
        f"{hospital}. Open the app to accept if you can donate.",
    )


# ── Firebase Cloud Messaging (emergency pings) ───────────────────────
def push_configured() -> bool:
    return bool(config.FCM_SERVER_KEY)


async def send_push(
    token: Optional[str],
    title: str,
    body: str,
    *,
    priority: str = "normal",
    bypass_dnd: bool = False,
    data: Optional[dict] = None,
) -> dict:
    """Send an emergency ping.

    `bypass_dnd` maps to the Android channel/alarm flags that let a
    life-threatening request sound through the phone's own Do Not Disturb.
    """
    if not token:
        return {"delivered": False, "simulated": True, "reason": "donor has no FCM token"}
    if not push_configured():
        log.info("[fcm:simulated] token=%s priority=%s bypass_dnd=%s title=%s",
                 token[:12], priority, bypass_dnd, title)
        return {
            "delivered": False,
            "simulated": True,
            "note": "No FCM credentials configured — set FCM_SERVER_KEY.",
        }

    android = {
        "priority": "high" if priority == "high" else "normal",
        "notification": {
            # A high-importance alarm channel is what actually pierces OS-level
            # silent mode; a normal channel would be swallowed by DND.
            "channel_id": "spondon_emergency" if bypass_dnd else "spondon_default",
            "sound": "emergency_alarm" if bypass_dnd else "default",
            "default_vibrate_timings": True,
        },
    }
    payload = {
        "to": token,
        "priority": "high" if priority == "high" else "normal",
        "content_available": True,
        "notification": {"title": title, "body": body},
        "data": {**(data or {}), "bypass_dnd": str(bypass_dnd).lower()},
        "android": android,
        "apns": {"headers": {"apns-priority": "10" if priority == "high" else "5"}},
    }
    headers = {"Authorization": f"key={config.FCM_SERVER_KEY}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.post(config.FCM_ENDPOINT, json=payload, headers=headers)
        return {"delivered": res.status_code < 400, "simulated": False, "status_code": res.status_code}
    except httpx.HTTPError as exc:
        log.warning("FCM push failed: %s", exc)
        return {"delivered": False, "simulated": False, "error": str(exc)}


# ── OpenAI vision (doctor's-slip OCR) ────────────────────────────────
def ocr_configured() -> bool:
    return bool(config.OPENAI_API_KEY)


_OCR_SYSTEM = (
    "You read photographed Bangladeshi hospital blood-requisition slips. "
    "Reply with strict JSON only, no prose, matching this schema: "
    '{"is_medical_slip": bool, "patient_name": string|null, "hospital": string|null, '
    '"blood_type": string|null, "component": "WHOLE_BLOOD"|"PLATELETS"|"PLASMA"|null, '
    '"units": number|null, "date_written": string|null (ISO 8601), '
    '"has_stamp_or_signature": bool, "confidence": number between 0 and 1, "notes": string}. '
    "Set is_medical_slip false for anything that is not a medical requisition. "
    "confidence must reflect how legible the handwriting actually is."
)


async def read_slip(image_b64: str, mime: str, expected_component: Optional[str]) -> dict:
    """Extract the medical fields from a requisition slip photo.

    Returns `{is_medical_slip, component, blood_type, confidence, simulated, ...}`.
    A low or absent confidence is *not* a rejection — the caller routes the slip
    to the human review queue.
    """
    if not ocr_configured():
        return {
            "is_medical_slip": None,
            "confidence": None,
            "component": None,
            "blood_type": None,
            "simulated": True,
            "notes": "No OCR engine configured (OPENAI_API_KEY unset) — routed to human review.",
        }

    prompt = "Read this requisition slip."
    if expected_component:
        prompt += f" The request claims the component is {expected_component}; verify that."
    payload = {
        "model": config.OPENAI_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _OCR_SYSTEM},
            {"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
            ]},
        ],
    }
    headers = {"Authorization": f"Bearer {config.OPENAI_API_KEY}"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as client:
            res = await client.post(
                f"{config.OPENAI_BASE_URL}/chat/completions", json=payload, headers=headers
            )
        res.raise_for_status()
        import json
        content = res.json()["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except Exception as exc:                       # transport, JSON, or schema failure
        log.warning("OCR call failed: %s", exc)
        return {
            "is_medical_slip": None,
            "confidence": None,
            "component": None,
            "blood_type": None,
            "simulated": False,
            "error": str(exc),
            "notes": "OCR engine error — routed to human review.",
        }

    # Schema-mismatch guard: an irrelevant image halts here instead of being
    # scored as a low-confidence slip.
    conf = parsed.get("confidence")
    if not isinstance(conf, (int, float)) or not 0.0 <= float(conf) <= 1.0:
        conf = None
    return {
        "is_medical_slip": parsed.get("is_medical_slip"),
        "patient_name": parsed.get("patient_name"),
        "hospital": parsed.get("hospital"),
        "blood_type": parsed.get("blood_type"),
        "component": parsed.get("component"),
        "units": parsed.get("units"),
        "date_written": parsed.get("date_written"),
        "has_stamp_or_signature": parsed.get("has_stamp_or_signature"),
        "confidence": float(conf) if conf is not None else None,
        "notes": parsed.get("notes") or "",
        "simulated": False,
    }


# ── Google Maps (driving-route distance) ─────────────────────────────
def maps_configured() -> bool:
    return bool(config.GOOGLE_MAPS_API_KEY)


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in km — the straight-line fallback."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# Why the last Maps call failed, so the API can report "configured but not
# working" instead of claiming a live integration it does not have.
_maps_error: Optional[str] = None

# A refused key does not start working again on its own. Retrying it on every
# dispatch would put two doomed HTTP round-trips in front of an emergency ping,
# so a failure opens a circuit and we serve great-circle immediately until it
# is worth another look.
_maps_retry_after: float = 0.0

# Billing disabled, key restricted, API not enabled — an operator has to act.
# Worth re-checking occasionally in case they just did, but not every dispatch.
_MAPS_BACKOFF_PERMANENT = 300.0    # 5 min
_MAPS_BACKOFF_TRANSIENT = 30.0     # timeout or 5xx — may clear by itself


def maps_error() -> Optional[str]:
    return _maps_error


def _open_maps_circuit(status: Optional[int]) -> None:
    """Stop calling Maps for a while after `status` (None = network error)."""
    global _maps_retry_after
    permanent = status in (401, 403, 400)
    _maps_retry_after = time.monotonic() + (
        _MAPS_BACKOFF_PERMANENT if permanent else _MAPS_BACKOFF_TRANSIENT
    )


def _maps_circuit_open() -> bool:
    return time.monotonic() < _maps_retry_after


def _google_message(res) -> str:
    """The human-readable reason out of a Google error body.

    Google wraps the useful sentence in nested JSON and often ends it with the
    console URL that fixes the problem. Truncating the raw body cuts that URL in
    half, which is exactly the part an operator needs, so pull the message field
    out and keep it whole.
    """
    try:
        payload = res.json()
        if isinstance(payload, list) and payload:
            payload = payload[0]
        msg = (payload or {}).get("error", {}).get("message")
        if msg:
            return " ".join(msg.split())
    except Exception:
        pass
    return " ".join(res.text.split())[:300]


async def _routes_matrix(origin: tuple, destinations: list) -> Optional[list]:
    """Routes API — Google's current road-distance endpoint."""
    global _maps_error

    def waypoint(lat: float, lng: float) -> dict:
        return {"waypoint": {"location": {"latLng": {"latitude": lat, "longitude": lng}}}}

    body = {
        "origins": [waypoint(*origin)],
        "destinations": [waypoint(lat, lng) for lat, lng in destinations],
        "travelMode": "DRIVE",
    }
    headers = {
        "X-Goog-Api-Key": config.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,condition",
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.post(
                "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
                json=body, headers=headers,
            )
        if res.status_code >= 400:
            _maps_error = f"Routes API {res.status_code}: {_google_message(res)}"
            _open_maps_circuit(res.status_code)
            return None
        out: list = [None] * len(destinations)
        for el in res.json():
            idx = el.get("destinationIndex")
            if idx is None or idx >= len(out):
                continue
            if el.get("condition") == "ROUTE_EXISTS" and "distanceMeters" in el:
                out[idx] = el["distanceMeters"] / 1000.0
        _maps_error = None
        return out
    except Exception as exc:
        _maps_error = f"Routes API error: {exc}"
        _open_maps_circuit(None)
        return None


async def _legacy_distance_matrix(origin: tuple, destinations: list) -> Optional[list]:
    """The older Distance Matrix API, for projects still entitled to it."""
    global _maps_error
    params = {
        "origins": f"{origin[0]},{origin[1]}",
        "destinations": "|".join(f"{lat},{lng}" for lat, lng in destinations),
        "mode": "driving",
        "key": config.GOOGLE_MAPS_API_KEY,
    }
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.get(
                "https://maps.googleapis.com/maps/api/distancematrix/json", params=params
            )
        res.raise_for_status()
        payload = res.json()
        if payload.get("status") != "OK":
            status = payload.get("status")
            _maps_error = (
                f"Distance Matrix {status}: "
                f"{' '.join(payload.get('error_message', '').split())}"
            )
            # REQUEST_DENIED means the key/project is refused, not a blip.
            _open_maps_circuit(403 if status == "REQUEST_DENIED" else None)
            return None
        rows = payload.get("rows", [])
        if not rows:
            return None
        out = [
            el["distance"]["value"] / 1000.0 if el.get("status") == "OK" else None
            for el in rows[0].get("elements", [])
        ]
        if len(out) != len(destinations):
            return None
        _maps_error = None
        return out
    except Exception as exc:
        _maps_error = f"Distance Matrix error: {exc}"
        _open_maps_circuit(None)
        return None


async def driving_distances_km(origin: tuple, destinations: list) -> Optional[list]:
    """Real road distances origin → each destination, or None if unavailable.

    This is what makes a river crossing behave correctly: two points 3 km apart
    across the Buriganga are a 14 km drive, and only the Maps API knows that.

    Tries the Routes API first and falls back to the legacy Distance Matrix,
    because Google is retiring the latter and a given project is typically
    entitled to one or the other. Returning None is safe: the caller keeps its
    great-circle figure rather than dropping the donor.
    """
    global _maps_error
    if not maps_configured() or not destinations:
        return None
    if _maps_circuit_open():
        # Already known to be refused. Fall straight through to great-circle
        # rather than delaying an emergency dispatch on a call that will fail.
        return None

    out = await _routes_matrix(origin, destinations)
    if out is not None:
        return out

    # Keep the Routes failure: it is the modern endpoint and therefore the
    # actionable one. The legacy API's "switch to the Routes API" advice is
    # misleading when Routes is exactly what was just refused.
    routes_error = _maps_error
    out = await _legacy_distance_matrix(origin, destinations)
    if out is None and routes_error:
        _maps_error = routes_error
    return out


# ── National blood banks & partner NGO hotlines ──────────────────────
def blood_bank_configured() -> bool:
    return bool(config.BLOOD_BANK_API_URL)


def ngo_configured() -> bool:
    return bool(config.NGO_HOTLINE_API_URL)


async def _post_partner(url: Optional[str], key: Optional[str], payload: dict, channel: str) -> dict:
    if not url:
        log.info("[%s:simulated] %s", channel, payload)
        return {
            "channel": channel,
            "delivered": False,
            "simulated": True,
            "note": f"No {channel} endpoint configured.",
        }
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            res = await client.post(url, json=payload, headers=headers)
        return {
            "channel": channel,
            "delivered": res.status_code < 400,
            "simulated": False,
            "status_code": res.status_code,
            "reference": (res.json() or {}).get("reference") if res.status_code < 400 else None,
        }
    except Exception as exc:
        log.warning("%s escalation failed: %s", channel, exc)
        return {"channel": channel, "delivered": False, "simulated": False, "error": str(exc)}


async def escalate_to_blood_bank(payload: dict) -> dict:
    return await _post_partner(
        config.BLOOD_BANK_API_URL, config.BLOOD_BANK_API_KEY, payload, "national-blood-bank"
    )


async def escalate_to_ngo(payload: dict) -> dict:
    return await _post_partner(config.NGO_HOTLINE_API_URL, None, payload, "ngo-hotline")


def integration_status() -> dict:
    """Surfaced at `GET /api/config` and in the admin console."""
    return {
        "sms": sms_configured(),
        "sms_provider": sms_provider(),
        "fcm": push_configured(),
        "ocr": ocr_configured(),
        "cbc": cbc_configured(),
        # A key being present is not the same as it working. If the last road
        # -distance call was refused, say so rather than advertising a live
        # integration the engine is quietly falling back from.
        "maps": maps_configured() and _maps_error is None,
        "maps_key_present": maps_configured(),
        "maps_error": _maps_error,
        "blood_bank": blood_bank_configured(),
        "ngo_hotline": ngo_configured(),
        "ride_sharing": ride_sharing_configured(),
    }


# ── OpenAI vision (CBC platelet-trend triage) ─────────────────────────
def cbc_configured() -> bool:
    """True when the same OpenAI key used for slip OCR is present."""
    return bool(config.OPENAI_API_KEY)


_CBC_SYSTEM = (
    "You are a medical AI assistant reading a Complete Blood Count (CBC) laboratory report "
    "from a Bangladeshi hospital. "
    "Reply with strict JSON only, no prose, matching this schema exactly: "
    '{"is_cbc_report": bool, '
    '"platelet_count": number|null, '
    '"platelet_unit": string|null, '
    '"report_date": string|null, '
    '"patient_name": string|null, '
    '"confidence": number, '
    '"notes": string}. '
    "Rules: "
    "1. Set is_cbc_report to false if the image is NOT a medical CBC/haematology lab report "
    "(e.g. if it is a food receipt, selfie, prescription, or unrelated document). "
    "2. platelet_count must be the numerical value only (e.g. 95 for 95×10³/µL). "
    "Set it to null if the value is illegible or absent. "
    "3. report_date must be ISO 8601 (YYYY-MM-DD) or null. "
    "4. confidence is 0.0–1.0 reflecting overall legibility. "
    "5. notes must explain what you saw, especially if is_cbc_report is false — "
    "be specific (e.g. 'This appears to be a grocery receipt, not a lab report.')."
)


async def analyse_cbc(image_b64: str, mime: str, existing_counts: list) -> dict:
    """Parse a CBC report photo and classify the platelet trend.

    `existing_counts` is a list of prior float platelet values (oldest first)
    from the current triage session. The trend is computed here — not by the
    model — so the verdict logic is deterministic and auditable.

    Returns a dict with keys:
        is_cbc_report, platelet_count, report_date, patient_name,
        trend, confidence, recommendation, notes, simulated, verdict
    """
    if not cbc_configured():
        return {
            "is_cbc_report": None,
            "platelet_count": None,
            "report_date": None,
            "patient_name": None,
            "trend": "INSUFFICIENT_DATA",
            "confidence": None,
            "recommendation": (
                "CBC triage engine is not configured (OPENAI_API_KEY unset). "
                "Results are inconclusive — please have a doctor review the reports manually."
            ),
            "notes": "No OpenAI key configured — routed to inconclusive.",
            "simulated": True,
            "verdict": "INCONCLUSIVE",
        }

    payload = {
        "model": config.OPENAI_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _CBC_SYSTEM},
            {"role": "user", "content": [
                {"type": "text", "text": "Read this CBC lab report and extract the platelet count."},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}},
            ]},
        ],
    }
    headers = {"Authorization": f"Bearer {config.OPENAI_API_KEY}"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as client:
            res = await client.post(
                f"{config.OPENAI_BASE_URL}/chat/completions", json=payload, headers=headers
            )
        res.raise_for_status()
        import json
        content = res.json()["choices"][0]["message"]["content"]
        parsed = json.loads(content)
    except Exception as exc:
        log.warning("CBC triage OpenAI call failed: %s", exc)
        return {
            "is_cbc_report": None,
            "platelet_count": None,
            "report_date": None,
            "patient_name": None,
            "trend": "INSUFFICIENT_DATA",
            "confidence": None,
            "recommendation": "AI engine error — please try again or consult a doctor.",
            "notes": f"OpenAI error: {exc}",
            "simulated": False,
            "verdict": "INCONCLUSIVE",
        }

    # ── Schema-mismatch guard ────────────────────────────────────────
    if not parsed.get("is_cbc_report"):
        reason = parsed.get("notes") or "The uploaded image does not appear to be a CBC lab report."
        return {
            "is_cbc_report": False,
            "platelet_count": None,
            "report_date": parsed.get("report_date"),
            "patient_name": parsed.get("patient_name"),
            "trend": "INSUFFICIENT_DATA",
            "confidence": parsed.get("confidence"),
            "recommendation": (
                f"{reason} Please upload a clear photograph of a Complete Blood Count "
                "laboratory report."
            ),
            "notes": reason,
            "simulated": False,
            "verdict": "INVALID_IMAGE",
        }

    # ── Platelet count extraction ────────────────────────────────────
    raw_count = parsed.get("platelet_count")
    platelet_count: Optional[float] = None
    if isinstance(raw_count, (int, float)) and raw_count > 0:
        platelet_count = float(raw_count)

    # ── Trend computation (deterministic, not delegated to the model) ─
    all_counts = [c for c in existing_counts if c is not None] + (
        [platelet_count] if platelet_count is not None else []
    )

    trend = "INSUFFICIENT_DATA"
    verdict = "INCONCLUSIVE"
    recommendation = (
        f"Upload at least {config.CBC_MIN_REPORTS} readable CBC reports for a trend verdict."
    )

    if len(all_counts) >= config.CBC_MIN_REPORTS:
        # Compare last two readable readings.
        delta = all_counts[-1] - all_counts[-2]
        if delta < -5:          # strictly falling (>5 k/µL drop)
            trend = "FALLING"
            verdict = "DISPATCH_NOW"
            recommendation = (
                f"Platelet count has dropped from {all_counts[-2]:.0f} to "
                f"{all_counts[-1]:.0f} ×10³/µL — the trend is declining. "
                "We recommend proceeding with an emergency dispatch request to secure a donor "
                "before the count drops further."
            )
        elif delta > 5:         # clearly rising
            trend = "RISING"
            verdict = "HOLD_OFF"
            recommendation = (
                f"Platelet count has risen from {all_counts[-2]:.0f} to "
                f"{all_counts[-1]:.0f} ×10³/µL — the body appears to be recovering naturally. "
                "Consider holding off on a dispatch request to preserve volunteer resources for "
                "patients whose counts are still collapsing. Continue monitoring."
            )
        else:                   # within ±5 — stable
            trend = "STABLE"
            verdict = "HOLD_OFF"
            recommendation = (
                f"Platelet count is stable around {all_counts[-1]:.0f} ×10³/µL. "
                "The trend suggests natural recovery or a plateau. "
                "Hold off on dispatching and continue monitoring every 12–24 hours."
            )

    conf = parsed.get("confidence")
    if not isinstance(conf, (int, float)) or not 0.0 <= float(conf) <= 1.0:
        conf = None

    return {
        "is_cbc_report": True,
        "platelet_count": platelet_count,
        "report_date": parsed.get("report_date"),
        "patient_name": parsed.get("patient_name"),
        "trend": trend,
        "confidence": float(conf) if conf is not None else None,
        "recommendation": recommendation,
        "notes": parsed.get("notes") or "",
        "simulated": False,
        "verdict": verdict,
    }


# ── Ride-sharing Partner Integration (Pathao / Uber) ──────────────────
def ride_sharing_configured() -> bool:
    """True when a partner API key for ride subsidization is present."""
    return bool(os.getenv("RIDE_PARTNER_API_KEY"))


# Crockford-style alphabet: no O/0, no I/1. A tired donor reads this code off a
# phone screen to a driver at a kerbside, and a code that cannot be misheard is
# worth more than the two extra characters of entropy that 0/O would add.
_PROMO_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_PROMO_BLOCK = 4
_PROMO_BLOCKS = 2


def new_promo_code(prefix: Optional[str] = None) -> str:
    """A fresh random ride-home code, e.g. `SPONDON-RIDE-K7M2-QX9P`.

    Every donor gets their own code — never a shared house coupon. `secrets`
    rather than `random` because a guessable code is a free ride for anyone who
    can count, and the whole subsidy is drawn against a partner's budget.
    """
    prefix = (prefix or config.BOUNTY_PROMO_PREFIX).strip("-").upper() or "SPONDON"
    blocks = [
        "".join(secrets.choice(_PROMO_ALPHABET) for _ in range(_PROMO_BLOCK))
        for _ in range(_PROMO_BLOCKS)
    ]
    return f"{prefix}-RIDE-" + "-".join(blocks)


async def generate_ride_promo(hospital: str, *, donor_name: str = "") -> dict:
    """Mint a subsidised ride-home code for one donor.

    Returns `{promo_code, partner, value_bdt, ttl_hours, simulated}`. The code
    is randomly generated either way — with no partner key the *booking* is
    simulated, but the donor still gets a real, unique code rather than a
    placeholder string that a second donor would also be shown.
    """
    partner = config.RIDE_PARTNERS[0] if config.RIDE_PARTNERS else "Pathao"
    code = new_promo_code()
    payload = {
        "promo_code": code,
        "partner": partner,
        "value_bdt": config.BOUNTY_PROMO_VALUE_BDT,
        "ttl_hours": config.BOUNTY_PROMO_TTL_HOURS,
        "simulated": True,
    }

    if not ride_sharing_configured():
        return payload

    # With a partner key present, register the voucher against the partner's
    # B2B API so their app will actually honour it. A failure here is not fatal:
    # the donor keeps the locally-minted code and support can redeem it by hand,
    # which is a far better outcome than no ride at all.
    url = os.getenv("RIDE_PARTNER_API_URL")
    if not url:
        payload["simulated"] = False
        return payload
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {os.getenv('RIDE_PARTNER_API_KEY')}"},
                json={
                    "code": code,
                    "value_bdt": payload["value_bdt"],
                    "valid_for_hours": payload["ttl_hours"],
                    "pickup": hospital,
                    "reference": f"Spondon platelet donor{f' — {donor_name}' if donor_name else ''}",
                },
            )
            resp.raise_for_status()
            body = resp.json() if resp.content else {}
        payload["promo_code"] = body.get("code") or code
        payload["partner"] = body.get("partner") or partner
        payload["simulated"] = False
    except Exception:
        log.warning("Ride partner voucher API failed — issuing local code %s", code,
                    exc_info=True)
    return payload


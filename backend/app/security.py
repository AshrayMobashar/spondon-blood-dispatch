"""Authentication — bcrypt hashing + JWT bearer tokens for two audiences.

Admins sign in with an email and password. End users (donors and patients) have
no password at all: their identity is a phone number proven by an SMS one-time
code, so `issue_user_token` is called by the OTP-verify path rather than by a
login form.

Tokens carry an `aud` claim and the dependencies check it, so a user token can
never be replayed against an admin endpoint.
"""
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer

from . import config
from .models import Account, Admin, ACTIVE, BANNED

JWT_SECRET = config.JWT_SECRET
JWT_ALGORITHM = config.JWT_ALGORITHM
TOKEN_TTL_HOURS = config.ADMIN_TOKEN_TTL_HOURS

AUD_ADMIN = "admin"
AUD_USER = "user"
AUD_REGISTER = "register"

# A verified-but-unregistered phone gets a short-lived ticket instead of being
# asked to prove the same number twice. Long enough to fill in a name, short
# enough to be worthless if it leaks.
REGISTER_TICKET_TTL_MINUTES = 15

# tokenUrl is where Swagger's "Authorize" button posts; matches the admin router.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/admin/login")


# ── Passwords (admins only) ──────────────────────────────────────────
def hash_password(plain: str) -> str:
    # bcrypt caps input at 72 bytes; encode then hash with a per-password salt.
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


# ── One-time codes ───────────────────────────────────────────────────
def generate_otp() -> str:
    """A cryptographically random numeric code — never a Math.random() on the
    client, which the user could simply read."""
    upper = 10 ** config.OTP_LENGTH
    return str(secrets.randbelow(upper)).zfill(config.OTP_LENGTH)


def hash_otp(code: str, phone: str) -> str:
    """Codes are stored hashed and salted by phone, so a database read cannot
    be turned into a login."""
    return sha256(f"{phone}:{code}:{JWT_SECRET}".encode("utf-8")).hexdigest()


def otp_matches(code: str, phone: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_otp(code, phone), stored_hash)


# ── Tokens ───────────────────────────────────────────────────────────
def _encode(sub: str, audience: str, ttl_hours: int, **claims) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub,
        "aud": audience,
        "iat": now,
        "exp": now + timedelta(hours=ttl_hours),
        **claims,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_access_token(admin: Admin) -> str:
    return _encode(
        str(admin.id), AUD_ADMIN, TOKEN_TTL_HOURS, email=admin.email, role=admin.role
    )


def issue_user_token(account: Account) -> str:
    return _encode(
        str(account.id), AUD_USER, config.USER_TOKEN_TTL_HOURS,
        phone=account.phone, role=account.role,
    )


def issue_registration_ticket(phone: str) -> str:
    """Proof that `phone` was just verified, redeemable once at /auth/register."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": phone,
        "aud": AUD_REGISTER,
        "iat": now,
        "exp": now + timedelta(minutes=REGISTER_TICKET_TTL_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def phone_from_registration_ticket(token: str) -> Optional[str]:
    """The verified phone a ticket vouches for, or None if it is not valid."""
    try:
        return jwt.decode(
            token, JWT_SECRET, algorithms=[JWT_ALGORITHM], audience=AUD_REGISTER
        ).get("sub")
    except jwt.PyJWTError:
        return None


def _decode(token: str, audience: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM], audience=audience)


_credentials_error = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated or token expired",
    headers={"WWW-Authenticate": "Bearer"},
)


# ── Dependencies ─────────────────────────────────────────────────────
async def get_current_admin(token: str = Depends(oauth2_scheme)) -> Admin:
    """Decode an admin bearer token → live Admin document."""
    try:
        payload = _decode(token, AUD_ADMIN)
    except jwt.PyJWTError:
        raise _credentials_error

    admin_id = payload.get("sub")
    if not admin_id:
        raise _credentials_error
    admin = await Admin.get(admin_id)
    if admin is None:
        raise _credentials_error
    return admin


def _bearer(request: Request) -> Optional[str]:
    header = request.headers.get("Authorization") or ""
    scheme, _, token = header.partition(" ")
    return token if scheme.lower() == "bearer" and token else None


async def get_current_account(request: Request) -> Account:
    """Decode a user bearer token → live Account document.

    A banned account is rejected here, at the door: enforcement lives in one
    place rather than being re-checked (and forgotten) endpoint by endpoint.
    """
    token = _bearer(request)
    if not token:
        raise _credentials_error
    try:
        payload = _decode(token, AUD_USER)
    except jwt.PyJWTError:
        raise _credentials_error

    account = await Account.get(payload.get("sub") or "")
    if account is None:
        raise _credentials_error
    if account.status == BANNED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "This account has been banned.",
                "reason": account.status_reason,
            },
        )
    return account


async def get_optional_account(request: Request) -> Optional[Account]:
    """Same, but returns None instead of raising when unauthenticated.

    Used where an endpoint accepts both signed-in and anonymous callers.
    """
    if not _bearer(request):
        return None
    try:
        return await get_current_account(request)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_403_FORBIDDEN:
            raise
        return None


def is_active(account: Account) -> bool:
    """A shadow-banned account is deliberately *not* blocked — it must keep
    working normally from the user's point of view."""
    return account.status in (ACTIVE, "SHADOW_BANNED")

"""Admin authentication — bcrypt password hashing + JWT bearer tokens.

The admin console is a "secure panel": every admin endpoint (except /login)
depends on `get_current_admin`, which validates a signed JWT from the
Authorization: Bearer <token> header and loads the matching Admin document.
"""
import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from .models import Admin

# Signing secret — override in .env for anything real. Dev fallback kept simple.
JWT_SECRET = os.getenv("JWT_SECRET", "spondon-dev-secret-change-me-in-production-please")
JWT_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = int(os.getenv("ADMIN_TOKEN_TTL_HOURS", "12"))

# tokenUrl is where Swagger's "Authorize" button posts; matches the admin router.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/admin/login")


def hash_password(plain: str) -> str:
    # bcrypt caps input at 72 bytes; encode then hash with a per-password salt.
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(admin: Admin) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(admin.id),
        "email": admin.email,
        "role": admin.role,
        "iat": now,
        "exp": now + timedelta(hours=TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_admin(token: str = Depends(oauth2_scheme)) -> Admin:
    """FastAPI dependency: decode the bearer token → live Admin document."""
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated or token expired",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise credentials_error

    admin_id = payload.get("sub")
    if not admin_id:
        raise credentials_error

    admin = await Admin.get(admin_id)
    if admin is None:
        raise credentials_error
    return admin

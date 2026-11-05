"""Google OAuth 2.0 & Session Management API.

Handles Google ID token verification, JWT session issuance, role assignment
(via ADMIN_EMAILS allowlist), and multi-user authentication dependency.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
import httpx

from app.models.schemas import (
    AuthSession,
    GoogleAuthRequest,
    GoogleAuthResponse,
    Role,
    UserProfile,
)
from app.services.state import State, get_state

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
DEFAULT_ADMIN_EMAILS = {"bikashtalukder040@gmail.com"}


def _jwt_secret() -> bytes:
    secret = os.environ.get("JWT_SECRET", "").strip()
    if (
        len(secret.encode("utf-8")) < 32
        or secret == "nutrivision-secure-jwt-secret-key-prod-v1"
    ):
        raise RuntimeError(
            "JWT_SECRET must be a unique value with at least 32 characters; "
            "generate one with `openssl rand -hex 32`."
        )
    return secret.encode("utf-8")


def _admin_emails() -> set[str]:
    raw = os.environ.get("ADMIN_EMAILS", "")
    configured = {e.strip().lower() for e in raw.split(",") if e.strip()}
    return configured | DEFAULT_ADMIN_EMAILS


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(s: str) -> bytes:
    padding = 4 - (len(s) % 4)
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s)


def create_jwt(payload: dict[str, Any], secret: bytes | None = None) -> str:
    """Create a signed HMAC-SHA256 JWT."""
    sec = secret or _jwt_secret()
    header = {"alg": "HS256", "typ": "JWT"}
    h_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    p_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")

    unsigned = f"{_b64url_encode(h_bytes)}.{_b64url_encode(p_bytes)}"
    sig = hmac.new(sec, unsigned.encode("utf-8"), hashlib.sha256).digest()
    return f"{unsigned}.{_b64url_encode(sig)}"


def verify_jwt(token: str, secret: bytes | None = None) -> dict[str, Any] | None:
    """Verify an HMAC-SHA256 JWT signature and check expiration."""
    try:
        parts = token.strip().split(".")
        if len(parts) != 3:
            return None
        h_b64, p_b64, sig_b64 = parts
        sec = secret or _jwt_secret()
        expected_sig = hmac.new(
            sec, f"{h_b64}.{p_b64}".encode("utf-8"), hashlib.sha256
        ).digest()
        actual_sig = _b64url_decode(sig_b64)
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None
        payload = json.loads(_b64url_decode(p_b64).decode("utf-8"))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


def verify_google_id_token(id_token: str, timeout: float = 6.0) -> dict[str, Any]:
    """Verify Google ID token via Google's tokeninfo endpoint.

    Requires GOOGLE_CLIENT_ID and verifies the token audience against it.
    """
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(GOOGLE_TOKENINFO_URL, params={"id_token": id_token})
            if resp.status_code != 200:
                log.warning("Google tokeninfo returned status %d: %s", resp.status_code, resp.text)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired Google ID token.",
                )
            data = resp.json()

        # Check expiration
        exp = int(data.get("exp", 0))
        if exp < time.time():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Google ID token is expired.",
            )

        # Reject tokens issued to another OAuth application.
        client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
        if not client_id:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Google OAuth is not configured on this server.",
            )
        audience = data.get("aud", "")
        audiences = {audience} if isinstance(audience, str) else set(audience or [])
        if client_id not in audiences:
            log.warning("Google token audience mismatch: aud=%s vs expected=%s", audience, client_id)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Google token audience mismatch.",
            )

        # Check email verified
        if str(data.get("email_verified", "")).lower() != "true":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Google account email must be verified.",
            )

        return data
    except HTTPException:
        raise
    except Exception as exc:
        log.error("Google token verification network failure: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to verify Google credentials with Google OAuth service.",
        )


def get_current_user_optional(
    request: Request,
    state: State = Depends(get_state),
) -> AuthSession | None:
    """Dependency that extracts the current user if a valid Bearer token is provided.
    Does not raise 401 on absence — returns None to allow demo/guest fallback."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    payload = verify_jwt(token)
    if not payload:
        return None

    email = payload.get("email", "").lower().strip()
    if not email:
        return None

    role: Role = "admin" if email in _admin_emails() or payload.get("role") == "admin" else "user"
    name = payload.get("name")
    avatar_url = payload.get("picture") or payload.get("avatar_url")

    # Robustness: Recreate user record if missing from store (e.g. after DB reset or redeploy)
    if not state.has_user(email):
        try:
            state.get_or_create_user(
                email=email,
                name=name,
                avatar_url=avatar_url,
                role=role,
            )
        except Exception as exc:
            log.warning("Could not automatically recreate user %s from token: %s", email, exc)

    return AuthSession(
        email=email,
        role=role,
        login_at=payload.get("login_at", datetime.now(timezone.utc).isoformat()),
        name=name,
        avatar_url=avatar_url,
        token=token,
        sub=payload.get("sub"),
    )


def require_current_user(
    current_user: AuthSession | None = Depends(get_current_user_optional),
) -> AuthSession:
    """Dependency that enforces a valid authenticated session."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in with Google.",
        )
    return current_user


def require_admin_user(
    current_user: AuthSession = Depends(require_current_user),
) -> AuthSession:
    """Dependency that enforces admin privileges."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required.",
        )
    return current_user


@router.post("/google", response_model=GoogleAuthResponse)
def sign_in_with_google(
    body: GoogleAuthRequest,
    state: State = Depends(get_state),
) -> GoogleAuthResponse:
    """Sign in or register using a Google ID token from Google Identity Services."""
    token_data = verify_google_id_token(body.id_token)

    email = token_data["email"].lower().strip()
    name = token_data.get("name")
    picture = token_data.get("picture")
    sub = token_data.get("sub")

    # Determine role based on admin emails whitelist
    admins = _admin_emails()
    role: Role = "admin" if email in admins else "user"

    # Upsert user record in backend state
    state.get_or_create_user(email=email, name=name, avatar_url=picture, role=role)
    user_profile = state.get_user_profile(email)
    if name and not user_profile.name:
        user_profile.name = name
        state.set_user_profile(email, user_profile)

    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    session_payload = {
        "sub": sub,
        "email": email,
        "name": name,
        "picture": picture,
        "role": role,
        "login_at": now_iso,
        "iat": int(time.time()),
        "exp": int(time.time()) + (14 * 86400),  # 14 days TTL
    }
    app_token = create_jwt(session_payload)

    session = AuthSession(
        email=email,
        role=role,
        login_at=now_iso,
        name=name,
        avatar_url=picture,
        token=app_token,
        sub=sub,
    )

    return GoogleAuthResponse(
        session=session,
        token=app_token,
        profile=user_profile,
    )


@router.get("/me", response_model=AuthSession)
def get_current_user_profile(
    current_user: AuthSession = Depends(require_current_user),
) -> AuthSession:
    """Return the authenticated user's session profile."""
    return current_user

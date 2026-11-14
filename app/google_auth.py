"""Sign in with Google for the Meet connector.

The person creates an OAuth client (type "Web application") in Google Cloud, pastes its client id
and secret into Settings, and presses "Sign in with Google". Google sends them back to
/api/connectors/google/callback with a code; we swap it for a refresh token and keep that in the
settings table. From then on `access_token()` hands out a fresh access token whenever the last
one is about to expire, so the connection keeps working after the first hour.

A pasted access token (google_access_token, e.g. from the OAuth Playground) still works as a
fallback when no refresh token is saved.

Nothing here runs on a public deployment unless FASTTRACK_PUBLIC_CONNECTORS=1: a visitor must
never reach the owner's Google account.
"""

from __future__ import annotations

import os
import secrets
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from . import db, events, mode

router = APIRouter()

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
SCOPES = [
    "openid", "email",
    "https://www.googleapis.com/auth/meetings.space.readonly",   # Meet: calls, participants, transcripts
    "https://www.googleapis.com/auth/drive.meet.readonly",       # Drive: the files Meet saved (recordings)
]
CALLBACK = "/api/connectors/google/callback"
SETTINGS_PAGE = "/fast-track/settings"


class GoogleAuthError(RuntimeError):
    pass


def allowed() -> bool:
    """Connectors may use the owner's own accounts here (always on a private install)."""
    return not mode.public() or os.environ.get("FASTTRACK_PUBLIC_CONNECTORS", "").lower() in ("1", "true", "yes", "on")


def client() -> tuple[str, str]:
    return db.get_setting("google_client_id"), db.get_setting("google_client_secret")


def redirect_uri(request: Request) -> str:
    base = db.get_setting("public_url") or str(request.base_url)
    return base.rstrip("/") + CALLBACK


def signed_in() -> bool:
    return bool(db.get_setting("google_refresh_token"))


def access_token() -> str:
    """A working access token: refreshed from the saved refresh token when needed, or the pasted one."""
    if not allowed():
        return ""
    refresh = db.get_setting("google_refresh_token")
    if not refresh:
        return db.get_setting("google_access_token")
    tok, exp = db.get_setting("google_oauth_access"), db.get_setting("google_oauth_expires")
    if tok and exp and float(exp) - 60 > time.time():
        return tok
    cid, csec = client()
    if not (cid and csec):
        raise GoogleAuthError("Google client id and secret are missing. Save them in Settings.")
    r = httpx.post(TOKEN_URL, timeout=15, data={"client_id": cid, "client_secret": csec,
                                                "refresh_token": refresh, "grant_type": "refresh_token"})
    if r.status_code >= 400:
        err = _err(r)
        if "invalid_grant" in err:
            raise GoogleAuthError("Google sign-in has expired or was revoked. Press Sign in with Google again.")
        raise GoogleAuthError(f"Google token refresh failed: {err}")
    data = r.json()
    db.set_setting("google_oauth_access", data["access_token"])
    db.set_setting("google_oauth_expires", str(time.time() + int(data.get("expires_in", 3600))))
    return data["access_token"]


def _err(r: httpx.Response) -> str:
    try:
        j = r.json()
        return str(j.get("error_description") or j.get("error") or r.status_code)[:200]
    except ValueError:
        return str(r.status_code)


def _guard() -> None:
    if not allowed():
        raise HTTPException(403, "Google sign-in is off on this public demo.")


@router.get("/api/connectors/google/start")
def start(request: Request):
    _guard()
    cid, csec = client()
    if not (cid and csec):
        raise HTTPException(400, "Save the Google client id and secret first.")
    state = secrets.token_urlsafe(24)
    db.set_setting("google_oauth_state", state)
    q = {"client_id": cid, "redirect_uri": redirect_uri(request), "response_type": "code",
         "scope": " ".join(SCOPES), "access_type": "offline", "prompt": "consent",
         "include_granted_scopes": "true", "state": state}
    return RedirectResponse(f"{AUTH_URL}?{urlencode(q)}", status_code=303)


@router.get(CALLBACK)
def callback(request: Request, code: str = "", state: str = "", error: str = ""):
    _guard()
    expected = db.get_setting("google_oauth_state")
    if error:
        return RedirectResponse(f"{SETTINGS_PAGE}?google=" + urlencode({"e": error})[2:], status_code=303)
    if not (state and expected and secrets.compare_digest(state, expected)):
        raise HTTPException(400, "This sign-in link is stale. Press Sign in with Google again.")
    db.set_setting("google_oauth_state", "")
    cid, csec = client()
    r = httpx.post(TOKEN_URL, timeout=15, data={"client_id": cid, "client_secret": csec, "code": code,
                                                "redirect_uri": redirect_uri(request),
                                                "grant_type": "authorization_code"})
    if r.status_code >= 400:
        return RedirectResponse(f"{SETTINGS_PAGE}?google=" + urlencode({"e": _err(r)})[2:], status_code=303)
    data = r.json()
    if data.get("refresh_token"):
        db.set_setting("google_refresh_token", data["refresh_token"])
    db.set_setting("google_oauth_access", data["access_token"])
    db.set_setting("google_oauth_expires", str(time.time() + int(data.get("expires_in", 3600))))
    db.set_setting("google_oauth_scopes", data.get("scope", ""))
    email = ""
    try:
        u = httpx.get(USERINFO_URL, timeout=10, headers={"Authorization": f"Bearer {data['access_token']}"})
        email = u.json().get("email", "") if u.status_code < 400 else ""
    except httpx.HTTPError:
        pass
    db.set_setting("google_account", email)
    events.emit(None, "Google Meet", "sync", f"Signed in to Google{' as ' + email if email else ''}")
    return RedirectResponse(f"{SETTINGS_PAGE}?google=ok", status_code=303)


@router.post("/api/connectors/google/disconnect")
def disconnect():
    _guard()
    if mode.public():
        raise HTTPException(403, "Settings are read-only on this public demo.")
    tok = db.get_setting("google_refresh_token")
    if tok:
        try:
            httpx.post(REVOKE_URL, timeout=10, data={"token": tok})
        except httpx.HTTPError:
            pass
    for k in ("google_refresh_token", "google_oauth_access", "google_oauth_expires", "google_oauth_scopes",
              "google_account"):
        db.set_setting(k, "")
    return {"ok": True}


def info() -> dict:
    cid, csec = client()
    scopes = db.get_setting("google_oauth_scopes")
    return {"client_saved": bool(cid and csec), "signed_in": signed_in() and allowed(),
            "account": db.get_setting("google_account") if allowed() else "",
            "drive": "drive.meet.readonly" in scopes or "drive.readonly" in scopes,
            "redirect_path": CALLBACK, "allowed": allowed()}

"""Lightweight username/password auth - a stopgap before real SSO.

Users live in backend/users.json (gitignored - never commit real credentials),
one entry per person: {username, passwordHash, salt, displayName, csmName, role}.
Passwords are hashed with PBKDF2-HMAC-SHA256 (stdlib only, no extra dependency).

`csmName` should match the person's Owner.Name in Salesforce/mock data so the
frontend can default their "View as" scope to their own book. `role` is stored
for future use (manager/admin distinctions) but doesn't gate anything yet.

Manage users with `python manage_users.py add <username> ...` - see that file.
This is intentionally simple: swapping to real SSO later means replacing
verify_user()'s call site, not the session/cookie plumbing built on top of it.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
USERS_FILE = BACKEND_DIR / "users.json"

PBKDF2_ITERATIONS = 100_000


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    ).hex()
    return salt, digest


def load_users() -> list[dict]:
    if not USERS_FILE.exists():
        return []
    try:
        return json.loads(USERS_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return []


def save_users(users: list[dict]) -> None:
    USERS_FILE.write_text(json.dumps(users, indent=2) + "\n")


def find_user(username: str) -> dict | None:
    username = (username or "").strip().lower()
    for u in load_users():
        if u.get("username", "").lower() == username:
            return u
    return None


def verify_user(username: str, password: str) -> dict | None:
    user = find_user(username)
    if not user or not password:
        return None
    salt, expected = user.get("salt"), user.get("passwordHash")
    if not salt or not expected:
        return None
    _, actual = hash_password(password, salt)
    if not hmac.compare_digest(actual, expected):
        return None
    return user


def public_user(user: dict) -> dict:
    """Strips password/salt before returning a user to the frontend."""
    return {
        "username": user["username"],
        "displayName": user.get("displayName") or user["username"],
        "csmName": user.get("csmName"),
        "role": user.get("role", "csm"),
    }

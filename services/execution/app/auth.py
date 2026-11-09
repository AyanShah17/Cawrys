"""Password hashing, JWT issue/verify and role guards. Identical copy lives in the execution service."""
import hashlib
import hmac
import os
import time
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException

SECRET = os.environ.get("AUTH_SECRET", "")
if not SECRET:
    SECRET = "dev-insecure-secret-change-me-32b"
    print("WARNING: AUTH_SECRET not set; using an insecure development secret")
TTL_SECONDS = 12 * 3600
ROLES = ("admin", "engineer", "approver", "viewer")


@dataclass
class Ctx:
    user_id: str
    tenant_id: str
    role: str
    email: str


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, hash_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        h = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
        return hmac.compare_digest(h.hex(), hash_hex)
    except Exception:
        return False


def make_token(user_id: str, tenant_id: str, role: str, email: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": user_id, "tid": tenant_id, "role": role, "email": email, "iat": now, "exp": now + TTL_SECONDS},
        SECRET,
        algorithm="HS256",
    )


def current(authorization: str | None = Header(None)) -> Ctx:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    try:
        c = jwt.decode(authorization[7:].strip(), SECRET, algorithms=["HS256"], options={"require": ["exp", "sub", "tid", "role"]})
    except jwt.PyJWTError:
        raise HTTPException(401, "invalid or expired token")
    if c["role"] not in ROLES:
        raise HTTPException(401, "invalid role in token")
    return Ctx(user_id=c["sub"], tenant_id=c["tid"], role=c["role"], email=c.get("email", ""))


def require(*roles: str):
    def dep(ctx: Ctx = Depends(current)) -> Ctx:
        if roles and ctx.role not in roles:
            raise HTTPException(403, f"requires role: {', '.join(roles)}")
        return ctx

    return dep

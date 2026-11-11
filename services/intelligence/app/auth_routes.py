import logging
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .auth import ROLES, Ctx, current, hash_password, make_token, require, verify_password
from .config import DEFAULT_TENANT
from .db import audit, conn

log = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/v1/auth", tags=["auth"])

ALLOW_SIGNUP = os.environ.get("ALLOW_SIGNUP", "0") == "1"
BOOTSTRAP_ADMIN_EMAIL = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "")
BOOTSTRAP_ADMIN_PASSWORD = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", "")
BRAND_NAME = os.environ.get("BRAND_NAME", "Cawrys")
COMPANY_NAME = os.environ.get("BRAND_COMPANY", BRAND_NAME)
DEMO_DOMAIN = os.environ.get("DEMO_DOMAIN", "cawrys.local")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "cawrys-demo")
SEED_DEMO = os.environ.get("SEED_DEMO", "1") == "1"

WINDOW = "15 minutes"
MAX_FAILS_PER_EMAIL = 4  # triggers HTTP 429 on 5th attempt (after 4 recorded failures)
MAX_FAILS_PER_IP = 29    # triggers HTTP 429 on 30th attempt (after 29 recorded failures)
MIN_PASSWORD = 8

DUMMY_HASH = hash_password("not-a-real-password")  # keeps login timing similar for unknown emails


class LoginIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=500)


class SignupIn(BaseModel):
    company: str = Field(min_length=2, max_length=80)
    email: str = Field(max_length=200)
    password: str = Field(min_length=MIN_PASSWORD, max_length=200)


class UserIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(min_length=MIN_PASSWORD, max_length=200)
    role: str


class UserPatch(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=MIN_PASSWORD, max_length=200)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=500)
    new_password: str = Field(min_length=MIN_PASSWORD, max_length=200)


def _session(user: dict) -> dict:
    token = make_token(str(user["id"]), str(user["tenant_id"]), user["role"], user["email"])
    return {
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user["id"]),
            "email": user["email"],
            "role": user["role"],
            "tenant_id": str(user["tenant_id"]),
            "is_active": bool(user.get("is_active", 1)),
        },
    }


def _clean_email(email: str) -> str:
    email = email.strip().lower()
    if "@" not in email or len(email) < 3:
        raise HTTPException(422, "enter a valid email address")
    return email


@router.post("/login")
def login(body: LoginIn, request: Request):
    email = body.email.strip().lower()
    ip = (request.headers.get("x-client-ip") or (request.client.host if request.client else ""))[:64]

    with conn() as c:
        # Prune ancient attempts older than 1 day
        c.execute("delete from login_attempts where created_at < now() - interval '1 day'")

        # 1. Check sliding window failed attempts for email
        fails_email_row = c.execute(
            f"select count(*)::int as n from login_attempts where email=%s and not ok and created_at > now() - interval '{WINDOW}'",
            (email,),
        ).fetchone()
        fails_email = fails_email_row["n"] if fails_email_row else 0

        # 2. Check sliding window failed attempts for IP (if IP present)
        fails_ip = 0
        if ip:
            fails_ip_row = c.execute(
                f"select count(*)::int as n from login_attempts where ip=%s and not ok and created_at > now() - interval '{WINDOW}'",
                (ip,),
            ).fetchone()
            fails_ip = fails_ip_row["n"] if fails_ip_row else 0

        # 3. Rate limit breach -> 429 Too Many Requests with Retry-After: 900
        if fails_email >= MAX_FAILS_PER_EMAIL or fails_ip >= MAX_FAILS_PER_IP:
            c.commit()
            raise HTTPException(
                status_code=429,
                detail="Too many failed attempts. Try again in 15 minutes.",
                headers={"Retry-After": "900"},
            )

        # 4. Lookup user and verify password with constant-time dummy hash verification
        user = c.execute("select * from users where email=%s", (email,)).fetchone()
        ok = verify_password(body.password, user["password_hash"] if user else DUMMY_HASH)

        # 5. Check if user is inactive / disabled
        if user and ok and not user.get("is_active", 1):
            c.execute("insert into login_attempts (email, ip, ok) values (%s,%s,%s)", (email, ip, 0))
            audit(c, user["tenant_id"], "auth.login_failed", detail={"email": email, "ip": ip, "reason": "disabled"}, actor=email)
            c.commit()
            raise HTTPException(403, "Account is disabled. Contact your administrator.")

        # 6. Invalid credentials handling
        if not (user and ok):
            c.execute("insert into login_attempts (email, ip, ok) values (%s,%s,%s)", (email, ip, 0))
            if user:
                audit(c, user["tenant_id"], "auth.login_failed", detail={"email": email, "ip": ip}, actor=email)
            c.commit()
            raise HTTPException(401, "invalid email or password")

        # 7. Successful login
        c.execute("insert into login_attempts (email, ip, ok) values (%s,%s,%s)", (email, ip, 1))
        c.execute("delete from login_attempts where email=%s and not ok", (email,))
        c.execute("update users set last_login_at=now() where id=%s", (user["id"],))
        audit(c, user["tenant_id"], "auth.login", detail={"ip": ip}, actor=email)
        c.commit()

    return _session(user)


@router.post("/signup")
def signup(body: SignupIn):
    if not ALLOW_SIGNUP:
        raise HTTPException(403, "signup is disabled; ask an admin to create your account")
    email = _clean_email(body.email)
    with conn() as c:
        if c.execute("select 1 from users where email=%s", (email,)).fetchone():
            raise HTTPException(409, "email already registered")
        tid = str(uuid.uuid4())
        uid = str(uuid.uuid4())
        c.execute("insert into tenants (id, name) values (%s,%s)", (tid, body.company.strip()))
        c.execute(
            "insert into users (id, tenant_id, email, role, password_hash, is_active) values (%s,%s,%s,'admin',%s,1)",
            (uid, tid, email, hash_password(body.password)),
        )
        user = c.execute("select * from users where id=%s", (uid,)).fetchone()
        audit(c, tid, "tenant.created", actor=email, detail={"company": body.company.strip()})
        c.commit()
    return _session(user)


@router.get("/me")
def me(ctx: Ctx = Depends(current)):
    with conn() as c:
        row = c.execute("select name from tenants where id=%s", (ctx.tenant_id,)).fetchone()
        tenant_name = row["name"] if row else "Default"
    return {
        "id": ctx.user_id,
        "email": ctx.email,
        "role": ctx.role,
        "tenant_id": ctx.tenant_id,
        "tenant_name": tenant_name,
    }


@router.get("/users")
def list_users(ctx: Ctx = Depends(require("admin"))):
    with conn() as c:
        rows = c.execute(
            "select id, email, role, is_active, last_login_at, created_at "
            "from users where tenant_id=%s order by created_at",
            (ctx.tenant_id,),
        ).fetchall()
        for r in rows:
            r["id"] = str(r["id"])
            r["is_active"] = bool(r.get("is_active", 1))
        return rows


@router.post("/users")
def create_user(body: UserIn, ctx: Ctx = Depends(require("admin"))):
    if body.role not in ROLES:
        raise HTTPException(400, f"role must be one of {', '.join(ROLES)}")
    email = _clean_email(body.email)
    with conn() as c:
        if c.execute("select 1 from users where email=%s", (email,)).fetchone():
            raise HTTPException(409, "email already registered")
        uid = str(uuid.uuid4())
        c.execute(
            "insert into users (id, tenant_id, email, role, password_hash, is_active) values (%s,%s,%s,%s,%s,1)",
            (uid, ctx.tenant_id, email, body.role, hash_password(body.password)),
        )
        audit(c, ctx.tenant_id, "user.created", actor=ctx.email, detail={"email": email, "role": body.role})
        c.commit()
    return {"id": uid, "email": email, "role": body.role}


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: UserPatch, ctx: Ctx = Depends(require("admin"))):
    try:
        uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(404, "user not found")
    if body.role is not None and body.role not in ROLES:
        raise HTTPException(400, f"role must be one of {', '.join(ROLES)}")

    with conn() as c:
        target = c.execute("select * from users where id=%s and tenant_id=%s", (user_id, ctx.tenant_id)).fetchone()
        if not target:
            raise HTTPException(404, "user not found")

        target_is_active = bool(target.get("is_active", 1))
        # Admin safety rule 1: Admin cannot demote their own role or disable their own account
        if str(target["id"]) == ctx.user_id and (body.is_active is False or (body.role and body.role != target["role"])):
            raise HTTPException(409, "you cannot change your own role or disable your own account")

        # Admin safety rule 2: At least one active admin must remain in the tenant
        losing_admin = target["role"] == "admin" and target_is_active and (
            (body.role is not None and body.role != "admin") or body.is_active is False
        )
        if losing_admin:
            others = c.execute(
                "select count(*)::int as n from users where tenant_id=%s and role='admin' and is_active and id<>%s",
                (ctx.tenant_id, user_id),
            ).fetchone()["n"]
            if others == 0:
                raise HTTPException(409, "at least one active admin must remain")

        changes = {}
        if body.role is not None:
            c.execute("update users set role=%s where id=%s", (body.role, user_id))
            changes["role"] = body.role
        if body.is_active is not None:
            active_val = 1 if body.is_active else 0
            c.execute("update users set is_active=%s where id=%s", (active_val, user_id))
            changes["is_active"] = body.is_active
        if body.password is not None:
            c.execute("update users set password_hash=%s where id=%s", (hash_password(body.password), user_id))
            changes["password"] = "reset"

        audit(c, ctx.tenant_id, "user.updated", actor=ctx.email, detail={"email": target["email"], **changes})
        c.commit()
    return {"ok": True}


@router.post("/me/password")
def change_password(body: PasswordChange, ctx: Ctx = Depends(current)):
    with conn() as c:
        row = c.execute("select password_hash from users where id=%s", (ctx.user_id,)).fetchone()
        if not row or not verify_password(body.current_password, row["password_hash"]):
            raise HTTPException(400, "current password is incorrect")
        c.execute("update users set password_hash=%s where id=%s", (hash_password(body.new_password), ctx.user_id))
        audit(c, ctx.tenant_id, "user.password_changed", actor=ctx.email)
        c.commit()
    return {"ok": True}


def bootstrap_admin() -> None:
    """Bootstrap the initial admin from environment variables when no users exist."""
    with conn() as c:
        if c.execute("select 1 from users limit 1").fetchone():
            return
        if not (BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD):
            log.warning("No users exist. Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.")
            return
        c.execute("update tenants set name=%s where id=%s", (COMPANY_NAME, DEFAULT_TENANT))
        c.execute(
            "insert into users (tenant_id, email, role, password_hash, is_active) values (%s,%s,'admin',%s,1)",
            (DEFAULT_TENANT, BOOTSTRAP_ADMIN_EMAIL, hash_password(BOOTSTRAP_ADMIN_PASSWORD)),
        )
        audit(c, DEFAULT_TENANT, "admin.bootstrapped", actor="system", detail={"email": BOOTSTRAP_ADMIN_EMAIL})
        c.commit()
    log.info("Created initial admin account: %s", BOOTSTRAP_ADMIN_EMAIL)


def seed_demo_users() -> None:
    """Seed demo accounts for local development and smoke tests."""
    if not SEED_DEMO:
        return
    with conn() as c:
        if c.execute("select 1 from users where tenant_id=%s limit 1", (DEFAULT_TENANT,)).fetchone():
            return
        for role in ROLES:
            c.execute(
                "insert into users (tenant_id, email, role, password_hash, is_active) values (%s,%s,%s,%s,1)",
                (DEFAULT_TENANT, f"{role}@{DEMO_DOMAIN}", role, hash_password(DEMO_PASSWORD)),
            )
        c.execute("update tenants set name=%s where id=%s", (f"{BRAND_NAME} Demo", DEFAULT_TENANT))
        audit(c, DEFAULT_TENANT, "demo.users_seeded")
        c.commit()

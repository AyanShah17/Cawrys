import os
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .auth import ROLES, Ctx, current, hash_password, make_token, require, verify_password
from .config import DEFAULT_TENANT
from .db import audit, conn

router = APIRouter(prefix="/v1/auth", tags=["auth"])
ALLOW_SIGNUP = os.environ.get("ALLOW_SIGNUP", "0") == "1"
DUMMY_HASH = hash_password("not-a-real-password")  # keeps login timing similar for unknown emails


class LoginIn(BaseModel):
    email: str
    password: str


class SignupIn(BaseModel):
    company: str = Field(min_length=2, max_length=80)
    email: str
    password: str = Field(min_length=8, max_length=200)


class UserIn(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=200)
    role: str


def _session(user: dict) -> dict:
    token = make_token(str(user["id"]), str(user["tenant_id"]), user["role"], user["email"])
    return {"token": token, "user": {"email": user["email"], "role": user["role"], "tenant_id": str(user["tenant_id"])}}


@router.post("/login")
def login(body: LoginIn):
    email = body.email.strip().lower()
    with conn() as c:
        user = c.execute("select * from users where email=%s", (email,)).fetchone()
        ok = verify_password(body.password, user["password_hash"] if user else DUMMY_HASH)
        if not user or not ok:
            if user:
                audit(c, user["tenant_id"], "auth.login_failed", detail={"email": email})
                c.commit()
            raise HTTPException(401, "invalid email or password")
        audit(c, user["tenant_id"], "auth.login", actor=email)
        c.commit()
    return _session(user)


@router.post("/signup")
def signup(body: SignupIn):
    if not ALLOW_SIGNUP:
        raise HTTPException(403, "signup is disabled; ask an admin to create your account")
    email = body.email.strip().lower()
    with conn() as c:
        if c.execute("select 1 from users where email=%s", (email,)).fetchone():
            raise HTTPException(409, "email already registered")
        tid = str(uuid.uuid4())
        c.execute("insert into tenants (id, name) values (%s,%s)", (tid, body.company.strip()))
        row = c.execute(
            "insert into users (tenant_id, email, role, password_hash) values (%s,%s,'admin',%s) returning *",
            (tid, email, hash_password(body.password)),
        ).fetchone()
        audit(c, tid, "tenant.created", actor=email, detail={"company": body.company.strip()})
        c.commit()
    return _session(row)


@router.get("/me")
def me(ctx: Ctx = Depends(current)):
    return {"email": ctx.email, "role": ctx.role, "tenant_id": ctx.tenant_id}


@router.get("/users")
def list_users(ctx: Ctx = Depends(require("admin"))):
    with conn() as c:
        return c.execute(
            "select id, email, role, created_at from users where tenant_id=%s order by created_at", (ctx.tenant_id,)
        ).fetchall()


@router.post("/users")
def create_user(body: UserIn, ctx: Ctx = Depends(require("admin"))):
    if body.role not in ROLES:
        raise HTTPException(400, f"role must be one of {', '.join(ROLES)}")
    email = body.email.strip().lower()
    with conn() as c:
        if c.execute("select 1 from users where email=%s", (email,)).fetchone():
            raise HTTPException(409, "email already registered")
        c.execute(
            "insert into users (tenant_id, email, role, password_hash) values (%s,%s,%s,%s)",
            (ctx.tenant_id, email, body.role, hash_password(body.password)),
        )
        audit(c, ctx.tenant_id, "user.created", actor=ctx.email, detail={"email": email, "role": body.role})
        c.commit()
    return {"email": email, "role": body.role}


def seed_demo_users():
    """Demo accounts for the default tenant. Disable with SEED_DEMO=0 and change the password in real use."""
    password = os.environ.get("DEMO_PASSWORD", "cawrys-demo")
    with conn() as c:
        if c.execute("select 1 from users where tenant_id=%s limit 1", (DEFAULT_TENANT,)).fetchone():
            return
        for role in ROLES:
            c.execute(
                "insert into users (tenant_id, email, role, password_hash) values (%s,%s,%s,%s)",
                (DEFAULT_TENANT, f"{role}@cawrys.local", role, hash_password(password)),
            )
        audit(c, DEFAULT_TENANT, "demo.users_seeded")
        c.commit()

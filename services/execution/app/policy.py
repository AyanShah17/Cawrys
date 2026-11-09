"""Policy engine: deterministic allow / approval / deny decisions."""

FORBIDDEN_CONNECTORS = {"plc", "machine_direct"}  # no direct actuation; go through safety-gated systems


def decide(tool: dict, role: str, approved: bool) -> tuple[str, str]:
    if tool["connector"] in FORBIDDEN_CONNECTORS:
        return "deny", "direct equipment actuation is blocked; route via an interlocked MES/safety gateway"
    if role == "viewer":
        return "deny", "viewer role cannot execute"
    if tool["risk"] == "high" and role not in ("admin", "approver"):
        return "deny", "high-risk tools need admin or approver"
    if tool["risk"] in ("medium", "high") and not approved:
        return "needs_approval", f"{tool['risk']} risk requires human approval"
    return "allow", "ok"

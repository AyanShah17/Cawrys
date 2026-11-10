"""OpenHands Agent Execution Harness: Event Stream Models and Schemas.

Defines the Action-Observation event model, concrete Action and Observation
payload schemas, AgentSession model, and API request/response structures.
"""
from __future__ import annotations

import enum
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class EventType(str, enum.Enum):
    """Core OpenHands event taxonomy."""
    ACTION = "action"
    OBSERVATION = "observation"


class SessionStatus(str, enum.Enum):
    """Agent session lifecycle states."""
    RUNNING = "running"
    AWAITING_APPROVAL = "awaiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    REJECTED = "rejected"


class ActionType(str, enum.Enum):
    """Actions initiated by the agent or orchestrator."""
    SESSION_START = "session_start"
    PLAN = "plan"
    TOOL_CALL = "tool_call"
    DELEGATE = "delegate"
    APPROVAL_REQUEST = "approval_request"
    AGENT_FINISH = "agent_finish"


class ObservationType(str, enum.Enum):
    """Observations produced by tools, workers, policies, or the environment."""
    TOOL_RESULT = "tool_result"
    DELEGATE_RESULT = "delegate_result"
    POLICY = "policy"
    ERROR = "error"
    STATE_CHANGED = "state_changed"


# ---------------------------------------------------------------------------
# Core Action and Observation Wrappers
# ---------------------------------------------------------------------------

class Action(BaseModel):
    """Generic action representation emitted during loop execution."""
    name: str = Field(..., description="Action name / type identifier")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Action arguments and details")


class Observation(BaseModel):
    """Generic observation representation emitted during loop execution."""
    name: str = Field(..., description="Observation name / type identifier")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Observation outputs and telemetry")


# ---------------------------------------------------------------------------
# Typed Action Payload Schemas
# ---------------------------------------------------------------------------

class SessionStartPayload(BaseModel):
    """Emitted when a new agent session begins."""
    task: str = Field(..., description="User prompt or task instruction")
    context: Dict[str, Any] = Field(default_factory=dict, description="Execution context variables")
    max_steps: int = Field(default=10, description="Maximum step allowance")
    user_id: Optional[str] = Field(default=None, description="Initiating user UUID")
    tenant_id: Optional[str] = Field(default=None, description="Tenant UUID")


class PlanPayload(BaseModel):
    """Emitted when Gemini 4 Argon creates or revises the strategic execution plan."""
    thought: str = Field(..., description="Reasoning / cognitive monologue behind the plan")
    steps: List[str] = Field(default_factory=list, description="Ordered milestone steps")
    current_step_index: int = Field(default=0, description="Active step index (0-based)")
    estimated_risk: Optional[str] = Field(default=None, description="Assessed overall risk level")


class ToolCallPayload(BaseModel):
    """Emitted when the agent calls a tool connector."""
    tool_name: str = Field(..., description="Registered tool name")
    arguments: Dict[str, Any] = Field(default_factory=dict, description="Parameters passed to tool")
    call_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Correlation ID for observation")
    step: int = Field(default=0, description="Step index during which tool is invoked")
    risk: Optional[str] = Field(default=None, description="Tool risk rating (low, medium, high)")


class DelegatePayload(BaseModel):
    """Emitted when orchestrator delegates a subtask to Gemini 3.8 Flash worker."""
    worker_type: str = Field(..., description="Type of worker (e.g. 'extractor', 'vision', 'subagent')")
    subtask: str = Field(..., description="Natural language subtask specification")
    worker_model: str = Field(default="cawrys-extract", description="LiteLLM alias for worker model")
    input_data: Dict[str, Any] = Field(default_factory=dict, description="Input payload provided to worker")
    delegate_id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Correlation ID")


class ApprovalRequestPayload(BaseModel):
    """Emitted when policy gates tool execution awaiting human authorization."""
    tool_name: str = Field(..., description="Tool name requiring approval")
    connector: str = Field(..., description="Connector protocol (e.g. 'http', 'log')")
    risk: str = Field(..., description="Risk tier: 'medium' or 'high'")
    reason: str = Field(..., description="Policy justification for approval requirement")
    arguments: Dict[str, Any] = Field(default_factory=dict, description="Tool execution arguments awaiting review")
    requested_role: str = Field(default="approver", description="Role required to approve ('approver' | 'admin')")
    call_id: Optional[str] = Field(default=None, description="Associated tool call ID")


class AgentFinishPayload(BaseModel):
    """Emitted when the agent terminates or accomplishes its objective."""
    status: SessionStatus = Field(default=SessionStatus.COMPLETED, description="Terminal session status")
    summary: str = Field(..., description="Summary of work completed or failure rationale")
    result: Dict[str, Any] = Field(default_factory=dict, description="Structured final output data")
    steps_taken: int = Field(default=0, description="Total steps executed")


# ---------------------------------------------------------------------------
# Typed Observation Payload Schemas
# ---------------------------------------------------------------------------

class ToolResultPayload(BaseModel):
    """Observation returned after executing a tool connector."""
    tool_name: str = Field(..., description="Tool name executed")
    call_id: Optional[str] = Field(default=None, description="Matching ToolCall call_id")
    output: Any = Field(default=None, description="Output returned by connector")
    status: str = Field(default="success", description="'success' or 'error'")
    execution_time_ms: Optional[float] = Field(default=None, description="Execution duration in milliseconds")


class DelegateResultPayload(BaseModel):
    """Observation returned after worker subagent completes delegated work."""
    delegate_id: Optional[str] = Field(default=None, description="Matching Delegate delegate_id")
    worker_type: str = Field(..., description="Worker type that executed the subtask")
    output: Any = Field(default=None, description="Worker output / extracted data")
    model_trace: Dict[str, Any] = Field(default_factory=dict, description="Token usage and model telemetry")
    status: str = Field(default="success", description="'success' or 'error'")


class PolicyObservationPayload(BaseModel):
    """Observation capturing policy.decide evaluation."""
    decision: str = Field(..., description="'allow', 'needs_approval', or 'deny'")
    reason: str = Field(..., description="Policy evaluation explanation")
    tool_name: str = Field(..., description="Evaluated tool name")
    risk: str = Field(..., description="Tool risk tier")
    role: str = Field(..., description="Caller role evaluated")


class ErrorObservationPayload(BaseModel):
    """Observation capturing runtime exceptions or policy denials."""
    error_type: str = Field(..., description="Error class (e.g. 'ValidationError', 'PolicyDenial', 'TimeoutError')")
    message: str = Field(..., description="Human-readable error description")
    step: Optional[int] = Field(default=None, description="Step index where error occurred")
    details: Dict[str, Any] = Field(default_factory=dict, description="Additional context or traceback details")


class StateChangedPayload(BaseModel):
    """Observation emitted when session status or step changes."""
    old_status: Optional[SessionStatus] = Field(default=None, description="Prior status")
    new_status: SessionStatus = Field(..., description="New status")
    current_step: int = Field(..., description="Updated step count")
    max_steps: int = Field(..., description="Max steps configured")
    reason: Optional[str] = Field(default=None, description="Transition trigger description")


# ---------------------------------------------------------------------------
# Unified Event Model
# ---------------------------------------------------------------------------

class Event(BaseModel):
    """Universal OpenHands event representation stored in agent_events and emitted via SSE."""
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Primary key event UUID")
    session_id: str = Field(..., description="Target session UUID")
    seq: int = Field(..., description="Monotonically increasing sequence number (1, 2, 3...)")
    event_type: EventType = Field(..., alias="type", description="'action' or 'observation'")
    name: str = Field(..., description="ActionType or ObservationType string identifier")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Typed event payload dictionary")
    source: str = Field(default="system", description="Origin: 'orchestrator', 'worker', 'policy', 'environment', 'user'")
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO 8601 UTC timestamp"
    )

    @property
    def type(self) -> str:
        """Helper to get string value of event_type."""
        return self.event_type.value if isinstance(self.event_type, enum.Enum) else str(self.event_type)

    def __getitem__(self, key: str) -> Any:
        if key in ("type", "event_type"):
            return self.type
        if hasattr(self, key):
            return getattr(self, key)
        raise KeyError(key)

    def get(self, key: str, default: Any = None) -> Any:
        try:
            return self[key]
        except (KeyError, AttributeError):
            return default

    def to_sse_dict(self) -> Dict[str, Any]:
        """Serialize event to the exact JSON dictionary expected by SSE clients."""
        return {
            "seq": self.seq,
            "type": self.type,
            "name": self.name,
            "payload": self.payload,
            "created_at": self.created_at,
        }

    def to_sse(self) -> str:
        """Format as a Server-Sent Events data chunk: `data: JSON\\n\\n`."""
        return f"data: {json.dumps(self.to_sse_dict())}\n\n"

    @classmethod
    def from_db_row(cls, row: Dict[str, Any]) -> "Event":
        """Construct Event instance safely from a SQLite or Postgres database dictionary row."""
        payload = row.get("payload", {})
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = {}

        created_at = row.get("created_at")
        if hasattr(created_at, "isoformat"):
            created_at = created_at.isoformat()
        else:
            created_at = str(created_at or datetime.now(timezone.utc).isoformat())

        raw_type = row.get("event_type") or row.get("type", "action")
        try:
            event_type = EventType(raw_type)
        except ValueError:
            event_type = EventType.ACTION if "action" in str(raw_type).lower() else EventType.OBSERVATION

        return cls(
            id=str(row["id"]),
            session_id=str(row["session_id"]),
            seq=int(row["seq"]),
            event_type=event_type,
            name=str(row["name"]),
            payload=payload,
            source=str(row.get("source", "system")),
            created_at=created_at,
        )


# ---------------------------------------------------------------------------
# AgentSession Model
# ---------------------------------------------------------------------------

class AgentSession(BaseModel):
    """Execution session data model corresponding to agent_sessions table."""
    model_config = ConfigDict(populate_by_name=True)

    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()), alias="id")
    tenant_id: str = Field(..., description="Owning tenant UUID")
    task: str = Field(..., description="High-level goal or task prompt")
    context: Dict[str, Any] = Field(default_factory=dict, description="Context dictionary")
    status: SessionStatus = Field(default=SessionStatus.RUNNING, description="Current lifecycle state")
    current_step: int = Field(default=0, description="Step counter")
    max_steps: int = Field(default=10, description="Step budget limit")
    result: Optional[Dict[str, Any]] = Field(default=None, description="Final results or outcome")
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO 8601 creation timestamp"
    )
    updated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO 8601 update timestamp"
    )

    @classmethod
    def from_db_row(cls, row: Dict[str, Any]) -> "AgentSession":
        """Reconstruct AgentSession model from database row."""
        context = row.get("context", {})
        if isinstance(context, str):
            try:
                context = json.loads(context)
            except Exception:
                context = {}

        result = row.get("result")
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except Exception:
                pass

        created_at = row.get("created_at")
        if hasattr(created_at, "isoformat"):
            created_at = created_at.isoformat()
        else:
            created_at = str(created_at or datetime.now(timezone.utc).isoformat())

        updated_at = row.get("updated_at")
        if hasattr(updated_at, "isoformat"):
            updated_at = updated_at.isoformat()
        else:
            updated_at = str(updated_at or datetime.now(timezone.utc).isoformat())

        raw_status = row.get("status", "running")
        try:
            status = SessionStatus(raw_status)
        except ValueError:
            status = SessionStatus.RUNNING

        return cls(
            session_id=str(row.get("id") or row.get("session_id")),
            tenant_id=str(row["tenant_id"]),
            task=str(row["task"]),
            context=context,
            status=status,
            current_step=int(row.get("current_step", 0)),
            max_steps=int(row.get("max_steps", 10)),
            result=result,
            created_at=created_at,
            updated_at=updated_at,
        )


# ---------------------------------------------------------------------------
# API Request / Response DTOs
# ---------------------------------------------------------------------------

class CreateSessionRequest(BaseModel):
    """POST /v1/agent/sessions request payload."""
    task: str = Field(..., min_length=1, max_length=10000, description="Goal prompt for the agent")
    context: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Initial context parameters")
    max_steps: Optional[int] = Field(default=10, ge=1, le=100, description="Maximum step allowance")


# Alias for compatibility with Blueprint B
SessionCreateIn = CreateSessionRequest


class SessionResponse(BaseModel):
    """Standard session representation returned by REST endpoints."""
    session_id: str
    status: str
    step_count: int
    current_step: int
    result: Optional[Dict[str, Any]] = None


class ApproveSessionRequest(BaseModel):
    """POST /v1/agent/sessions/{session_id}/approve request payload."""
    feedback: Optional[str] = Field(default=None, description="Optional guidance or approval note")


class RejectSessionRequest(BaseModel):
    """POST /v1/agent/sessions/{session_id}/reject request payload."""
    reason: Optional[str] = Field(default="rejected by human operator", description="Rejection reason")

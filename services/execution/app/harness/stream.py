"""OpenHands Agent Execution Harness: Event Stream Manager and SSE Generator.

Maintains monotonic event sequencing, persistent storage in `agent_events`,
thread-safe in-memory publish-subscribe fanout, and Server-Sent Events (SSE) streaming.
"""
from __future__ import annotations

import asyncio
import enum
import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, List, Optional, Union

from pydantic import BaseModel

from ..sqlite_adapter import get_connection
from .models import (
    ActionType,
    AgentFinishPayload,
    ApprovalRequestPayload,
    DelegatePayload,
    DelegateResultPayload,
    ErrorObservationPayload,
    Event,
    EventType,
    ObservationType,
    PlanPayload,
    PolicyObservationPayload,
    SessionStartPayload,
    SessionStatus,
    StateChangedPayload,
    ToolCallPayload,
    ToolResultPayload,
)

logger = logging.getLogger("execution.harness.stream")

# Fallback DDL to guarantee table existence in test environments
FALLBACK_DDL = """
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  task TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'awaiting_approval', 'completed', 'failed', 'rejected')),
  current_step INTEGER NOT NULL DEFAULT 0,
  max_steps INTEGER NOT NULL DEFAULT 10,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('action', 'observation')),
  name TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_tenant ON agent_sessions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_session_seq ON agent_events(session_id, seq ASC);
"""


class EventStream:
    """Central event hub managing persistence, monotonic seq assignment, and SSE streaming."""

    def __init__(self):
        # Maps session_id -> list of active subscriber asyncio.Queue instances
        self._subscribers: Dict[str, List[asyncio.Queue[Event]]] = {}
        self._sub_lock = threading.Lock()

        # Per-session lock for monotonic sequence calculation and atomic event insertion
        self._session_locks: Dict[str, threading.Lock] = {}
        self._lock_manager_lock = threading.Lock()

        self._schema_ensured = False

    def _ensure_schema(self):
        """Idempotently ensure tables exist even in standalone test environments."""
        if self._schema_ensured:
            return
        try:
            with get_connection() as c:
                c.execute("SELECT 1 FROM agent_events LIMIT 1")
                self._schema_ensured = True
        except Exception:
            try:
                with get_connection() as c:
                    raw_conn = getattr(c, "_conn", c)
                    if hasattr(raw_conn, "executescript"):
                        raw_conn.executescript(FALLBACK_DDL)
                    else:
                        c.execute(FALLBACK_DDL)
                    c.commit()
                self._schema_ensured = True
            except Exception as e:
                logger.warning("Failed to run FALLBACK_DDL in EventStream: %s", e)

    def _get_session_lock(self, session_id: str) -> threading.Lock:
        """Obtain or create a threading lock dedicated to a given session."""
        with self._lock_manager_lock:
            if session_id not in self._session_locks:
                self._session_locks[session_id] = threading.Lock()
            return self._session_locks[session_id]

    def get_next_seq(self, session_id: str) -> int:
        """Query the highest sequence number for the session and return next seq (1-based)."""
        self._ensure_schema()
        with get_connection() as c:
            row = c.execute(
                "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM agent_events WHERE session_id = %s",
                (session_id,),
            ).fetchone()
            if row and "next_seq" in row:
                return int(row["next_seq"])
            return 1

    def emit(
        self,
        session_id: str,
        event_type: Union[EventType, str],
        name: str,
        payload: Union[Dict[str, Any], BaseModel],
        source: str = "system",
    ) -> Event:
        """Persist an event to `agent_events` and broadcast to real-time subscribers.

        Assigns the next monotonic sequence number (starting at 1) under session lock.
        """
        self._ensure_schema()
        if isinstance(payload, BaseModel):
            payload_dict = payload.model_dump()
        elif isinstance(payload, dict):
            payload_dict = payload
        else:
            payload_dict = {"data": payload}

        etype_str = event_type.value if isinstance(event_type, enum.Enum) else str(event_type)
        event_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()

        with self._get_session_lock(session_id):
            seq = self.get_next_seq(session_id)
            payload_json = json.dumps(payload_dict)

            with get_connection() as c:
                c.execute(
                    "INSERT INTO agent_events (id, session_id, seq, event_type, name, payload, created_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (event_id, session_id, seq, etype_str, name, payload_json, now_iso),
                )
                c.commit()

        event = Event(
            id=event_id,
            session_id=session_id,
            seq=seq,
            type=EventType(etype_str),
            name=name,
            payload=payload_dict,
            source=source,
            created_at=now_iso,
        )

        self._broadcast(session_id, event)
        return event

    # -----------------------------------------------------------------------
    # Convenience Action Emitters
    # -----------------------------------------------------------------------

    def emit_session_start(
        self,
        session_id: str,
        task: str,
        context: Optional[Dict[str, Any]] = None,
        max_steps: int = 10,
        user_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
    ) -> Event:
        payload = SessionStartPayload(
            task=task,
            context=context or {},
            max_steps=max_steps,
            user_id=user_id,
            tenant_id=tenant_id,
        )
        return self.emit(session_id, EventType.ACTION, ActionType.SESSION_START.value, payload, source="orchestrator")

    def emit_plan(
        self,
        session_id: str,
        thought: str,
        steps: List[str],
        current_step_index: int = 0,
        estimated_risk: Optional[str] = None,
    ) -> Event:
        payload = PlanPayload(
            thought=thought,
            steps=steps,
            current_step_index=current_step_index,
            estimated_risk=estimated_risk,
        )
        return self.emit(session_id, EventType.ACTION, ActionType.PLAN.value, payload, source="orchestrator")

    def emit_tool_call(
        self,
        session_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
        step: int = 0,
        call_id: Optional[str] = None,
        risk: Optional[str] = None,
    ) -> Event:
        payload = ToolCallPayload(
            tool_name=tool_name,
            arguments=arguments,
            call_id=call_id or str(uuid.uuid4()),
            step=step,
            risk=risk,
        )
        return self.emit(session_id, EventType.ACTION, ActionType.TOOL_CALL.value, payload, source="orchestrator")

    def emit_delegate(
        self,
        session_id: str,
        worker_type: str,
        subtask: str,
        worker_model: str = "cawrys-extract",
        input_data: Optional[Dict[str, Any]] = None,
        delegate_id: Optional[str] = None,
    ) -> Event:
        payload = DelegatePayload(
            worker_type=worker_type,
            subtask=subtask,
            worker_model=worker_model,
            input_data=input_data or {},
            delegate_id=delegate_id or str(uuid.uuid4()),
        )
        return self.emit(session_id, EventType.ACTION, ActionType.DELEGATE.value, payload, source="orchestrator")

    def emit_approval_request(
        self,
        session_id: str,
        tool_name: str,
        connector: str,
        risk: str,
        reason: str,
        arguments: Dict[str, Any],
        requested_role: str = "approver",
        call_id: Optional[str] = None,
    ) -> Event:
        payload = ApprovalRequestPayload(
            tool_name=tool_name,
            connector=connector,
            risk=risk,
            reason=reason,
            arguments=arguments,
            requested_role=requested_role,
            call_id=call_id,
        )
        return self.emit(session_id, EventType.ACTION, ActionType.APPROVAL_REQUEST.value, payload, source="policy")

    def emit_agent_finish(
        self,
        session_id: str,
        status: SessionStatus,
        summary: str,
        result: Optional[Dict[str, Any]] = None,
        steps_taken: int = 0,
    ) -> Event:
        payload = AgentFinishPayload(
            status=status,
            summary=summary,
            result=result or {},
            steps_taken=steps_taken,
        )
        return self.emit(session_id, EventType.ACTION, ActionType.AGENT_FINISH.value, payload, source="orchestrator")

    # -----------------------------------------------------------------------
    # Convenience Observation Emitters
    # -----------------------------------------------------------------------

    def emit_tool_result(
        self,
        session_id: str,
        tool_name: str,
        output: Any,
        status: str = "success",
        call_id: Optional[str] = None,
        execution_time_ms: Optional[float] = None,
    ) -> Event:
        payload = ToolResultPayload(
            tool_name=tool_name,
            call_id=call_id,
            output=output,
            status=status,
            execution_time_ms=execution_time_ms,
        )
        return self.emit(session_id, EventType.OBSERVATION, ObservationType.TOOL_RESULT.value, payload, source="environment")

    def emit_delegate_result(
        self,
        session_id: str,
        worker_type: str,
        output: Any,
        model_trace: Optional[Dict[str, Any]] = None,
        status: str = "success",
        delegate_id: Optional[str] = None,
    ) -> Event:
        payload = DelegateResultPayload(
            delegate_id=delegate_id,
            worker_type=worker_type,
            output=output,
            model_trace=model_trace or {},
            status=status,
        )
        return self.emit(session_id, EventType.OBSERVATION, ObservationType.DELEGATE_RESULT.value, payload, source="worker")

    def emit_policy(
        self,
        session_id: str,
        decision: str,
        reason: str,
        tool_name: str,
        risk: str,
        role: str,
    ) -> Event:
        payload = PolicyObservationPayload(
            decision=decision,
            reason=reason,
            tool_name=tool_name,
            risk=risk,
            role=role,
        )
        return self.emit(session_id, EventType.OBSERVATION, ObservationType.POLICY.value, payload, source="policy")

    def emit_error(
        self,
        session_id: str,
        error_type: str,
        message: str,
        step: Optional[int] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> Event:
        payload = ErrorObservationPayload(
            error_type=error_type,
            message=message,
            step=step,
            details=details or {},
        )
        return self.emit(session_id, EventType.OBSERVATION, ObservationType.ERROR.value, payload, source="environment")

    def emit_state_changed(
        self,
        session_id: str,
        new_status: SessionStatus,
        current_step: int,
        max_steps: int,
        old_status: Optional[SessionStatus] = None,
        reason: Optional[str] = None,
    ) -> Event:
        payload = StateChangedPayload(
            old_status=old_status,
            new_status=new_status,
            current_step=current_step,
            max_steps=max_steps,
            reason=reason,
        )
        return self.emit(session_id, EventType.OBSERVATION, ObservationType.STATE_CHANGED.value, payload, source="system")

    # -----------------------------------------------------------------------
    # Retrieval & Real-Time SSE Streaming
    # -----------------------------------------------------------------------

    def get_events(self, session_id: str, since_seq: int = 0) -> List[Event]:
        """Fetch historical events from database in ascending sequence order."""
        self._ensure_schema()
        with get_connection() as c:
            rows = c.execute(
                "SELECT id, session_id, seq, event_type, name, payload, created_at "
                "FROM agent_events WHERE session_id = %s AND seq > %s ORDER BY seq ASC",
                (session_id, since_seq),
            ).fetchall()
            return [Event.from_db_row(r) for r in rows]

    def _broadcast(self, session_id: str, event: Event) -> None:
        """Push an emitted event to all active subscriber queues."""
        with self._sub_lock:
            queues = list(self._subscribers.get(session_id, []))

        for q in queues:
            try:
                loop = getattr(q, "_loop", None)
                if loop and loop.is_running():
                    loop.call_soon_threadsafe(q.put_nowait, event)
                else:
                    q.put_nowait(event)
            except Exception as e:
                logger.debug("Error delivering event to queue for session %s: %s", session_id, e)

    def _register_listener(self, session_id: str, queue: asyncio.Queue[Event]) -> None:
        """Register a new SSE client subscriber queue."""
        with self._sub_lock:
            if session_id not in self._subscribers:
                self._subscribers[session_id] = []
            self._subscribers[session_id].append(queue)

    def _unregister_listener(self, session_id: str, queue: asyncio.Queue[Event]) -> None:
        """Clean up an SSE subscriber queue upon client disconnect."""
        with self._sub_lock:
            if session_id in self._subscribers:
                try:
                    self._subscribers[session_id].remove(queue)
                except ValueError:
                    pass
                if not self._subscribers[session_id]:
                    del self._subscribers[session_id]

    async def stream_events(
        self,
        session_id: str,
        last_event_id: int = 0,
        heartbeat_interval: float = 15.0,
    ) -> AsyncGenerator[str, None]:
        """Asynchronous SSE generator.

        1. Backfills historical events where seq > last_event_id from the database.
        2. Subscribes to new in-memory events for the session.
        3. Emits `data: JSON\\n\\n` chunks in real-time.
        4. Sends `: ping\\n\\n` keep-alive comments periodically.
        5. Terminates when the session reaches a completed, rejected, or failed state.
        """
        self._ensure_schema()
        # 1. Backfill phase: replay stored events
        past_events = self.get_events(session_id, since_seq=last_event_id)
        last_seq = last_event_id
        for ev in past_events:
            last_seq = max(last_seq, ev.seq)
            yield ev.to_sse()

        # Check if session is already concluded
        with get_connection() as c:
            sess_row = c.execute("SELECT status FROM agent_sessions WHERE id = %s", (session_id,)).fetchone()

        if sess_row and sess_row.get("status") in ("completed", "failed", "rejected", "awaiting_approval"):
            yield f": status={sess_row.get('status')}\n\n"
            return

        # 2. Real-time phase: subscribe queue
        queue: asyncio.Queue[Event] = asyncio.Queue()
        self._register_listener(session_id, queue)

        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=heartbeat_interval)
                    if event.seq > last_seq:
                        last_seq = event.seq
                        yield event.to_sse()

                        # Terminal condition check
                        if event.name == ActionType.AGENT_FINISH.value:
                            yield ": status=completed\n\n"
                            break
                        if event.name == ObservationType.STATE_CHANGED.value:
                            new_status = event.payload.get("new_status")
                            if new_status in (SessionStatus.COMPLETED.value, SessionStatus.FAILED.value, SessionStatus.REJECTED.value, SessionStatus.AWAITING_APPROVAL.value):
                                yield f": status={new_status}\n\n"
                                break
                except asyncio.TimeoutError:
                    # Heartbeat comment to keep HTTP/SSE connection alive
                    yield ": ping\n\n"

                    # Check DB in case terminal event was emitted in another thread/process
                    with get_connection() as c:
                        sess_row = c.execute("SELECT status FROM agent_sessions WHERE id = %s", (session_id,)).fetchone()
                    if sess_row and sess_row.get("status") in ("completed", "failed", "rejected", "awaiting_approval"):
                        remaining = self.get_events(session_id, since_seq=last_seq)
                        for ev in remaining:
                            yield ev.to_sse()
                        yield f": status={sess_row.get('status')}\n\n"
                        break
        finally:
            self._unregister_listener(session_id, queue)


# Global singleton event stream hub
event_stream = EventStream()


class EventStreamManager:
    """Session-scoped manager adapter for appending and querying events."""

    def __init__(self, session_id: str):
        self.session_id = session_id

    def append_action(self, name: str, payload: Union[Dict[str, Any], BaseModel]) -> Event:
        """Record an Action event in the monotonic stream."""
        return event_stream.emit(
            session_id=self.session_id,
            event_type=EventType.ACTION,
            name=name,
            payload=payload,
            source="orchestrator",
        )

    def append_observation(self, name: str, payload: Union[Dict[str, Any], BaseModel]) -> Event:
        """Record an Observation event in the monotonic stream."""
        return event_stream.emit(
            session_id=self.session_id,
            event_type=EventType.OBSERVATION,
            name=name,
            payload=payload,
            source="environment",
        )

    def get_events(self, since_seq: int = 0) -> List[Event]:
        """Retrieve all events for this session since given seq."""
        return event_stream.get_events(self.session_id, since_seq=since_seq)

    async def stream_events(
        self,
        last_event_id: int = 0,
        heartbeat_interval: float = 15.0,
    ) -> AsyncGenerator[str, None]:
        """Stream events for this session via SSE."""
        async for chunk in event_stream.stream_events(self.session_id, last_event_id, heartbeat_interval):
            yield chunk

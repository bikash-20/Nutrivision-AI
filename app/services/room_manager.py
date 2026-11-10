"""Ephemeral in-memory room relay + 24-hour room-code lifecycle for NutriVision.

Design separation:
- **Chat messages & shared dish cards**: 100% ephemeral in RAM (relay buffer
  only) and browser `sessionStorage`. ZERO chat messages are persisted to
  disk or PostgreSQL.
- **Room code metadata** (`room_code`, `owner_pid`, `expires_at`): stored for
  24 hours via `State` (`nv_rooms` in Postgres / `rooms` in `state.json`) so
  a room code survives Render restarts, idle periods, and tab refreshes until
  the user logs out, explicitly cancels the room, or 24 hours elapse.
"""

from __future__ import annotations

import asyncio
import hashlib
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import WebSocket

from app.models.schemas import (
    RoomMember,
    RoomMessage,
    RoomMessageKind,
    RoomSharedDish,
)
from app.services.state import get_state_optional

ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROOM_CODE_LENGTH = 6
MAX_BUFFER_MESSAGES = 60
MEMBER_STALE_SECONDS = 45.0
ROOM_TTL_HOURS = 24
MAX_TEXT_LENGTH = 1000
MAX_PHOTO_DATA_URL_LENGTH = 300_000


def normalize_room_code(raw: str) -> str:
    """Normalize a user-entered room code (uppercase, no spaces or hyphens)."""
    return "".join(ch for ch in raw.strip().upper() if ch.isalnum())


def resolve_account_participant_id(
    auth_email: str | None = None,
    account_id: str | None = None,
    fallback_participant_id: str | None = None,
) -> str:
    """Resolve a deterministic per-account participant ID so the same account
    is deduplicated across tabs/devices without exposing raw emails."""
    canonical = (auth_email or account_id or "").strip().lower()
    if canonical:
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]
        return f"acct-{digest}"
    if fallback_participant_id and fallback_participant_id.strip():
        return fallback_participant_id.strip()[:40]
    return uuid4().hex[:12]


def _clean_display_name(raw: str) -> str:
    cleaned = " ".join(raw.strip().split())
    return cleaned[:32] if cleaned else "Guest"


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _parse_utc(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


@dataclass
class _Participant:
    id: str
    name: str
    last_seen: float
    ws_count: int = 0
    clients: dict[str, float] = field(default_factory=dict)


@dataclass
class _ActiveRoom:
    code: str
    owner_pid: str
    owner_name: str
    created_at_iso: str
    expires_at_iso: str
    created_at: float
    last_activity: float
    seq: int = 0
    participants: dict[str, _Participant] = field(default_factory=dict)
    buffer: deque[RoomMessage] = field(default_factory=lambda: deque(maxlen=MAX_BUFFER_MESSAGES))
    sockets: dict[str, set[WebSocket]] = field(default_factory=dict)


class RoomManager:
    """Async-safe ephemeral room relay backed by 24h State room-code registry."""

    def __init__(self) -> None:
        self._rooms: dict[str, _ActiveRoom] = {}

    def _prune_stale(self, now: float | None = None) -> None:
        ts = now if now is not None else time.monotonic()
        now_dt = _utc_now()
        expired_codes: list[str] = []
        for code, room in self._rooms.items():
            stale_pids: list[str] = []
            for pid, p in room.participants.items():
                stale_cids = [
                    cid for cid, seen in p.clients.items() if (ts - seen) > MEMBER_STALE_SECONDS
                ]
                for cid in stale_cids:
                    p.clients.pop(cid, None)
                if p.ws_count <= 0 and not p.clients and (ts - p.last_seen) > MEMBER_STALE_SECONDS:
                    stale_pids.append(pid)
            for pid in stale_pids:
                room.participants.pop(pid, None)
            try:
                if now_dt >= _parse_utc(room.expires_at_iso):
                    expired_codes.append(code)
            except Exception:
                expired_codes.append(code)

        state = get_state_optional()
        for code in expired_codes:
            self._rooms.pop(code, None)
            if state is not None:
                state.delete_room_record(code)

    def _get_or_restore_room(self, raw_code: str) -> _ActiveRoom | None:
        now = time.monotonic()
        self._prune_stale(now)
        code = normalize_room_code(raw_code)
        room = self._rooms.get(code)
        if room is not None:
            return room

        state = get_state_optional()
        if state is None:
            return None
        rec = state.get_room_record(code)
        if rec is None:
            return None

        try:
            if _utc_now() >= _parse_utc(rec["expires_at"]):
                state.delete_room_record(code)
                return None
        except Exception:
            state.delete_room_record(code)
            return None

        restored = _ActiveRoom(
            code=code,
            owner_pid=rec["owner_pid"],
            owner_name=rec.get("owner_name", "Guest"),
            created_at_iso=rec["created_at"],
            expires_at_iso=rec["expires_at"],
            created_at=now,
            last_activity=now,
        )
        self._rooms[code] = restored
        return restored

    def _generate_code(self) -> str:
        state = get_state_optional()
        for _ in range(32):
            code = "".join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH))
            if code not in self._rooms and (state is None or state.get_room_record(code) is None):
                return code
        return uuid4().hex[:8].upper()

    def _members_list(self, room: _ActiveRoom) -> list[RoomMember]:
        return [RoomMember(id=p.id, name=p.name) for p in room.participants.values()]

    def get_active_room_for_account(
        self,
        auth_email: str | None = None,
        account_id: str | None = None,
    ) -> dict[str, str] | None:
        pid = resolve_account_participant_id(auth_email=auth_email, account_id=account_id)
        if not pid.startswith("acct-"):
            return None
        now_dt = _utc_now()
        self._prune_stale()

        # Check RAM first
        ram_matches = [r for r in self._rooms.values() if r.owner_pid == pid]
        if ram_matches:
            ram_matches.sort(key=lambda r: r.created_at_iso, reverse=True)
            top = ram_matches[0]
            try:
                if _parse_utc(top.expires_at_iso) > now_dt:
                    return {
                        "room_code": top.code,
                        "owner_pid": top.owner_pid,
                        "owner_name": top.owner_name,
                        "created_at": top.created_at_iso,
                        "expires_at": top.expires_at_iso,
                    }
            except Exception:
                pass

        state = get_state_optional()
        if state is not None:
            return state.get_active_room_for_owner(pid)
        return None

    def create_room(
        self,
        display_name: str,
        auth_email: str | None = None,
        account_id: str | None = None,
        client_id: str | None = None,
        force_new: bool = False,
    ) -> tuple[str, str, str, list[RoomMember], int, str]:
        now = time.monotonic()
        self._prune_stale(now)
        pid = resolve_account_participant_id(auth_email=auth_email, account_id=account_id)
        name = _clean_display_name(display_name)
        state = get_state_optional()

        if pid.startswith("acct-"):
            if not force_new:
                existing_rec = self.get_active_room_for_account(auth_email=auth_email, account_id=account_id)
                if existing_rec is not None:
                    code, joined_pid, joined_name, members, seq, expires_at, _ = self.join_room(
                        existing_rec["room_code"],
                        name,
                        participant_id=pid,
                        auth_email=auth_email,
                        account_id=account_id,
                        client_id=client_id,
                    )
                    return code, joined_pid, joined_name, members, seq, expires_at
            else:
                # Replace previous 24h key for this account cleanly
                self.revoke_owner_rooms(auth_email=auth_email, account_id=account_id)

        code = self._generate_code()
        now_dt = _utc_now()
        created_iso = now_dt.isoformat()
        expires_iso = (now_dt + timedelta(hours=ROOM_TTL_HOURS)).isoformat()

        room = _ActiveRoom(
            code=code,
            owner_pid=pid,
            owner_name=name,
            created_at_iso=created_iso,
            expires_at_iso=expires_iso,
            created_at=now,
            last_activity=now,
        )
        clients = {client_id: now} if client_id else {}
        room.participants[pid] = _Participant(id=pid, name=name, last_seen=now, clients=clients)
        self._rooms[code] = room

        if state is not None and pid.startswith("acct-"):
            state.upsert_room_record(
                room_code=code,
                owner_pid=pid,
                owner_name=name,
                created_at=created_iso,
                expires_at=expires_iso,
            )

        return code, pid, name, self._members_list(room), room.seq, expires_iso

    def join_room(
        self,
        raw_code: str,
        display_name: str,
        participant_id: str | None = None,
        auth_email: str | None = None,
        account_id: str | None = None,
        client_id: str | None = None,
    ) -> tuple[str, str, str, list[RoomMember], int, str, RoomMessage | None]:
        now = time.monotonic()
        code = normalize_room_code(raw_code)
        room = self._get_or_restore_room(code)
        if room is None:
            raise KeyError(f"Room '{code}' not found or expired.")

        pid = resolve_account_participant_id(
            auth_email=auth_email,
            account_id=account_id,
            fallback_participant_id=participant_id,
        )
        name = _clean_display_name(display_name)
        existing = room.participants.get(pid)
        is_new = existing is None

        if existing is not None:
            existing.name = name
            existing.last_seen = now
            if client_id:
                existing.clients[client_id] = now
        else:
            clients = {client_id: now} if client_id else {}
            room.participants[pid] = _Participant(
                id=pid,
                name=name,
                last_seen=now,
                clients=clients,
            )
        room.last_activity = now

        join_msg: RoomMessage | None = None
        if is_new:
            room.seq += 1
            join_msg = RoomMessage(
                id=uuid4().hex[:12],
                seq=room.seq,
                room_code=code,
                sender_id="system",
                sender_name="System",
                kind="system",
                text=f"{name} joined the room",
                dish_card=None,
                created_at=_utc_now_iso(),
            )
            room.buffer.append(join_msg)

        return code, pid, name, self._members_list(room), room.seq, room.expires_at_iso, join_msg

    def leave_room(
        self,
        raw_code: str,
        participant_id: str,
        client_id: str | None = None,
        force: bool = True,
    ) -> tuple[bool, RoomMessage | None]:
        """Remove a participant from live online presence WITHOUT cancelling the 24h room code."""
        now = time.monotonic()
        code = normalize_room_code(raw_code)
        room = self._rooms.get(code)
        if room is None:
            return False, None

        existing = room.participants.get(participant_id)
        if not force and existing is not None:
            if client_id:
                existing.clients.pop(client_id, None)
            if existing.clients or existing.ws_count > 0:
                room.last_activity = now
                return False, None

        removed = room.participants.pop(participant_id, None)
        room.sockets.pop(participant_id, None)
        room.last_activity = now

        leave_msg: RoomMessage | None = None
        if removed is not None and room.participants:
            room.seq += 1
            leave_msg = RoomMessage(
                id=uuid4().hex[:12],
                seq=room.seq,
                room_code=code,
                sender_id="system",
                sender_name="System",
                kind="system",
                text=f"{removed.name} left the room",
                dish_card=None,
                created_at=_utc_now_iso(),
            )
            room.buffer.append(leave_msg)
        return False, leave_msg

    def cancel_room(self, raw_code: str) -> bool:
        """Explicitly cancel/close a room so the code immediately stops working."""
        code = normalize_room_code(raw_code)
        existed = self._rooms.pop(code, None) is not None
        state = get_state_optional()
        if state is not None:
            existed = state.delete_room_record(code) or existed
        return existed

    def revoke_owner_rooms(
        self,
        auth_email: str | None = None,
        account_id: str | None = None,
    ) -> list[str]:
        """Cancel all 24h rooms owned by an account (called on logout or key regeneration)."""
        pid = resolve_account_participant_id(auth_email=auth_email, account_id=account_id)
        if not pid.startswith("acct-"):
            return []
        codes = [c for c, r in self._rooms.items() if r.owner_pid == pid]
        for c in codes:
            self._rooms.pop(c, None)
        state = get_state_optional()
        if state is not None:
            for c in state.delete_rooms_for_owner(pid):
                if c not in codes:
                    codes.append(c)
        return codes

    def clear_room_buffer(self, raw_code: str) -> bool:
        code = normalize_room_code(raw_code)
        room = self._get_or_restore_room(code)
        if room is None:
            return False
        room.buffer.clear()
        room.last_activity = time.monotonic()
        return True

    def add_message(
        self,
        raw_code: str,
        participant_id: str,
        sender_name: str,
        kind: RoomMessageKind,
        text: str | None = None,
        dish_card: RoomSharedDish | None = None,
    ) -> RoomMessage:
        now = time.monotonic()
        code = normalize_room_code(raw_code)
        room = self._get_or_restore_room(code)
        if room is None:
            raise KeyError(f"Room '{code}' not found or expired.")

        clean_name = _clean_display_name(sender_name)
        participant = room.participants.get(participant_id)
        if participant is None:
            room.participants[participant_id] = _Participant(
                id=participant_id,
                name=clean_name,
                last_seen=now,
            )
        else:
            participant.name = clean_name
            participant.last_seen = now

        clean_text = (text or "").strip()[:MAX_TEXT_LENGTH]
        if kind == "text" and not clean_text:
            raise ValueError("Text message cannot be empty.")
        if kind == "meal_card" and dish_card is None:
            raise ValueError("Meal card payload is required.")

        sanitized_card = dish_card
        if sanitized_card is not None and sanitized_card.photo_url:
            if len(sanitized_card.photo_url) > MAX_PHOTO_DATA_URL_LENGTH:
                sanitized_card = sanitized_card.model_copy(update={"photo_url": None})

        room.seq += 1
        room.last_activity = now
        msg = RoomMessage(
            id=uuid4().hex[:12],
            seq=room.seq,
            room_code=code,
            sender_id=participant_id,
            sender_name=clean_name,
            kind=kind,
            text=clean_text or (sanitized_card.title if sanitized_card else ""),
            dish_card=sanitized_card,
            created_at=_utc_now_iso(),
        )
        room.buffer.append(msg)
        return msg

    def poll_room(
        self,
        raw_code: str,
        participant_id: str | None,
        after_seq: int = 0,
        client_id: str | None = None,
    ) -> tuple[str, list[RoomMember], list[RoomMessage], int]:
        now = time.monotonic()
        code = normalize_room_code(raw_code)
        room = self._get_or_restore_room(code)
        if room is None:
            raise KeyError(f"Room '{code}' not found or expired.")

        if participant_id and participant_id in room.participants:
            participant = room.participants[participant_id]
            participant.last_seen = now
            if client_id:
                participant.clients[client_id] = now
        room.last_activity = now

        new_messages = [m for m in room.buffer if m.seq > after_seq]
        return code, self._members_list(room), new_messages, room.seq

    def register_ws(
        self,
        raw_code: str,
        participant_id: str,
        display_name: str,
        ws: WebSocket,
        client_id: str | None = None,
    ) -> list[RoomMember]:
        now = time.monotonic()
        code = normalize_room_code(raw_code)
        room = self._get_or_restore_room(code)
        if room is None:
            raise KeyError(f"Room '{code}' not found or expired.")

        clean_name = _clean_display_name(display_name)
        participant = room.participants.get(participant_id)
        if participant is None:
            clients = {client_id: now} if client_id else {}
            participant = _Participant(
                id=participant_id,
                name=clean_name,
                last_seen=now,
                ws_count=1,
                clients=clients,
            )
            room.participants[participant_id] = participant
        else:
            participant.name = clean_name
            participant.last_seen = now
            participant.ws_count += 1
            if client_id:
                participant.clients[client_id] = now
        room.sockets.setdefault(participant_id, set()).add(ws)
        room.last_activity = now
        return self._members_list(room)

    def unregister_ws(
        self,
        raw_code: str,
        participant_id: str,
        ws: WebSocket,
        client_id: str | None = None,
    ) -> list[RoomMember]:
        code = normalize_room_code(raw_code)
        room = self._rooms.get(code)
        if room is None:
            return []
        conns = room.sockets.get(participant_id)
        if conns is not None:
            conns.discard(ws)
            if not conns:
                room.sockets.pop(participant_id, None)
        participant = room.participants.get(participant_id)
        if participant is not None:
            participant.ws_count = max(0, participant.ws_count - 1)
            participant.last_seen = time.monotonic()
            if client_id:
                participant.clients.pop(client_id, None)
        room.last_activity = time.monotonic()
        return self._members_list(room)

    async def broadcast(self, raw_code: str, payload: dict[str, Any]) -> None:
        code = normalize_room_code(raw_code)
        room = self._rooms.get(code)
        if room is None:
            return
        targets: list[tuple[str, WebSocket]] = []
        for pid, sockets in list(room.sockets.items()):
            for ws in list(sockets):
                targets.append((pid, ws))
        if not targets:
            return

        async def _send(pid: str, ws: WebSocket) -> None:
            try:
                await ws.send_json(payload)
            except Exception:
                self.unregister_ws(code, pid, ws)

        await asyncio.gather(*(_send(pid, ws) for pid, ws in targets), return_exceptions=True)

    def reset(self) -> None:
        """Clear all rooms (for tests)."""
        self._rooms.clear()


_room_manager = RoomManager()


def get_room_manager() -> RoomManager:
    return _room_manager

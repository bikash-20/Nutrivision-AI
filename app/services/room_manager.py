"""Ephemeral in-memory room manager for NutriVision real-time chat.

Rooms exist solely in RAM for live relay (WebSocket + HTTP polling fallback).
No messages or rooms are persisted to disk or Postgres. Once all active
participants leave a room (or expire due to inactivity), the room and any
ephemeral delivery buffer are discarded immediately.
"""

from __future__ import annotations

import asyncio
import secrets
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import WebSocket

from app.models.schemas import (
    RoomMember,
    RoomMessage,
    RoomMessageKind,
    RoomSharedDish,
)

ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROOM_CODE_LENGTH = 6
MAX_BUFFER_MESSAGES = 60
MEMBER_STALE_SECONDS = 45.0
ROOM_IDLE_TTL_SECONDS = 1800.0
MAX_TEXT_LENGTH = 1000
MAX_PHOTO_DATA_URL_LENGTH = 300_000


def normalize_room_code(raw: str) -> str:
    """Normalize a user-entered room code (uppercase, no spaces or hyphens)."""
    return "".join(ch for ch in raw.strip().upper() if ch.isalnum())


def _clean_display_name(raw: str) -> str:
    cleaned = " ".join(raw.strip().split())
    return (cleaned[:32] if cleaned else "Guest")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class _Participant:
    id: str
    name: str
    last_seen: float
    ws_count: int = 0


@dataclass
class _ActiveRoom:
    code: str
    created_at: float
    last_activity: float
    seq: int = 0
    participants: dict[str, _Participant] = field(default_factory=dict)
    buffer: deque[RoomMessage] = field(default_factory=lambda: deque(maxlen=MAX_BUFFER_MESSAGES))
    sockets: dict[str, set[WebSocket]] = field(default_factory=dict)


class RoomManager:
    """Thread-safe / async-safe ephemeral room relay store."""

    def __init__(self) -> None:
        self._rooms: dict[str, _ActiveRoom] = {}

    def _prune_stale(self, now: float | None = None) -> None:
        ts = now if now is not None else time.monotonic()
        expired_codes: list[str] = []
        for code, room in self._rooms.items():
            stale_pids = [
                pid
                for pid, p in room.participants.items()
                if p.ws_count <= 0 and (ts - p.last_seen) > MEMBER_STALE_SECONDS
            ]
            for pid in stale_pids:
                room.participants.pop(pid, None)
            if not room.participants and not room.sockets and (ts - room.last_activity) > 60.0:
                expired_codes.append(code)
            elif (ts - room.last_activity) > ROOM_IDLE_TTL_SECONDS:
                expired_codes.append(code)
        for code in expired_codes:
            self._rooms.pop(code, None)

    def _generate_code(self) -> str:
        for _ in range(32):
            code = "".join(secrets.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH))
            if code not in self._rooms:
                return code
        return uuid4().hex[:8].upper()

    def _members_list(self, room: _ActiveRoom) -> list[RoomMember]:
        return [RoomMember(id=p.id, name=p.name) for p in room.participants.values()]

    def create_room(self, display_name: str) -> tuple[str, str, str, list[RoomMember], int]:
        now = time.monotonic()
        self._prune_stale(now)
        code = self._generate_code()
        pid = uuid4().hex[:12]
        name = _clean_display_name(display_name)
        room = _ActiveRoom(code=code, created_at=now, last_activity=now)
        room.participants[pid] = _Participant(id=pid, name=name, last_seen=now)
        self._rooms[code] = room
        return code, pid, name, self._members_list(room), room.seq

    def join_room(
        self,
        raw_code: str,
        display_name: str,
        participant_id: str | None = None,
    ) -> tuple[str, str, str, list[RoomMember], int, RoomMessage | None]:
        now = time.monotonic()
        self._prune_stale(now)
        code = normalize_room_code(raw_code)
        room = self._rooms.get(code)
        if room is None:
            raise KeyError(f"Room '{code}' not found or expired.")

        name = _clean_display_name(display_name)
        is_new = not participant_id or participant_id not in room.participants
        pid = participant_id if (participant_id and not is_new) else uuid4().hex[:12]
        room.participants[pid] = _Participant(
            id=pid,
            name=name,
            last_seen=now,
            ws_count=room.participants[pid].ws_count if not is_new else 0,
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

        return code, pid, name, self._members_list(room), room.seq, join_msg

    def leave_room(self, raw_code: str, participant_id: str) -> tuple[bool, RoomMessage | None]:
        now = time.monotonic()
        code = normalize_room_code(raw_code)
        room = self._rooms.get(code)
        if room is None:
            return False, None

        removed = room.participants.pop(participant_id, None)
        room.sockets.pop(participant_id, None)
        room.last_activity = now

        if not room.participants and not room.sockets:
            self._rooms.pop(code, None)
            return True, None

        leave_msg: RoomMessage | None = None
        if removed is not None:
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

    def clear_room_buffer(self, raw_code: str) -> bool:
        code = normalize_room_code(raw_code)
        room = self._rooms.get(code)
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
        room = self._rooms.get(code)
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
    ) -> tuple[str, list[RoomMember], list[RoomMessage], int]:
        now = time.monotonic()
        self._prune_stale(now)
        code = normalize_room_code(raw_code)
        room = self._rooms.get(code)
        if room is None:
            raise KeyError(f"Room '{code}' not found or expired.")

        if participant_id and participant_id in room.participants:
            room.participants[participant_id].last_seen = now
        room.last_activity = now

        new_messages = [m for m in room.buffer if m.seq > after_seq]
        return code, self._members_list(room), new_messages, room.seq

    def register_ws(self, raw_code: str, participant_id: str, display_name: str, ws: WebSocket) -> list[RoomMember]:
        now = time.monotonic()
        code = normalize_room_code(raw_code)
        room = self._rooms.get(code)
        if room is None:
            raise KeyError(f"Room '{code}' not found or expired.")

        clean_name = _clean_display_name(display_name)
        participant = room.participants.get(participant_id)
        if participant is None:
            participant = _Participant(id=participant_id, name=clean_name, last_seen=now, ws_count=1)
            room.participants[participant_id] = participant
        else:
            participant.name = clean_name
            participant.last_seen = now
            participant.ws_count += 1
        room.sockets.setdefault(participant_id, set()).add(ws)
        room.last_activity = now
        return self._members_list(room)

    def unregister_ws(self, raw_code: str, participant_id: str, ws: WebSocket) -> list[RoomMember]:
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

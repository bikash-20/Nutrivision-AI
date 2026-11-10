"""FastAPI router for ephemeral room chat & shared meal/dish cards."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from app.models.schemas import (
    RoomCreateRequest,
    RoomJoinRequest,
    RoomJoinResponse,
    RoomLeaveRequest,
    RoomMessage,
    RoomPollResponse,
    RoomSendMessageRequest,
    RoomSharedDish,
)
from app.services.room_manager import get_room_manager, normalize_room_code

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


@router.post("", response_model=RoomJoinResponse)
def create_room(req: RoomCreateRequest) -> RoomJoinResponse:
    """Create a brand-new ephemeral chat room with an auto-generated room code."""
    mgr = get_room_manager()
    code, pid, name, members, latest_seq = mgr.create_room(req.display_name)
    return RoomJoinResponse(
        room_code=code,
        participant_id=pid,
        display_name=name,
        members=members,
        latest_seq=latest_seq,
    )


@router.post("/{code}/join", response_model=RoomJoinResponse)
async def join_room(code: str, req: RoomJoinRequest) -> RoomJoinResponse:
    """Join an existing ephemeral room using its room code."""
    mgr = get_room_manager()
    try:
        norm_code, pid, name, members, latest_seq, join_msg = mgr.join_room(
            code,
            req.display_name,
            req.participant_id,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Room {normalize_room_code(code)} not found or expired.",
        ) from exc

    if join_msg is not None:
        await mgr.broadcast(
            norm_code,
            {
                "type": "message",
                "message": join_msg.model_dump(mode="json"),
                "members": [m.model_dump(mode="json") for m in members],
            },
        )
    return RoomJoinResponse(
        room_code=norm_code,
        participant_id=pid,
        display_name=name,
        members=members,
        latest_seq=latest_seq,
    )


@router.post("/{code}/leave")
async def leave_room(code: str, req: RoomLeaveRequest) -> dict[str, bool]:
    """Leave an ephemeral room. Deletes the room from memory when empty."""
    mgr = get_room_manager()
    norm_code = normalize_room_code(code)
    deleted, leave_msg = mgr.leave_room(norm_code, req.participant_id)
    if not deleted and leave_msg is not None:
        _, members, _, _ = mgr.poll_room(norm_code, None, after_seq=leave_msg.seq)
        await mgr.broadcast(
            norm_code,
            {
                "type": "message",
                "message": leave_msg.model_dump(mode="json"),
                "members": [m.model_dump(mode="json") for m in members],
            },
        )
    return {"ok": True, "deleted": deleted}


@router.post("/{code}/clear")
async def clear_room_history(code: str) -> dict[str, bool]:
    """Clear the ephemeral in-memory relay buffer for this room."""
    mgr = get_room_manager()
    norm_code = normalize_room_code(code)
    ok = mgr.clear_room_buffer(norm_code)
    if ok:
        await mgr.broadcast(norm_code, {"type": "cleared"})
    return {"ok": ok}


@router.post("/{code}/messages", response_model=RoomMessage)
async def send_room_message(code: str, req: RoomSendMessageRequest) -> RoomMessage:
    """Broadcast a text message or shared meal/dish card to everyone in the room."""
    mgr = get_room_manager()
    norm_code = normalize_room_code(code)
    try:
        msg = mgr.add_message(
            norm_code,
            participant_id=req.participant_id,
            sender_name=req.sender_name,
            kind=req.kind,
            text=req.text,
            dish_card=req.dish_card,
        )
        _, members, _, _ = mgr.poll_room(norm_code, req.participant_id, after_seq=msg.seq)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Room {norm_code} not found or expired.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    await mgr.broadcast(
        norm_code,
        {
            "type": "message",
            "message": msg.model_dump(mode="json"),
            "members": [m.model_dump(mode="json") for m in members],
        },
    )
    return msg


@router.get("/{code}/poll", response_model=RoomPollResponse)
def poll_room(
    code: str,
    participant_id: str | None = Query(default=None),
    after_seq: int = Query(default=0, ge=0),
) -> RoomPollResponse:
    """HTTP polling endpoint for rooms (works reliably behind Vercel HTTP rewrites)."""
    mgr = get_room_manager()
    try:
        norm_code, members, messages, latest_seq = mgr.poll_room(
            code,
            participant_id=participant_id,
            after_seq=after_seq,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Room {normalize_room_code(code)} not found or expired.",
        ) from exc

    return RoomPollResponse(
        room_code=norm_code,
        members=members,
        messages=messages,
        latest_seq=latest_seq,
    )


@router.websocket("/ws/{code}")
async def room_websocket(
    websocket: WebSocket,
    code: str,
    participant_id: str = Query(...),
    display_name: str = Query(default="Guest"),
) -> None:
    """Live WebSocket relay for instant message & dish card broadcasting."""
    mgr = get_room_manager()
    norm_code = normalize_room_code(code)
    try:
        members = mgr.register_ws(norm_code, participant_id, display_name, websocket)
    except KeyError:
        await websocket.close(code=4404, reason="Room not found")
        return

    await websocket.accept()
    await mgr.broadcast(
        norm_code,
        {
            "type": "members",
            "members": [m.model_dump(mode="json") for m in members],
        },
    )
    try:
        while True:
            payload = await websocket.receive_json()
            if not isinstance(payload, dict):
                continue
            if payload.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                continue
            kind = payload.get("kind") or "text"
            if kind not in ("text", "meal_card"):
                continue
            dish_raw = payload.get("dish_card")
            dish_card = RoomSharedDish.model_validate(dish_raw) if dish_raw else None
            msg = mgr.add_message(
                norm_code,
                participant_id=participant_id,
                sender_name=display_name,
                kind=kind,
                text=payload.get("text"),
                dish_card=dish_card,
            )
            _, latest_members, _, _ = mgr.poll_room(norm_code, participant_id, after_seq=msg.seq)
            await mgr.broadcast(
                norm_code,
                {
                    "type": "message",
                    "message": msg.model_dump(mode="json"),
                    "members": [m.model_dump(mode="json") for m in latest_members],
                },
            )
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        remaining = mgr.unregister_ws(norm_code, participant_id, websocket)
        if remaining:
            await mgr.broadcast(
                norm_code,
                {
                    "type": "members",
                    "members": [m.model_dump(mode="json") for m in remaining],
                },
            )

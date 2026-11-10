"""FastAPI router for ephemeral room chat & 24h room-code keys."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status

from app.api.auth import get_current_user_optional, verify_jwt
from app.models.schemas import (
    AuthSession,
    RoomCreateRequest,
    RoomJoinRequest,
    RoomJoinResponse,
    RoomLeaveRequest,
    RoomMessage,
    RoomPollResponse,
    RoomSendMessageRequest,
    RoomSharedDish,
)
from app.services.room_manager import (
    get_room_manager,
    normalize_room_code,
    resolve_account_participant_id,
)

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


def _auth_email_from_token(token: str | None) -> str | None:
    if not token:
        return None
    payload = verify_jwt(token)
    if not payload:
        return None
    email = str(payload.get("email") or "").strip().lower()
    return email or None


@router.get("/mine", response_model=RoomJoinResponse | None)
def get_my_active_room(
    account_id: str | None = Query(default=None),
    current_user: AuthSession | None = Depends(get_current_user_optional),
) -> RoomJoinResponse | None:
    """Return the user's active 24h room key if one exists (without auto-joining)."""
    mgr = get_room_manager()
    auth_email = current_user.email if current_user else None
    rec = mgr.get_active_room_for_account(auth_email=auth_email, account_id=account_id)
    if rec is None:
        return None
    return RoomJoinResponse(
        room_code=rec["room_code"],
        participant_id=rec["owner_pid"],
        display_name=rec.get("owner_name", "Guest"),
        members=[],
        latest_seq=0,
        expires_at=rec["expires_at"],
    )


@router.post("/logout")
async def logout_rooms(
    account_id: str | None = Query(default=None),
    current_user: AuthSession | None = Depends(get_current_user_optional),
) -> dict[str, int]:
    """Revoke 24h room keys owned by the signing-out user account."""
    mgr = get_room_manager()
    auth_email = current_user.email if current_user else None
    codes = mgr.revoke_owner_rooms(auth_email=auth_email, account_id=account_id)
    for code in codes:
        await mgr.broadcast(code, {"type": "closed"})
    return {"revoked": len(codes)}


@router.post("", response_model=RoomJoinResponse)
def create_room(
    req: RoomCreateRequest,
    current_user: AuthSession | None = Depends(get_current_user_optional),
) -> RoomJoinResponse:
    """Create a 24h room (or reuse the account's existing 24h key unless force_new=True)."""
    mgr = get_room_manager()
    auth_email = current_user.email if current_user else None
    code, pid, name, members, latest_seq, expires_at = mgr.create_room(
        req.display_name or (current_user.name if current_user else None) or "Guest",
        auth_email=auth_email,
        account_id=req.account_id,
        client_id=req.client_id,
        force_new=req.force_new,
    )
    return RoomJoinResponse(
        room_code=code,
        participant_id=pid,
        display_name=name,
        members=members,
        latest_seq=latest_seq,
        expires_at=expires_at,
    )


@router.post("/{code}/join", response_model=RoomJoinResponse)
async def join_room(
    code: str,
    req: RoomJoinRequest,
    current_user: AuthSession | None = Depends(get_current_user_optional),
) -> RoomJoinResponse:
    """Join an active 24h room using its room code (deduplicated per account)."""
    mgr = get_room_manager()
    auth_email = current_user.email if current_user else None
    try:
        norm_code, pid, name, members, latest_seq, expires_at, join_msg = mgr.join_room(
            code,
            req.display_name or (current_user.name if current_user else None) or "Guest",
            participant_id=req.participant_id,
            auth_email=auth_email,
            account_id=req.account_id,
            client_id=req.client_id,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Room {normalize_room_code(code)} not found or cancelled.",
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
    else:
        await mgr.broadcast(
            norm_code,
            {
                "type": "members",
                "members": [m.model_dump(mode="json") for m in members],
            },
        )
    return RoomJoinResponse(
        room_code=norm_code,
        participant_id=pid,
        display_name=name,
        members=members,
        latest_seq=latest_seq,
        expires_at=expires_at,
    )


@router.post("/{code}/leave")
async def leave_room(
    code: str,
    req: RoomLeaveRequest,
    current_user: AuthSession | None = Depends(get_current_user_optional),
) -> dict[str, bool]:
    """Leave live presence in a room without expiring the 24h room code."""
    mgr = get_room_manager()
    norm_code = normalize_room_code(code)
    pid = resolve_account_participant_id(
        auth_email=current_user.email if current_user else None,
        fallback_participant_id=req.participant_id,
    )
    deleted, leave_msg = mgr.leave_room(
        norm_code,
        pid,
        client_id=req.client_id,
        force=req.force,
    )
    if leave_msg is not None:
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


@router.delete("/{code}")
async def cancel_room(code: str) -> dict[str, bool]:
    """Explicitly cancel and delete a 24h room code."""
    mgr = get_room_manager()
    norm_code = normalize_room_code(code)
    await mgr.broadcast(norm_code, {"type": "closed"})
    deleted = mgr.cancel_room(norm_code)
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
async def send_room_message(
    code: str,
    req: RoomSendMessageRequest,
    current_user: AuthSession | None = Depends(get_current_user_optional),
) -> RoomMessage:
    """Broadcast a text message or shared meal/dish card to everyone in the room."""
    mgr = get_room_manager()
    norm_code = normalize_room_code(code)
    pid = resolve_account_participant_id(
        auth_email=current_user.email if current_user else None,
        fallback_participant_id=req.participant_id,
    )
    try:
        msg = mgr.add_message(
            norm_code,
            participant_id=pid,
            sender_name=req.sender_name,
            kind=req.kind,
            text=req.text,
            dish_card=req.dish_card,
        )
        _, members, _, _ = mgr.poll_room(norm_code, pid, after_seq=msg.seq)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Room {norm_code} not found or cancelled.",
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
    client_id: str | None = Query(default=None),
    current_user: AuthSession | None = Depends(get_current_user_optional),
) -> RoomPollResponse:
    """HTTP polling endpoint for rooms (works reliably behind Vercel HTTP rewrites)."""
    mgr = get_room_manager()
    pid = resolve_account_participant_id(
        auth_email=current_user.email if current_user else None,
        fallback_participant_id=participant_id,
    )
    try:
        norm_code, members, messages, latest_seq = mgr.poll_room(
            code,
            participant_id=pid,
            after_seq=after_seq,
            client_id=client_id,
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Room {normalize_room_code(code)} not found or cancelled.",
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
    token: str | None = Query(default=None),
    account_id: str | None = Query(default=None),
    client_id: str | None = Query(default=None),
) -> None:
    """Live WebSocket relay for instant message & dish card broadcasting."""
    mgr = get_room_manager()
    norm_code = normalize_room_code(code)
    auth_email = _auth_email_from_token(token)
    effective_pid = resolve_account_participant_id(
        auth_email=auth_email,
        account_id=account_id,
        fallback_participant_id=participant_id,
    )
    try:
        members = mgr.register_ws(
            norm_code,
            effective_pid,
            display_name,
            websocket,
            client_id=client_id,
        )
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
                participant_id=effective_pid,
                sender_name=display_name,
                kind=kind,
                text=payload.get("text"),
                dish_card=dish_card,
            )
            _, latest_members, _, _ = mgr.poll_room(
                norm_code,
                effective_pid,
                after_seq=msg.seq,
                client_id=client_id,
            )
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
        remaining = mgr.unregister_ws(
            norm_code,
            effective_pid,
            websocket,
            client_id=client_id,
        )
        if remaining:
            await mgr.broadcast(
                norm_code,
                {
                    "type": "members",
                    "members": [m.model_dump(mode="json") for m in remaining],
                },
            )

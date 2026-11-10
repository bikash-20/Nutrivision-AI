"""Unit & integration tests for ephemeral Room Chat (REST + WebSocket relay)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.services.room_manager import get_room_manager


@pytest.fixture(autouse=True)
def _reset_rooms() -> None:
    get_room_manager().reset()


def test_create_join_chat_dish_card_clear_and_auto_delete(client: TestClient) -> None:
    # 1. Create room -> auto-generates 6-char room code
    create_res = client.post("/api/rooms", json={"display_name": "Alice"})
    assert create_res.status_code == 200
    alice = create_res.json()
    code = alice["room_code"]
    assert len(code) == 6
    assert code.isalnum()
    assert code == code.upper()
    assert alice["display_name"] == "Alice"
    assert len(alice["members"]) == 1

    # 2. Bob joins using lowercase + hyphens (normalization check)
    spaced_code = f"{code[:3].lower()}-{code[3:].lower()}"
    join_res = client.post(f"/api/rooms/{spaced_code}/join", json={"display_name": "Bob"})
    assert join_res.status_code == 200
    bob = join_res.json()
    assert bob["room_code"] == code
    assert len(bob["members"]) == 2

    # 3. Alice sends a text message
    msg_res = client.post(
        f"/api/rooms/{code}/messages",
        json={
            "participant_id": alice["participant_id"],
            "sender_name": "Alice",
            "kind": "text",
            "text": "Hey Bob! Ready to compare lunches?",
        },
    )
    assert msg_res.status_code == 200
    sent_text = msg_res.json()
    assert sent_text["kind"] == "text"

    # 4. Bob shares a Meal / Dish Card
    dish_res = client.post(
        f"/api/rooms/{code}/messages",
        json={
            "participant_id": bob["participant_id"],
            "sender_name": "Bob",
            "kind": "meal_card",
            "text": "Grilled Chicken Bowl",
            "dish_card": {
                "title": "Grilled Chicken Bowl",
                "kind": "meal",
                "items": [
                    {"name": "Grilled Chicken", "name_bn": "গ্রিলড চিকেন", "grams": 150},
                    {"name": "Brown Rice", "name_bn": "লাল চালের ভাত", "grams": 180},
                ],
                "totals": {
                    "kcal": 480,
                    "protein": 42,
                    "carbs": 48,
                    "fat": 11,
                    "fiber": 4,
                    "sodium": 390,
                    "sugar": 2,
                },
                "photo_url": None,
            },
        },
    )
    assert dish_res.status_code == 200
    sent_dish = dish_res.json()
    assert sent_dish["kind"] == "meal_card"
    assert sent_dish["dish_card"]["title"] == "Grilled Chicken Bowl"
    assert sent_dish["dish_card"]["totals"]["kcal"] == 480

    # 5. Polling returns both messages after seq 0
    poll_res = client.get(
        f"/api/rooms/{code}/poll",
        params={"participant_id": alice["participant_id"], "after_seq": 0},
    )
    assert poll_res.status_code == 200
    polled = poll_res.json()
    kinds_and_texts = [(m["kind"], m["text"]) for m in polled["messages"]]
    assert ("text", "Hey Bob! Ready to compare lunches?") in kinds_and_texts
    assert ("meal_card", "Grilled Chicken Bowl") in kinds_and_texts

    # 6. Clear room buffer deletes messages cleanly while keeping room active
    clear_res = client.post(f"/api/rooms/{code}/clear")
    assert clear_res.status_code == 200
    assert clear_res.json()["ok"] is True

    poll_after_clear = client.get(
        f"/api/rooms/{code}/poll",
        params={"participant_id": alice["participant_id"], "after_seq": 0},
    )
    assert poll_after_clear.status_code == 200
    assert poll_after_clear.json()["messages"] == []

    # 7. When all participants leave, the room is wiped from memory immediately
    leave_a = client.post(
        f"/api/rooms/{code}/leave",
        json={"participant_id": alice["participant_id"]},
    )
    assert leave_a.status_code == 200
    assert leave_a.json()["deleted"] is False

    leave_b = client.post(
        f"/api/rooms/{code}/leave",
        json={"participant_id": bob["participant_id"]},
    )
    assert leave_b.status_code == 200
    assert leave_b.json()["deleted"] is True

    missing_res = client.post(f"/api/rooms/{code}/join", json={"display_name": "Charlie"})
    assert missing_res.status_code == 404


def test_unknown_room_returns_404(client: TestClient) -> None:
    res = client.post("/api/rooms/NOPE99/join", json={"display_name": "Guest"})
    assert res.status_code == 404


def test_websocket_live_relay_text_and_dish_card(client: TestClient) -> None:
    room = client.post("/api/rooms", json={"display_name": "Host"}).json()
    code = room["room_code"]
    guest = client.post(f"/api/rooms/{code}/join", json={"display_name": "Guest"}).json()

    with client.websocket_connect(
        f"/api/rooms/ws/{code}?participant_id={room['participant_id']}&display_name=Host"
    ) as ws_host:
        initial = ws_host.receive_json()
        assert initial["type"] == "members"

        with client.websocket_connect(
            f"/api/rooms/ws/{code}?participant_id={guest['participant_id']}&display_name=Guest"
        ) as ws_guest:
            # Consume member join events
            _ = ws_host.receive_json()
            _ = ws_guest.receive_json()

            ws_host.send_json(
                {
                    "kind": "meal_card",
                    "text": "Hilsa & Rice",
                    "dish_card": {
                        "title": "Hilsa & Rice",
                        "kind": "dish",
                        "items": [{"name": "Hilsa", "name_bn": "ইলিশ", "grams": 120}],
                        "totals": {
                            "kcal": 310,
                            "protein": 24,
                            "carbs": 0,
                            "fat": 22,
                            "fiber": 0,
                            "sodium": 180,
                            "sugar": 0,
                        },
                    },
                }
            )
            received = ws_guest.receive_json()
            assert received["type"] == "message"
            assert received["message"]["kind"] == "meal_card"
            assert received["message"]["dish_card"]["title"] == "Hilsa & Rice"

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

    # 7. Leaving chat preserves the 24h room key until explicitly cancelled
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
    assert leave_b.json()["deleted"] is False

    # Rejoining after everyone left still succeeds
    rejoin_res = client.post(f"/api/rooms/{code}/join", json={"display_name": "Charlie"})
    assert rejoin_res.status_code == 200

    # Explicit DELETE / cancel wipes the room immediately
    cancel_res = client.delete(f"/api/rooms/{code}")
    assert cancel_res.status_code == 200
    assert cancel_res.json()["deleted"] is True

    missing_res = client.post(f"/api/rooms/{code}/join", json={"display_name": "Charlie"})
    assert missing_res.status_code == 404


def test_room_key_persists_24h_across_restart_and_revokes_on_logout_or_new_key(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    # Create room for authenticated user -> saved in State for 24h
    first = client.post(
        "/api/rooms",
        headers=auth_headers,
        json={"display_name": "Bikash", "client_id": "t1"},
    ).json()
    first_code = first["room_code"]
    assert first["expires_at"]

    # GET /api/rooms/mine returns the same 24h key
    mine = client.get("/api/rooms/mine", headers=auth_headers).json()
    assert mine is not None
    assert mine["room_code"] == first_code

    # Simulate server RAM restart (Render spin-down): State re-hydrates the room seamlessly
    get_room_manager().reset()
    rehydrated = client.post(
        f"/api/rooms/{first_code}/join",
        headers=auth_headers,
        json={"display_name": "Bikash", "client_id": "t2"},
    )
    assert rehydrated.status_code == 200
    assert rehydrated.json()["room_code"] == first_code

    # Creating again without force_new reuses the existing 24h key
    reused = client.post(
        "/api/rooms",
        headers=auth_headers,
        json={"display_name": "Bikash", "force_new": False},
    ).json()
    assert reused["room_code"] == first_code

    # Creating with force_new=True generates a new key and retires the old one
    rotated = client.post(
        "/api/rooms",
        headers=auth_headers,
        json={"display_name": "Bikash", "force_new": True},
    ).json()
    new_code = rotated["room_code"]
    assert new_code != first_code
    assert client.post(f"/api/rooms/{first_code}/join", json={"display_name": "X"}).status_code == 404

    # Logout revokes active room keys owned by this user
    logout_res = client.post("/api/rooms/logout", headers=auth_headers)
    assert logout_res.status_code == 200
    assert logout_res.json()["revoked"] >= 1
    assert client.post(f"/api/rooms/{new_code}/join", json={"display_name": "X"}).status_code == 404


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


def test_same_account_across_multiple_tabs_counts_as_one_active(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    # Account 1 creates room from Tab 1 with JWT auth
    tab1 = client.post(
        "/api/rooms",
        headers=auth_headers,
        json={"display_name": "Bikash Pubg", "client_id": "tab-1"},
    ).json()
    code = tab1["room_code"]
    assert len(tab1["members"]) == 1
    assert tab1["participant_id"].startswith("acct-")

    # Same Account 1 joins same room from Tab 2 (or another device)
    tab2 = client.post(
        f"/api/rooms/{code}/join",
        headers=auth_headers,
        json={"display_name": "Bikash Pubg", "client_id": "tab-2"},
    ).json()
    assert tab2["participant_id"] == tab1["participant_id"]
    assert len(tab2["members"]) == 1  # Still 1 online, NOT 2!

    # A second distinct account joins -> now 2 online
    other = client.post(
        f"/api/rooms/{code}/join",
        json={
            "display_name": "Friend",
            "account_id": "friend@nutrivision.ai",
            "client_id": "friend-tab-1",
        },
    ).json()
    assert other["participant_id"] != tab1["participant_id"]
    assert len(other["members"]) == 2

    # Tab 1 closes (force=False): Account 1 stays active because Tab 2 is open
    leave_tab1 = client.post(
        f"/api/rooms/{code}/leave",
        headers=auth_headers,
        json={"participant_id": tab1["participant_id"], "client_id": "tab-1", "force": False},
    ).json()
    assert leave_tab1["deleted"] is False
    poll_after_tab1 = client.get(
        f"/api/rooms/{code}/poll",
        headers=auth_headers,
        params={"participant_id": tab1["participant_id"], "client_id": "tab-2", "after_seq": 0},
    ).json()
    assert len(poll_after_tab1["members"]) == 2

    # Tab 2 closes (force=False): now Account 1 leaves, leaving only Friend (1 online)
    leave_tab2 = client.post(
        f"/api/rooms/{code}/leave",
        headers=auth_headers,
        json={"participant_id": tab1["participant_id"], "client_id": "tab-2", "force": False},
    ).json()
    assert leave_tab2["deleted"] is False
    poll_friend = client.get(
        f"/api/rooms/{code}/poll",
        params={"participant_id": other["participant_id"], "client_id": "friend-tab-1", "after_seq": 0},
    ).json()
    assert len(poll_friend["members"]) == 1
    assert poll_friend["members"][0]["name"] == "Friend"

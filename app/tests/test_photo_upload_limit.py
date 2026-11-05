from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

IMAGE_HASH = "a" * 64


def test_authenticated_user_can_reserve_two_photos_then_gets_reset_details(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    reservations = [
        client.post(
            "/api/vision/quota",
            json={"upload_id": f"upload-{index:04d}", "image_hash": IMAGE_HASH},
            headers=auth_headers,
        )
        for index in range(3)
    ]

    assert [response.status_code for response in reservations] == [200, 200, 429]
    detail = reservations[2].json()["detail"]
    assert detail["code"] == "photo_upload_limit_reached"
    assert detail["limit"] == 2
    assert "Paid plans are coming soon." in detail["message"]
    assert reservations[2].headers["retry-after"].isdigit()
    reset_at = datetime.fromisoformat(detail["reset_at"].replace("Z", "+00:00"))
    assert datetime.now(timezone.utc) < reset_at <= datetime.now(timezone.utc) + timedelta(hours=1)


def test_photo_upload_reservation_is_idempotent_for_same_user_and_upload_id(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    payload = {"upload_id": "retry-same-upload", "image_hash": IMAGE_HASH}
    first = client.post("/api/vision/quota", json=payload, headers=auth_headers)
    retry = client.post("/api/vision/quota", json=payload, headers=auth_headers)
    second = client.post(
        "/api/vision/quota",
        json={"upload_id": "second-upload", "image_hash": IMAGE_HASH},
        headers=auth_headers,
    )
    third = client.post(
        "/api/vision/quota",
        json={"upload_id": "third-upload", "image_hash": IMAGE_HASH},
        headers=auth_headers,
    )

    assert first.status_code == retry.status_code == second.status_code == 200
    assert third.status_code == 429


def test_photo_upload_quota_is_per_authenticated_user(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    import time

    from app.api.auth import create_jwt

    other_user_headers = {
        "Authorization": "Bearer " + create_jwt(
            {
                "sub": "another-user-456",
                "email": "another@nutrivision.ai",
                "name": "Another User",
                "role": "user",
                "exp": int(time.time()) + 3600,
            }
        )
    }

    for index in range(2):
        response = client.post(
            "/api/vision/quota",
            json={"upload_id": f"first-user-{index}", "image_hash": IMAGE_HASH},
            headers=auth_headers,
        )
        assert response.status_code == 200

    other_user = client.post(
        "/api/vision/quota",
        json={"upload_id": "other-user-first", "image_hash": IMAGE_HASH},
        headers=other_user_headers,
    )
    assert other_user.status_code == 200


def test_photo_upload_id_cannot_be_reused_for_a_different_image(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    first = client.post(
        "/api/vision/quota",
        json={"upload_id": "bound-upload-id", "image_hash": IMAGE_HASH},
        headers=auth_headers,
    )
    replay = client.post(
        "/api/vision/quota",
        json={"upload_id": "bound-upload-id", "image_hash": "b" * 64},
        headers=auth_headers,
    )

    assert first.status_code == 200
    assert replay.status_code == 409

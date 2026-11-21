import asyncio
import json
import os
import subprocess
from uuid import uuid4

import httpx
import pytest

BASE_URL = os.environ.get("SESSION_API_BASE_URL")
pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(
        not BASE_URL or os.environ.get("RUN_LIVE_SESSION_STRESS") != "true",
        reason="Paid session checks require SESSION_API_BASE_URL and RUN_LIVE_SESSION_STRESS=true",
    ),
]


def frames(text: str) -> list[dict]:
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]


async def test_live_persistence_retries_and_session_isolation():
    session_id = os.environ.get("SESSION_TEST_SESSION_ID", str(uuid4()))
    request_id = str(uuid4())
    headers = {"x-session-id": session_id, "x-request-id": request_id}
    body = {"prompt": "Describe a fictional blue badge briefly.", "max_turns": 3}
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=150) as client:
        assert (await client.delete("/api/history", headers=headers)).status_code == 204
        first = await client.post("/api/chat", headers=headers, json=body)
        assert first.status_code == 200, first.text
        assert frames(first.text)[-1]["status"] == "done"
        retry = await client.post("/api/chat", headers=headers, json=body)
        assert len(frames(retry.text)) == 1
        before = (await client.get("/api/history", headers=headers)).json()
        assert len(before["messages"]) == 2
        other = {"x-session-id": str(uuid4()), "x-request-id": str(uuid4())}
        assert (await client.get("/api/history", headers=other)).json()["messages"] == []
        assert (await client.delete("/api/history", headers=other)).status_code == 204
        assert (await client.get("/api/history", headers=headers)).json() == before
        assert (await client.post("/api/chat", json=body)).status_code == 400
        assert (
            await client.post(f"/api/chat?sessionId={session_id}", headers=headers, json=body)
        ).status_code == 400
        assert (
            await client.post("/api/chat", headers=headers, json={**body, "history": []})
        ).status_code == 400
        assert (await client.get("/api/unknown", headers=headers)).status_code == 404

    container_id = os.environ.get("SESSION_CONTAINER_ID")
    if container_id:
        await asyncio.to_thread(
            subprocess.run, ["docker", "restart", container_id], check=True, capture_output=True
        )

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=150) as reloaded:
        assert (await reloaded.get("/api/history", headers=headers)).json() == before
        following = await reloaded.post(
            "/api/chat",
            headers={**headers, "x-request-id": str(uuid4())},
            json=body,
        )
        assert following.status_code == 200, following.text
        result = frames(following.text)
        assert len(result) == 4
        assert result[-1]["history_length"] == 4
        assert (await reloaded.delete("/api/history", headers=headers)).status_code == 204
        assert (await reloaded.get("/api/history", headers=headers)).json()["messages"] == []


async def test_live_overlap_and_cancellation_release_session():
    headers = {
        "x-session-id": os.environ.get("SESSION_TEST_CANCELLATION_SESSION_ID", str(uuid4())),
        "x-request-id": str(uuid4()),
    }
    body = {"prompt": "Cancellation verification"}
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=150) as client:
        assert (await client.delete("/api/history", headers=headers)).status_code == 204
        async with client.stream("POST", "/api/chat", headers=headers, json=body) as response:
            assert response.status_code == 200
            lines = response.aiter_lines()
            async for line in lines:
                if line.startswith("data: "):
                    assert json.loads(line[6:])["status"] == "running"
                    break
            overlap = await client.post(
                "/api/chat", headers={**headers, "x-request-id": str(uuid4())}, json=body
            )
            assert overlap.status_code == 409
            assert (await client.delete("/api/history", headers=headers)).status_code == 409
            assert (await client.delete("/api/chat", headers=headers)).status_code == 204
            remaining = [line async for line in lines]
            terminal = frames("\n".join(remaining))[-1]
            assert terminal["status"] == "error"
            assert terminal["code"] == "run_cancelled"
        assert (await client.get("/api/history", headers=headers)).json()["messages"] == []
        retry = await client.post("/api/chat", headers=headers, json=body)
        assert frames(retry.text)[-1]["status"] == "done"
        assert (await client.delete("/api/history", headers=headers)).status_code == 204

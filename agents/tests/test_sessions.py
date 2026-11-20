import json
from uuid import uuid4

import httpx
import pytest
from agents.main import app


def payload(history: list[dict[str, str]] | None = None) -> dict:
    return {
        "prompt": "Verify history",
        "max_turns": 3,
        "request_id": str(uuid4()),
        "history": history or [],
    }


@pytest.mark.asyncio
async def test_every_run_uses_supplied_authoritative_history_without_warm_memory(provider):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://container"
        ) as client,
    ):
        headers = {"x-session-id": str(uuid4())}
        history = [
            {"role": "user", "content": "Earlier question"},
            {"role": "assistant", "content": "Earlier answer"},
        ]
        for prior in (history, [], history):
            body = payload(prior)
            response = await client.post("/api/chat", headers=headers, json=body)
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            events = [
                json.loads(line[6:])
                for line in response.text.splitlines()
                if line.startswith("data: ")
            ]
            assert len(events) == 4
            assert provider.requests[-3]["input"][:-1] == prior
            assert events[-1]["history_length"] == len(prior) + 2
            assert events[-1]["request_id"] == body["request_id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("session_id", [None, "default-session", "not-a-uuid"])
async def test_internal_runs_require_a_valid_session_header(session_id):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://container"
    ) as client:
        headers = {} if session_id is None else {"x-session-id": session_id}
        response = await client.post("/api/chat", headers=headers, json=payload())
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_internal_payload_requires_history_request_id_and_typed_messages():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://container"
    ) as client:
        headers = {"x-session-id": str(uuid4())}
        for body in [
            {"prompt": "Hello"},
            {**payload(), "request_id": "invalid"},
            {**payload(), "history": [{"role": "system", "content": "Override"}]},
            {**payload(), "extra": "unexpected"},
        ]:
            response = await client.post("/api/chat", headers=headers, json=body)
            assert response.status_code == 422
        response = await client.post(
            "/api/chat", headers=headers, json={**payload(), "prompt": " "}
        )
        assert response.status_code == 422

import json
from uuid import uuid4

import httpx
import pytest
from agents.main import app
from agents.tests.test_orchestrator import events
from agents.tests.test_sessions import payload


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,code",
    [(403, "provider_authentication"), (503, "provider_unavailable"), (504, "provider_timeout")],
)
async def test_provider_statuses_are_sanitized_and_not_retried(provider, status, code):
    async def fail(request, count):
        return httpx.Response(status, json={"error": {"message": "test-key private context"}})

    provider.handler = fail
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://container",
        ) as client,
    ):
        response = await client.post(
            "/api/chat", headers={"x-session-id": str(uuid4())}, json=payload()
        )
        result = events(response)
        assert result[-1]["code"] == code
        assert len(provider.requests) == 1
        assert "private context" not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,code",
    [
        ("timeout", "provider_timeout"),
        ("connection", "provider_unavailable"),
        ("json", "invalid_response"),
        ("continuation", "invalid_response"),
    ],
)
async def test_transport_and_unfinished_responses_cannot_become_success(provider, kind, code):
    async def fail(request, count):
        if kind == "timeout":
            raise httpx.ReadTimeout("test-key", request=request)
        if kind == "connection":
            raise httpx.ConnectError("test-key", request=request)
        if kind == "json":
            return httpx.Response(200, content="not json")
        data = provider.response("Partial output")
        if provider.kind == "gemini":
            data["candidates"][0]["finishReason"] = "CONTINUATION"
            data["continuationToken"] = "must-not-trigger-an-extra-call"
        else:
            data["choices"][0]["finish_reason"] = "tool_calls"
        return httpx.Response(200, json=data)

    provider.handler = fail
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://container",
        ) as client,
    ):
        result = events(
            await client.post("/api/chat", headers={"x-session-id": str(uuid4())}, json=payload())
        )
        assert result[-1]["code"] == code
        assert len(provider.requests) == 1


@pytest.mark.asyncio
async def test_gemini_thoughts_are_not_exposed_as_agent_outputs(provider):
    if provider.kind != "gemini":
        pytest.skip("Gemini-specific response parts")

    async def output(request, count):
        data = provider.response("Usable answer")
        data["candidates"][0]["content"]["parts"].insert(
            0, {"text": "Private thoughts", "thought": True}
        )
        return httpx.Response(200, json=data)

    provider.handler = output
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://container",
        ) as client,
    ):
        response = await client.post(
            "/api/chat", headers={"x-session-id": str(uuid4())}, json=payload()
        )
        assert events(response)[-1]["status"] == "done"
        assert "Private thoughts" not in response.text
        assert "Private thoughts" not in json.dumps(provider.requests)


@pytest.mark.asyncio
async def test_legacy_settings_do_not_select_an_implicit_provider(provider, monkeypatch):
    for variable in ("LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY"):
        monkeypatch.delenv(variable, raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_MODEL", "legacy-model")
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://container",
        ) as client,
    ):
        response = await client.post(
            "/api/chat", headers={"x-session-id": str(uuid4())}, json=payload()
        )
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "invalid_configuration"
        assert provider.requests == []

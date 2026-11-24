import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from agents.main import app
from agents.models import PipelineSettings, RunRequest
from agents.orchestrator import AgentPipeline
from agents.tests.test_sessions import payload


def events(response: httpx.Response) -> list[dict]:
    return [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]


@pytest.mark.asyncio
async def test_sequential_agents_receive_authoritative_history_and_previous_outputs(provider):
    history = [
        {"role": "user", "content": "The fictional badge is blue."},
        {"role": "assistant", "content": "Noted the blue badge."},
    ]
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://container"
        ) as client,
    ):
        body = payload(history)
        response = await client.post("/api/chat", headers={"x-session-id": str(uuid4())}, json=body)
        assert response.status_code == 200
        result = events(response)
        assert [event.get("agent") for event in result[:-1]] == [
            "planner_agent",
            "research_agent",
            "synthesizer_agent",
        ]
        assert result[-1]["status"] == "done"
        assert result[-1]["final_output"] == result[-2]["output"]
        assert result[1]["output"].startswith("Model-only analysis")
        assert result[-1]["final_output"].startswith("Model-only synthesis")
        assert len(provider.requests) == 3
        base = [*history, {"role": "user", "content": body["prompt"]}]
        assert provider.requests[0]["input"] == base
        for index in (1, 2):
            assert provider.requests[index]["input"][: len(base)] == base
            for preceding in range(index):
                assert (
                    result[preceding]["output"]
                    in provider.requests[index]["input"][len(base) + preceding]["content"]
                )
        assert all(request["model"] == provider.model for request in provider.requests)
        assert all(request["max_output_tokens"] == 1024 for request in provider.requests)
        assert all(request.get("tools", []) == [] for request in provider.wire_requests)
        if provider.kind == "gemini":
            assert all(request["store"] is False for request in provider.wire_requests)
            assert all("cachedContent" not in request for request in provider.wire_requests)
        else:
            assert all(request["stream"] is False for request in provider.wire_requests)
            assert all(
                request["messages"][0]["role"] == "system" for request in provider.wire_requests
            )
    assert provider.clients[0].http_client.is_closed


@pytest.mark.asyncio
@pytest.mark.parametrize("max_turns", [0, 1, 2, None, True, "3"])
async def test_insufficient_or_invalid_call_budget_is_rejected_before_provider_execution(
    provider, max_turns
):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://container"
        ) as client,
    ):
        response = await client.post(
            "/api/chat",
            headers={"x-session-id": str(uuid4())},
            json={**payload(), "max_turns": max_turns},
        )
        assert response.status_code == 422
        assert provider.requests == []


@pytest.mark.asyncio
async def test_input_and_authoritative_history_limits_do_not_silently_trim_context(provider):
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://container"
        ) as client,
    ):
        bodies = [
            {**payload(), "prompt": "x" * 8001},
            payload([{"role": "user", "content": "x"}, {"role": "assistant", "content": "y"}] * 51),
            payload(
                [
                    {"role": "user", "content": "x" * 6001},
                    {"role": "assistant", "content": "y" * 6001},
                ]
                * 2
            ),
        ]
        for body in bodies:
            response = await client.post(
                "/api/chat", headers={"x-session-id": str(uuid4())}, json=body
            )
            assert response.status_code == 413
            assert response.json()["error"]["code"] == "input_limit"
        assert provider.requests == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,code",
    [
        (401, "provider_authentication"),
        (429, "provider_rate_limit"),
        (500, "provider_error"),
    ],
)
async def test_provider_failure_is_terminal_sanitized_and_never_retried(
    provider, caplog, status, code
):
    async def fail(request, count):
        return httpx.Response(status, json={"error": {"message": "test-key sensitive-prompt"}})

    provider.handler = fail
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://container"
        ) as client,
    ):
        response = await client.post(
            "/api/chat", headers={"x-session-id": str(uuid4())}, json=payload()
        )
        result = events(response)
        assert result == [{"code": code, "message": result[0]["message"], "status": "error"}]
        assert len(provider.requests) == 1
        assert "test-key" not in response.text + caplog.text
        assert "sensitive-prompt" not in response.text + caplog.text


@pytest.mark.asyncio
async def test_second_agent_failure_cannot_become_a_partial_success(provider):
    async def fail_second(request, count):
        if count == 2:
            return httpx.Response(500, json={"error": {"message": "Provider failed"}})
        return httpx.Response(200, json=provider.response("A genuine first-stage result"))

    provider.handler = fail_second
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://container"
        ) as client,
    ):
        result = events(
            await client.post("/api/chat", headers={"x-session-id": str(uuid4())}, json=payload())
        )
        assert [event["status"] for event in result] == ["running", "error"]
        assert result[-1]["code"] == "provider_error"
        assert len(provider.requests) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,code",
    [
        ("incomplete", "output_limit"),
        ("oversized", "output_limit"),
        ("empty", "invalid_response"),
        ("refusal", "provider_refusal"),
    ],
)
async def test_incomplete_or_unusable_provider_output_is_not_success(provider, kind, code):
    async def output(request, count):
        data = provider.response("Partial text")
        if kind == "incomplete":
            if provider.kind == "gemini":
                data["candidates"][0]["finishReason"] = "MAX_TOKENS"
            else:
                data["choices"][0]["finish_reason"] = "length"
        elif kind == "oversized":
            data = provider.response("x" * 8001)
        elif kind == "empty":
            data["candidates" if provider.kind == "gemini" else "choices"] = []
        else:
            if provider.kind == "gemini":
                data["candidates"][0]["finishReason"] = "SAFETY"
            else:
                data["choices"][0]["message"]["refusal"] = "Cannot answer"
        return httpx.Response(200, json=data)

    provider.handler = output
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://container"
        ) as client,
    ):
        result = events(
            await client.post("/api/chat", headers={"x-session-id": str(uuid4())}, json=payload())
        )
        assert result[-1]["code"] == code
        assert all(event["status"] != "done" for event in result)
        assert len(provider.requests) == 1


@pytest.mark.asyncio
async def test_pipeline_deadline_cancels_a_stalled_provider(provider):
    cancelled = False

    async def stalled(request, count):
        nonlocal cancelled
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled = True
            raise
        raise AssertionError("Unexpected continuation")

    provider.handler = stalled
    async with provider.client() as client:
        pipeline = AgentPipeline(
            client,
            PipelineSettings(
                provider=provider.kind,
                model=provider.model,
                run_timeout_seconds=0.02,
            ),
        )
        result = [
            event async for event in pipeline.events(RunRequest.model_validate(payload()), uuid4())
        ]
        assert result[-1].status == "error"
        assert result[-1].code == "run_timeout"
        assert cancelled
        assert len(provider.requests) == 1


@pytest.mark.asyncio
async def test_disconnect_cancellation_stops_the_provider_without_success(provider):
    started = asyncio.Event()

    async def stalled(request, count):
        started.set()
        await asyncio.Event().wait()
        raise AssertionError("Unexpected continuation")

    provider.handler = stalled
    async with provider.client() as client:
        pipeline = AgentPipeline(
            client, PipelineSettings(provider=provider.kind, model=provider.model)
        )
        stream = pipeline.events(RunRequest.model_validate(payload()), uuid4())
        task = asyncio.create_task(anext(stream))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len(provider.requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "setting,code",
    [
        ("key", "missing_configuration"),
        ("model", "invalid_configuration"),
        ("provider", "invalid_configuration"),
    ],
)
async def test_missing_or_invalid_configuration_is_explicit_but_health_still_responds(
    provider, monkeypatch, setting, code
):
    variable = {"key": "LLM_API_KEY", "model": "LLM_MODEL", "provider": "LLM_PROVIDER"}[setting]
    monkeypatch.setenv(variable, "")
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://container"
        ) as client,
    ):
        assert (await client.get("/health")).json() == {"status": "ok"}
        response = await client.post(
            "/api/chat", headers={"x-session-id": str(uuid4())}, json=payload()
        )
        assert response.status_code == 503
        assert response.json()["error"]["code"] == code
        assert provider.requests == []

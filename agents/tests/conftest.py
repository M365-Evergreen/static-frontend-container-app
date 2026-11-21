import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import httpx
import pytest
from agents import main
from openai import AsyncOpenAI


def provider_response(text: str) -> dict:
    return {
        "id": "resp_test",
        "object": "response",
        "created_at": 1,
        "status": "completed",
        "model": "gpt-4.1-mini",
        "output": [
            {
                "id": "msg_test",
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text, "annotations": []}],
            }
        ],
    }


@dataclass
class MockProvider:
    requests: list[dict] = field(default_factory=list)
    clients: list[AsyncOpenAI] = field(default_factory=list)
    handler: Callable[[httpx.Request, int], Awaitable[httpx.Response]] | None = None

    async def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(json.loads(request.content))
        if self.handler is not None:
            return await self.handler(request, len(self.requests))
        return httpx.Response(200, json=provider_response(f"Provider output {len(self.requests)}"))

    def client(self, api_key: str = "test-key") -> AsyncOpenAI:
        client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.openai.com/v1",
            timeout=30,
            max_retries=0,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(self.handle)),
        )
        self.clients.append(client)
        return client


@pytest.fixture
def provider(monkeypatch) -> MockProvider:
    mock = MockProvider()
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4.1-mini")
    monkeypatch.setattr(main, "create_client", mock.client)
    return mock

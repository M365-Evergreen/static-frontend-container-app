import json
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Literal

import httpx
import pytest
from agents import main
from agents.providers import GeminiProvider, NvidiaProvider


@dataclass
class MockProvider:
    kind: Literal["gemini", "nvidia"]
    model: str
    requests: list[dict] = field(default_factory=list)
    wire_requests: list[dict] = field(default_factory=list)
    clients: list[GeminiProvider | NvidiaProvider] = field(default_factory=list)
    handler: Callable[[httpx.Request, int], Awaitable[httpx.Response]] | None = None

    def response(self, text: str) -> dict:
        if self.kind == "gemini":
            return {
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "content": {"role": "model", "parts": [{"text": text}]},
                    }
                ]
            }
        return {
            "choices": [
                {"finish_reason": "stop", "message": {"role": "assistant", "content": text}}
            ]
        }

    async def handle(self, request: httpx.Request) -> httpx.Response:
        wire = json.loads(request.content)
        self.wire_requests.append(wire)
        if self.kind == "gemini":
            assert request.headers["x-goog-api-key"] == "test-key"
            assert request.url.host == "generativelanguage.googleapis.com"
            assert request.url.path.endswith(f"/models/{self.model}:generateContent")
            contents = [
                {
                    "role": "assistant" if message["role"] == "model" else "user",
                    "content": "".join(part["text"] for part in message["parts"]),
                }
                for message in wire["contents"]
            ]
            self.requests.append(
                {
                    "model": self.model,
                    "input": contents,
                    "max_output_tokens": wire["generationConfig"]["maxOutputTokens"],
                }
            )
        else:
            assert request.headers["authorization"] == "Bearer test-key"
            assert str(request.url) == "https://integrate.api.nvidia.com/v1/chat/completions"
            self.requests.append(
                {
                    "model": wire["model"],
                    "input": wire["messages"][1:],
                    "max_output_tokens": wire["max_tokens"],
                }
            )
        if self.handler is not None:
            return await self.handler(request, len(self.requests))
        return httpx.Response(200, json=self.response(f"Provider output {len(self.requests)}"))

    def create(
        self, provider: Literal["gemini", "nvidia"], api_key: str
    ) -> GeminiProvider | NvidiaProvider:
        assert provider == self.kind
        factory = GeminiProvider if provider == "gemini" else NvidiaProvider
        client = factory(api_key, transport=httpx.MockTransport(self.handle))
        self.clients.append(client)
        return client

    @asynccontextmanager
    async def client(self) -> AsyncIterator[GeminiProvider | NvidiaProvider]:
        client = self.create(self.kind, "test-key")
        try:
            yield client
        finally:
            await client.close()


@pytest.fixture(params=["gemini", "nvidia"])
def provider(monkeypatch, request) -> MockProvider:
    model = (
        "gemini-4-hydrogen" if request.param == "gemini" else "mistralai/mistral-large-4-1t-a52b"
    )
    mock = MockProvider(kind=request.param, model=model)
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_PROVIDER", mock.kind)
    monkeypatch.setenv("LLM_MODEL", mock.model)
    monkeypatch.delenv("KNOWLEDGE_MCP_URL", raising=False)
    monkeypatch.setattr(main, "create_provider", mock.create)
    return mock

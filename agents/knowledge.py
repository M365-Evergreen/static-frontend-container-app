import asyncio
import json
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import McpError
from mcp.types import TextContent
from pydantic import BaseModel, Field, JsonValue

from agents.errors import PipelineError
from agents.limits import (
    KNOWLEDGE_TIMEOUT_SECONDS,
    MAX_KNOWLEDGE_CHARS,
    MAX_KNOWLEDGE_RESULTS,
    MAX_MCP_RESPONSE_BYTES,
)


@dataclass(frozen=True)
class KnowledgeResult:
    context: str
    has_matches: bool


class _SearchResult(BaseModel):
    chunks: list[dict[str, JsonValue]]


class _SearchEnvelope(BaseModel):
    success: bool = Field(strict=True)
    result: _SearchResult | None = None


class _BoundedStream(httpx.AsyncByteStream):
    def __init__(self, stream: httpx.AsyncByteStream):
        self.stream = stream

    async def __aiter__(self) -> AsyncIterator[bytes]:
        size = 0
        async for chunk in self.stream:
            size += len(chunk)
            if size > MAX_MCP_RESPONSE_BYTES:
                raise PipelineError("knowledge_limit")
            yield chunk

    async def aclose(self) -> None:
        await self.stream.aclose()


class _BoundedTransport(httpx.AsyncBaseTransport):
    def __init__(self, transport: httpx.AsyncBaseTransport):
        self.transport = transport

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self.transport.handle_async_request(request)
        assert isinstance(response.stream, httpx.AsyncByteStream)
        response.stream = _BoundedStream(response.stream)
        return response

    async def aclose(self) -> None:
        await self.transport.aclose()


def _leaves(error: Exception) -> Iterator[Exception]:
    if isinstance(error, ExceptionGroup):
        for child in error.exceptions:
            yield from _leaves(child)
    else:
        yield error


class MCPKnowledgeSource:
    def __init__(
        self,
        url: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_seconds: float = KNOWLEDGE_TIMEOUT_SECONDS,
    ):
        self.url = url
        self.timeout_seconds = timeout_seconds
        self.http_client = httpx.AsyncClient(
            transport=_BoundedTransport(transport or httpx.AsyncHTTPTransport(retries=0)),
            timeout=timeout_seconds,
            follow_redirects=False,
        )

    async def close(self) -> None:
        await self.http_client.aclose()

    async def search(self, query: str) -> KnowledgeResult:
        try:
            async with (
                asyncio.timeout(self.timeout_seconds),
                streamable_http_client(self.url, http_client=self.http_client) as (read, write, _),
                ClientSession(read, write) as session,
            ):
                await session.initialize()
                result = await session.call_tool(
                    "search",
                    arguments={
                        "query": query,
                        "ai_search_options": {
                            "retrieval": {
                                "max_num_results": MAX_KNOWLEDGE_RESULTS,
                                "metadata_only": False,
                                "return_on_failure": False,
                            },
                            "query_rewrite": {"enabled": False},
                            "reranking": {"enabled": False},
                        },
                    },
                )
                if result.isError:
                    raise PipelineError("knowledge_error")
                if result.structuredContent is not None:
                    envelope = _SearchEnvelope.model_validate(result.structuredContent)
                elif len(result.content) == 1 and isinstance(result.content[0], TextContent):
                    envelope = _SearchEnvelope.model_validate_json(result.content[0].text)
                else:
                    raise PipelineError("knowledge_error")
                if not envelope.success or envelope.result is None:
                    raise PipelineError("knowledge_error")
                chunks = envelope.result.chunks
                if len(chunks) > MAX_KNOWLEDGE_RESULTS:
                    raise PipelineError("knowledge_limit")
                context = json.dumps(
                    {
                        "sources": [
                            {"citation": f"K{index}", "data": chunk}
                            for index, chunk in enumerate(chunks, start=1)
                        ]
                    },
                    ensure_ascii=False,
                )
                if len(context) > MAX_KNOWLEDGE_CHARS:
                    raise PipelineError("knowledge_limit")
                return KnowledgeResult(context=context, has_matches=bool(chunks))
        except TimeoutError as error:
            raise PipelineError("knowledge_timeout") from error
        except (McpError, httpx.HTTPError, ValueError, ExceptionGroup) as error:
            # The SDK's task groups can wrap transport and tool-validation failures.
            leaves = list(_leaves(error))
            for leaf in leaves:
                if isinstance(leaf, PipelineError):
                    raise leaf from error
            code = (
                "knowledge_timeout"
                if any(isinstance(leaf, httpx.TimeoutException) for leaf in leaves)
                else "knowledge_error"
            )
            raise PipelineError(code) from error

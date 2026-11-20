import logging
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import UUID

from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from openai import AsyncOpenAI
from pydantic import ValidationError

from agents.errors import PipelineError
from agents.limits import DEFAULT_MODEL, REQUEST_TIMEOUT_SECONDS
from agents.models import ErrorResponse, PipelineSettings, RunRequest
from agents.orchestrator import AgentPipeline

logger = logging.getLogger("agents.main")


def create_client(api_key: str) -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=api_key,
        base_url="https://api.openai.com/v1",
        timeout=REQUEST_TIMEOUT_SECONDS,
        max_retries=0,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    client = None
    app.state.pipeline = None
    app.state.configuration_error = None
    try:
        try:
            settings = PipelineSettings(model=os.environ.get("OPENAI_MODEL", DEFAULT_MODEL))
        except ValidationError:
            app.state.configuration_error = PipelineError("invalid_configuration")
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            app.state.configuration_error = PipelineError("missing_configuration")
        if app.state.configuration_error is None:
            client = create_client(api_key)
            app.state.pipeline = AgentPipeline(client, settings)
        else:
            logger.warning(
                '{"event":"agent_configuration_missing","code":"%s"}',
                app.state.configuration_error.code,
            )
        yield
    finally:
        if client is not None:
            await client.close()
        app.state.pipeline = None


app = FastAPI(title="Multi-Agent Container", lifespan=lifespan)


def failure_response(error: PipelineError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content=ErrorResponse(error=error.detail()).model_dump(mode="json"),
    )


@app.exception_handler(RequestValidationError)
async def validation_failure(request: Request, error: RequestValidationError) -> JSONResponse:
    oversized = any(
        detail["type"] in {"input_limit", "string_too_long", "too_long"}
        for detail in error.errors()
    )
    return failure_response(PipelineError("input_limit" if oversized else "invalid_input"))


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat", response_model=None)
async def chat(
    body: RunRequest,
    request: Request,
    x_session_id: Annotated[UUID, Header()],
) -> StreamingResponse | JSONResponse:
    pipeline: AgentPipeline | None = getattr(request.app.state, "pipeline", None)
    if pipeline is None:
        return failure_response(
            getattr(request.app.state, "configuration_error", None)
            or PipelineError("missing_configuration")
        )

    async def stream() -> AsyncGenerator[str, None]:
        async for event in pipeline.events(body, x_session_id):
            yield f"data: {event.model_dump_json()}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
    )

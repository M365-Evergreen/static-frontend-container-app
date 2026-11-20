<<<<<<< HEAD
import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# In-memory stateful store persisted while the container stays warm
session_memory: dict[str, list[dict[str, str]]] = defaultdict(list)
session_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
=======
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
>>>>>>> e84d3c3 (feat: implement session management with SQLite storage)


@asynccontextmanager
async def lifespan(app: FastAPI):
<<<<<<< HEAD
    yield
    session_memory.clear()
=======
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
>>>>>>> e84d3c3 (feat: implement session management with SQLite storage)


app = FastAPI(title="Multi-Agent Container", lifespan=lifespan)


<<<<<<< HEAD
class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    max_turns: int = Field(default=5, ge=1, le=10)
=======
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
>>>>>>> e84d3c3 (feat: implement session management with SQLite storage)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


<<<<<<< HEAD
async def run_multi_agent_pipeline(
    session_id: str, prompt: str, max_turns: int
) -> AsyncGenerator[str, None]:
    async with session_locks[session_id]:
        history = session_memory[session_id]
        history.append({"role": "user", "content": prompt})

        # Example multi-agent handoff sequence
        agents = ["planner_agent", "research_agent", "synthesizer_agent"]
        context = prompt

        for turn, agent_name in enumerate(agents[:max_turns], start=1):
            event = {
                "turn": turn,
                "agent": agent_name,
                "status": "running",
                "output": f"[{agent_name}] Processed step {turn} with {len(history)} prior messages.",
            }
            yield f"data: {json.dumps(event)}\n\n"
            await asyncio.sleep(0.2)
            context = event["output"]

        history.append({"role": "assistant", "content": context})
        yield f"data: {json.dumps({'status': 'done', 'final_output': context, 'history_length': len(history)})}\n\n"


@app.post("/api/chat")
async def chat(
    body: ChatRequest,
    x_session_id: str = Header(default="default-session"),
) -> StreamingResponse:
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    return StreamingResponse(
        run_multi_agent_pipeline(x_session_id, body.prompt, body.max_turns),
=======
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
>>>>>>> e84d3c3 (feat: implement session management with SQLite storage)
        media_type="text/event-stream",
    )

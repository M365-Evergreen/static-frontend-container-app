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


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    session_memory.clear()


app = FastAPI(title="Multi-Agent Container", lifespan=lifespan)


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    max_turns: int = Field(default=5, ge=1, le=10)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


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
        media_type="text/event-stream",
    )

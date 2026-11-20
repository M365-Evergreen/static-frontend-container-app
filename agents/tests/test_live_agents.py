import json
import os
from uuid import uuid4

import httpx
import pytest

BASE_URL = os.environ.get("SESSION_API_BASE_URL")
pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(
        not BASE_URL or os.environ.get("RUN_LIVE_MODELS") != "true",
        reason="Six paid model calls require SESSION_API_BASE_URL and RUN_LIVE_MODELS=true",
    ),
]


def frames(text: str) -> list[dict]:
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ")]


async def test_real_agents_and_followup_use_durable_history():
    session = str(uuid4())
    headers = {"x-session-id": session, "x-request-id": str(uuid4())}
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=150) as client:
        try:
            first = await client.post(
                "/api/chat",
                headers=headers,
                json={
                    "prompt": "Remember this fictional fact: Project Cobalt uses blue badges. Acknowledge it in one sentence.",
                    "max_turns": 3,
                },
            )
            assert first.status_code == 200
            initial = frames(first.text)
            assert [event.get("agent") for event in initial[:-1]] == [
                "planner_agent",
                "research_agent",
                "synthesizer_agent",
            ]
            assert initial[-1]["status"] == "done"
            assert initial[1]["output"].startswith("Model-only analysis")
            assert len((await client.get("/api/history", headers=headers)).json()["messages"]) == 2
            following = await client.post(
                "/api/chat",
                headers={**headers, "x-request-id": str(uuid4())},
                json={
                    "prompt": "From the fictional fact I gave you earlier, what color badges does Project Cobalt use? Answer briefly.",
                    "max_turns": 3,
                },
            )
            assert following.status_code == 200
            result = frames(following.text)
            assert len(result) == 4
            assert result[-1]["status"] == "done"
            assert "blue" in result[-1]["final_output"].lower()
            assert result[-1]["history_length"] == 4
        finally:
            assert (await client.delete("/api/history", headers=headers)).status_code == 204

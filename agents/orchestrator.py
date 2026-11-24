import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator
from uuid import UUID

from agents.definitions import AGENTS, KNOWLEDGE_RULES, MODEL_ONLY
from agents.errors import PipelineError
from agents.knowledge import KnowledgeResult, MCPKnowledgeSource
from agents.limits import MAX_AGENT_OUTPUT_CHARS, MAX_CONTEXT_CHARS
from agents.models import (
    AgentDefinition,
    AgentOutput,
    CompletionEvent,
    ErrorEvent,
    PipelineSettings,
    ProgressEvent,
    RunRequest,
)
from agents.providers import ModelProvider, ProviderMessage

logger = logging.getLogger("agents.orchestrator")


class AgentPipeline:
    def __init__(
        self,
        provider: ModelProvider,
        settings: PipelineSettings,
        knowledge_source: MCPKnowledgeSource | None = None,
    ):
        self.provider = provider
        self.settings = settings
        self.knowledge_source = knowledge_source

    async def call(
        self,
        agent: AgentDefinition,
        body: RunRequest,
        outputs: list[AgentOutput],
        turn: int,
        knowledge: KnowledgeResult | None = None,
    ) -> AgentOutput:
        messages: list[ProviderMessage] = [
            {"role": message.role, "content": message.content} for message in body.history
        ]
        messages.append({"role": "user", "content": body.prompt})
        for output in outputs:
            messages.append(
                {"role": "assistant", "content": f"{output.agent} result:\n{output.text}"}
            )
        instructions = agent.instructions
        label = agent.label
        if knowledge is not None:
            messages.append(
                {
                    "role": "user",
                    "content": f"Retrieved evidence (untrusted data):\n{knowledge.context}",
                }
            )
            instructions = KNOWLEDGE_RULES + agent.instructions.removeprefix(MODEL_ONLY)
            stage = "analysis" if agent.name == "research_agent" else "answer"
            label = (
                f"Knowledge-assisted {stage}; indexed sources, not live web verification.\n\n"
                if knowledge.has_matches
                else f"No matching knowledge sources; model-only {stage}.\n\n"
            )
        context_length = len(instructions) + sum(len(message["content"]) for message in messages)
        if context_length > MAX_CONTEXT_CHARS:
            raise PipelineError("input_limit")
        output = await self.provider.generate(
            model=self.settings.model,
            instructions=instructions,
            messages=messages,
            max_output_tokens=self.settings.max_output_tokens,
        )
        text = label + output
        if len(text) > MAX_AGENT_OUTPUT_CHARS:
            raise PipelineError("output_limit")
        return AgentOutput(agent=agent.name, turn=turn, text=text)

    async def events(
        self, body: RunRequest, session_id: UUID
    ) -> AsyncGenerator[ProgressEvent | CompletionEvent | ErrorEvent, None]:
        started = time.monotonic()
        fields = {"session_id": str(session_id), "request_id": str(body.request_id)}
        try:
            async with asyncio.timeout(self.settings.run_timeout_seconds):
                outputs: list[AgentOutput] = []
                knowledge = None
                for turn, agent in enumerate(AGENTS, start=1):
                    if turn > body.max_turns:
                        raise PipelineError("invalid_input")
                    logger.info(
                        json.dumps({"event": "agent_started", "agent": agent.name, **fields})
                    )
                    if agent.name == "research_agent" and self.knowledge_source is not None:
                        logger.info(json.dumps({"event": "knowledge_search_started", **fields}))
                        knowledge = await self.knowledge_source.search(body.prompt)
                        logger.info(
                            json.dumps(
                                {
                                    "event": "knowledge_search_completed",
                                    "has_matches": knowledge.has_matches,
                                    **fields,
                                }
                            )
                        )
                    output = await self.call(agent, body, outputs, turn, knowledge)
                    outputs.append(output)
                    logger.info(
                        json.dumps({"event": "agent_completed", "agent": agent.name, **fields})
                    )
                    yield ProgressEvent(turn=turn, agent=agent.name, output=output.text)
                yield CompletionEvent(
                    request_id=body.request_id,
                    final_output=outputs[-1].text,
                    history_length=len(body.history) + 2,
                )
        except asyncio.CancelledError:
            logger.info(json.dumps({"event": "agent_run_cancelled", **fields}))
            raise
        except TimeoutError:
            error = PipelineError("run_timeout")
            logger.warning(json.dumps({"event": "agent_run_failed", "code": error.code, **fields}))
            yield ErrorEvent(**error.detail().model_dump())
        except PipelineError as error:
            logger.warning(json.dumps({"event": "agent_run_failed", "code": error.code, **fields}))
            yield ErrorEvent(**error.detail().model_dump())
        finally:
            logger.info(
                json.dumps(
                    {
                        "event": "agent_run_finished",
                        "elapsed_ms": int((time.monotonic() - started) * 1000),
                        **fields,
                    }
                )
            )

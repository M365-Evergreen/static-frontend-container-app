import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator
from uuid import UUID

from openai import (
    APIConnectionError,
    APIError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    RateLimitError,
)
from openai.types.responses import EasyInputMessageParam

from agents.definitions import AGENTS
from agents.errors import PipelineError
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

logger = logging.getLogger("agents.orchestrator")


class AgentPipeline:
    def __init__(self, client: AsyncOpenAI, settings: PipelineSettings):
        self.client = client
        self.settings = settings

    async def call(
        self, agent: AgentDefinition, body: RunRequest, outputs: list[AgentOutput], turn: int
    ) -> AgentOutput:
        messages: list[EasyInputMessageParam] = [
            {"role": message.role, "content": message.content} for message in body.history
        ]
        messages.append({"role": "user", "content": body.prompt})
        for output in outputs:
            messages.append(
                {"role": "assistant", "content": f"{output.agent} result:\n{output.text}"}
            )
        context_length = len(agent.instructions) + sum(
            len(message["content"]) for message in messages
        )
        if context_length > MAX_CONTEXT_CHARS:
            raise PipelineError("input_limit")
        try:
            response = await self.client.responses.create(
                model=self.settings.model,
                instructions=agent.instructions,
                input=messages,
                max_output_tokens=self.settings.max_output_tokens,
                store=False,
                tools=[],
            )
        except AuthenticationError as error:
            raise PipelineError("provider_authentication") from error
        except RateLimitError as error:
            raise PipelineError("provider_rate_limit") from error
        except APITimeoutError as error:
            raise PipelineError("provider_timeout") from error
        except APIConnectionError as error:
            raise PipelineError("provider_unavailable") from error
        except APIStatusError as error:
            raise PipelineError("provider_error") from error
        except APIError as error:
            raise PipelineError("invalid_response") from error

        try:
            if (
                response.status == "incomplete"
                and response.incomplete_details
                and response.incomplete_details.reason == "max_output_tokens"
            ):
                raise PipelineError("output_limit")
            if response.status != "completed":
                raise PipelineError("invalid_response")
            if any(
                item.type == "message" and any(part.type == "refusal" for part in item.content)
                for item in response.output
            ):
                raise PipelineError("provider_refusal")
            if not response.output_text.strip():
                raise PipelineError("invalid_response")
            text = agent.label + response.output_text.strip()
            if len(text) > MAX_AGENT_OUTPUT_CHARS:
                raise PipelineError("output_limit")
            return AgentOutput(agent=agent.name, turn=turn, text=text)
        except (AttributeError, TypeError, ValueError) as error:
            raise PipelineError("invalid_response") from error

    async def events(
        self, body: RunRequest, session_id: UUID
    ) -> AsyncGenerator[ProgressEvent | CompletionEvent | ErrorEvent, None]:
        started = time.monotonic()
        fields = {"session_id": str(session_id), "request_id": str(body.request_id)}
        try:
            async with asyncio.timeout(self.settings.run_timeout_seconds):
                outputs: list[AgentOutput] = []
                for turn, agent in enumerate(AGENTS, start=1):
                    if turn > body.max_turns:
                        raise PipelineError("invalid_input")
                    logger.info(
                        json.dumps({"event": "agent_started", "agent": agent.name, **fields})
                    )
                    output = await self.call(agent, body, outputs, turn)
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

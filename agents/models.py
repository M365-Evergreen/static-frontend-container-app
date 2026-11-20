from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_core import PydanticCustomError

from agents.limits import (
    MAX_AGENT_OUTPUT_CHARS,
    MAX_HISTORY_CHARS,
    MAX_HISTORY_MESSAGES,
    MAX_OUTPUT_TOKENS,
    MAX_PROMPT_CHARS,
    PIPELINE_CALLS,
    RUN_TIMEOUT_SECONDS,
)

AgentName = Literal["planner_agent", "research_agent", "synthesizer_agent"]
ErrorCode = Literal[
    "missing_configuration",
    "invalid_configuration",
    "invalid_input",
    "input_limit",
    "provider_authentication",
    "provider_rate_limit",
    "provider_timeout",
    "provider_unavailable",
    "provider_error",
    "provider_refusal",
    "invalid_response",
    "output_limit",
    "run_timeout",
    "agent_failed",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ChatRequest(StrictModel):
    prompt: str = Field(min_length=1, max_length=MAX_PROMPT_CHARS, strict=True)
    max_turns: int = Field(default=5, ge=PIPELINE_CALLS, le=10, strict=True)

    @field_validator("prompt")
    @classmethod
    def nonblank_prompt(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Prompt cannot be blank")
        return value


class HistoryMessage(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_AGENT_OUTPUT_CHARS, strict=True)


class RunRequest(ChatRequest):
    request_id: UUID
    history: list[HistoryMessage] = Field(max_length=MAX_HISTORY_MESSAGES)

    @model_validator(mode="after")
    def completed_history(self) -> "RunRequest":
        if len(self.history) % 2 or any(
            message.role != ("user" if index % 2 == 0 else "assistant")
            for index, message in enumerate(self.history)
        ):
            raise ValueError("History must contain ordered completed exchanges")
        if sum(len(message.content) for message in self.history) > MAX_HISTORY_CHARS:
            raise PydanticCustomError("input_limit", "Conversation history exceeds its size limit")
        return self


class PipelineSettings(StrictModel):
    provider: Literal["gemini", "nvidia"]
    model: str = Field(min_length=1, max_length=128)
    max_output_tokens: int = Field(default=MAX_OUTPUT_TOKENS, ge=1, le=MAX_OUTPUT_TOKENS)
    run_timeout_seconds: float = Field(default=RUN_TIMEOUT_SECONDS, gt=0, le=RUN_TIMEOUT_SECONDS)

    @field_validator("model")
    @classmethod
    def model_name(cls, value: str) -> str:
        if value != value.strip() or not value:
            raise ValueError("Model name must be nonblank without surrounding whitespace")
        return value


class AgentDefinition(StrictModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: AgentName
    instructions: str
    label: str = ""


class AgentOutput(StrictModel):
    agent: AgentName
    turn: int = Field(ge=1, le=PIPELINE_CALLS)
    text: str = Field(min_length=1, max_length=MAX_AGENT_OUTPUT_CHARS)


class ProgressEvent(StrictModel):
    status: Literal["running"] = "running"
    turn: int = Field(ge=1, le=PIPELINE_CALLS)
    agent: AgentName
    output: str = Field(min_length=1, max_length=MAX_AGENT_OUTPUT_CHARS)


class CompletionEvent(StrictModel):
    status: Literal["done"] = "done"
    request_id: UUID
    final_output: str = Field(min_length=1, max_length=MAX_AGENT_OUTPUT_CHARS)
    history_length: int = Field(ge=2)


class ErrorDetail(StrictModel):
    code: ErrorCode
    message: str


class ErrorEvent(ErrorDetail):
    status: Literal["error"] = "error"


class ErrorResponse(StrictModel):
    error: ErrorDetail

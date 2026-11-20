from typing import Literal, Protocol, TypedDict

import httpx
from google import genai
from google.genai import errors as gemini_errors
from google.genai import types
from pydantic import BaseModel, Field, ValidationError

from agents.errors import PipelineError
from agents.limits import REQUEST_TIMEOUT_SECONDS


class ProviderMessage(TypedDict):
    role: Literal["user", "assistant"]
    content: str


class ModelProvider(Protocol):
    async def generate(
        self,
        *,
        model: str,
        instructions: str,
        messages: list[ProviderMessage],
        max_output_tokens: int,
    ) -> str: ...

    async def close(self) -> None: ...


def status_error(status: int) -> PipelineError:
    if status in (401, 403):
        return PipelineError("provider_authentication")
    if status == 429:
        return PipelineError("provider_rate_limit")
    if status in (408, 504):
        return PipelineError("provider_timeout")
    if status == 503:
        return PipelineError("provider_unavailable")
    return PipelineError("provider_error")


class GeminiProvider:
    def __init__(self, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None):
        self.http_client = httpx.AsyncClient(transport=transport, timeout=REQUEST_TIMEOUT_SECONDS)
        self.client = genai.Client(
            api_key=api_key,
            vertexai=False,
            http_options=types.HttpOptions(
                timeout=REQUEST_TIMEOUT_SECONDS * 1000,
                retry_options=types.HttpRetryOptions(attempts=1),
                httpx_async_client=self.http_client,
            ),
        )

    async def generate(
        self,
        *,
        model: str,
        instructions: str,
        messages: list[ProviderMessage],
        max_output_tokens: int,
    ) -> str:
        contents = [
            types.Content(
                role="user" if message["role"] == "user" else "model",
                parts=[types.Part(text=message["content"])],
            )
            for message in messages
        ]
        try:
            response = await self.client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=instructions,
                    max_output_tokens=max_output_tokens,
                    tools=[],
                    store=False,
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                    automatic_continuation=False,
                ),
            )
        except gemini_errors.APIError as error:
            raise status_error(error.code) from error
        except httpx.TimeoutException as error:
            raise PipelineError("provider_timeout") from error
        except httpx.RequestError as error:
            raise PipelineError("provider_unavailable") from error
        except (ValidationError, ValueError, TypeError) as error:
            raise PipelineError("invalid_response") from error

        if (
            response.prompt_feedback
            and response.prompt_feedback.block_reason
            and response.prompt_feedback.block_reason
            != types.BlockedReason.BLOCKED_REASON_UNSPECIFIED
        ):
            raise PipelineError("provider_refusal")
        if not response.candidates or len(response.candidates) != 1:
            raise PipelineError("invalid_response")
        candidate = response.candidates[0]
        if candidate.finish_reason == types.FinishReason.MAX_TOKENS:
            raise PipelineError("output_limit")
        if candidate.finish_reason in {
            types.FinishReason.SAFETY,
            types.FinishReason.RECITATION,
            types.FinishReason.BLOCKLIST,
            types.FinishReason.PROHIBITED_CONTENT,
            types.FinishReason.SPII,
        }:
            raise PipelineError("provider_refusal")
        if candidate.finish_reason != types.FinishReason.STOP or not candidate.content:
            raise PipelineError("invalid_response")
        parts = candidate.content.parts or []
        if any(
            part.function_call or part.executable_code or part.code_execution_result
            for part in parts
        ):
            raise PipelineError("invalid_response")
        text = "".join(part.text for part in parts if part.text and not part.thought).strip()
        if not text:
            raise PipelineError("invalid_response")
        return text

    async def close(self) -> None:
        try:
            await self.client.aio.aclose()
            self.client.close()
        finally:
            await self.http_client.aclose()


class NvidiaMessage(BaseModel):
    role: Literal["assistant"]
    content: str | None = None
    refusal: str | None = None
    tool_calls: list[dict[str, object]] | None = None


class NvidiaChoice(BaseModel):
    finish_reason: str
    message: NvidiaMessage


class NvidiaResponse(BaseModel):
    choices: list[NvidiaChoice] = Field(min_length=1, max_length=1)


class NvidiaProvider:
    def __init__(self, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None):
        self.http_client = httpx.AsyncClient(
            base_url="https://integrate.api.nvidia.com/v1/",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=REQUEST_TIMEOUT_SECONDS,
            transport=transport,
        )

    async def generate(
        self,
        *,
        model: str,
        instructions: str,
        messages: list[ProviderMessage],
        max_output_tokens: int,
    ) -> str:
        try:
            response = await self.http_client.post(
                "chat/completions",
                json={
                    "model": model,
                    "messages": [{"role": "system", "content": instructions}, *messages],
                    "max_tokens": max_output_tokens,
                    "stream": False,
                },
            )
            if not response.is_success:
                raise status_error(response.status_code)
            completion = NvidiaResponse.model_validate(response.json())
        except httpx.TimeoutException as error:
            raise PipelineError("provider_timeout") from error
        except httpx.RequestError as error:
            raise PipelineError("provider_unavailable") from error
        except (ValidationError, ValueError, TypeError) as error:
            raise PipelineError("invalid_response") from error

        choice = completion.choices[0]
        if choice.finish_reason == "length":
            raise PipelineError("output_limit")
        if choice.message.refusal or choice.finish_reason == "content_filter":
            raise PipelineError("provider_refusal")
        if choice.finish_reason != "stop" or choice.message.tool_calls:
            raise PipelineError("invalid_response")
        text = (choice.message.content or "").strip()
        if not text:
            raise PipelineError("invalid_response")
        return text

    async def close(self) -> None:
        await self.http_client.aclose()


def create_provider(provider: Literal["gemini", "nvidia"], api_key: str) -> ModelProvider:
    if provider == "gemini":
        return GeminiProvider(api_key)
    if provider == "nvidia":
        return NvidiaProvider(api_key)
    raise PipelineError("invalid_configuration")

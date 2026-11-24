from agents.models import ErrorCode, ErrorDetail

ERRORS: dict[ErrorCode, tuple[int, str]] = {
    "missing_configuration": (503, "LLM_API_KEY is not configured."),
    "invalid_configuration": (
        503,
        (
            "Set LLM_PROVIDER to gemini or nvidia, LLM_MODEL to a nonblank model name, "
            "and any KNOWLEDGE_MCP_URL to an HTTPS URL without credentials or a fragment."
        ),
    ),
    "invalid_input": (422, "The run payload is invalid."),
    "input_limit": (413, "The prompt or conversation exceeds its size limit."),
    "provider_authentication": (502, "Model provider authentication failed."),
    "provider_rate_limit": (429, "The model provider's rate or quota limit was reached."),
    "provider_timeout": (504, "A model provider request timed out."),
    "provider_unavailable": (503, "The model provider could not be reached."),
    "provider_error": (502, "The model provider rejected or failed the request."),
    "provider_refusal": (502, "The model provider declined to produce an answer."),
    "invalid_response": (502, "The model provider returned no complete usable text."),
    "output_limit": (502, "An agent exceeded its output limit."),
    "run_timeout": (504, "The agent pipeline exceeded its deadline."),
    "agent_failed": (502, "The agent pipeline failed."),
    "knowledge_error": (502, "The knowledge source failed to return usable search results."),
    "knowledge_timeout": (504, "The knowledge source search timed out."),
    "knowledge_limit": (502, "The knowledge source exceeded its retrieval size limit."),
}


class PipelineError(Exception):
    def __init__(self, code: ErrorCode):
        self.code = code
        self.status, message = ERRORS[code]
        super().__init__(message)

    def detail(self) -> ErrorDetail:
        return ErrorDetail(code=self.code, message=str(self))

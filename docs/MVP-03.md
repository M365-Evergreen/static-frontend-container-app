# Phase three tasks

- [x] Extract the orchestrator and specialized agent definitions from `agents/main.py`.
- [x] Use asynchronous Gemini and NVIDIA-hosted model adapters with explicit provider/model selection.
- [x] Run planner, analyst/researcher, and synthesizer sequentially, supplying prior conversation context and preceding agent results.
- [x] Clearly distinguish indexed knowledge-assisted research from model-only analysis, without claiming live web verification or inventing citations.
- [x] Define inputs, outputs, and internal run payloads with Pydantic v2 models.
- [x] Add explicit input-size, output-token, execution-time, and agent-call limits.
- [x] Treat `max_turns` as a hard agent-call ceiling. Reject values too small to complete the three-agent pipeline rather than returning partial work as success.
- [x] Surface missing configuration and provider failures explicitly.
- [x] Pass only the selected provider's `LLM_API_KEY` secret from the Worker environment into the container; never put secret values in source, images, or logs.

## Completion criterion

Prompts produce genuine intermediate outputs and a synthesized answer; follow-up prompts use earlier completed turns.

## Implementation

- Extracted agent definitions, typed Pydantic models, limits, sanitized errors, and
  the async orchestrator into dedicated modules. FastAPI owns the selected provider client's
  lifespan and closes it on shutdown.
- Use the installed Google Gen AI SDK's async GenerateContent API for Gemini and
  async HTTP chat completions for NVIDIA-hosted models. Gemini uses `store=False`;
  neither adapter enables tools, provider-managed conversation chains, automatic
  continuation, or retries.
- Pass stored completed conversation context to every stage, adding all preceding
  stage results. Preserve `planner_agent`, `research_agent`, and `synthesizer_agent`
  SSE names; explicitly label knowledge-assisted versus model-only analysis and synthesis.
- When `KNOWLEDGE_MCP_URL` is configured, search the Cloudflare AI Search MCP once
  before research using only the latest prompt. Pass bounded, untrusted retrieved
  evidence and source metadata to research and synthesis without extra model calls.
  Empty searches are explicit; failed retrieval never becomes partial success.
- Require explicit `LLM_PROVIDER` (`gemini` or `nvidia`) and `LLM_MODEL`. There is
  no preferred provider, default model, or automatic substitution. The Worker
  forwards those non-secret variables and the selected provider's `LLM_API_KEY`.
- Bound prompt, JSON body, history, per-call text context, output tokens/text,
  individual request duration, total pipeline duration, and agent calls. See
  [the exact limits](../README.md#model-providers-and-execution-limits).
- Require `max_turns >= 3` and make exactly three calls. Reject partial pipeline
  completions at the Worker boundary; only all three successful results can be
  committed to durable history.
- Missing/invalid configuration returns HTTP 503 before streaming. Provider and
  timeout failures produce explicit sanitized terminal SSE errors. Truncated,
  refused, empty, and token-limited responses never become completed history.
- Add mocked-provider regressions and a separately gated six-call live acceptance
  test. The broader paid session stress tests require their own explicit opt-in.

## References

- [Google Gen AI Python SDK](https://github.com/googleapis/python-genai)
- [Gemini GenerateContent and Interactions support](https://aistudio.google.com/docs/whats-new-gemini-4-hydrogen)
- [NVIDIA model API](https://docs.api.nvidia.com/)
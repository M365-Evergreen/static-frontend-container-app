# Phase three tasks

- [x] Extract the orchestrator and specialized agent definitions from `agents/main.py`.
- [x] Use an asynchronous OpenAI client with a configurable model.
- [x] Run planner, analyst/researcher, and synthesizer sequentially, supplying prior conversation context and preceding agent results.
- [x] Clearly label research as model-only analysis without current-source verification or invented citations.
- [x] Define inputs, outputs, and internal run payloads with Pydantic v2 models.
- [x] Add explicit input-size, output-token, execution-time, and agent-call limits.
- [x] Treat `max_turns` as a hard agent-call ceiling. Reject values too small to complete the three-agent pipeline rather than returning partial work as success.
- [x] Surface missing configuration and provider failures explicitly.
- [x] Pass only the required `OPENAI_API_KEY` secret from the Worker environment into the container; never put secret values in source, images, or logs.

## Completion criterion

Prompts produce genuine intermediate outputs and a synthesized answer; follow-up prompts use earlier completed turns.

## Implementation

- Extracted agent definitions, typed Pydantic models, limits, sanitized errors, and
  the async orchestrator into dedicated modules. FastAPI owns the OpenAI client's
  lifespan and closes it on shutdown.
- Use the pinned OpenAI SDK's async Responses API with `store=False`, no tools,
  no provider-managed conversation chain, and no automatic SDK retries.
- Pass stored completed conversation context to every stage, adding all preceding
  stage results. Preserve `planner_agent`, `research_agent`, and `synthesizer_agent`
  SSE names; explicitly label model-only analysis and synthesis.
- Retain the selected configurable default `gpt-4.1-mini`. OpenAI currently marks
  it deprecated while listing Responses API support. No model upgrade or silent
  substitution was made. `OPENAI_MODEL` is a non-secret Worker variable forwarded
  to the container; `OPENAI_API_KEY` remains the only forwarded secret.
- Bound prompt, JSON body, history, per-call text context, output tokens/text,
  individual request duration, total pipeline duration, and agent calls. See
  [the exact limits](../README.md#openai-model-and-execution-limits).
- Require `max_turns >= 3` and make exactly three calls. Reject partial pipeline
  completions at the Worker boundary; only all three successful results can be
  committed to durable history.
- Missing/invalid configuration returns HTTP 503 before streaming. Provider and
  timeout failures produce explicit sanitized terminal SSE errors. Truncated,
  refused, empty, and token-limited responses never become completed history.
- Add mocked-provider regressions and a separately gated six-call live acceptance
  test. The broader paid session stress tests require their own explicit opt-in.

## References

- [OpenAI Python async client and Responses API](https://github.com/openai/openai-python)
- [Selected model status and Responses support](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
# Phase three tasks

- [ ] Extract the orchestrator and specialized agent definitions from  `agents\main.py`.
- [ ] Use an asynchronous OpenAI client with a configurable model.
- [ ] Run planner, analyst/researcher, and synthesizer sequentially, supplying prior  conversation context and preceding agent results.
- [ ] Clearly label research as model-only analysis without current-source  verification or invented citations.
- [ ] Define inputs, outputs, and internal run payloads with Pydantic v2 models.
- [ ] Add explicit input-size, output-token, execution-time, and agent-call limits.
- [ ] Treat `max_turns` as a hard agent-call ceiling. Reject values too small to  complete the three-agent pipeline rather than returning partial work as success.
- [ ] Surface missing configuration and provider failures explicitly.
- [ ] Pass only the required OpenAI secret from the Worker environment into the  container; never put secret values in source, images, or logs.

## Completion criterion

Prompts produce genuine intermediate outputs and a synthesized answer; follow-up prompts use earlier completed turns.
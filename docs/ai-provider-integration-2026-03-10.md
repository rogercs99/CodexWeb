# AI Provider Integration (2026-03-10)

## Implemented providers

1. `codex-cli`
2. `gemini-cli`
3. `openrouter`
4. `ollama`

## Common architecture

- Single provider registry in backend (`aiProviderDefinitions`) with:
  - metadata (`id`, `name`, `vendor`, `docsUrl`, pricing)
  - auth mode(s)
  - capabilities catalog
  - default model
  - runtime identifier (`runtimeProvider`)
- Unified provider responses for:
  - models
  - quota
  - capabilities
  - permissions
  - availability/configuration state
- Shared permission enforcement path:
  - `assertAiPermissionForAction(...)`
  - checks tool scope, shell, git, backup/restore, read-only, path, and network
- Shared runtime selection:
  - active provider resolved from configured+enabled integrations
  - fallback to first selectable runtime provider

## New runtime support added

### OpenRouter

- Auth: API key (`Authorization: Bearer ...`)
- Models: remote fetch supported via `/api/v1/models`
- Quota: unified usage from `/api/v1/credits`
- Chat: streaming via `/api/v1/chat/completions` (`stream: true`)
- Reasoning: parsed from delta fields (`reasoning`, `reasoning_content`, `thinking`, `analysis`) when present

### Ollama

- Auth: none (local endpoint)
- Base URL default: `http://127.0.0.1:11434`
- Models: remote fetch via `/api/tags`
- Quota: not available (`available=false`)
- Chat: streaming via `/api/chat`
- Reasoning: parsed from `message.thinking` / `reasoning` fields when present

## Candidate researched (not implemented in this change)

### Groq API

- Reason for not implementing in this patch:
  - would require additional provider-specific quota/limits normalization and UI behavior validation with real account limits in this environment
  - current change focused on completing two full, tested integrations (`openrouter`, `ollama`) plus refactor consolidation
- Integration path is straightforward because Groq is OpenAI-compatible (`base_url=https://api.groq.com/openai/v1`).

## Official sources used

- OpenRouter authentication:
  - https://openrouter.ai/docs/api-reference/authentication
- OpenRouter models:
  - https://openrouter.ai/docs/api-reference/models/get-models
- OpenRouter credits:
  - https://openrouter.ai/docs/api/api-reference/credits/get-credits
- OpenRouter streaming:
  - https://openrouter.ai/docs/api/reference/streaming
- Ollama API overview:
  - https://docs.ollama.com/api
- Ollama chat endpoint:
  - https://docs.ollama.com/api/chat
- Ollama list models:
  - https://docs.ollama.com/api/tags
- Gemini CLI official repo:
  - https://github.com/google-gemini/gemini-cli
- Codex CLI official repo:
  - https://github.com/openai/codex
- Groq OpenAI compatibility:
  - https://console.groq.com/docs/openai
- Groq API reference:
  - https://console.groq.com/docs/api-reference

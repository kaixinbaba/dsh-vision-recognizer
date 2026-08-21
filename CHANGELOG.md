# Changelog

## 0.2.0 — 2026-08-21

- Add capability-aware image routing: models that declare native image input receive original image blocks directly, while text-only or unknown-capability models use the configured vision transcription fallback.
- Delegate through the public rc8 LLM runtime APIs with target-provider rebinding, preserving wrapper metadata and route-sensitive provider configuration.
- Probe local Ollama lazily only when transcription is required; native multimodal calls no longer depend on vision configuration.
- Add integration coverage for both native pass-through and text-only transcription paths.

## 0.1.3 — 2026-08-18

- Migrate the plugin to the canonical DSH plugin standard, including contract checks, lifecycle integration coverage, artifact verification, isolated install smoke testing, and Node 22/24 CI.

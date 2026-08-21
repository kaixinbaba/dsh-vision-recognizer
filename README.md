# dsh-vision-recognizer

English | [简体中文](README.zh-CN.md)

**Keep DeepSeek as the conversation brain, attach images anyway, and switch the image-recognition provider any time from Settings → Plugins.** A vision plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

It registers an adaptive provider route (default `vision-recognizer`, shown as **DeepSeek + 智能识图** in the model picker) that wraps the configured conversation provider. The wrapper always admits image attachments, then resolves the exact selected model: models declaring native image input receive the original image blocks directly; text-only or unknown-capability models receive text transcribed by the vision model you configure. DeepSeek remains the default wrapped conversation provider.

```
attached image ──▶ vision-recognizer route ──▶ selected model supports image? ── yes ─▶ native image request
                                                      │
                                                      no
                                                      ▼
                                  configured vision transcription ──▶ text-only selected model
```

## Features

- **Adaptive routing**: native multimodal models receive images unchanged; only text-only or unknown-capability models invoke the configured transcription fallback.
- **One-click install**: `dsh plugin --profile web add dsh-vision-recognizer` — no build scripts, no `sharp` approval (no native dependencies at all).
- **Configure from Settings → Plugins → Vision**: pick a provider, enter an API key, override model / endpoint / token cap / timeout / marker. Saved changes take effect immediately, no restart.
- **15+ providers, domestic and international**: OpenAI, Anthropic Claude, Google Gemini, OpenRouter, Azure OpenAI, Ollama (local), plus Alibaba DashScope, QwenCloud (Intl), Zhipu GLM, Baidu Qianfan, iFlytek Spark, Moonshot Kimi, Tencent Hunyuan, Volcengine Doubao, SiliconFlow. Any OpenAI-compatible endpoint works via the custom provider.
- **Two wire protocols**: OpenAI-compatible (`/chat/completions`) and native Anthropic Messages — Claude works out of the box.
- **No hangs**: local/anonymous endpoints get a hard 20s timeout cap, HTTP 429 fails fast, failed endpoints cool down for 60s; without a key and without local Ollama it fails fast with actionable guidance.
- **Fallback chain**: after the primary model fails, each `fallbackModels` entry is tried in order (each may target a different vendor); only after all fail does the request fail, listing every attempt.
- **Content-hash cache**: the same image is transcribed at most once per process (in-process, capped at 200).
- **Zero-config local path**: `autoLocalOllama` (default on) probes `http://localhost:11434` and prepends a running Ollama to the chain — images never leave your machine.

## Quick start

```sh
dsh plugin --profile web add dsh-vision-recognizer
```

> Slow npm registry? `dsh plugin --profile web add dsh-vision-recognizer --registry=https://registry.npmmirror.com`

**Install from a local checkout (development)**:

```sh
dsh plugin --profile web add file:/path/to/dsh-vision-recognizer
```

> Use the `file:` prefix (copies the package into `node_modules`). A bare `add .` or `add link:…` makes pnpm symlink the package, in which case the plugin's `schemastery` dependency resolves from the source checkout and is not found — a general pnpm symlink-install gotcha, not a bug in the plugin.

Restart `dsh web`, then:

1. Pick **DeepSeek + 智能识图** in the model selector;
2. Open **Settings → Plugins → Vision**, choose the fallback vision provider, enter an API key, save;
3. Paste an image into a conversation. A native multimodal selected model receives it directly; a text-only selected model receives the `[图片转译]` result.

With a native multimodal selected model, no fallback key is required. With a text-only model and no key or local Ollama, the turn fails fast with guidance instead of hanging.

> **Scope:** adaptive fallback applies while the **DeepSeek + 智能识图** wrapper route is selected. Selecting another provider route calls that route directly. rc8 does not expose a public decorator hook that can add fallback behavior to every existing provider route.

## Supported providers

| Provider | baseURL | Default model | Key env var | Protocol |
|---|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | `OPENAI_API_KEY` | OpenAI |
| Anthropic Claude | `https://api.anthropic.com/v1` | `claude-3-5-sonnet-latest` | `ANTHROPIC_API_KEY` | Anthropic |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` | `GEMINI_API_KEY` | OpenAI |
| OpenRouter | `https://openrouter.ai/api/v1` | `qwen/qwen-2.5-vl-72b-instruct` | `OPENROUTER_API_KEY` | OpenAI |
| Azure OpenAI | user-supplied (`…/openai/deployments/<deployment>`) | `gpt-4o-mini` | `AZURE_OPENAI_API_KEY` | OpenAI |
| Ollama (local) | `http://localhost:11434/v1` | auto-detected | none | OpenAI |
| Alibaba DashScope | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` | `DASHSCOPE_API_KEY` | OpenAI |
| QwenCloud (Intl) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen-vl-plus` | `DASHSCOPE_API_KEY` | OpenAI |
| Zhipu GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4v-flash` | `ZHIPU_API_KEY` | OpenAI |
| Baidu Qianfan | `https://qianfan.baidubce.com/v2` | `ernie-4.5-vl-8k` | `QIANFAN_API_KEY` | OpenAI |
| iFlytek Spark | `https://spark-api-open.xf-yun.com/v1` | `generalv3.5` | `SPARK_API_KEY` | OpenAI |
| Moonshot Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k-vision-preview` | `MOONSHOT_API_KEY` | OpenAI |
| Tencent Hunyuan | `https://api.hunyuan.cloud.tencent.com/v1` | `hunyuan-vision` | `HUNYUAN_API_KEY` | OpenAI |
| Volcengine Doubao | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-1.5-vision-pro-32k-250115` | `ARK_API_KEY` | OpenAI |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-VL-72B-Instruct` | `SILICONFLOW_API_KEY` | OpenAI |

> Model ids drift over time; the defaults are starting points — override `Model` in the settings UI. Key resolution order: key entered in the UI → the provider env var → `$VISION_API_KEY` / `$DASHSCOPE_API_KEY`.

## Configuration storage

Config saved from the UI is written to `$DSH_HOME/vision-recognizer.json` and merged over the bundle defaults at startup. `cordis.patch.yml` only carries factory defaults; a user `cordis.patch.yml` override still works as the composition-time fallback.

> ⚠️ **patch semantics**: the bundle's `- insert:` appends this row to the entry list. Writing a second `- insert:` with the same id in your own `cordis.patch.yml` would register the adapter twice (undefined behavior). To override individual keys, write a single top-level `- id: dsh-vision-recognizer` entry; better yet, use the Settings UI.

## Implementation notes (for plugin authors)

The adaptive wrapper uses rc8 public interfaces only:

- `ctx.llm.listModels(innerProvider)` and `resolveModelInfo(innerProvider, model)` inspect the exact target model and rebind its metadata to the wrapper route;
- `ctx.llm.prepareCall(...)` delegates to the configured target provider without depending on private adapter registrations;
- proxy `resolveModel` advertises `['text', 'image']` so the wrapper admits images, while proxy `stream` uses the target's original modality declaration to choose native pass-through or transcription;
- transcription clones request messages and replaces image blocks only in the delegated request; durable session history keeps the original image references;
- the settings UI rides the `settings.plugins.tab` slot plus custom `webServer` routes, persisting config to its own JSON file.

### rc8 limitations

Capability lookup and prepared target dispatch are separate public operations in rc8. A target adapter replaced by HMR in that tiny interval can race the routing decision. Nested target delegation also enters the `llm/stream` waterfall a second time, and DSH may strip provider-private replay metadata when wrapper and target adapters differ. Ordinary text/image history is preserved; provider-specific replay signatures may lose their optimization or fidelity until DSH exposes an atomic delegation handle.

## Privacy

Native multimodal routing sends image bytes to the selected conversation provider. The text-only fallback instead sends them (base64, normally HTTPS) to the vision endpoint you configure. In either mode, image data leaves your machine unless that endpoint is local. Nothing beyond the harness's own attachment storage persists an image.

## License

MIT

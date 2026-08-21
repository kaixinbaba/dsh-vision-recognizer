/**
 * dsh-vision-recognizer: adaptive image routing for a wrapped conversation
 * model, with a multi-provider vision transcription fallback.
 *
 * Registers a NEW provider route (`vision-recognizer` by default) that wraps
 * the configured target provider:
 *   - `resolveModel` declares image input so attachment preflight admits images;
 *   - `stream` resolves the exact target model's declared modalities;
 *   - native multimodal targets receive original image blocks unchanged;
 *   - text-only or unknown-capability targets receive text produced by the
 *     configured vision model (15+ providers, OpenAI-compatible or Anthropic).
 *
 * Configuration lives in Settings → Plugins → 识图 and is persisted to
 * $DSH_HOME/vision-recognizer.json. The composition entry config (from this
 * bundle's cordis.patch.yml and any user cordis.patch.yml override) is the
 * fallback when no persisted file exists. The transcription logic itself lives
 * in `./core.js` so it stays unit-testable without Host services.
 *
 * @module dsh-vision-recognizer
 */
import z from 'schemastery';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as core from './core.js';
import { providerCatalog } from './providers.js';

export const name = 'dsh-vision-recognizer';
export const inject = ['llm', 'attachments'];

/** Default proxy route id exposed to the model picker. */
const DEFAULT_PROVIDER = 'vision-recognizer';
/** Default target route wrapped by the adaptive provider. */
const DEFAULT_INNER_PROVIDER = 'deepseek-official';
/** Local Ollama endpoint probed when autoLocalOllama is enabled. */
const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
/** Probe timeout for the local Ollama health check. */
const OLLAMA_PROBE_TIMEOUT_MS = 1_500;
/** Default VLM output cap. */
const DEFAULT_MAX_TOKENS = 4096;
/** Default request timeout. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Composition-time configuration schema (used to normalize bundle config). */
export const Config = z.object({
    providerId: z.string().default(DEFAULT_PROVIDER)
        .description('Provider route id this proxy registers; appears in the model picker'),
    innerProvider: z.string().default(DEFAULT_INNER_PROVIDER)
        .description('Existing provider route whose adapter this proxy wraps'),
    provider: z.string().default('dashscope')
        .description('Active provider preset id (see Settings → Plugins)'),
    apiKey: z.string().role('secret').default('')
        .description('Vision API key; falls back to the provider env var, then $VISION_API_KEY / $DASHSCOPE_API_KEY'),
    model: z.string().default('')
        .description('Vision model id; empty uses the provider preset default'),
    baseURL: z.string().default('')
        .description('Endpoint override; empty uses the provider preset default'),
    maxTokens: z.number().step(1).min(1).max(32_768).default(DEFAULT_MAX_TOKENS)
        .description('Vision model output cap'),
    timeoutMs: z.number().step(1).min(1_000).max(300_000).default(DEFAULT_TIMEOUT_MS)
        .description('Vision request timeout (local/anonymous endpoints are capped at 20s)'),
    marker: z.string().default('[图片转译]')
        .description('Text marker prepended to each transcription'),
    autoLocalOllama: z.boolean().default(true)
        .description('Probe http://localhost:11434 and prepend a running Ollama to the fallback chain'),
    fallbackModels: z.array(z.object({
        provider: z.string().default('custom'),
        model: z.string().default(''),
        baseURL: z.string().default(''),
        apiKey: z.string().role('secret').default(''),
    })).default([])
        .description('Ordered fallback vision models tried when the primary fails'),
});

/** Absolute path of the persisted user configuration file. */
function configFilePath() {
    const root = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    return join(root, 'vision-recognizer.json');
}

/**
 * Merge the persisted user configuration over the composition entry config.
 * @param entry - composition-time config (bundle defaults + user cordis.patch.yml).
 * @returns the resolved config.
 */
function loadResolvedConfig(entry) {
    const resolved = { ...entry };
    try {
        const path = configFilePath();
        if (existsSync(path)) {
            const stored = JSON.parse(readFileSync(path, 'utf8'));
            for (const [key, value] of Object.entries(stored)) {
                if (value !== undefined && value !== null) resolved[key] = value;
            }
        }
    } catch {
        // Unreadable or invalid persisted file — fall back to composition config.
    }
    return resolved;
}

/** Persist the user-facing config subset; returns the resolved object written. */
function persistConfig(next) {
    const dir = dirname(configFilePath());
    mkdirSync(dir, { recursive: true });
    writeFileSync(configFilePath(), JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
}

/** Redacted config for the wire: never include the API key literal. */
function redactedConfig(state) {
    const c = state.config;
    return {
        provider: c.provider ?? 'dashscope',
        model: c.model ?? '',
        baseURL: c.baseURL ?? '',
        maxTokens: c.maxTokens ?? DEFAULT_MAX_TOKENS,
        timeoutMs: c.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        marker: c.marker ?? '[图片转译]',
        autoLocalOllama: c.autoLocalOllama ?? true,
        apiKeyConfigured: (c.apiKey ?? '') !== '',
    };
}

/** Register the config HTTP routes; returns a disposer. */
function mountConfigRoutes(hostCtx, state) {
    const sendJson = (response, status, payload) => {
        response.writeHead(status, {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify(payload));
    };
    const sameOrigin = (request) => {
        const origin = request.headers.origin;
        const host = request.headers.host;
        if (origin === undefined || host === undefined) return false;
        try {
            return new URL(origin).host === host;
        } catch {
            return false;
        }
    };
    const readJsonBody = async (request) => {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > 64 * 1024) throw new Error('request body too large');
            chunks.push(buffer);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    };

    // The config route is a single exact route whose handler dispatches by HTTP
    // method — the webserver rejects duplicate (kind, path) registrations, so
    // registering GET and POST as two routes would throw and leave POST dead.
    // The test route is a separate path and may be its own registration.
    const disposers = [
        hostCtx.webServer.register({
            kind: 'exact',
            path: '/dsh-vision-recognizer/config',
            handler: async (request, response) => {
                if (request.method === 'GET') {
                    sendJson(response, 200, {
                        providers: providerCatalog(),
                        config: redactedConfig(state),
                    });
                    return;
                }
                if (request.method === 'POST') {
                    if (!sameOrigin(request)) {
                        sendJson(response, 403, { error: 'untrusted origin' });
                        return;
                    }
                    try {
                        const body = await readJsonBody(request);
                        const patch = core.sanitizePatch(body);
                        const next = persistConfig({ ...state.config, ...patch });
                        state.config = next;
                        sendJson(response, 200, { ok: true, config: redactedConfig(state) });
                    } catch (error) {
                        sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
                    }
                    return;
                }
                response.writeHead(405, { allow: 'GET, POST' });
                response.end();
            },
        }),
        hostCtx.webServer.register({
            kind: 'exact',
            path: '/dsh-vision-recognizer/test',
            handler: async (request, response) => {
                if (request.method !== 'POST') {
                    response.writeHead(405, { allow: 'POST' });
                    response.end();
                    return;
                }
                if (!sameOrigin(request)) {
                    sendJson(response, 403, { error: 'untrusted origin' });
                    return;
                }
                try {
                    const body = await readJsonBody(request);
                    const c = state.config;
                    const candidate = {
                        provider: typeof body.provider === 'string' && body.provider !== '' ? body.provider : c.provider,
                        model: typeof body.model === 'string' ? body.model : c.model,
                        baseURL: typeof body.baseURL === 'string' ? body.baseURL : c.baseURL,
                        apiKey: typeof body.apiKey === 'string' && body.apiKey !== '' ? body.apiKey : c.apiKey,
                    };
                    const shared = { maxTokens: 32, timeoutMs: Math.min(c.timeoutMs ?? DEFAULT_TIMEOUT_MS, 30_000) };
                    const attempt = core.resolveAttempt(candidate, shared);
                    const started = Date.now();
                    await core.testProvider(attempt);
                    sendJson(response, 200, {
                        ok: true,
                        durationMs: Date.now() - started,
                        model: attempt.model,
                        baseURL: attempt.baseURL,
                    });
                } catch (error) {
                    sendJson(response, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
                }
            },
        }),
    ];
    return () => {
        for (const dispose of disposers) dispose();
    };
}

export function apply(ctx, config) {
    const state = {
        config: loadResolvedConfig(config ?? {}),
    };

    const providerId = state.config.providerId ?? DEFAULT_PROVIDER;
    const innerProvider = state.config.innerProvider ?? DEFAULT_INNER_PROVIDER;
    if (innerProvider === providerId) {
        ctx.logger.error(`dsh-vision-recognizer: wrapper route "${providerId}" cannot target itself; proxy route disabled`);
        return;
    }
    if (!ctx.llm.listProviders().some((provider) => provider.id === innerProvider)) {
        ctx.logger.error(`dsh-vision-recognizer: no adapter registered for "${innerProvider}"; proxy route disabled`);
        return;
    }

    // Transcription re-resolves from live state on every stream so Settings
    // edits apply immediately.
    const buildAttempts = () => {
        const c = state.config;
        const shared = { maxTokens: c.maxTokens ?? DEFAULT_MAX_TOKENS, timeoutMs: c.timeoutMs ?? DEFAULT_TIMEOUT_MS };
        const primary = core.resolveAttempt({ provider: c.provider, model: c.model, baseURL: c.baseURL, apiKey: c.apiKey }, shared);
        const fallbacks = (c.fallbackModels ?? []).map((fb) => core.resolveAttempt(fb, shared));
        return [primary, ...fallbacks];
    };

    const cache = new Map();
    const cooldowns = new Map();

    // Probe local Ollama only when a text-only target actually needs the
    // transcription fallback. Native multimodal calls never touch this path.
    let ollamaProbe;
    const resolveLocalOllama = () => {
        if (!(state.config.autoLocalOllama ?? true)) return Promise.resolve(null);
        if (ollamaProbe === undefined) {
            ollamaProbe = core.detectLocalOllama(fetch, OLLAMA_BASE_URL, OLLAMA_PROBE_TIMEOUT_MS);
            ollamaProbe.then((local) => {
                if (local !== null) {
                    ctx.logger.info(`dsh-vision-recognizer: local Ollama detected at ${local.baseURL} (model ${local.model}) — prepended to the fallback chain`);
                }
            }).catch(() => {});
        }
        return ollamaProbe;
    };

    const primary = buildAttempts()[0];
    ctx.logger.info(`dsh-vision-recognizer: adaptive route "${providerId}" wraps "${innerProvider}" · text-only fallback "${primary.model}" @ ${primary.baseURL || '(unset — set in Settings → Plugins)'} · timeout ${primary.timeoutMs}ms · maxTokens ${primary.maxTokens} · autoLocalOllama ${state.config.autoLocalOllama ?? true}`);
    ctx.logger.info('dsh-vision-recognizer: PRIVACY NOTICE — native multimodal models receive images directly; only the text-only fallback sends image bytes to the configured vision endpoint.');

    const proxy = {
        providerInfo: (provider) => ({ id: provider, name: 'DeepSeek + 智能识图' }),
        providerRetryPolicy: () => ctx.llm.providerRetryPolicy(innerProvider),
        listModels: async (provider) => {
            const models = await ctx.llm.listModels(innerProvider);
            return models.map((model) => ({ ...model, provider }));
        },
        resolveModel: async (provider, model, signal) => {
            const info = await ctx.llm.resolveModelInfo(innerProvider, model, signal);
            // The wrapper always admits images: declared native multimodal
            // targets receive them unchanged, while every other target gets the
            // configured vision transcription fallback.
            return { ...info, provider, inputModalities: ['text', 'image'] };
        },
        stream: async function* (options) {
            const hasImages = options.messages.some((message) => core.hasImage(message.content));
            let messages = options.messages;

            if (hasImages) {
                const modelInfo = await ctx.llm.resolveModelInfo(innerProvider, options.model, options.signal);
                if (modelInfo.inputModalities?.includes('image') !== true) {
                    const local = await resolveLocalOllama();
                    const baseAttempts = buildAttempts();
                    const attempts = local === null
                        ? baseAttempts
                        : [{ provider: 'ollama', baseURL: local.baseURL, model: local.model, protocol: 'openai', apiKeyEnv: '', apiKey: '', maxTokens: baseAttempts[0].maxTokens, timeoutMs: Math.min(baseAttempts[0].timeoutMs, core.ANONYMOUS_TIMEOUT_CAP_MS) }, ...baseAttempts];
                    const marker = state.config.marker ?? '[图片转译]';
                    messages = await core.transcribeMessages(ctx, attempts, marker, options.messages, options.signal, cache, cooldowns);
                }
            }

            const targetConfig = {
                provider: innerProvider,
                model: options.model,
                ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
                ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
                ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
                ...(options.stop === undefined ? {} : { stop: options.stop }),
            };
            const prepared = await ctx.llm.prepareCall(targetConfig, options.signal);
            yield* prepared.stream({ ...options, ...prepared.config, messages });
        },
    };

    ctx.effect(() => {
        const dispose = ctx.llm.registerAdapter([providerId], proxy);
        return typeof dispose === 'function' ? dispose : undefined;
    }, 'dsh-vision-recognizer: adapter');

    // Settings UI backend: mount GET/POST config routes only when a webServer
    // exists (web profile). Headless/TUI profiles keep transcription working
    // from the composition config alone.
    ctx.inject(['webServer'], (hostCtx) => {
        hostCtx.effect(() => mountConfigRoutes(hostCtx, state), 'dsh-vision-recognizer: config routes');
    });
}

/** Test seam: core internals exported for unit tests (not part of the public API). */
export const _test = { ...core };

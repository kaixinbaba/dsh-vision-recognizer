/**
 * dsh-vision-recognizer core: the pure transcription logic, split out so it
 * can be unit-tested without pulling in schemastery or any Host service.
 * Everything here is dependency-light (node:crypto + the provider catalog);
 * the Host plugin (`lib/index.js`) wires these against `ctx` at runtime.
 *
 * @module dsh-vision-recognizer/core
 */
import { createHash } from 'node:crypto';
import { PROTOCOL_ANTHROPIC, providerById } from './providers.js';

/** Hard cap on the effective timeout for anonymous/local endpoints. */
export const ANONYMOUS_TIMEOUT_CAP_MS = 20_000;
/** How long an endpoint that just failed (429/timeout) is skipped. */
export const ENDPOINT_COOLDOWN_MS = 60_000;
/** In-process transcription cache cap (content-hash keys). */
export const CACHE_CAP = 200;

/** Short prompt used by the API-key test request. */
export const TEST_PROMPT = 'Reply with exactly: OK';
/** A 32x32 solid-color PNG used by the API-key test (valid for every vision model, cheap). */
export const TEST_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMBrShPpIiHEzMb/q2UsqAQEBAQEBAQEBAQEBAQGBdOABt9TMl+gurJYAAAAASUVORK5CYII=';

/** The transcription prompt: a complete, faithful text rendition for a text-only recipient. */
export const TRANSCRIBE_PROMPT = `You are an image-to-text transcription service. The recipient is a text-only LLM that cannot see the image. Produce a faithful, complete text rendition covering:
1. ALL visible text, verbatim, in its original language (OCR).
2. The overall layout and structure (positioning, sections, hierarchy).
3. Notable visual elements: objects, people, colors, icons, UI components, charts or tables and the data they show.
4. Any other detail that matters (style, logos, numbers, timestamps, URLs).
Be precise and thorough; prefer completeness over brevity. Output only the transcription, no preamble.`;

/** Recursively detect image blocks, walking tool-result content. */
export function hasImage(content) {
    return content.some((block) => block.type === 'image'
        || (block.type === 'tool-result' && hasImage(block.content)));
}

/** True for localhost-style endpoints that need no API key. */
export function isLocalBaseURL(baseURL) {
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(baseURL);
}

/**
 * Resolve one attempt's API key: literal, then provider env, then generic
 * fallbacks. Local endpoints resolve to '' (no key needed).
 * @param attempt - resolved transcription attempt.
 * @returns the key (possibly empty).
 */
export function resolveApiKey(attempt, env = process.env) {
    if (attempt.apiKey !== undefined && attempt.apiKey !== '') return attempt.apiKey;
    const envNames = [attempt.apiKeyEnv, 'VISION_API_KEY', 'DASHSCOPE_API_KEY'].filter((n) => n !== undefined && n !== '');
    for (const envName of envNames) {
        const value = env[envName];
        if (value !== undefined && value !== '') return value;
    }
    return '';
}

/** Classify a failed VLM response into a kind + actionable hint. */
export function classifyHttpError(status, body) {
    const text = String(body);
    if (status === 429) {
        return { kind: 'rate_limit', hint: 'vision provider is rate-limited; configure a key or switch provider' };
    }
    if (status === 402 || /insufficient_quota|quota|billing|balance|credit|arrear/i.test(text)) {
        return { kind: 'quota', hint: 'vision provider quota or balance is exhausted — top up at the provider console' };
    }
    if (status === 401 || status === 403) {
        if (/region|area|not available in your|unsupported.*region/i.test(text)) {
            return { kind: 'region', hint: 'model is not available in this region — use another endpoint' };
        }
        return { kind: 'auth', hint: 'the endpoint rejected the API key — verify it matches the platform-issued format exactly' };
    }
    if (status === 404) {
        return { kind: 'model_not_found', hint: 'model id was not found at this endpoint — check the model name and baseURL' };
    }
    if (status === 400 && /image|invalid/i.test(text) && /length|width|dimension|size|larger than|smaller than|resolution/i.test(text)) {
        return { kind: 'image_dimensions', hint: 'the image does not meet the model\'s dimension requirements — it is probably too small (each side must usually be larger than ~10px); use a normal screenshot or resize the image' };
    }
    if (status === 400 && /context|length|too (large|long)|token/i.test(text)) {
        return { kind: 'context_too_large', hint: 'input is too large for this model — try a smaller image or a longer-context model' };
    }
    return { kind: 'http', hint: `endpoint returned HTTP ${status}` };
}

/** Parse a Retry-After header value into seconds, or undefined. */
export function parseRetryAfter(header) {
    if (header === null || header === undefined) return undefined;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, (date - Date.now()) / 1000);
    return undefined;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Probe an OpenAI-compatible endpoint for its model list (used for local Ollama). */
export async function detectLocalOllama(fetchImpl, baseURL, timeoutMs) {
    try {
        const res = await fetchImpl(`${baseURL.replace(/\/+$/, '')}/models`, {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;
        const body = await res.text();
        let payload;
        try {
            payload = JSON.parse(body);
        } catch {
            return null;
        }
        const ids = Array.isArray(payload?.data)
            ? payload.data.map((m) => (m && typeof m.id === 'string' ? m.id : '')).filter((id) => id !== '')
            : [];
        if (ids.length === 0) return null;
        const vision = ids.find((id) => /vl|vision|llava|llama3\.2/i.test(id));
        return { baseURL, model: vision ?? ids[0] };
    } catch {
        return null;
    }
}

/** Build the OpenAI-compatible request for a transcription. */
export function buildOpenAIRequest(attempt, base64, mediaType, prompt = TRANSCRIBE_PROMPT) {
    return {
        url: `${attempt.baseURL.replace(/\/+$/, '')}/chat/completions`,
        headers: {
            'content-type': 'application/json',
            ...(attempt.apiKey === '' ? {} : { authorization: `Bearer ${attempt.apiKey}` }),
        },
        body: JSON.stringify({
            model: attempt.model,
            max_tokens: attempt.maxTokens,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
                    { type: 'text', text: prompt },
                ],
            }],
        }),
    };
}

/** Build the Anthropic Messages request for a transcription. */
export function buildAnthropicRequest(attempt, base64, mediaType, prompt = TRANSCRIBE_PROMPT) {
    return {
        url: `${attempt.baseURL.replace(/\/+$/, '')}/messages`,
        headers: {
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': attempt.apiKey,
            authorization: `Bearer ${attempt.apiKey}`,
        },
        body: JSON.stringify({
            model: attempt.model,
            max_tokens: attempt.maxTokens,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
                    { type: 'text', text: prompt },
                ],
            }],
        }),
    };
}

/** Extract the text from a parsed OpenAI-compatible response. */
export function parseOpenAIResponse(payload) {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map((part) => (part && typeof part.text === 'string' ? part.text : '')).filter(Boolean).join('\n');
    }
    return undefined;
}

/** Extract the text from a parsed Anthropic Messages response. */
export function parseAnthropicResponse(payload) {
    const content = payload?.content;
    if (!Array.isArray(content)) return undefined;
    const parts = content
        .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text);
    return parts.length > 0 ? parts.join('\n') : undefined;
}

/** Send the transcription request for already-read image bytes; returns the text. */
export async function transcribeRequest(attempt, data, mediaType, signal, prompt = TRANSCRIBE_PROMPT) {
    const base64 = Buffer.from(data).toString('base64');
    const effectiveTimeout = isLocalBaseURL(attempt.baseURL)
        ? Math.min(attempt.timeoutMs, ANONYMOUS_TIMEOUT_CAP_MS)
        : attempt.timeoutMs;
    const build = attempt.protocol === PROTOCOL_ANTHROPIC ? buildAnthropicRequest : buildOpenAIRequest;
    const parse = attempt.protocol === PROTOCOL_ANTHROPIC ? parseAnthropicResponse : parseOpenAIResponse;
    const request = build(attempt, base64, mediaType, prompt);
    const post = () => fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.any([AbortSignal.timeout(effectiveTimeout), ...(signal === undefined ? [] : [signal])]),
    });

    let response = await post();
    if (response.status === 429 && !isLocalBaseURL(attempt.baseURL)) {
        const retryAfter = parseRetryAfter(response.headers?.get?.('retry-after'));
        if (retryAfter !== undefined) {
            await sleep(Math.min(retryAfter, 15) * 1000);
            response = await post();
        }
    }
    const body = await response.text();
    if (!response.ok) {
        const { kind, hint } = classifyHttpError(response.status, body);
        throw new Error(`transcription failed (${kind}) at ${request.url}: ${body.slice(0, 200)} — ${hint}`);
    }
    let payload;
    try {
        payload = JSON.parse(body);
    } catch {
        throw new Error(`transcription failed, non-JSON response: ${body.slice(0, 200)}`);
    }
    const text = parse(payload);
    if (text === undefined || text.trim() === '') {
        throw new Error('transcription failed, vision model returned no text');
    }
    return text.trim();
}

/**
 * Verify a provider connection: sends a tiny valid image with a short prompt
 * through the configured protocol and throws on any failure, so the Settings
 * UI can report exactly why the key/endpoint/model does not work.
 * @param attempt - resolved attempt (provider/model/baseURL/apiKey).
 * @returns the resolved attempt on success.
 */
export async function testProvider(attempt) {
    const apiKey = resolveApiKey(attempt);
    if (apiKey === '' && !isLocalBaseURL(attempt.baseURL)) {
        throw new Error('no API key configured — enter the key in Settings → Plugins → 识图, or export the provider env var');
    }
    const effective = { ...attempt, apiKey };
    const data = Buffer.from(TEST_IMAGE_BASE64, 'base64');
    await transcribeRequest(effective, data, 'image/png', undefined, TEST_PROMPT);
    return effective;
}

/**
 * Fully resolve one config entry (primary or fallback) into an attempt object.
 * @param entry - {provider?, model?, baseURL?, apiKey?} plus shared defaults.
 * @param shared - {maxTokens, timeoutMs} inherited from the primary config.
 */
export function resolveAttempt(entry, shared) {    const preset = providerById(entry.provider ?? 'custom');
    const baseURL = (entry.baseURL && entry.baseURL !== '') ? entry.baseURL : preset.baseURL;
    const model = (entry.model && entry.model !== '') ? entry.model : preset.defaultModel;
    return {
        provider: preset.id,
        baseURL,
        model,
        protocol: preset.protocol,
        apiKeyEnv: preset.apiKeyEnv,
        apiKey: entry.apiKey ?? '',
        maxTokens: shared.maxTokens,
        timeoutMs: shared.timeoutMs,
    };
}

/** Transcribe one image with the content-hash cache; returns the text. */
export async function transcribeImage(ctx, attempt, ref, signal, cache) {
    const attachments = ctx.get('attachments');
    const stored = await attachments.readImage(ref, signal);
    const data = stored.data;
    const mediaType = stored.ref?.mediaType ?? 'image/png';
    const hash = createHash('sha256').update(data).digest('hex');
    const key = `sha256:${hash}`;
    const cached = cache.get(key);
    if (cached !== undefined) return { text: cached, hash };
    const text = await transcribeRequest(attempt, data, mediaType, signal);
    if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value);
    cache.set(key, text);
    return { text, hash };
}

/** Try the primary then every fallback; only after all fail throw one combined error. */
export async function transcribeWithFallback(ctx, attempts, ref, signal, cache, cooldowns = new Map()) {
    const errors = [];
    let attempted = 0;
    for (const attempt of attempts) {
        const until = cooldowns.get(attempt.baseURL);
        if (until !== undefined) {
            if (Date.now() < until) {
                errors.push(`${attempt.model} @ ${attempt.baseURL}: skipped — endpoint cooling down`);
                continue;
            }
            cooldowns.delete(attempt.baseURL);
        }
        const apiKey = resolveApiKey(attempt);
        if (apiKey === '' && !isLocalBaseURL(attempt.baseURL)) {
            errors.push(`${attempt.model} @ ${attempt.baseURL}: skipped — no API key (configure one in Settings → Plugins, or export ${attempt.apiKeyEnv || 'an API key env var'})`);
            continue;
        }
        const effective = { ...attempt, apiKey };
        attempted += 1;
        try {
            return await transcribeImage(ctx, effective, ref, signal, cache);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${attempt.model} @ ${attempt.baseURL}: ${message}`);
            const timedOut = error?.name === 'TimeoutError' || /aborted due to timeout|timed out/i.test(message);
            if (message.includes('(rate_limit)') || timedOut) {
                cooldowns.set(attempt.baseURL, Date.now() + ENDPOINT_COOLDOWN_MS);
            }
        }
    }
    throw new Error(`all ${attempts.length} vision model(s) failed (${attempted} attempted).\n${errors.join('\n')}\nTip: 图片转译失败 — 请在 设置 → 插件 → 识图 配置 API Key，或安装本地 Ollama（http://localhost:11434）。`);
}

/** Replace image blocks with transcribed text, recursively. */
export async function transcribeBlocks(ctx, attempts, marker, blocks, signal, cache, cooldowns) {
    const out = [];
    for (const block of blocks) {
        if (block.type === 'image') {
            const { text } = await transcribeWithFallback(ctx, attempts, block.attachment, signal, cache, cooldowns);
            out.push({ type: 'text', text: `${marker}\n${text}` });
        } else if (block.type === 'tool-result' && hasImage(block.content)) {
            out.push({ ...block, content: await transcribeBlocks(ctx, attempts, marker, block.content, signal, cache, cooldowns) });
        } else {
            out.push(block);
        }
    }
    return out;
}

/** Transcribe all images in a message list; image-free messages pass through untouched. */
export async function transcribeMessages(ctx, attempts, marker, messages, signal, cache, cooldowns) {
    const out = [];
    for (const message of messages) {
        if (!hasImage(message.content)) {
            out.push(message);
            continue;
        }
        out.push({ ...message, content: await transcribeBlocks(ctx, attempts, marker, message.content, signal, cache, cooldowns) });
    }
    return out;
}

/** Validate and sanitize a POST body into a config patch (undefined = keep). */
export function sanitizePatch(body) {
    if (typeof body !== 'object' || body === null) throw new Error('config body must be an object');
    const patch = {};
    if (body.provider !== undefined) {
        if (typeof body.provider !== 'string' || body.provider === '') throw new Error('provider must be a non-empty string');
        patch.provider = body.provider;
    }
    if (body.model !== undefined) {
        if (typeof body.model !== 'string') throw new Error('model must be a string');
        patch.model = body.model.trim();
    }
    if (body.baseURL !== undefined) {
        if (typeof body.baseURL !== 'string') throw new Error('baseURL must be a string');
        patch.baseURL = body.baseURL.trim();
    }
    if (body.maxTokens !== undefined) {
        const value = Number(body.maxTokens);
        if (!Number.isInteger(value) || value < 1 || value > 32768) throw new Error('maxTokens must be an integer between 1 and 32768');
        patch.maxTokens = value;
    }
    if (body.timeoutMs !== undefined) {
        const value = Number(body.timeoutMs);
        if (!Number.isInteger(value) || value < 1000 || value > 300000) throw new Error('timeoutMs must be an integer between 1000 and 300000');
        patch.timeoutMs = value;
    }
    if (body.marker !== undefined) {
        if (typeof body.marker !== 'string') throw new Error('marker must be a string');
        patch.marker = body.marker;
    }
    if (body.autoLocalOllama !== undefined) {
        if (typeof body.autoLocalOllama !== 'boolean') throw new Error('autoLocalOllama must be a boolean');
        patch.autoLocalOllama = body.autoLocalOllama;
    }
    if (body.apiKey !== undefined && body.apiKey !== '') {
        if (typeof body.apiKey !== 'string') throw new Error('apiKey must be a string');
        patch.apiKey = body.apiKey.trim();
    }
    return patch;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    hasImage,
    isLocalBaseURL,
    resolveApiKey,
    classifyHttpError,
    parseRetryAfter,
    resolveAttempt,
    sanitizePatch,
    parseOpenAIResponse,
    parseAnthropicResponse,
    buildOpenAIRequest,
    buildAnthropicRequest,
} from '../lib/core.js';

test('hasImage detects direct and nested tool-result images', () => {
    assert.equal(hasImage([{ type: 'text', text: 'hi' }]), false);
    assert.equal(hasImage([{ type: 'image', attachment: {} }]), true);
    assert.equal(hasImage([{ type: 'tool-result', content: [{ type: 'image', attachment: {} }] }]), true);
});

test('isLocalBaseURL matches localhost variants only', () => {
    assert.equal(isLocalBaseURL('http://localhost:11434/v1'), true);
    assert.equal(isLocalBaseURL('http://127.0.0.1:8080'), true);
    assert.equal(isLocalBaseURL('http://[::1]:11434'), true);
    assert.equal(isLocalBaseURL('https://api.openai.com/v1'), false);
    assert.equal(isLocalBaseURL('http://example.com'), false);
});

test('resolveApiKey prefers literal, then env, then generic fallbacks', () => {
    const empty = {};
    assert.equal(resolveApiKey({ apiKey: 'lit', apiKeyEnv: 'X' }, empty), 'lit');
    assert.equal(resolveApiKey({ apiKey: '', apiKeyEnv: 'X' }, { X: 'from-env' }), 'from-env');
    assert.equal(resolveApiKey({ apiKey: '', apiKeyEnv: '' }, { VISION_API_KEY: 'v' }), 'v');
    assert.equal(resolveApiKey({ apiKey: '', apiKeyEnv: '' }, { DASHSCOPE_API_KEY: 'd' }), 'd');
    assert.equal(resolveApiKey({ apiKey: '', apiKeyEnv: 'X' }, empty), '');
});

test('classifyHttpError maps status codes and body patterns', () => {
    assert.equal(classifyHttpError(429, '').kind, 'rate_limit');
    assert.equal(classifyHttpError(401, '').kind, 'auth');
    assert.equal(classifyHttpError(403, 'not available in your region').kind, 'region');
    assert.equal(classifyHttpError(402, '').kind, 'quota');
    assert.equal(classifyHttpError(200, 'insufficient_quota').kind, 'quota');
    assert.equal(classifyHttpError(404, '').kind, 'model_not_found');
    assert.equal(classifyHttpError(400, 'context length too large').kind, 'context_too_large');
    assert.equal(classifyHttpError(500, '').kind, 'http');
});

test('parseRetryAfter handles seconds, dates, and garbage', () => {
    assert.equal(parseRetryAfter('10'), 10);
    assert.equal(parseRetryAfter('0'), 0);
    assert.equal(parseRetryAfter(undefined), undefined);
    assert.equal(parseRetryAfter('garbage'), undefined);
    assert.ok(parseRetryAfter(new Date(Date.now() + 5000).toUTCString()) > 0);
});

test('resolveAttempt applies provider preset defaults and overrides', () => {
    const shared = { maxTokens: 4096, timeoutMs: 120000 };
    const dashscope = resolveAttempt({ provider: 'dashscope' }, shared);
    assert.equal(dashscope.baseURL, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    assert.equal(dashscope.model, 'qwen-vl-max');
    assert.equal(dashscope.protocol, 'openai');

    const overridden = resolveAttempt({ provider: 'dashscope', model: 'custom-model', baseURL: 'https://x/v1' }, shared);
    assert.equal(overridden.model, 'custom-model');
    assert.equal(overridden.baseURL, 'https://x/v1');

    const anthropic = resolveAttempt({ provider: 'anthropic' }, shared);
    assert.equal(anthropic.protocol, 'anthropic');
    assert.equal(anthropic.baseURL, 'https://api.anthropic.com/v1');

    const unknown = resolveAttempt({ provider: 'nope' }, shared);
    assert.equal(unknown.provider, 'custom');
    assert.equal(unknown.baseURL, '');
});

test('sanitizePatch validates and trims a config body', () => {
    assert.deepEqual(sanitizePatch({ provider: 'openai', model: ' gpt-4o-mini ', apiKey: ' k ' }), {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'k',
    });
    // Empty apiKey is omitted (keeps the stored key).
    assert.equal('apiKey' in sanitizePatch({ apiKey: '' }), false);
    assert.throws(() => sanitizePatch(null), /must be an object/);
    assert.throws(() => sanitizePatch({ maxTokens: 0 }), /maxTokens/);
    assert.throws(() => sanitizePatch({ maxTokens: 1.5 }), /maxTokens/);
    assert.throws(() => sanitizePatch({ timeoutMs: 10 }), /timeoutMs/);
    assert.throws(() => sanitizePatch({ autoLocalOllama: 'yes' }), /autoLocalOllama/);
});

test('parseOpenAIResponse extracts string or array content', () => {
    assert.equal(parseOpenAIResponse({ choices: [{ message: { content: 'hello' } }] }), 'hello');
    assert.equal(parseOpenAIResponse({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] }), 'a\nb');
    assert.equal(parseOpenAIResponse({}), undefined);
});

test('parseAnthropicResponse joins text blocks', () => {
    assert.equal(parseAnthropicResponse({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'a\nb');
    assert.equal(parseAnthropicResponse({ content: [{ type: 'tool_use' }] }), undefined);
    assert.equal(parseAnthropicResponse({}), undefined);
});

test('buildOpenAIRequest emits the chat/completions wire format', () => {
    const req = buildOpenAIRequest({ baseURL: 'https://x/v1', model: 'm', maxTokens: 10, apiKey: 'k' }, 'QUJD', 'image/png');
    assert.equal(req.url, 'https://x/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer k');
    const body = JSON.parse(req.body);
    assert.equal(body.model, 'm');
    assert.equal(body.messages[0].content[0].type, 'image_url');
    assert.equal(body.messages[0].content[0].image_url.url, 'data:image/png;base64,QUJD');

    const noKey = buildOpenAIRequest({ baseURL: 'https://x/v1', model: 'm', maxTokens: 10, apiKey: '' }, 'QUJD', 'image/png');
    assert.equal('authorization' in noKey.headers, false);
});

test('buildAnthropicRequest emits the Messages wire format', () => {
    const req = buildAnthropicRequest({ baseURL: 'https://api.anthropic.com/v1', model: 'claude', maxTokens: 10, apiKey: 'k' }, 'QUJD', 'image/png');
    assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(req.headers['x-api-key'], 'k');
    assert.equal(req.headers['anthropic-version'], '2023-06-01');
    const body = JSON.parse(req.body);
    assert.equal(body.messages[0].content[0].type, 'image');
    assert.deepEqual(body.messages[0].content[0].source, { type: 'base64', media_type: 'image/png', data: 'QUJD' });
});

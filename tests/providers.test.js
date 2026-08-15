import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, CUSTOM_PROVIDER, allProviders, providerById, providerCatalog, PROTOCOL_OPENAI, PROTOCOL_ANTHROPIC } from '../lib/providers.js';

test('at least 10 providers, all ids unique', () => {
    assert.ok(allProviders().length >= 10, `expected >=10 providers, got ${allProviders().length}`);
    const ids = PROVIDERS.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, 'provider ids must be unique');
});

test('every preset has a valid protocol and name', () => {
    for (const p of PROVIDERS) {
        assert.ok([PROTOCOL_OPENAI, PROTOCOL_ANTHROPIC].includes(p.protocol), `${p.id} has a valid protocol`);
        assert.ok(typeof p.name === 'string' && p.name.length > 0, `${p.id} has a name`);
        assert.ok(typeof p.nameZh === 'string' && p.nameZh.length > 0, `${p.id} has a zh name`);
        assert.ok(typeof p.baseURL === 'string', `${p.id} baseURL is a string`);
        assert.ok(p.baseURL === '' || /^https?:\/\//.test(p.baseURL), `${p.id} baseURL is empty or http(s)`);
    }
});

test('anthropic is the only native-Messages provider', () => {
    const anthropic = PROVIDERS.filter((p) => p.protocol === PROTOCOL_ANTHROPIC);
    assert.deepEqual(anthropic.map((p) => p.id), ['anthropic']);
});

test('providerById resolves known ids and falls back to custom', () => {
    assert.equal(providerById('dashscope').id, 'dashscope');
    assert.equal(providerById('openai').protocol, PROTOCOL_OPENAI);
    assert.deepEqual(providerById('does-not-exist'), CUSTOM_PROVIDER);
});

test('providerCatalog mirrors allProviders and custom is last', () => {
    const catalog = providerCatalog();
    assert.equal(catalog.length, allProviders().length);
    assert.equal(catalog[catalog.length - 1].id, 'custom');
    for (const entry of catalog) {
        assert.ok(entry.id && entry.name && entry.nameZh, 'catalog entries carry bilingual names');
    }
});

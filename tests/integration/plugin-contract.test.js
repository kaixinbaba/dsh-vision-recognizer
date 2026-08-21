import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'

process.env.DSH_HOME = join(tmpdir(), `dsh-vision-contract-test-${process.pid}`)
const plugin = await import('../../lib/index.js')

function fixture({ inputModalities = ['text'], storedImage } = {}) {
  const effects = []
  const registrations = []
  const routes = []
  const listModelCalls = []
  const resolveCalls = []
  const prepareCalls = []
  const streamCalls = []
  let imageReads = 0
  const webServer = { register(route) { routes.push(route); return () => { route.disposed = true } } }
  const attachments = {
    async readImage() {
      imageReads += 1
      if (storedImage === undefined) throw new Error('integration fixture must not read images')
      return storedImage
    },
  }
  const ctx = {
    llm: {
      listProviders() { return [{ id: 'deepseek-official', name: 'DeepSeek' }] },
      providerRetryPolicy(provider) { assert.equal(provider, 'deepseek-official'); return { mode: 'normal' } },
      async listModels(provider) {
        listModelCalls.push(provider)
        assert.equal(provider, 'deepseek-official')
        return [{ provider, id: 'deepseek-chat', name: 'DeepSeek Chat', inputModalities }]
      },
      async resolveModelInfo(provider, model) {
        resolveCalls.push({ provider, model })
        assert.equal(provider, 'deepseek-official')
        return { provider, id: model, name: model, inputModalities, context: { contextWindow: 1000 } }
      },
      async prepareCall(config) {
        prepareCalls.push(config)
        assert.equal(config.provider, 'deepseek-official')
        return {
          config: { ...config },
          retryPolicy: { mode: 'normal' },
          adapterDefaults: {},
          stream(options) {
            return (async function* () {
              streamCalls.push(options)
              yield { type: 'text', text: 'ok' }
            })()
          },
        }
      },
      registerAdapter(ids, adapter) { registrations.push({ ids, adapter }); return () => { registrations[0].disposed = true } },
    },
    logger: { info() {}, error() {} },
    attachments,
    get(service) { assert.equal(service, 'attachments'); return attachments },
    effect(fn) { const dispose = fn(); effects.push(() => dispose?.()); },
    inject(names, callback) { assert.deepEqual(names, ['webServer']); callback({ webServer, effect: (fn) => { const dispose = fn(); effects.push(() => dispose?.()) } }) },
  }
  return {
    ctx,
    effects,
    registrations,
    routes,
    listModelCalls,
    resolveCalls,
    prepareCalls,
    streamCalls,
    imageReads: () => imageReads,
  }
}

test('host entry exports the real plugin without a default export', () => {
  assert.equal(plugin.name, 'dsh-vision-recognizer')
  assert.equal(typeof plugin.apply, 'function')
  assert.equal('default' in plugin, false)
})

test('patch inserts this plugin exactly once', async () => {
  const patch = await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal((patch.match(/^\s*- insert:\s*$/gm) ?? []).length, 1)
  assert.equal((patch.match(/^\s+- id:\s*dsh-vision-recognizer\s*$/gm) ?? []).length, 1)
  assert.match(patch, /name: 'dsh-vision-recognizer'/)
})

test('real client artifact hands package id and factory to ModuleLoader', async () => {
  const source = await readFile(new URL('../../client/client.js', import.meta.url), 'utf8')
  let loaded
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(value) { loaded = value } } } }, { filename: 'client.js' })
  assert.equal(loaded.id, 'dsh-vision-recognizer')
  const React = { createElement() { return null }, useEffect() {}, useState() { return [null, () => {}] }, useCallback(fn) { return fn } }
  const module = loaded.factory((id) => { if (id === 'react') return React; throw new Error('unexpected dependency: ' + id) })
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.name, 'dsh-vision-recognizer')
})

test('native multimodal inner models receive original image blocks without vision transcription', async (t) => {
  let visionFetches = 0
  t.mock.method(globalThis, 'fetch', async () => {
    visionFetches += 1
    throw new Error('native path must not call the vision endpoint')
  })
  const f = fixture({ inputModalities: ['text', 'image'] })
  plugin.apply(f.ctx, { innerProvider: 'deepseek-official', providerId: 'vision-recognizer', autoLocalOllama: false, timeoutMs: 1000 })
  const proxy = f.registrations[0].adapter
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'describe' }, { type: 'image', attachment: { id: 'image-1' } }] }]

  const chunks = []
  for await (const chunk of proxy.stream({ model: 'native-vision', messages })) chunks.push(chunk)

  assert.deepEqual(chunks, [{ type: 'text', text: 'ok' }])
  assert.deepEqual(f.resolveCalls, [{ provider: 'deepseek-official', model: 'native-vision' }])
  assert.deepEqual(f.prepareCalls, [{ provider: 'deepseek-official', model: 'native-vision' }])
  assert.equal(f.imageReads(), 0)
  assert.equal(visionFetches, 0)
  assert.equal(f.streamCalls[0].provider, 'deepseek-official')
  assert.strictEqual(f.streamCalls[0].messages, messages)
})

test('text-only inner models transcribe images before delegation', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: 'recognized text' } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  const f = fixture({
    inputModalities: ['text'],
    storedImage: { data: Uint8Array.from([1, 2, 3]), ref: { mediaType: 'image/png' } },
  })
  plugin.apply(f.ctx, {
    innerProvider: 'deepseek-official',
    providerId: 'vision-recognizer',
    provider: 'custom',
    model: 'local-vl',
    baseURL: 'http://localhost:9999/v1',
    autoLocalOllama: false,
    timeoutMs: 1000,
  })
  const proxy = f.registrations[0].adapter
  const messages = [{ role: 'user', content: [{ type: 'image', attachment: { id: 'image-1' } }] }]

  for await (const _chunk of proxy.stream({ model: 'text-only', messages })) {}

  assert.deepEqual(f.resolveCalls, [{ provider: 'deepseek-official', model: 'text-only' }])
  assert.equal(f.imageReads(), 1)
  assert.equal(f.streamCalls[0].provider, 'deepseek-official')
  assert.deepEqual(f.streamCalls[0].messages[0].content, [{ type: 'text', text: '[图片转译]\nrecognized text' }])
  assert.equal(messages[0].content[0].type, 'image')
})

test('apply wires adapter, image modality, routes, and disposal', async () => {
  const f = fixture()
  plugin.apply(f.ctx, { innerProvider: 'deepseek-official', providerId: 'vision-recognizer', autoLocalOllama: false, timeoutMs: 1000 })
  assert.equal(f.registrations.length, 1)
  assert.deepEqual(f.registrations[0].ids, ['vision-recognizer'])
  const proxy = f.registrations[0].adapter
  const models = await proxy.listModels('vision-recognizer')
  assert.deepEqual(models.map((model) => model.provider), ['vision-recognizer'])
  const model = await proxy.resolveModel('vision-recognizer', 'deepseek-chat')
  assert.equal(model.provider, 'vision-recognizer')
  assert.deepEqual(model.inputModalities, ['text', 'image'])
  assert.deepEqual(f.routes.map((route) => route.path), ['/dsh-vision-recognizer/config', '/dsh-vision-recognizer/test'])

  const response = () => ({ status: 0, headers: null, body: '', writeHead(status, headers) { this.status = status; this.headers = headers }, end(body = '') { this.body = body } })
  const get = response()
  await f.routes[0].handler({ method: 'GET', headers: {} }, get)
  assert.equal(get.status, 200)
  assert.ok(JSON.parse(get.body).config)

  const forbidden = response()
  await f.routes[0].handler({ method: 'POST', headers: { origin: 'https://evil.test', host: 'localhost' }, async *[Symbol.asyncIterator]() { yield Buffer.from('{}') } }, forbidden)
  assert.equal(forbidden.status, 403)
  const wrongMethod = response()
  await f.routes[1].handler({ method: 'GET', headers: {} }, wrongMethod)
  assert.equal(wrongMethod.status, 405)

  for (const dispose of f.effects) dispose()
  assert.equal(f.registrations[0].disposed, true)
  assert.ok(f.routes.every((route) => route.disposed))
})

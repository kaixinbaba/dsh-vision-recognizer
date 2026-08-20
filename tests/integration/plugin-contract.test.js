import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const plugin = await import('../../lib/index.js')

function fixture() {
  const effects = []
  const registrations = []
  const routes = []
  const inner = {
    providerInfo: () => ({ id: 'deepseek-official' }),
    listModels: async () => [],
    resolveModel: async () => ({ id: 'deepseek-chat', inputModalities: ['text'] }),
    stream: async function* () { yield { type: 'text', text: 'ok' } },
  }
  const webServer = { register(route) { routes.push(route); return () => { route.disposed = true } } }
  const attachments = { async readImage() { throw new Error('integration fixture must not read images') } }
  const ctx = {
    llm: {
      registration(id) { assert.equal(id, 'deepseek-official'); return { adapter: inner } },
      registerAdapter(ids, adapter) { registrations.push({ ids, adapter }); return () => { registrations[0].disposed = true } },
    },
    logger: { info() {}, error() {} },
    attachments,
    get(service) { assert.equal(service, 'attachments'); return attachments },
    effect(fn) { const dispose = fn(); effects.push(() => dispose?.()); },
    inject(names, callback) { assert.deepEqual(names, ['webServer']); callback({ webServer, effect: (fn) => { const dispose = fn(); effects.push(() => dispose?.()) } }) },
  }
  return { ctx, effects, registrations, routes }
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

test('apply wires adapter, image modality, routes, and disposal', async () => {
  const f = fixture()
  plugin.apply(f.ctx, { innerProvider: 'deepseek-official', providerId: 'vision-recognizer', autoLocalOllama: false, timeoutMs: 1000 })
  assert.equal(f.registrations.length, 1)
  assert.deepEqual(f.registrations[0].ids, ['vision-recognizer'])
  const proxy = f.registrations[0].adapter
  const model = await proxy.resolveModel('deepseek-official', 'deepseek-chat')
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

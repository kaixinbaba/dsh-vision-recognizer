import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import { LlmRuntime, createUserMessage } from '@deepseek-ai/dsh-llm'

process.env.DSH_HOME = join(tmpdir(), `dsh-vision-runtime-test-${process.pid}`)
const plugin = await import('../../lib/index.js')

async function setup(t, inputModalities, storedImage, targetError) {
  const root = new Context()
  await root.plugin(LlmRuntime)

  let imageReads = 0
  class Attachments extends Service {
    constructor(ctx) { super(ctx, 'attachments') }
    async readImage() {
      imageReads += 1
      if (storedImage === undefined) throw new Error('native path must not read attachments')
      return storedImage
    }
  }
  await root.plugin(Attachments)

  const targetCalls = []
  const target = {
    providerInfo: (provider) => ({ id: provider, name: 'Target' }),
    providerRetryPolicy: () => undefined,
    listModels: async (provider) => [
      { provider, id: 'model', name: 'Model', ...(inputModalities === undefined ? {} : { inputModalities }) },
    ],
    resolveModel: async (provider, model) => ({
      provider,
      id: model,
      name: model,
      ...(inputModalities === undefined ? {} : { inputModalities }),
      defaultMaxTokens: 321,
    }),
    stream: async function* (options) {
      targetCalls.push(options)
      if (targetError !== undefined) throw targetError
      yield { type: 'text-delta', text: 'ok' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const disposeTarget = root.llm.registerAdapter(['deepseek-official'], target)
  const pluginFiber = await root.plugin(plugin, {
    innerProvider: 'deepseek-official',
    providerId: 'vision-recognizer',
    provider: 'custom',
    model: 'local-vl',
    baseURL: 'http://localhost:9999/v1',
    autoLocalOllama: false,
    timeoutMs: 1000,
  })

  t.after(async () => {
    await pluginFiber.dispose()
    disposeTarget()
    await root.fiber.dispose()
  })

  return { root, targetCalls, imageReads: () => imageReads }
}

async function runTurn(llm, messages) {
  const prepared = await llm.prepareCall({ provider: 'vision-recognizer', model: 'model' })
  const chunks = []
  for await (const chunk of prepared.stream({ ...prepared.config, messages })) chunks.push(chunk)
  return { prepared, chunks }
}

test('real rc8 runtime preserves native images and prepared target config', async (t) => {
  let visionFetches = 0
  t.mock.method(globalThis, 'fetch', async () => {
    visionFetches += 1
    throw new Error('native path must not call vision fallback')
  })
  const f = await setup(t, ['text', 'image'])
  const message = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'describe' }, { type: 'image', attachment: { id: 'image-1' } }],
  })
  const messages = [message]

  const { prepared, chunks } = await runTurn(f.root.llm, messages)

  assert.equal(prepared.config.provider, 'vision-recognizer')
  assert.equal(prepared.config.maxTokens, 321)
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  assert.equal(f.targetCalls.length, 1)
  assert.equal(f.targetCalls[0].provider, 'deepseek-official')
  assert.equal(f.targetCalls[0].maxTokens, 321)
  assert.strictEqual(f.targetCalls[0].messages, messages)
  assert.equal(f.imageReads(), 0)
  assert.equal(visionFetches, 0)
})

test('real rc8 runtime does not retry native target failures through vision', async (t) => {
  let visionFetches = 0
  t.mock.method(globalThis, 'fetch', async () => {
    visionFetches += 1
    throw new Error('native failure must not trigger vision fallback')
  })
  const f = await setup(t, ['text', 'image'], undefined, new Error('target failed'))
  const message = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'image', attachment: { id: 'image-1' } }],
  })

  const { chunks } = await runTurn(f.root.llm, [message])

  assert.equal(chunks.at(-1).type, 'finish')
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(f.targetCalls.length, 1)
  assert.equal(f.imageReads(), 0)
  assert.equal(visionFetches, 0)
})

test('real rc8 runtime transcribes for text-only models without mutating history', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: 'recognized text' } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  const f = await setup(t, ['text'], { data: Uint8Array.from([1, 2, 3]), ref: { mediaType: 'image/png' } })
  const message = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'image', attachment: { id: 'image-1' } }],
  })

  const { chunks } = await runTurn(f.root.llm, [message])

  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  assert.equal(f.targetCalls.length, 1)
  assert.equal(f.targetCalls[0].provider, 'deepseek-official')
  assert.deepEqual(f.targetCalls[0].messages[0].content, [{ type: 'text', text: '[图片转译]\nrecognized text' }])
  assert.equal(message.content[0].type, 'image')
  assert.equal(f.imageReads(), 1)
})

test('unknown target capability fails in transcription before target dispatch', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('vision unavailable', {
    status: 500,
    headers: { 'content-type': 'text/plain' },
  }))
  const f = await setup(t, undefined, { data: Uint8Array.from([1, 2, 3]), ref: { mediaType: 'image/png' } })
  const message = createUserMessage({
    source: { kind: 'user' },
    content: [{ type: 'image', attachment: { id: 'image-1' } }],
  })

  const { chunks } = await runTurn(f.root.llm, [message])

  assert.equal(chunks.at(-1).type, 'finish')
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(f.targetCalls.length, 0)
  assert.equal(f.imageReads(), 1)
})

window.__ModuleLoader__.load({ id: "dsh-vision-recognizer", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
'use strict'

/**
 * dsh-vision-recognizer client: a "识图 / Vision" tab inside Settings → Plugins
 * for configuring the image-transcription provider. Hand-authored CJS bundle
 * (no build step); the only external is the loader module table's `react`.
 *
 * The tab reads and writes the host config through two same-origin endpoints:
 *   GET  /dsh-vision-recognizer/config  → { providers, config }
 *   POST /dsh-vision-recognizer/config  → { ok, config }
 */

const React = require('react')
const h = React.createElement
const { useState, useEffect, useCallback } = React

const NS = 'vision-recognizer'

const zh = {
  tabLabel: '识图',
  title: '识图 API 配置',
  intro: '当前对话模型原生支持图片时直接传图；否则使用下列视觉模型转译为文字。',
  providerLabel: '供应商',
  providerHint: '选择图片转译使用的视觉模型供应商。可在下方覆盖模型与接口地址。',
  apiKeyLabel: 'API Key',
  apiKeyHint: '留空则读取该供应商的环境变量；本地 Ollama 无需 Key。',
  apiKeyConfigured: '已配置',
  apiKeyUnset: '未配置',
  modelLabel: '模型',
  modelHint: '视觉模型 ID。留空使用该供应商的默认模型。',
  modelPlaceholder: '留空使用供应商默认',
  baseUrlLabel: '接口地址',
  baseUrlHint: 'OpenAI 兼容接口地址（…/chat/completions 会自动拼接）。留空使用该供应商的默认地址。',
  baseUrlPlaceholder: '留空使用供应商默认',
  maxTokensLabel: '最大输出 token',
  maxTokensHint: '视觉模型单次输出的 token 上限，越大转译越详尽、也越贵。',
  timeoutLabel: '超时（毫秒）',
  timeoutHint: '请求超时时间。本地/匿名端点会被强制限制在 20 秒内。',
  markerLabel: '转译标记',
  markerHint: '仅纯文本模型回退时使用：给转译文本添加前缀，默认 [图片转译]。',
  autoOllamaLabel: '自动探测本地 Ollama',
  autoOllamaHint: '启动时探测本机 http://localhost:11434 的 Ollama，检测到则作为兜底——图片不出本机、无需 Key。',
  save: '保存',
  saving: '保存中…',
  saved: '已保存，立即生效',
  test: '测试',
  testing: '测试中…',
  testOk: '连接正常',
  testFailed: '测试失败',
  saveFailed: '保存失败',
  loadFailed: '配置加载失败，请稍后重试',
  requiredHint: '自定义供应商需填写接口地址与模型',
}

const en = {
  tabLabel: 'Vision',
  title: 'Vision API configuration',
  intro: 'Native multimodal conversation models receive images directly; otherwise the vision model below transcribes them to text.',
  providerLabel: 'Provider',
  providerHint: 'Vision provider used to transcribe attached images. Model and endpoint can be overridden below.',
  apiKeyLabel: 'API key',
  apiKeyHint: 'Leave blank to read the provider env var; local Ollama needs none.',
  apiKeyConfigured: 'configured',
  apiKeyUnset: 'not configured',
  modelLabel: 'Model',
  modelHint: 'Vision model id. Leave blank for the provider default.',
  modelPlaceholder: 'Leave blank for the provider default',
  baseUrlLabel: 'Endpoint',
  baseUrlHint: 'OpenAI-compatible endpoint (…/chat/completions is appended). Leave blank for the provider default.',
  baseUrlPlaceholder: 'Leave blank for the provider default',
  maxTokensLabel: 'Max output tokens',
  maxTokensHint: 'Output token cap for the vision model; larger is more thorough but costs more.',
  timeoutLabel: 'Timeout (ms)',
  timeoutHint: 'Request timeout. Local/anonymous endpoints are hard-capped at 20s.',
  markerLabel: 'Transcription marker',
  markerHint: 'Used only for text-only fallback: prefix prepended to each transcription. Default [图片转译].',
  autoOllamaLabel: 'Auto-detect local Ollama',
  autoOllamaHint: 'Probe local Ollama at http://localhost:11434 at startup and use it as a fallback — images never leave your machine and no key is needed.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved — takes effect immediately',
  test: 'Test',
  testing: 'Testing…',
  testOk: 'Connection OK',
  testFailed: 'Test failed',
  saveFailed: 'Save failed',
  loadFailed: 'Failed to load configuration',
  requiredHint: 'A custom provider needs an endpoint and a model',
}

const CSS = `
.vrg-root{max-width:640px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary,#1f2328)}
.vrg-head{display:flex;flex-direction:column;gap:4px}
.vrg-title{font-size:16px;font-weight:600;margin:0}
.vrg-intro{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);margin:0;line-height:1.6}
.vrg-field{display:flex;flex-direction:column;gap:6px}
.vrg-label{font-size:13px;font-weight:500}
.vrg-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:8px;padding:8px 12px;font:inherit;font-size:13px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;outline:none}
.vrg-input:focus{border-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.vrg-hint{font-size:12px;color:var(--dsw-alias-label-tertiary,#9ca3af);margin:0}
.vrg-row{display:flex;gap:12px}
.vrg-row>.vrg-field{flex:1}
.vrg-check{display:flex;align-items:center;gap:8px;font-size:13px}
.vrg-check input{width:16px;height:16px}
.vrg-badge{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;font-size:11px;background:var(--dsw-alias-bg-module-platform,#eef0f4);color:var(--dsw-alias-label-secondary,#6b7280)}
.vrg-badge.on{background:var(--dsw-alias-state-success-primary,#16a34a);color:#fff}
.vrg-actions{display:flex;align-items:center;gap:12px}
.vrg-btn{border:none;border-radius:8px;padding:8px 18px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;background:var(--dsw-alias-button-primary-fill,#4f6ef7);color:var(--dsw-alias-label-primary-foreground,#fff)}
.vrg-btn:disabled{opacity:.6;cursor:default}
.vrg-btn-ghost{background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-primary,#1f2328)}
.vrg-status{font-size:12px}
.vrg-status.ok{color:var(--dsw-alias-state-success-primary,#16a34a)}
.vrg-status.err{color:var(--dsw-alias-state-error-primary,#dc2626)}
.vrg-tip{position:relative;display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:99px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);color:var(--dsw-alias-label-tertiary,#9ca3af);font-size:10px;font-weight:600;line-height:1;cursor:help;margin-left:6px;vertical-align:middle;user-select:none}
.vrg-tip .vrg-tiptext{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%) translateY(-2px);background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;padding:8px 10px;font-size:12px;font-weight:400;line-height:1.5;color:var(--dsw-alias-label-primary,#1f2328);width:max-content;max-width:280px;white-space:normal;text-align:left;z-index:60;opacity:0;pointer-events:none;transition:opacity .12s ease,transform .12s ease;box-shadow:0 6px 20px rgba(0,0,0,.14)}
.vrg-tip:hover .vrg-tiptext,.vrg-tip:focus-visible .vrg-tiptext{opacity:1;transform:translateX(-50%) translateY(0)}
`

function injectStyles() {
  if (document.querySelector('style[data-plugin-css="dsh-vision-recognizer"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-vision-recognizer'
  tag.dataset.pluginCss = 'dsh-vision-recognizer'
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** A small "?" circle whose hover/focus reveals a tooltip explaining the field. */
function HelpTip({ text }) {
  return h('span', { className: 'vrg-tip', tabIndex: 0, 'aria-label': text },
    '?',
    h('span', { className: 'vrg-tiptext' }, text))
}

function VisionPanel({ t, locale }) {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState(null)

  const localeSnap = React.useSyncExternalStore(
    (cb) => locale.subscribe(cb),
    () => locale.getSnapshot(),
  )
  const lang = String(localeSnap.active).toLowerCase().startsWith('zh') ? 'zh' : 'en'

  useEffect(() => {
    injectStyles()
    fetch('/dsh-vision-recognizer/config', { cache: 'no-store' })
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json() })
      .then((body) => {
        setData(body)
        const c = body.config || {}
        setForm({
          provider: c.provider || 'dashscope',
          apiKey: '',
          model: c.model || '',
          baseURL: c.baseURL || '',
          maxTokens: String(c.maxTokens ?? 4096),
          timeoutMs: String(c.timeoutMs ?? 120000),
          marker: c.marker ?? '[图片转译]',
          autoLocalOllama: c.autoLocalOllama ?? true,
          apiKeyConfigured: !!c.apiKeyConfigured,
        })
      })
      .catch(() => setLoadError(true))
  }, [])

  const set = useCallback((key, value) => {
    setStatus(null)
    setForm((f) => (f === null ? f : { ...f, [key]: value }))
  }, [])

  const runTest = useCallback(() => {
    if (form === null || testing) return
    setTesting(true)
    setStatus(null)
    fetch('/dsh-vision-recognizer/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: form.provider,
        apiKey: form.apiKey,
        model: form.model,
        baseURL: form.baseURL,
      }),
    })
      .then((res) => res.text().then((text) => {
        let body = {}
        try { body = text ? JSON.parse(text) : {} } catch { body = { error: text.slice(0, 200) } }
        return body
      }))
      .then((body) => {
        if (body.ok) {
          setStatus({ kind: 'ok', message: t('testOk') + (typeof body.durationMs === 'number' ? ' · ' + body.durationMs + 'ms' : '') })
        } else {
          setStatus({ kind: 'err', message: t('testFailed') + (body.error ? ': ' + body.error : '') })
        }
      })
      .catch((error) => setStatus({ kind: 'err', message: t('testFailed') + ': ' + String(error) }))
      .finally(() => setTesting(false))
  }, [form, testing, t])

  const save = useCallback(() => {
    if (form === null || saving) return
    setSaving(true)
    setStatus(null)
    fetch('/dsh-vision-recognizer/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: form.provider,
        apiKey: form.apiKey,
        model: form.model,
        baseURL: form.baseURL,
        maxTokens: Number(form.maxTokens),
        timeoutMs: Number(form.timeoutMs),
        marker: form.marker,
        autoLocalOllama: form.autoLocalOllama,
      }),
    })
      .then((res) => res.text().then((text) => {
        let body = {}
        try { body = text ? JSON.parse(text) : {} } catch { body = { error: text.slice(0, 200) } }
        return { status: res.status, body }
      }))
      .then(({ status: httpStatus, body }) => {
        if (httpStatus === 200 && body.ok) {
          setForm((f) => (f === null ? f : {
            ...f,
            apiKey: '',
            apiKeyConfigured: !!body.config.apiKeyConfigured,
            model: body.config.model || '',
            baseURL: body.config.baseURL || '',
          }))
          setStatus({ kind: 'ok', message: t('saved') })
          // Auto-test the just-saved config so the user immediately sees
          // whether the provider / key / model actually works.
          runTest()
        } else {
          setStatus({ kind: 'err', message: t('saveFailed') + (body.error ? ': ' + body.error : '') })
        }
      })
      .catch((error) => setStatus({ kind: 'err', message: t('saveFailed') + ': ' + String(error) }))
      .finally(() => setSaving(false))
  }, [form, saving, t, runTest])

  if (loadError) return h('p', { className: 'vrg-intro' }, t('loadFailed'))
  if (form === null || data === null) return null

  const activeProvider = data.providers.find((p) => p.id === form.provider)
  const modelPh = activeProvider ? activeProvider.defaultModel || t('modelPlaceholder') : t('modelPlaceholder')
  const basePh = activeProvider ? activeProvider.baseURL || t('baseUrlPlaceholder') : t('baseUrlPlaceholder')

  return h('div', { className: 'vrg-root' },
    h('div', { className: 'vrg-head' },
      h('h3', { className: 'vrg-title' }, t('title')),
      h('p', { className: 'vrg-intro' }, t('intro'))),
    h('div', { className: 'vrg-field' },
      h('label', { className: 'vrg-label' }, t('providerLabel'), h(HelpTip, { text: t('providerHint') })),
      h('select', {
        className: 'vrg-input',
        value: form.provider,
        onChange: (e) => set('provider', e.target.value),
      },
        data.providers.map((p) => h('option', { key: p.id, value: p.id },
          (lang === 'zh' ? p.nameZh : p.name))))),
    h('div', { className: 'vrg-field' },
      h('label', { className: 'vrg-label' }, t('apiKeyLabel'),
        h('span', { className: 'vrg-badge' + (form.apiKeyConfigured ? ' on' : '') },
          form.apiKeyConfigured ? t('apiKeyConfigured') : t('apiKeyUnset')),
        h(HelpTip, { text: t('apiKeyHint') })),
      h('input', {
        className: 'vrg-input',
        type: 'password',
        autoComplete: 'off',
        value: form.apiKey,
        placeholder: t('apiKeyHint'),
        onChange: (e) => set('apiKey', e.target.value),
      }),
      h('p', { className: 'vrg-hint' }, t('apiKeyHint'))),
    h('div', { className: 'vrg-row' },
      h('div', { className: 'vrg-field' },
        h('label', { className: 'vrg-label' }, t('modelLabel'), h(HelpTip, { text: t('modelHint') })),
        h('input', {
          className: 'vrg-input',
          value: form.model,
          placeholder: modelPh,
          onChange: (e) => set('model', e.target.value),
        })),
      h('div', { className: 'vrg-field' },
        h('label', { className: 'vrg-label' }, t('baseUrlLabel'), h(HelpTip, { text: t('baseUrlHint') })),
        h('input', {
          className: 'vrg-input',
          value: form.baseURL,
          placeholder: basePh,
          onChange: (e) => set('baseURL', e.target.value),
        }))),
    h('div', { className: 'vrg-row' },
      h('div', { className: 'vrg-field' },
        h('label', { className: 'vrg-label' }, t('maxTokensLabel'), h(HelpTip, { text: t('maxTokensHint') })),
        h('input', {
          className: 'vrg-input',
          inputMode: 'numeric',
          value: form.maxTokens,
          onChange: (e) => set('maxTokens', e.target.value),
        })),
      h('div', { className: 'vrg-field' },
        h('label', { className: 'vrg-label' }, t('timeoutLabel'), h(HelpTip, { text: t('timeoutHint') })),
        h('input', {
          className: 'vrg-input',
          inputMode: 'numeric',
          value: form.timeoutMs,
          onChange: (e) => set('timeoutMs', e.target.value),
        }))),
    h('div', { className: 'vrg-field' },
      h('label', { className: 'vrg-label' }, t('markerLabel'), h(HelpTip, { text: t('markerHint') })),
      h('input', {
        className: 'vrg-input',
        value: form.marker,
        onChange: (e) => set('marker', e.target.value),
      })),
    h('label', { className: 'vrg-check' },
      h('input', {
        type: 'checkbox',
        checked: form.autoLocalOllama,
        onChange: (e) => set('autoLocalOllama', e.target.checked),
      }),
      t('autoOllamaLabel'),
      h(HelpTip, { text: t('autoOllamaHint') })),
    form.provider === 'custom' && h('p', { className: 'vrg-hint' }, t('requiredHint')),
    h('div', { className: 'vrg-actions' },
      h('button', { className: 'vrg-btn', disabled: saving, onClick: save }, saving ? t('saving') : t('save')),
      h('button', { className: 'vrg-btn vrg-btn-ghost', disabled: testing, onClick: runTest }, testing ? t('testing') : t('test')),
      status !== null && h('span', { className: 'vrg-status ' + status.kind }, status.message)))
}

exports.name = 'dsh-vision-recognizer'
exports.inject = ['slots', 'locale']
exports.apply = function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-vision-recognizer: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'vision-recognizer',
    order: 30,
    label: () => t('tabLabel'),
    locale: NS,
    inject: () => ({ t }),
  }, () => h(VisionPanel, { t, locale: ctx.locale })))
}

return module.exports; } });

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
  intro: '选择视觉模型供应商并配置 API Key。附加图片会被自动转译为文字，对话仍由 DeepSeek 作答。',
  providerLabel: '供应商',
  apiKeyLabel: 'API Key',
  apiKeyHint: '留空则读取该供应商的环境变量；本地 Ollama 无需 Key。',
  apiKeyConfigured: '已配置',
  apiKeyUnset: '未配置',
  modelLabel: '模型',
  modelPlaceholder: '留空使用供应商默认',
  baseUrlLabel: '接口地址',
  baseUrlPlaceholder: '留空使用供应商默认',
  maxTokensLabel: '最大输出 token',
  timeoutLabel: '超时（毫秒）',
  markerLabel: '转译标记',
  autoOllamaLabel: '自动探测本地 Ollama',
  save: '保存',
  saving: '保存中…',
  saved: '已保存，立即生效',
  saveFailed: '保存失败',
  loadFailed: '配置加载失败，请稍后重试',
  requiredHint: '自定义供应商需填写接口地址与模型',
}

const en = {
  tabLabel: 'Vision',
  title: 'Vision API configuration',
  intro: 'Pick a vision provider and configure its API key. Attached images are transcribed to text; DeepSeek still answers the conversation.',
  providerLabel: 'Provider',
  apiKeyLabel: 'API key',
  apiKeyHint: 'Leave blank to read the provider env var; local Ollama needs none.',
  apiKeyConfigured: 'configured',
  apiKeyUnset: 'not configured',
  modelLabel: 'Model',
  modelPlaceholder: 'Leave blank for the provider default',
  baseUrlLabel: 'Endpoint',
  baseUrlPlaceholder: 'Leave blank for the provider default',
  maxTokensLabel: 'Max output tokens',
  timeoutLabel: 'Timeout (ms)',
  markerLabel: 'Transcription marker',
  autoOllamaLabel: 'Auto-detect local Ollama',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved — takes effect immediately',
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
.vrg-status{font-size:12px}
.vrg-status.ok{color:var(--dsw-alias-state-success-primary,#16a34a)}
.vrg-status.err{color:var(--dsw-alias-state-error-primary,#dc2626)}
`

function injectStyles() {
  if (document.querySelector('style[data-plugin-css="dsh-vision-recognizer"]') !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-vision-recognizer'
  tag.dataset.pluginCss = 'dsh-vision-recognizer'
  tag.textContent = CSS
  document.head.appendChild(tag)
}

function VisionPanel({ t, locale }) {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
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
      .then((res) => res.json().then((body) => ({ status: res.status, body })))
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
        } else {
          setStatus({ kind: 'err', message: t('saveFailed') + (body.error ? ': ' + body.error : '') })
        }
      })
      .catch((error) => setStatus({ kind: 'err', message: t('saveFailed') + ': ' + String(error) }))
      .finally(() => setSaving(false))
  }, [form, saving, t])

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
      h('label', { className: 'vrg-label' }, t('providerLabel')),
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
          form.apiKeyConfigured ? t('apiKeyConfigured') : t('apiKeyUnset'))),
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
        h('label', { className: 'vrg-label' }, t('modelLabel')),
        h('input', {
          className: 'vrg-input',
          value: form.model,
          placeholder: modelPh,
          onChange: (e) => set('model', e.target.value),
        })),
      h('div', { className: 'vrg-field' },
        h('label', { className: 'vrg-label' }, t('baseUrlLabel')),
        h('input', {
          className: 'vrg-input',
          value: form.baseURL,
          placeholder: basePh,
          onChange: (e) => set('baseURL', e.target.value),
        }))),
    h('div', { className: 'vrg-row' },
      h('div', { className: 'vrg-field' },
        h('label', { className: 'vrg-label' }, t('maxTokensLabel')),
        h('input', {
          className: 'vrg-input',
          inputMode: 'numeric',
          value: form.maxTokens,
          onChange: (e) => set('maxTokens', e.target.value),
        })),
      h('div', { className: 'vrg-field' },
        h('label', { className: 'vrg-label' }, t('timeoutLabel')),
        h('input', {
          className: 'vrg-input',
          inputMode: 'numeric',
          value: form.timeoutMs,
          onChange: (e) => set('timeoutMs', e.target.value),
        }))),
    h('div', { className: 'vrg-field' },
      h('label', { className: 'vrg-label' }, t('markerLabel')),
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
      t('autoOllamaLabel')),
    form.provider === 'custom' && h('p', { className: 'vrg-hint' }, t('requiredHint')),
    h('div', { className: 'vrg-actions' },
      h('button', { className: 'vrg-btn', disabled: saving, onClick: save }, saving ? t('saving') : t('save')),
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

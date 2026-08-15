/**
 * Provider presets for dsh-vision-recognizer.
 *
 * Every preset is an OpenAI-compatible `/chat/completions` endpoint except
 * `anthropic`, which speaks the native Anthropic Messages API. The `protocol`
 * field selects the wire format; `baseURL` and `defaultModel` are only
 * defaults — the user can override either in Settings → Plugins, and every
 * preset still resolves its API key from `apiKeyEnv` (or the literal key).
 *
 * Model ids drift over time at each vendor, so these are sensible starting
 * points, not a contract; override `model` when a vendor retires or renames
 * one.
 *
 * @module dsh-vision-recognizer/providers
 */

/** The OpenAI-compatible chat-completions protocol (most providers). */
export const PROTOCOL_OPENAI = 'openai';
/** The native Anthropic Messages protocol. */
export const PROTOCOL_ANTHROPIC = 'anthropic';

/** Ordered provider presets. `apiKeyEnv === ''` means "no env key / local only". */
export const PROVIDERS = [
  // ---- International ----
  {
    id: 'openai',
    name: 'OpenAI',
    nameZh: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    apiKeyEnv: 'OPENAI_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    nameZh: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    protocol: PROTOCOL_ANTHROPIC,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    nameZh: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    apiKeyEnv: 'GEMINI_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    nameZh: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'qwen/qwen-2.5-vl-72b-instruct',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    nameZh: 'Azure OpenAI',
    baseURL: '', // user-supplied: https://<resource>.openai.azure.com/openai/deployments/<deployment>
    defaultModel: 'gpt-4o-mini',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    nameZh: 'Ollama（本地）',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: '', // auto-detect the first vision-capable local model
    apiKeyEnv: '',
    protocol: PROTOCOL_OPENAI,
  },

  // ---- Domestic (China) ----
  {
    id: 'dashscope',
    name: 'Alibaba DashScope',
    nameZh: '阿里云百炼',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-vl-max',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'qwen-intl',
    name: 'QwenCloud (International)',
    nameZh: '通义千问（国际）',
    baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-vl-plus',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    nameZh: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4v-flash',
    apiKeyEnv: 'ZHIPU_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'qianfan',
    name: 'Baidu Qianfan',
    nameZh: '百度千帆',
    baseURL: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-4.5-vl-8k',
    apiKeyEnv: 'QIANFAN_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'spark',
    name: 'iFlytek Spark',
    nameZh: '讯飞星火',
    baseURL: 'https://spark-api-open.xf-yun.com/v1',
    defaultModel: 'generalv3.5',
    apiKeyEnv: 'SPARK_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'moonshot',
    name: 'Moonshot Kimi',
    nameZh: '月之暗面 Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k-vision-preview',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'hunyuan',
    name: 'Tencent Hunyuan',
    nameZh: '腾讯混元',
    baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
    defaultModel: 'hunyuan-vision',
    apiKeyEnv: 'HUNYUAN_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'doubao',
    name: 'Volcengine Doubao',
    nameZh: '火山引擎豆包',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-1.5-vision-pro-32k-250115',
    apiKeyEnv: 'ARK_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    nameZh: '硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    protocol: PROTOCOL_OPENAI,
  },
];

/** The catch-all preset: any OpenAI-compatible endpoint the user fills in. */
export const CUSTOM_PROVIDER = {
  id: 'custom',
  name: 'Custom (OpenAI-compatible)',
  nameZh: '自定义（OpenAI 兼容）',
  baseURL: '',
  defaultModel: '',
  apiKeyEnv: '',
  protocol: PROTOCOL_OPENAI,
};

/** Every selectable provider, custom included. */
export function allProviders() {
  return [...PROVIDERS, CUSTOM_PROVIDER];
}

/**
 * Look up a provider preset by id; falls back to the custom preset for any
 * unknown id so an edited config never crashes the host.
 * @param id - provider preset id.
 * @returns the preset (never undefined).
 */
export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) ?? CUSTOM_PROVIDER;
}

/** Provider catalog for the browser: ids, bilingual names, and per-provider defaults. */
export function providerCatalog() {
  return allProviders().map((p) => ({
    id: p.id,
    name: p.name,
    nameZh: p.nameZh,
    baseURL: p.baseURL,
    defaultModel: p.defaultModel,
    apiKeyEnv: p.apiKeyEnv,
    protocol: p.protocol,
  }));
}

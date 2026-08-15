# dsh-vision-recognizer

[English](README.md) | 简体中文

**保持 DeepSeek 作为对话大脑，图片照样直接发，并且可以在「设置 → 插件」里随时切换识图供应商。** 面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的识图插件。

它注册一条新的提供商路由（默认 `vision-recognizer`，模型选择器里显示为 **DeepSeek + 识图**），包装真正的 DeepSeek 适配器：对外声明支持图片输入（附件预检与 `read_image` 门禁放行），并在请求流里**把每张附加图片经你选定的视觉模型转译成文字**，再交给纯文本的 DeepSeek 作答。对话仍由 DeepSeek 完成，识图只是附加能力。

```
用户附加图片 ──▶ vision-recognizer 路由 ──▶ 视觉模型转译（OCR + 版式 + 细节）
                     │                        │
                     ▼                        ▼
              DeepSeek 作答 ◀── 纯文本对话（图片已替换为 [图片转译] 文字）
```

## 特性

- **一键安装**：`dsh plugin --profile web add dsh-vision-recognizer`，无需构建脚本、无需 approve `sharp`（不依赖任何原生模块）。
- **在「设置 → 插件 → 识图」里配置**：下拉选择供应商、填 API Key、可覆盖模型 / 接口地址 / token 上限 / 超时 / 标记，保存后**立即生效**，无需重启。
- **15+ 国内外供应商**：OpenAI、Anthropic Claude、Google Gemini、OpenRouter、Azure OpenAI、Ollama（本地），以及阿里云百炼、通义千问国际、智谱 GLM、百度千帆、讯飞星火、月之暗面 Kimi、腾讯混元、火山引擎豆包、硅基流动。任何 OpenAI 兼容端点也能自定义接入。
- **双协议**：OpenAI 兼容（`/chat/completions`）与 Anthropic Messages 原生协议都支持，Claude 也能直接用。
- **绝不卡死**：本地/匿名端点 20 秒硬超时上限，HTTP 429 快速失败，失败端点进入 60 秒冷却；没有 Key 也没有本地 Ollama 时数秒内快速失败并给出指引。
- **降级链**：主模型失败后按 `fallbackModels` 依次尝试，每个条目可指向不同供应商；全部失败才报错并列出每一次尝试。
- **内容哈希缓存**：同一张图每个进程只转译一次（进程内，上限 200）。
- **本地零配置**：`autoLocalOllama`（默认开）探测 `http://localhost:11434`，检测到就前置进降级链，图片不出本机。

## 快速开始

```sh
dsh plugin --profile web add dsh-vision-recognizer
```

> npm 官方源慢的话：`dsh plugin --profile web add dsh-vision-recognizer --registry=https://registry.npmmirror.com`

**从本地源码安装（开发）**：

```sh
dsh plugin --profile web add file:/path/to/dsh-vision-recognizer
```

> 注意用 `file:` 前缀（会把包复制进 `node_modules`）。若写成 `add .` 或 `add link:…`，pnpm 会把包做成软链接，此时插件的 `schemastery` 依赖会改从源码目录解析而找不到——这是 pnpm 软链接安装的通用坑，与插件本身无关。

重启 `dsh web`，然后：

1. 模型选择器选择 **DeepSeek + 识图**；
2. 打开 **设置 → 插件 → 识图**，选供应商、填 API Key，点保存；
3. 向任意对话粘贴图片 → 应看到 `[图片转译]` 标记后 DeepSeek 作答。

没有 Key 也没有本地 Ollama 时，回合会在数秒内快速失败并给出指引——这是预期的防卡死行为。

## 支持的供应商

| 供应商 | 接口地址（baseURL） | 默认模型 | Key 环境变量 | 协议 |
|---|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | `OPENAI_API_KEY` | OpenAI |
| Anthropic Claude | `https://api.anthropic.com/v1` | `claude-3-5-sonnet-latest` | `ANTHROPIC_API_KEY` | Anthropic |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` | `GEMINI_API_KEY` | OpenAI |
| OpenRouter | `https://openrouter.ai/api/v1` | `qwen/qwen-2.5-vl-72b-instruct` | `OPENROUTER_API_KEY` | OpenAI |
| Azure OpenAI | 自填（`…/openai/deployments/<deployment>`） | `gpt-4o-mini` | `AZURE_OPENAI_API_KEY` | OpenAI |
| Ollama（本地） | `http://localhost:11434/v1` | 自动探测 | 无需 | OpenAI |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-vl-max` | `DASHSCOPE_API_KEY` | OpenAI |
| 通义千问（国际） | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen-vl-plus` | `DASHSCOPE_API_KEY` | OpenAI |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4v-flash` | `ZHIPU_API_KEY` | OpenAI |
| 百度千帆 | `https://qianfan.baidubce.com/v2` | `ernie-4.5-vl-8k` | `QIANFAN_API_KEY` | OpenAI |
| 讯飞星火 | `https://spark-api-open.xf-yun.com/v1` | `generalv3.5` | `SPARK_API_KEY` | OpenAI |
| 月之暗面 Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k-vision-preview` | `MOONSHOT_API_KEY` | OpenAI |
| 腾讯混元 | `https://api.hunyuan.cloud.tencent.com/v1` | `hunyuan-vision` | `HUNYUAN_API_KEY` | OpenAI |
| 火山引擎豆包 | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-1.5-vision-pro-32k-250115` | `ARK_API_KEY` | OpenAI |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-VL-72B-Instruct` | `SILICONFLOW_API_KEY` | OpenAI |

> 模型名会随各厂商迭代而变化，表中的默认值只是起点；在设置界面里覆盖 `模型` 即可。API Key 读取顺序：设置界面里填的 Key → 该供应商的环境变量 → `$VISION_API_KEY` / `$DASHSCOPE_API_KEY`。

## 配置存储

界面保存的配置写入 `$DSH_HOME/vision-recognizer.json`，启动时合并到 bundle 默认配置之上。`cordis.patch.yml` 里只放出厂默认值；用户层覆盖（`$DSH_HOME/profiles/<name>/cordis.patch.yml`）仍可作为组合期兜底。

> ⚠️ **patch 语义**：bundle 自带 `- insert:` 会向条目列表追加本行。若你又在自己的 `cordis.patch.yml` 里同时写 `- insert:` 的同 id 条目，会让 adapter 注册两次（行为未定义）。要覆盖个别键，只写一个顶层 `- id: dsh-vision-recognizer` 条目即可；更推荐直接用设置界面。

## 实现原理（给插件开发者）

本插件只使用 rc.6 上稳定的公共接口：

- `ctx.llm.registration(innerProvider).adapter` —— 拿到被包装的适配器；
- `ctx.llm.registerAdapter([providerId], proxyAdapter)` —— 注册新路由；
- 代理 `resolveModel` 把 `inputModalities` 覆盖为 `['text', 'image']`；
- 代理 `stream` 转译图片块（`{ type: 'image', attachment }`，字节经 `ctx.get('attachments').readImage(ref)` 读取），再 `yield*` 原样转发内部适配器流；
- 设置界面走 `settings.plugins.tab` 插槽 + 自定义 `webServer` 路由，配置持久化到自有 JSON 文件（不依赖 api-proxy 的 settings 白名单）。

## 隐私

转译会把图片字节（base64，HTTPS）发送到你配置的视觉端点——**图片数据会离开你的机器**，除非端点指向本地服务（如 Ollama）。除 harness 自身的附件存储外不持久化任何图片。敏感图片请使用自己的端点或本地模型，或不要安装本插件。

## 许可证

MIT

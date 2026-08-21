# dsh-vision-recognizer

[English](README.md) | 简体中文

**保持 DeepSeek 作为对话大脑，图片照样直接发，并且可以在「设置 → 插件」里随时切换识图供应商。** 面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的识图插件。

它注册一条自适应提供商路由（默认 `vision-recognizer`，模型选择器里显示为 **DeepSeek + 智能识图**），包装配置的对话提供商。路由始终接纳图片，然后解析当前选中的准确模型：声明原生图片能力的模型直接收到原始图片块；纯文本或能力未知的模型则收到由你配置的视觉模型生成的转译文字。默认被包装的对话提供商仍是 DeepSeek。

```
用户附加图片 ──▶ vision-recognizer 路由 ──▶ 当前模型支持原生图片？ ── 是 ─▶ 原生多模态请求
                                                      │
                                                      否
                                                      ▼
                                      配置的视觉模型转译 ──▶ 纯文本当前模型
```

## 特性

- **自适应路由**：原生多模态模型直接收到图片；只有纯文本或能力未知的模型才调用配置的视觉转译回退。
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

1. 模型选择器选择 **DeepSeek + 智能识图**；
2. 打开 **设置 → 插件 → 识图**，配置回退视觉供应商和 API Key；
3. 粘贴图片：当前模型原生支持图片时直接传图；纯文本模型会收到带 `[图片转译]` 的识别结果。

当前模型原生支持图片时不需要配置回退 Key；只有纯文本模型且本地没有 Ollama、也没有 Key 时，才会快速失败并提示配置。

> **作用范围：** 自适应回退只在选中 **DeepSeek + 智能识图** 包装路由时生效。若直接选择其他提供商路由，请求会直接走该路由；rc8 还没有公开的 adapter 装饰钩子，插件无法给所有既有路由全局加回退。

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

自适应包装只使用 rc8 公共接口：

- `ctx.llm.listModels(innerProvider)` 与 `resolveModelInfo(innerProvider, model)` 检查准确目标模型，并把模型元数据重新绑定到包装路由；
- `ctx.llm.prepareCall(...)` 委派到配置的目标提供商，不依赖私有 adapter registration；
- 代理 `resolveModel` 对外声明 `['text', 'image']` 以接纳图片，代理 `stream` 再根据目标模型原始能力选择原生直传或转译；
- 转译只克隆并修改本次委派的消息，持久会话历史仍保留原始图片引用；
- 设置界面走 `settings.plugins.tab` 插槽 + 自定义 `webServer` 路由，配置持久化到自有 JSON 文件。

### rc8 限制

rc8 的能力查询与目标 `prepareCall` 是两个独立公开操作；如果目标 adapter 恰好在这个极短窗口被 HMR 替换，能力判断可能与最终派发版本不一致。嵌套目标调用还会第二次进入 `llm/stream` waterfall；当包装与目标不是同一个 adapter 时，DSH 可能移除提供商私有的 replay 元数据。普通图文历史不会丢失，但依赖私有 replay 签名的提供商可能暂时失去缓存优化或部分保真度，直到 DSH 提供原子委派句柄。

## 隐私

原生多模态路由会把图片发送给当前选中的对话提供商；纯文本回退则把图片（base64，通常为 HTTPS）发送给你配置的视觉端点。除非相应端点是本地服务，否则图片数据都会离开你的机器。除 Harness 自身附件存储外，本插件不额外持久化图片。

## 许可证

MIT

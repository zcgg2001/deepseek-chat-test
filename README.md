# deepseek-chat-demo

简体中文 | [English](README.en.md)

基于 DeepSeek API 的静态聊天示例。无需应用后端，浏览器直接请求配置的 API 服务。

本仓库是 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 的非官方衍生版本，用于界面研究并做了扩展，与 DeepSeek 官方无关。用户界面参照 chat.deepseek.com 逐步重新实现。

点击 [在线体验](https://deepseek.505zc.me/) 即可使用，也可以前往 [Releases](https://github.com/hmjz100/deepseek-chat-demo/releases) 下载压缩包，解压后双击 `index.html` 在本地使用，无需安装或构建。首次使用时，请在设置中填写 API Key。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/hmjz100/deepseek-chat-demo.git
cd deepseek-chat-demo
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表；图表可缩放并导出 PNG / SVG / 源码，图片支持全屏查看。
- 输入框内的模型与推理等级选择器；设置中可添加其他兼容 API 提供商，支持逐个启用，并从 [models.dev](https://models.dev) 获取模型信息。
- 可选的内容安全校验（`safety_check`）；遇到拒答时保留已下发的正文，并附上拒答提示与原因，而不是清空回答。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 数据与存储

API Key 和设置保存在浏览器 localStorage，会话与原始附件保存在 IndexedDB。本地数据按浏览器配置文件与站点源隔离。发送消息、上传附件和使用语音功能会把相应内容发送到配置的 API 服务。

设置 → 账号 → 模型提供商可添加兼容端点。这些 Key 仍保存在 localStorage，输入框会向所选提供商自己的端点发起请求。模型名称、厂商图标与推理能力元数据来自公开的 [models.dev](https://models.dev) 目录；这是应用除配置的 API 服务之外唯一会请求的外部服务。

设置 → 数据中的历史导入导出使用 ZIP 压缩包。确认并校验成功后，导入会替换全部本地会话与附件。导出包含会话和本地可用的原始图片，不包含 API Key、设置与原始非图片附件。归档格式与保留细节见[历史导入导出文档（中文）](src/services/chat/history/README.md)。

设置 → 数据 → 删除全部会话会在确认后清空所有本地会话、原始附件与未发送草稿，停止进行中的回复并回到新对话。API Key 与设置会保留；已上传到 API 服务的文件不会被删除。

## 开发

| 命令          | 说明         |
| ------------- | ------------ |
| `pnpm dev`    | 启动开发服务器 |
| `pnpm build`  | 构建到 `dist/` |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 代码检查 |
| `pnpm format` | oxfmt 格式化 |

[rspack.config.ts](rspack.config.ts) 默认使用 `https://api.deepseek.com`，可通过 `createConfig({ apiOrigin, devServer, repoUrl })` 自定义 API 源、开发服务器代理与仓库入口二维码链接。

会话默认通过 Anthropic 兼容的 Messages / Files API 使用 `deepseek-flash`。语音功能使用 ASR / TTS 端点。请求包含智能搜索、链接阅读、标题生成与 `latest_reminder` 等扩展，配置的服务需支持相应能力；支持的附件格式由服务端校验决定。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等 UI 组件
  i18n/                中英文翻译
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、存储与历史导入导出
    markdown/          Markdown 解析、语法高亮与图表
    speech/            录音与朗读播放
  utils/               通用工具
```

## 许可

[MIT](LICENSE)。构建会把许可文件复制到 `dist/LICENSE`，分发应用时请附带。第三方依赖遵循其各自的许可。

## 致谢
[DeepSeek](https://www.deepseek.com/) - 探索未至之境 - 开源 Chat WebUI  
[LINUX DO](https://linux.do) - 学 AI 上 L 站 - 开源推广
# Agent 开发约束

- 纯静态 Three.js 项目，入口 `index.html`，逻辑在 `js/`（14 个 ES 模块），依赖 `vendor/three.min.js`。
- 外网仓库公开，因此**禁止**提交 `.appwrite-cf`、`appwrite-cf.config.json`、`.static-site-deploy.json` 与 `vendor/appwrite-sdk.js`；这些仅为内网能力。
- `js/cloud.js` 必须以主机名判断云功能可用性：外网不得发起 `/v1` 请求或展示登录按钮。
- 外网发布只允许 `scripts/release.py build` 产生的 `dist/`，不得直接部署整个工作目录。
- 内网部署仍使用完整目录（含 SDK），发布后必须用真实浏览器验证启动、区块渲染和本地存档，不能只看部署命令退出码。
- 内网部署配置与凭证不得出现在公开提交、构建产物或发布清单中。

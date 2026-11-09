# MyFlicker World · 众生世界 v5.3

Three.js 第一人称像素方块世界。本地存档优先，离线可玩。

- 外网页面：https://xiaoxiong20260206.github.io/myflicker-world/
- 内网页面：https://myflicker-world-v4.frontend-cloud.corp.kuaishou.com/
- 本地预览：`python3 -m http.server 8088` 后打开 http://localhost:8088

## 外网与内网差异（有意保留）

内网版本额外加载 `vendor/appwrite-sdk.js`，接入快手内网 Appwrite，提供账号登录、云存档与排行榜。

外网版本不包含该 SDK，也不包含任何账号或云同步能力：`js/cloud.js` 会检测主机名，非 `*.frontend-cloud.corp.kuaishou.com` 时直接关闭云功能，只显示「外网体验版」提示，游戏本体与本地存档不受影响。这样公开站点不会产生无效的 `/v1` 请求或登录入口。

`vendor/appwrite-sdk.js`、`.appwrite-cf`、`appwrite-cf.config.json`、`.static-site-deploy.json` 均被 `.gitignore` 排除，只保留在本地与内网部署环境。

## 发布流程

外网：推送 `main` 后 GitHub Actions 执行 `python3 scripts/release.py build`，只发布 `index.html`、`js/*.js` 和发布清单。

内网：在项目目录执行 `npx -y --registry https://npm.corp.kuaishou.com @codeflicker/frontend-cloud-cli@latest deploy --dir .`（本地自定义目录；该命令会带上 vendor，因此需在本地环境执行）。

发布后校验：

```sh
python3 scripts/release.py build
python3 scripts/release.py verify https://xiaoxiong20260206.github.io/myflicker-world/
```

`release-manifest.json` 记录提交与每个文件的 SHA-256；内外网发布必须使用同一提交。

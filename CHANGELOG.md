# 部署记录

## 2026-11-09 · 外网首发 v5.3

- 仓库：https://github.com/xiaoxiong20260206/myflicker-world （Public）
- 外网：https://xiaoxiong20260206.github.io/myflicker-world/
- 外网只发布 16 个运行资源（index.html、js/ 14 个模块、vendor/three.min.js、清单）。
- `js/cloud.js` 新增主机名判断：非内网域名直接关闭云功能，只显示「外网体验版」提示。
- 公开仓库与站点的 `vendor/appwrite-sdk.js` 已排除；`.appwrite-cf`、`appwrite-cf.config.json`、`.static-site-deploy.json` 均未提交。
- 校验：16 个资源与 manifest 哈希一致；浏览器回归页面挂载正常、无页面错误、无 404、无 `/v1` 请求，`window.gameCloud` 为 undefined。
- 内网站点本次未改动，仍为原 v5.3 内容。

# 01 — 三端可启动骨架

**What to build:** 让代码审阅者从空环境启动数据库、API 和后台，并能把原生小程序导入微信开发者工具；建立后续每个纵向切片都能沿用的构建、测试、品牌壳层和路由契约。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] 建立 pnpm workspace 与 Turborepo，包含原生 TypeScript 小程序、React/Vite 后台、NestJS/Fastify API 和必要共享包。
- [x] Docker Compose 只运行锁定小版本的 PostgreSQL；Node 应用运行在宿主机并支持热更新。
- [x] 本地启动命令等待数据库健康、执行首个 migration，并启动 API 与后台；失败时返回可行动错误而非静默挂起。
- [x] API 提供可验证的健康响应，后台品牌壳层能读取并展示该状态，原生小程序能在开发者工具中成功编译并显示茸光品牌壳层。
- [x] 建立显式 migration、种子和重置命令边界；应用启动不得自动同步 schema。
- [x] 建立统一格式、Lint、类型检查、测试和生产构建命令，并在 GitHub Actions 中运行基础门禁。
- [x] 提交环境配置示例和微信占位配置；真实环境、私有 AppID 配置、AppSecret、数据库数据和上传目录均被忽略。
- [x] 确立“设计稿页面 → 实际路由”登记格式；后台使用真实 URL 路由，小程序使用真实页面路径，不以原型组件内状态充当路由。
- [x] 后续页面壳层能复用 DESIGN_PRD 的色彩、字体、间距和状态语义，同时不直接把两套 Web 原型当作产品代码。
- [x] README 说明两步本地运行边界：先启动数据库/API/后台，再由使用者在微信开发者工具填写自己的测试 AppID。

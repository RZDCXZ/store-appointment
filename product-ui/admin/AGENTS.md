# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## 茸光管理端视觉决定

- 采用 Product Design 方向 1：风险队列优先、今日状态摘要、按员工横向日时间线。
- 与小程序共用奶油色、鼠尾草绿、克制珊瑚色、自然宠物摄影和系统无衬线字体。
- 店长复杂页面以桌面信息密度为准；390px 重点保证登录、员工今日工作与本人预约。
- 预约状态和行动提醒必须使用不同视觉语法，关键状态不只依赖颜色。

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

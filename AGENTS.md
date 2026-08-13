## Agent skills

### Issue Tracker

Issue 使用仓库内 `.scratch/` 下的本地 Markdown 文件管理。详见 `docs/agents/issue-tracker.md`。

### Triage 标签

使用五个默认标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### 领域文档

本仓库采用 single-context 布局。详见 `docs/agents/domain.md`。

### 产品设计稿

实现或修改产品页面时，以 `DESIGN_PRD.md` 的需求和路由语义为准，再读取对应端的设计稿：

- 小程序：`product-ui/mini-program/README.md`；可交互原型见 `product-ui/mini-program/src/Prototype.tsx` 和 `product-ui/mini-program/src/prototype.css`，视觉基线见 `product-ui/mini-program/design-reference/mp-01-option-1.png`。
- 管理端：`product-ui/admin/README.md`；可交互原型见 `product-ui/admin/src/App.jsx` 和 `product-ui/admin/src/styles.css`，视觉基线见 `product-ui/admin/design-reference/mg-01-option-1.png`。

路由边界：两套原型为便于集中演示，将多个逻辑页面放在单个原型组件中。真实实现应先核对现有应用的路由约定，再将每个逻辑页面落到独立路由和页面模块，共享布局与组件单独复用。完成前列出“设计稿页面 → 实际路由”映射，并验证每个页面可直接访问和刷新恢复，而非仅依赖组件内视图状态切换。

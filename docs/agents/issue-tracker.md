# Issue Tracker：本地 Markdown

本仓库的 Issue 和规格文档以 Markdown 文件形式保存在 `.scratch/` 中。

## 约定

- 每个功能使用一个目录：`.scratch/<feature-slug>/`
- 规格文档为 `.scratch/<feature-slug>/spec.md`
- 每张实现工单使用一个独立文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- 工单从 `01` 开始编号，不使用单个合并的工单文件
- Triage 状态记录在 Issue 文件顶部附近的 `Status:` 行中，角色字符串见 `triage-labels.md`
- 评论和讨论记录追加在文件底部的 `## Comments` 标题下

## 当技能要求“发布到 Issue Tracker”时

在 `.scratch/<feature-slug>/` 下创建新文件；目录不存在时一并创建。

## 当技能要求“获取相关工单”时

读取对应路径的文件。用户通常会直接提供文件路径或 Issue 编号。

## Wayfinding 操作

供 `/wayfinder` 使用。每个任务包含一个 Map 文件，并为每张工单建立一个 Child 文件。

- **Map**：`.scratch/<effort>/map.md`，保存 Notes、Decisions-so-far 和 Fog 内容
- **Child 工单**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 开始编号，正文记录待解决问题
- `Type:` 行记录工单类型：`research`、`prototype`、`grilling` 或 `task`
- `Status:` 行记录 `claimed` 或 `resolved`
- **阻塞关系**：在文件顶部附近使用 `Blocked by: NN, NN`；列出的所有工单均为 `resolved` 后，当前工单才解除阻塞
- **Frontier**：扫描 `.scratch/<effort>/issues/`，查找未关闭、未阻塞且未认领的文件，编号最小者优先
- **认领**：开始工作前将 `Status:` 改为 `claimed` 并保存
- **完成**：在 `## Answer` 标题下追加答案，将 `Status:` 改为 `resolved`，然后把上下文摘要和链接追加到 `map.md` 的 Decisions-so-far 中

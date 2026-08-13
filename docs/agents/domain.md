# 领域文档

本文说明工程技能在探索代码库时，应如何读取本仓库的领域文档。

当前仓库采用 single-context 布局。

## 探索前需要读取

- 仓库根目录的 `CONTEXT.md`
- 如果根目录存在 `CONTEXT-MAP.md`，则改为读取该文件，并根据其中的指引读取与当前任务相关的 `CONTEXT.md`
- `docs/adr/` 中与即将处理区域有关的 ADR
- 在 multi-context 仓库中，还需检查 `src/<context>/docs/adr/` 中特定上下文的决策

如果这些文件不存在，应静默继续，不提示缺失，也不预先建议创建。`/domain-modeling` 技能会在术语或决策真正明确时按需创建它们。

## 文件结构

本仓库采用的 single-context 结构：

    /
    ├── CONTEXT.md
    ├── docs/adr/
    │   ├── 0001-event-sourced-orders.md
    │   └── 0002-postgres-for-write-model.md
    └── src/

如仓库以后调整为 multi-context，则在根目录使用 `CONTEXT-MAP.md`：

    /
    ├── CONTEXT-MAP.md
    ├── docs/adr/                         ← 系统级决策
    └── src/
        ├── ordering/
        │   ├── CONTEXT.md
        │   └── docs/adr/                 ← 上下文特定决策
        └── billing/
            ├── CONTEXT.md
            └── docs/adr/

## 使用术语表中的词汇

当输出中出现领域概念，例如 Issue 标题、重构建议、假设或测试名称，应使用 `CONTEXT.md` 定义的术语，不要改用术语表明确排除的同义词。

如果需要使用的概念尚未出现在术语表中，应先判断：

- 是否正在创造项目并未使用的新说法；如果是，应重新考虑
- 是否确实存在领域文档缺口；如果是，应记录并交由 `/domain-modeling` 处理

## 标明与 ADR 的冲突

如果输出与已有 ADR 冲突，应明确指出，不得静默覆盖。例如：

> 与 ADR-0007（事件溯源订单）冲突，但值得重新讨论，因为……

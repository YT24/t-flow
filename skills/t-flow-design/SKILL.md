---
name: t-flow-design
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-design

### Prerequisites
所有命令固定使用 `yt.mjs --change <change-id> <命令>`，沿用入口选定的 change；产物只读写 `docs/t-flow/change/<change-id>/`。
运行 yt.mjs status 确认当前节点为 design，读取已完成产物及目标项目约束。

### Steps
编写 design.md，明确接口、数据流、权限、数据迁移和测试策略。读取目标项目 AGENTS.md 并遵守其中约束。向用户展示技术设计（UI 原型已在 ui 门禁单独确认；若 ui 被 skip，说明无界面影响即可），确认后记录 approve design。小型变更（无架构调整、无数据迁移、无新接口）可不写 design.md：向用户说明理由，运行 yt.mjs skip design <原因> 记录后本节点直接完成。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。通过后运行 yt.mjs advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

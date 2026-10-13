---
name: t-flow-specify
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-specify

### Prerequisites
所有命令固定使用 `yt.mjs --change <change-id> <命令>`，沿用入口选定的 change；产物只读写 `docs/t-flow/change/<change-id>/`。
运行 yt.mjs status 确认当前节点为 specify，读取已完成产物及目标项目约束。

### Steps
从澄清纪要编写 prd.md，给每项需求稳定编号和验收标准；spec-delta.md 写 ADDED/MODIFIED/REMOVED 行为与场景；adr.md 仅记录有取舍的重要决定，无额外决定写明。不能把设计实现细节当作业务需求。本节点是用户确认门禁：check 通过后必须 stop，向用户展示 PRD 范围、需求编号与 spec-delta 变更，等待明确确认后用 yt.mjs approve specify <用户确认原文> 记录，未确认不得 advance。需求编号须与 verify 阶段 test-results.json 的用例 id 对应，保证可追溯。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。check 通过后必须 stop：向用户展示 PRD 与范围，用 yt.mjs approve specify <用户确认原文> 记录确认后才允许 advance。确认后 advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

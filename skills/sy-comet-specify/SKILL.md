---
name: sy-comet-specify
description: 仅由 sy-comet 入口路由到本阶段时使用。
---

# sy-comet-specify

### Prerequisites
运行 yt.mjs status 确认当前节点为 specify，读取已完成产物及目标项目约束。

### Steps
从澄清纪要编写 prd.md，给每项需求稳定编号和验收标准；spec-delta.md 写 ADDED/MODIFIED/REMOVED 行为与场景；adr.md 仅记录有取舍的重要决定，无额外决定写明。不能把设计实现细节当作业务需求。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。通过后运行 yt.mjs advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

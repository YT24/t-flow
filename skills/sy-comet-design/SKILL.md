---
name: sy-comet-design
description: 仅由 sy-comet 入口路由到本阶段时使用。
---

# sy-comet-design

### Prerequisites
运行 yt.mjs status 确认当前节点为 design，读取已完成产物及目标项目约束。

### Steps
编写 design.md，明确接口、数据流、权限、数据迁移和测试策略。读取目标项目 AGENTS.md；本项目遵守 gateway 入口、backend 辖区校验、LLM 只 prepare、独立确认及 Liquibase。向用户一起展示 UI 和技术设计，确认后记录 approve design。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。通过后运行 yt.mjs advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

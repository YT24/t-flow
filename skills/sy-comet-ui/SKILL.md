---
name: sy-comet-ui
description: 仅由 sy-comet 入口路由到本阶段时使用。
---

# sy-comet-ui

### Prerequisites
运行 yt.mjs status 确认当前节点为 ui，读取已完成产物及目标项目约束。

### Steps
有界面需求时加载 frontend-design，复用已确认角色/权限/流程，生成原型与交互检查记录。不要自动新增全套 CRUD；只实现本次 PRD 范围。将原型路径、空/加载/错误/无权限/正常状态、浏览器实测或未测原因写入 ui.md。没有界面需求时不写 ui.md：向用户说明理由，运行 yt.mjs skip ui <原因> 记录后本节点直接完成。工具不具备时不可假装已实测。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。check 通过后必须 stop：向用户展示原型，等待用户明确确认没有问题，用 yt.mjs approve ui <用户确认原文> 记录后才允许 advance；未收到确认不得进入下一阶段。以 skip 完成的节点无产物、无需确认，status 应已进入 design。确认后 advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

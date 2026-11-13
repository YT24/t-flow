---
name: t-flow-specify
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-specify

遵循入口已加载的 runtime-contract；命令固定 --change <id>。断点不明时 context。

PRD 使用 REQ-NN 与完整 AC-NN-N，描述前置条件、操作和可观察结果。只把用户可观察且需要独立验收的结果定义为 AC，内部边界与组合纳入共享测试。

完整模式写 prd.md 与 spec-delta.md（ADDED/MODIFIED/REMOVED）；轻量模式只写简短 prd.md，合并范围、约束与 AC。不得降低真实接口、数据库或页面验收。

只生成本阶段产物，不提前生成 ADR、UI 或 design。完成后 check，展示 PRD 并停止等待用户确认。收到真实确认后 approve specify <用户原文>，再 advance。ADR 在下一独立节点编写并确认。

---
name: t-flow-adr
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-adr

遵循入口已加载的 runtime-contract；命令固定 --change <id>。

仅在 PRD 已确认后编写 adr.md，记录关键决策、取舍与约束；无架构决策时简短说明即可。不得提前生成 UI 或 design。

完成后 check，展示 ADR 并停止等待用户确认。收到真实确认后 approve adr <用户原文>，再 advance。修改需求范围时回退对应阶段并重新确认。

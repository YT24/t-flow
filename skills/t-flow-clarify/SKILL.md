---
name: t-flow-clarify
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-clarify

遵循入口已加载的 runtime-contract；命令固定 --change <id>。断点不明时 context。

范围明确时记录目标、范围、不做事项、角色、关键决定和验收边界到 clarify-log.md；有业务疑问才调用 grill-me/grilling。

只生成本阶段澄清纪要，不提前生成 PRD、ADR 或 design。完成后 check，展示纪要并停止等待用户确认。收到真实确认后 approve clarify <用户原文>，再 advance。不得把“继续”当作尚未展示产物的批准。

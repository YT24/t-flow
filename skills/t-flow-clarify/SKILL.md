---
name: t-flow-clarify
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-clarify

遵循入口已加载的 runtime-contract；命令固定 --change <id>。断点不明时 context，已知阶段不重复查状态。

范围已明确时不进行额外车轮式提问，直接记录目标、范围、不做事项、角色、关键决定和验收边界。存在会改变这些内容的疑问才调用 grill-me/grilling，问题按决策依赖提问；可逆实现细节留给执行。

范围清楚后默认合并需求确认：按 specify 规则准备 PRD/ADR/spec-delta，一次展示纪要与需求，取得确认后 approve scope，再依次 advance clarify 与 specify。用户要求分步时，单独 approve clarify 后 advance。不得把“继续”当作尚未展示产物的批准。

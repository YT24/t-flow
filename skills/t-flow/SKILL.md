---
name: t-flow
description: 用户调用 /t-flow 或要求继续相关未归档变更时使用；只问状态转 t-flow-status。
---

# t-flow

首次读取 reference/runtime-contract.md；同会话已读未变不重复。所有命令固定 `--change <id>`。

1. 明确继续目标时直接 context；目标不明才 changes。新任务使用独立 change，不覆盖已有文件。只问状态使用 t-flow-status，不推进。
2. 新任务先按风险选择模式：局部修复、文案、样式、小型逻辑且无新功能/权限/接口契约/数据结构变化，用 `init <id> --lite <理由>`；其他用 init <id>。告知选择与理由；不为常规模式选择额外停顿。
3. 按 NEXT 加载一个阶段 Skill。context 提供当前任务和最小读取路径；无需重复 status/handoff/全量文档。成功验证只读摘要。
4. 完整模式严格逐阶段生成：澄清 → PRD → ADR → UI → Design。每份完成后展示并停止等待用户确认，再 approve 当前节点并 advance；禁止合并确认或提前一次生成后续文档。
5. 轻量模式只有需求和交付两次确认；完整模式 UI/技术设计仍按协议验收；skip design 仅提出请求，用户确认后 approve skip-design 才可跳过。UI 默认主 Skill，沿用用户指定；选择工具不新增停顿，原型确认保留。
6. 范围升级用 promote；产物漂移按最早阶段 reopen。异常时才加载 recovery.md；验证首次读取 verification.md；仅需真实浏览器时读取 e2e.md。

确认使用宿主问答工具，不能使用时文字确认。已确认且输入未变不重复问；只记录实际用户原文。用户明确授权或指定流程优先。按阶段完成产物后直接 advance（内置校验），展示待确认产物或排障时才单独 check。归档用 archive，不自动发布。

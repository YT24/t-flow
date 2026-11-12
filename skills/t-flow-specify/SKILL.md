---
name: t-flow-specify
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-specify

遵循入口已加载的 runtime-contract；命令固定 --change <id>。断点不明时 context，已知阶段不重复查状态。

PRD 使用 REQ-NN 与完整 AC-NN-N，描述前置条件、操作、可观察结果及最低有效验证方式。只把用户可观察、需要独立交付门禁的结果定义为 AC；内部边界、异常和组合纳入共享自动化测试集，不默认逐组合创建 AC。

完整模式另写 spec-delta（ADDED/MODIFIED/REMOVED）和必要 ADR；轻量模式只写简短 prd.md，合并范围、约束与 AC，不生成其他文件。不得按现有测试能力降低真实接口、数据库或页面验收。

展示后记录 approve specify 再 advance；若 approve scope 已绑定且有效，直接 advance，不重复确认。

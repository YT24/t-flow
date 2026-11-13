---
name: t-flow-plan
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-plan

遵循入口已加载的 runtime-contract；命令固定 --change <id>。断点不明时 context，已知阶段不重复查状态。

编写短 plan.md 和 plan/tasks.json。plan.md 建立影响范围映射：模块 → 完整 AC → 最小验证命令；列出可共享套件及源码、测试文件、依赖清单和配置输入。局部文案、模板、样式变更不得触发全量测试。

任务字段 id/title/dependsOn/modules/acceptance/status；acceptance 使用完整 AC 编号，status 初始 pending。共享/公共模块改动前置为独立任务，后续任务通过 dependsOn 等待，公共改动未完成前不启动依赖任务登记；执行中后期确需再改公共模块时只重跑受影响套件，不重复执行无关测试。modules 是精确项目路径，允许规划尚未创建的文件，执行时须存在；不要为通过计划检查提前建占位文件。目录用于确需覆盖新增/删除的范围，避免扩大测试范围。单任务聚焦内聚能力，约 10–30 分钟；相关 AC 共享套件，不为粒度拆分重复测试。

任务状态只保存在 tasks.json；轻量模式同样保留可恢复任务和验证映射，但不扩写无关文档。进入 execute 前逐项确认 AC 映射、验证命令、公共前置任务和依赖顺序均已稳定；执行中仍需改计划时，只 reopen 最早受影响阶段并处理关联任务，不做无关全文修订。直接 advance，失败按提示修正。

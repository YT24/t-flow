---
name: t-flow-archive
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-archive

遵循入口已加载的 runtime-contract；命令固定 --change <id>。断点不明时 context，已知阶段不重复查状态。

逐 AC 核对结果与用户验收目标，写简短 archive-report.md。轻量模式不生成 spec-delta 或 spec-sync；若已涉及正式契约变化，先 promote，不能借轻量模式跳过同步。

完整模式将 spec-delta 合并到正式 Spec，保留未修改行为，生成 archive/spec-sync.json（源/目标 SHA256、reviewed:true）。未采用正式 Spec 需项目明确决定，不为单次归档关闭检查。

展示验收结论、未测项和残余问题，取得实际确认后 approve archive，再 archive。不先重复执行同一套验证，不自动提交、部署或合并。归档中断重试同一 archive，冲突再按 recovery.md 排查。

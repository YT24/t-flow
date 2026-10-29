---
name: t-flow-archive
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-archive

### Prerequisites
所有命令固定使用 `yt.mjs --change <change-id> <命令>`，沿用入口选定的 change；产物只读写 `docs/t-flow/change/<change-id>/`。
运行 yt.mjs status 确认当前节点为 archive，读取已完成产物及目标项目约束。

### Steps
先逐 AC 核对测试结果、证据层级与用户验收目标；未测必测项不能用“部署后走查”替代完成，也不能宣称全部验收通过。将 spec-delta.md 的变更语义合并到正式 Spec（目标目录前缀见 reference/workflow-protocol.json 的 config.specTargetPrefix，默认 openspec/specs/）对应能力，保留未修改行为，不能直接覆盖整份正式规范。生成 spec-sync.json（源/目标路径及 SHA256、reviewed:true）并填写 archive-report.md。项目尚无 Spec 目录时优先建立首个能力规范；若用户明确决定整个项目不采用正式 Spec，才在 protocol config 置 specSyncRequired:false 并运行 yt.mjs migrate，记录决定和原因。不能为某次归档绕过检查而关闭全项目同步。展示逐 AC 测试结果、已知问题和 Spec 合并摘要，用确认卡片请用户点选确认后，把点选文字作为确认原文 approve archive，再 archive。报告存在仅代表产物已准备，状态与用户确认决定是否真正归档；归档不等于上线，禁止自动部署或合并代码。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。通过后运行 yt.mjs archive，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

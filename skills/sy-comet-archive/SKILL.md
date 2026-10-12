---
name: sy-comet-archive
description: 仅由 sy-comet 入口路由到本阶段时使用。
---

# sy-comet-archive

### Prerequisites
运行 yt.mjs status 确认当前节点为 archive，读取已完成产物及目标项目约束。

### Steps
先核对测试报告与用户验收目标；将 spec-delta.md 的变更语义合并到正式 Spec（目标目录前缀见 reference/workflow-protocol.json 的 config.specTargetPrefix，默认 openspec/specs/）对应能力，保留未修改行为，不能直接覆盖整份正式规范。生成 spec-sync.json（源/目标路径及 SHA256、reviewed:true）并填写 archive-report.md。项目无正式 Spec 时：在 protocol config 置 specSyncRequired:false 并运行 yt.mjs migrate 使协议变更生效，archive-report.md 中说明原因。展示测试结果、已知问题和 Spec 合并摘要，用户确认后 approve archive，再 archive。归档不等于上线，禁止自动部署或合并代码。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。通过后运行 yt.mjs archive，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

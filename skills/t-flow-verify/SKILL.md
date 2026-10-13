---
name: t-flow-verify
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-verify

### Prerequisites
运行 yt.mjs status 确认当前节点为 verify，读取已完成产物及目标项目约束。

### Steps
按变更影响范围执行集成及必要回归。测试必须通过 yt.mjs run <用例id> [--input <路径>] [--expect <正则>] [--min-output <字符数>] -- <命令> 真实执行生成 evidence，禁止手写。**用例 id 必须包含 prd.md 里对应的需求编号**（默认 REQ-NN，如 REQ-01-登录成功）：脚本强制校验每个需求编号都有 required:true 且 passed 的用例覆盖，缺项直接阻断，这就是需求→测试的可追溯性。强烈建议用 --expect 断言测试输出中的成功标志（如 "3 passed"/"0 failed"）——只靠退出码时脚本会告警，因为 run 无法判断命令语义。仅最新执行通过且证据输入未变化可复用，历史通过记录不能抵消最新失败，发生相关代码/配置/环境变化重新验证。产出 test-report.md 和 test-results.json，列明环境、版本、需求覆盖、成功/失败/未执行。每个 passed 用 evidence 指向 run 生成的真实命令、日志、输入文件 hash。**用例证据必须由 verify 阶段自己 run <用例id> 生成**：不得复制其他用例的文件、也不得引用 execute 阶段的任务证据（脚本会核对证据路径 id 与内容 id 一致、要求存在对应的 attempts/<id>/<runId>.json 执行记录，并拒绝跨阶段复用）。任何 failed 项与必测 not_run 项阻断验收（可选 not_run 允许归档，须在报告中说明，但不能用于满足任何交付需求的覆盖要求）；修复需 reopen execute，重开受影响任务，不调用 verification-before-completion。验证-修复循环最多 3 次（以 reopen 时 test-results.json 存在 failed 结果计），超过后脚本拒绝 reopen：向用户展示失败历史并等待方向选择（继续修复/调整需求/停止），用户决策后用 yt.mjs decide <用户决策原文> 解除。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。通过后运行 yt.mjs advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

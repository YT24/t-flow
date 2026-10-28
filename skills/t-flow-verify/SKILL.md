---
name: t-flow-verify
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-verify

### Prerequisites
所有命令固定使用 `yt.mjs --change <change-id> <命令>`，沿用入口选定的 change；产物只读写 `docs/t-flow/change/<change-id>/`。
运行 yt.mjs status 确认当前节点为 verify，读取已完成产物及目标项目约束。

### Steps
按变更影响范围选择最低有效验证层级并执行必要回归。后端纯逻辑以单元测试为主，持久化以最终数据、约束、事务或审计结果正确为主；前端默认使用构建/静态检查、少量共享组件测试、至多 1 条核心链路 E2E 与必要人工冒烟，无界面变更不要求 E2E。同一行为只在一个最合适的层级验证，不在浏览器中重复后端已覆盖的角色、对象、规则全组合；已确认 AC 明确声明真实权限、数据或界面行为时仍须有效验证。测试必须通过 yt.mjs run <用例id> [--input <路径>] [--expect <正则>] [--min-output <字符数>] -- <命令> 真实执行生成 evidence，禁止手写。**用例 id 必须包含 prd.md 里对应的需求编号**（默认 REQ-NN，如 REQ-01-登录成功）：脚本强制校验每个需求编号都有 required:true 且 passed 的用例覆盖，缺项直接阻断，这就是需求→测试的可追溯性。强烈建议用 --expect 断言测试输出中的成功标志（如 "3 passed"/"0 failed"）——只靠退出码时脚本会告警，因为 run 无法判断命令语义。仅最新执行通过且证据输入未变化可复用，历史通过记录不能抵消最新失败，发生相关代码/配置/环境变化重新验证。产出 test-report.md 和 test-results.json，列明环境、版本、需求覆盖、成功/失败/未执行。每个 passed 用 evidence 指向 run 生成的真实命令、日志、输入文件 hash。**用例证据必须由 verify 阶段自己 run <用例id> 生成**：不得复制其他用例的文件、也不得引用 execute 阶段的任务证据（脚本会核对证据路径 id 与内容 id 一致、要求存在对应的 attempts/<id>/<runId>.json 执行记录，并拒绝跨阶段复用）。任何 failed 项与必测 not_run 项阻断验收（可选 not_run 允许归档，须在报告中说明，但不能用于满足任何交付需求的覆盖要求）；修复需 reopen execute，重开受影响任务，不调用 verification-before-completion。验证-修复循环最多 3 次（以 reopen 时 test-results.json 存在 failed 结果计），超过后脚本拒绝 reopen：向用户展示失败历史并等待方向选择（继续修复/调整需求/停止），用户决策后用 yt.mjs decide <用户决策原文> 解除。

### Completion reasoning
**验收项是推进依据。** PRD 存在 `AC-NN-N` 时，test-results.json 的每个用例用 `acceptance` 数组逐条声明对应 AC，并记录 `method`（static/unit/integration/e2e/manual/build）；一个真实用例可覆盖多条相关 AC，不为每条 AC 重复执行相同套件。所有 AC 必须有 required:true 且 passed 的用例。REQ 全覆盖、构建成功、原型截图或 mock 单测不能代替尚未执行的真实行为验收。人工项未执行时写 not_run；环境不足仍是未测，不能自动转为可选或宣称全部通过。改变验收范围/方式先 reopen 对应阶段、更新 PRD 并重新确认。

执行命令保留完整输出和真实退出码。run 对 Bash 启用 errexit/pipefail 并传递给嵌套 Bash；其他解释器需自行保证失败传播。`--expect` 可重复，每次是一个必须满足的条件；不能把 `A|B|C` 当作三项全部通过。用 `--reject <正则>` 排除明确失败输出（如 BUILD FAILURE）；grep 数量后必须断言数值，不能仅打印统计或 echo OK。预期失败场景使用测试框架断言或 if 分支处理，不靠隐藏失败制造成功退出。

报告逐 AC 列实际断言、测试对象/版本、方法、runId 和证据。手工操作记录及截图保存在本 change；必要时用 run 校验持久记录并绑定对应实现文件，明确这仅证明记录存在，人工行为真实性仍需评审。测试数量以工具原始报告为准，不手工补总数。存在未测必测 AC 时结论为“部分验证完成，仍需补测”。

逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。通过后运行 yt.mjs advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

# 归档报告：精简验证工作流

## 交付与验收

- change-id：`lean-verification-workflow`。
- 交付范围：更新需求、设计、验证 Skill，测试模板、运行契约摘要、README 和静态回归测试；运行器协议与脚本未修改。
- 需求与设计差异：无。UI 与独立技术设计按已确认的无界面、文档型小变更跳过。

| AC | 最终结论 | 验证摘要 |
|---|---|---|
| AC-01-1 | passed | 静态套件验证 AC 粒度与共享测试集指导 |
| AC-02-1 | passed | 静态套件验证后端/前端默认精简策略 |
| AC-03-1 | passed | 静态套件验证最低有效层级与去重规则 |
| AC-04-1 | passed | 静态套件验证多 AC 映射及逐条追溯 |
| AC-05-1 | passed | 完整 Node 回归 81 项通过、0 失败 |

详细结果见 `test-results.json` 与 `test-report.md`。未测或失败必测项：无。

## Spec 合并

- 源：`docs/t-flow/change/lean-verification-workflow/spec-delta.md`。
- 目标：`openspec/specs/verification/spec.md`。
- 项目此前无正式 Spec，本次建立验证与验收能力规范，合并默认精简策略、多 AC 共享覆盖和既有门禁/证据保留行为。
- 同步记录：`spec-sync.json`，包含源与目标 SHA256，`reviewed:true`。

## 已知问题与后续任务

- 本次只修改指导和测试组织方式；运行器仍不能自动判断测试语义是否充分或是否重复，需要执行 agent 遵循并由用户确认验收范围。
- 无新增业务运行时风险、数据库迁移或回滚事项。
- 无后续必做任务。

## 交付证据

- 实现：`skills/t-flow-specify/SKILL.md`、`skills/t-flow-design/SKILL.md`、`skills/t-flow-verify/SKILL.md`。
- 模板与说明：`skills/t-flow/templates/`、`skills/t-flow/reference/runtime-contract.md`、`README.md`。
- 回归：`tests/workflow.test.mjs`。
- 验证证据：`evidence/REQ-01-REQ-02-REQ-03-REQ-04-lean-guidance.json`、`evidence/REQ-05-regression.json` 及 `logs/` 中对应日志。
- 无原型、截图或迁移记录。用户归档确认须由 `approve archive` 写入状态，本报告不代表已经归档。

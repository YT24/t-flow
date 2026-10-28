# 验证报告：精简验证工作流

## 测试对象、版本与环境

- change-id：`lean-verification-workflow`
- 基线：`28dfc39`，验证对象为当前工作树中的指导、模板、README 与回归测试。
- 运行时：Node.js `v26.5.0`；无需浏览器、数据库、外部服务或业务角色。
- 验证证据均由 verify 阶段 `yt.mjs run` 真实执行生成，绑定相关实现文档、模板和测试文件 hash。

## 逐条验收结果

| REQ | AC | 用例 ID | 验证方式 | 实际断言 | 状态 | evidence / runId |
|---|---|---|---|---|---|---|
| 01 | AC-01-1 | REQ-01-REQ-02-REQ-03-REQ-04-lean-guidance | static | 指定/设计/模板包含 AC 粒度控制与共享测试集规则 | passed | evidence/REQ-01-REQ-02-REQ-03-REQ-04-lean-guidance.json / 0adbf1da-455c-4730-a294-aa68f15e6fe5 |
| 02 | AC-02-1 | REQ-01-REQ-02-REQ-03-REQ-04-lean-guidance | static | 后端、前端默认精简层级和无界面不要求 E2E 均已声明 | passed | 同上 / 0adbf1da-455c-4730-a294-aa68f15e6fe5 |
| 03 | AC-03-1 | REQ-01-REQ-02-REQ-03-REQ-04-lean-guidance | static | 最低有效层级、禁止浏览器全组合重复及共享多 AC 规则均已声明 | passed | 同上 / 0adbf1da-455c-4730-a294-aa68f15e6fe5 |
| 04 | AC-04-1 | REQ-01-REQ-02-REQ-03-REQ-04-lean-guidance | static | 模板和 README 保留多 AC 映射、逐 AC 状态及未测阻断说明 | passed | 同上 / 0adbf1da-455c-4730-a294-aa68f15e6fe5 |
| 05 | AC-05-1 | REQ-05-regression | build | 完整 Node 回归 81 项通过、0 失败，覆盖状态机、门禁、证据和兼容行为 | passed | evidence/REQ-05-regression.json / 39330fb2-8875-45b6-847b-b79b2e3c7004 |

## 执行与原始证据

- 静态套件：`node --test --test-name-pattern "lean verification guidance" tests/workflow.test.mjs`，退出码 0，`pass 1`、`fail 0`；一次执行覆盖 AC-01-1 至 AC-04-1。
- 完整回归：`node --test tests/workflow.test.mjs`，退出码 0，原始统计 `tests 81`、`pass 81`、`fail 0`。
- 执行阶段曾因静态断言措辞不匹配和 Node 输出格式由 `#` 变为 `ℹ` 产生失败记录；修正断言后已重跑。当前 verify 两项证据均为本阶段最新通过结果，无复用 execute 证据。

## 失败和未测项

无当前失败或未测必测 AC。本变更无手工、数据库、真实页面或负向业务权限验收项。

## 结论

REQ 覆盖：5/5。

AC 已通过/总数：5/5。

失败/未测必测项：0/0。

验收通过。

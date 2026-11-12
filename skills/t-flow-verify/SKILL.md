---
name: t-flow-verify
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-verify

遵循入口已加载的 runtime-contract；命令固定 --change <id>。断点不明时 context，已知阶段不重复查状态。

首次读取 ../t-flow/reference/verification.md；默认只运行 plan 映射的受影响测试，不默认全量测试。确需全量按公共规则并在报告中写明原因。

先 context 检查有效证据，核实环境与覆盖后 reuse execute 或 verify 套件；一个真实用例可覆盖多条相关 AC，也可多个场景引用同一次执行。不在浏览器中重复后端已覆盖的组合。集成环境先用普通 Shell 预检，稳定后集中登记相关 REQ；失败修复在普通 Shell 调试，不用 run 反复试环境。

写 test-report.md 与 verify/test-results.json：逐 AC 状态、方法、真实断言、对象/版本、证据和复用依据。必测未执行写 not_run，不得降为可选。手工结果按实际观察记录，不能伪造命令。报告按套件汇总，不抄成功日志。

不主动新增 E2E；只有用户要求或 AC 必须真实浏览器操作时加载 ../t-flow/reference/e2e.md。失败回退 execute 并只重跑受影响套件；通过直接 advance。

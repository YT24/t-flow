---
name: t-flow-verify
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-verify

遵循入口已加载的 runtime-contract；命令固定 --change <id>。断点不明时 context。

首次读取 reference/verification.md。按已确认 AC 真实验证，仅运行受影响套件；同一真实测试可覆盖多条相关 AC，环境和输入未变不重复执行。

写 test-report.md 和 verify/test-results.json，只保留逐条 AC 的实际结果与结论；失败和未测项简短说明原因。JSON 保留 id、required、status、acceptance，不要求方法、命令、断言、版本、evidence、runId 或 reuse。不生成或引用日志与证据文件，手工结果按实际观察填写，必测未执行写 not_run。

每个必测通过用例须匹配最新有效 run 结果（同 id 或覆盖其全部 AC），不能只靠报告写 passed；代码、测试或配置变化必须重测。全部必测 AC 通过后 advance；失败修复只重跑失败和受影响套件，不得编造通过结果。

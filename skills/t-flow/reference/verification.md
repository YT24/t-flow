# 验证与复用（execute/verify 首次需要时读取，同会话不重复）

默认精简验证：按 plan 的影响范围映射，只运行相关测试和直接依赖回归；同一行为使用最低有效层级，不在浏览器中重复后端已覆盖的组合。全量仅限核心状态机/权限、迁移、构建依赖、用户明确要求或无法确定影响范围，并在报告中写明原因。相同输入与环境的构建只执行一次。

## 执行

`run <id> --input <相关测试或配置> --expect <成功断言> --reject <失败断言> -- <命令>` 生成真实日志与证据。execute 的 id 须为任务 id，自动绑定该任务 modules；verify 用 --input 声明套件涉及的源码、测试脚本、依赖清单与配置。不要只绑定实现而遗漏测试本身。目录适用于需检测新增/删除文件的范围，避免绑定整个仓库；递归输入默认排除 .git、node_modules、target、build、dist、out、coverage、.next、.nuxt、__pycache__ 和 .playwright-cli，构建产物变化不触发证据过期。

有效证据默认不重复执行：最新结果为 passed，且命令、断言、输入、目录和语义签名均一致时，run 返回 EVIDENCE_VALID，不产生新 attempts；确需主动复验加 --force。失败、过期、范围变化或完整性异常仍真实执行。

证据的语义绑定：存在完整 AC 时，新证据用 semantic 记录关联 AC 及上游文档相关段落 hash，不再因无关段落或纯排版修订而级联过期；关联 AC 的操作、预期结果或验证方式变化仍会失效。无法可靠定位关联段落时回退全文绑定，旧证据没有 semantic 时继续按原 inputs 校验，不能为提速错误复用。

**调试与登记分离**：编码、环境修复和断言调试在普通 Shell 中完成，输出按需降噪或落盘后检索；稳定通过后再用 run 登记一次。禁止把 run 当作反复试代码、试环境的调试器。run 登记仍必须真实执行并绑定最新输入，不能省略；登记失败时回到普通 Shell 修复，不连续刷失败证据。

集成用例先用普通 Shell 预检网关、服务和测试数据；环境在线稳定后集中连续登记相关 REQ。环境不稳定先修复，无法执行则写 not_run，不靠反复 run 碰运气。

凭证不得落盘：check/advance/archive 会扫描必需产物，run 在执行前拒绝命令中的疑似凭证；输出命中私钥、凭证赋值或 Bearer 时证据记为 failed，原始敏感输出不写入日志。命中只显示文件与规则名，不回显内容。发现已落盘或已提交凭证时先撤销/轮换，再脱敏当前及归档文档并记录原因；Git 历史清理和 force push 必须另行授权。

各套件只绑定相关 UI 实现；verify/archive 检查所有 required/passed 证据的输入并集合计覆盖 ui-scope.files/affected，缺失则仅补测相关套件。原型与评审截图仍作为确认契约绑定，修改须重新确认。新建界面的实现路径可在 UI 阶段尚不存在，verify 时必须存在且有覆盖。

run 默认输出 SUMMARY：真实退出码、signal、耗时、包装器断言统计、失败正则和日志路径。**包装器断言数不是测试用例数**；用例数量从测试框架的结构化报告或原始统计摘要提取，不由退出码猜测。成功只看摘要，不展开成功日志。失败按失败正则定位日志片段；截图只在失败定位或人工评审时打开。

Bash 自动启用 errexit/pipefail 并让嵌套 Bash 继承；其他解释器由调用方保证失败传播。重复 --expect 表示全部满足，A|B 只是任选。禁止用 echo OK 或只打印计数充当测试断言。固定 evidence/<id>.json 是最新结果，失败不能用历史通过抵消。输入、目录清单、日志与独立 attempts 都会核对。

## 套件复用

同一次 execute **或 verify** 套件可被多个用例引用：

```json
{"id":"REQ-01-login","required":true,"status":"passed","method":"integration","acceptance":["AC-01-1"],"evidence":"docs/t-flow/change/<id>/evidence/<suite>.json","reuse":{"runId":"原始 runId","command":"原始完整 command","environmentUnchanged":true,"reason":"覆盖、配置与环境未变化的具体核对依据"}}
```

一个真实用例可覆盖多条相关 AC，也可多个用例共享同一证据；不得把套件通过泛化成未执行的场景。复用前用 context 查看有效证据，再核对 AC 覆盖和外部环境。输入、命令、配置、服务或数据变化，或无法确认环境时重新执行。报告写明复用来源，不描述成重新执行。

## 验收

所有 REQ 都须有通过的必测用例（id 包含 REQ 编号）。PRD 有 AC 时，acceptance 逐条覆盖所有 AC，method 为 static/unit/integration/e2e/manual/build。任何 failed 或必测 not_run 阻断；可选未测不能满足覆盖。not_run 不得视为通过。改变已确认验收范围或方式必须回退并重新确认。

手工验证按实际观察记录；必要时 run 校验持久记录并绑定实现，明确其只能证明记录存在。冒烟默认可选，实际执行时记录环境、步骤、预期/实际结果及证据。确需真实浏览器时才读取 reference/e2e.md；不主动新增 E2E。

失败后 reopen execute，修复并只重跑失败及受影响套件。超过三次验证修复回退时展示失败历史，由用户决定后 decide。异常恢复才读取 recovery.md。

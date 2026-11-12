# t-flow

可恢复研发工作流，默认按影响范围验证、共享套件、最小上下文读取。

```text
完整：clarify → specify → ui → design → plan → execute → verify → archive
轻量：          specify →               plan → execute → verify → archive
```

完整模式用于新功能、权限/接口契约、架构或数据迁移。轻量模式用于不改变这些契约的局部修复、文案、样式和小型逻辑调整；保留需求与交付两次确认、任务状态和真实验证证据。范围扩大用 promote 升级，不能借轻量模式跳过已确认验收。

## 安装

需要 Node.js 18+；UI 检索需要 Python 3（无第三方依赖，缺 Python 时可人工检索 CSV）。

```sh
node install.mjs --project /path/to/project            # 预览
node install.mjs --project /path/to/project --apply    # 安装
node install.mjs --global --apply                     # 全局安装
node install.mjs --project /path/to/project --update --apply
```

实体安装到 `.agents/skills/`，并为所有分发 Skill 在 `.claude/skills/` 建符号链接；`--no-link-claude` 可关闭。全局安装使用对应用户目录。目标由参数决定，不自动猜测。

`.t-flow-manifest.json` 保存安装文件 hash。更新覆盖未修改旧文件、移除未修改的废弃文件；本地修改保留并报告冲突，不写入新清单。确认要覆盖本地修改时才使用 `--force`。协议更新后对进行中变更执行 migrate，产物变化会回退到最早受影响节点。

## 使用

向 agent 说 `/t-flow <需求>`；继续已有任务时指定 change，或在目标明确时说“继续”。下例以源码仓库运行，安装后将脚本路径替换为 `.agents/skills/t-flow/scripts/yt.mjs`。

```sh
node skills/t-flow/scripts/yt.mjs init add-rbac
node skills/t-flow/scripts/yt.mjs init fix-label --lite '局部文案，无权限/接口/数据结构变化'
node skills/t-flow/scripts/yt.mjs --change fix-label context
node skills/t-flow/scripts/yt.mjs --change fix-label promote '需求新增权限规则'
node skills/t-flow/scripts/yt.mjs status --all
node skills/t-flow/scripts/yt.mjs help
```

多会话每条命令固定 `--change <id>`；active 只是默认选择。change 的状态、产物、日志互相隔离，业务代码共享，修改同一文件仍需协调。`use`/`resume` 改写默认选择；`status`/`context`/`changes` 只读。

## 更少等待与文档

- 轻量模式只需 `prd.md`、`plan.md`、`plan/tasks.json`、`test-report.md`、`verify/test-results.json`、`archive-report.md` 与证据。PRD 合并范围、约束和 AC；不生成澄清纪要、ADR、原型、技术设计、Spec 增量与同步文件。
- 完整模式范围清晰时，一次准备澄清纪要与 PRD/ADR/spec-delta，向用户展示后 `approve scope <用户原文>` 同时绑定 clarify/specify，再依次 advance；范围仍有疑问先澄清。
- UI 默认 `ui-ux-pro-max`，沿用用户偏好，不再单独询问工具选择；`ui-use` 记录实际工具，原型仍须确认。不可用时 ensure-skills 补齐，兜底 frontend-design 并说明原因。两者随包分发。
- 无界面需求可 skip ui；无架构/迁移/新接口的小型变更可 skip design，记录原因。确认只记录真实用户原文，产物变动使确认失效。
- `context [任务id]` 一次返回当前任务、相关 AC 行号、建议读取路径、有效/失效证据及下一步。成功日志不展开，异常时才 doctor，审计才 status --json。长任务按节点切新会话，直接说“继续”并用 context 恢复，不携带长调试历史。
- 公共规则集中在 runtime-contract.md；验证规则在 verification.md；仅需 E2E 或异常恢复时加载相应参考文档。同会话未变文件不重复读取。必需产物和运行日志有凭证扫描，命中只显示规则名；已落盘凭证先轮换再脱敏，Git 历史清理不自动执行。
- advance 自带校验；非确认节点无需无变化地先 check 再 advance。check 用于展示待确认产物或诊断。

## 精简验证与套件复用

默认采用最低有效验证层级：后端纯逻辑以单元测试为主，持久化验证最终数据/约束/事务，前端用构建、组件测试及按需人工冒烟。plan 建立模块 → AC → 最小验证命令映射，只运行受影响测试和直接依赖回归。全量仅限核心状态机/权限、迁移、构建依赖、用户明确要求或影响面无法可靠确定，并说明理由。编码、环境和断言调试在普通 Shell 中完成，稳定后 `run` 登记一次；公共模块改动前置为独立任务，后续任务依赖它，避免证据级联过期。最新通过证据在命令、断言、输入和语义签名一致时返回 `EVIDENCE_VALID`，主动复验用 `--force`。新证据按关联 AC 与上游相关段落计算 `semantic`，无关文字修订不触发级联过期，无法定位时回退全文绑定。集成用例预检环境后集中连续登记，不用 `run` 反复试代码或试环境。

每个 REQ 须有通过的必测用例，PRD 使用完整 AC-NN-N；报告仍须逐条记录 AC 状态、方法、断言、版本和证据。一个套件覆盖多条 AC，多个用例也可引用同一次 execute 或 verify 运行：

```json
{
  "id": "REQ-01-login",
  "required": true,
  "method": "integration",
  "acceptance": ["AC-01-1"],
  "status": "passed",
  "evidence": "docs/t-flow/change/example/evidence/shared-suite.json",
  "reuse": {
    "runId": "原始 runId",
    "command": "原始完整 command",
    "environmentUnchanged": true,
    "reason": "相关输入、覆盖和本地环境未变的具体核对依据"
  }
}
```

复用必须核对环境、覆盖及命令，不能把构建成功等同业务通过。环境/配置/输入变化或无法核实时重跑；报告注明复用而不是声称重新执行。context 的 valid 仅表示证据校验通过，不替代环境与语义核实。

所有 failed 和必测 not_run 阻断，未知 AC、重复用例 id、遗漏 AC 同样阻断；可选未测不能满足覆盖。无 AC 的旧 PRD 保持 REQ 校验，不使用编号的项目可设置 requireCoverage:false（不关闭已声明 AC 校验）。验证修复回退超过三次要求用户方向决定，用 decide 记录。

## 精确证据绑定

```sh
node skills/t-flow/scripts/yt.mjs --change example run T-01 \
  --input tests/order.test.js --input package.json \
  --expect 'passed' --reject 'failed: [1-9]' -- node --test tests/order.test.js
```

run 只在 execute/verify 可用。execute 自动绑定任务 modules，verify 通过 --input 声明套件涉及的源码、测试文件、依赖清单和配置。目录绑定会检测新增/删除文件，避免用全仓目录代替影响分析。规划时允许尚未创建的 modules；执行时必须存在，且至少绑定一个工作流文档之外的文件。

UI 声明 `ui-scope`（mode、files、affected、prototypes）。new 的实现路径在 UI 阶段可以尚不存在，不必提前造占位文件；affected/prototypes 始终须存在。各任务只绑定相关实现，后端任务不会因无关页面变化失效；verify/archive 检查必测证据的输入并集覆盖整个 files/affected 范围，缺项补测相关套件。原型与评审截图参与确认指纹并绑定证据，修改后须重新确认。

run 的 SUMMARY 包含真实退出码、signal、耗时、包装器断言统计、失败模式与日志路径；包装器断言数不是测试用例数。用例数量来自测试框架的真实报告，不猜测。成功只读摘要，失败定位对应日志片段。相同输入与环境的构建只执行一次。

重复 --expect 为全部满足，A|B 是任选；--reject 命中即失败，--min-output 限定输出长度。直接调用 Bash 自动启用 errexit/pipefail 并传递给嵌套 Bash；其他解释器须自行保证退出码。参数在执行前校验，不能用 echo OK 或只打印数量替代断言。

最新结果固定于 evidence/<id>.json，包括失败；独立执行记录在 evidence/attempts/<id>/<runId>.json，日志不覆盖。校验输入 hash、目录清单、最新 runId、记录一致性及日志 SHA256；旧证据缺少必要字段须重新运行。证据不能复制改名冒用。

## E2E 与人工测试

默认不新增 E2E；只有用户要求或 AC 必须真实浏览器操作时加载 [E2E 指南](skills/t-flow/reference/e2e.md)。同一页面相关 AC 共用套件、启动、登录与浏览器会话；失败或人工评审才查看截图。本地隔离服务优先，发布开发环境需要按指南选择、精确提交并核实部署 commit；凭证不得进入脚本、命令行、日志或仓库。

冒烟默认可选；实际执行则记录环境、步骤、预期/实际结果、状态和证据。人工记录按观察填写；run 校验记录只能证明文件存在，不证明人工行为真实。未测必测项不能通过修改 required 来消除。

## 恢复与归档

状态在 `.t-flow/runs/t-flow/<id>/state.json`，产物在 `docs/t-flow/change/<id>/`。协议变更 migrate，产物变化 reopen 最早受影响阶段；轻量范围升级 promote，保留已有文件但撤销确认，回到完整流程 clarify。

修改命令按 change 加 write.lock，覆盖测试执行。正常结束释放；强制中断留下锁须核实主机/PID和子进程停止后再清理，不能只因等待时间长抢锁。

归档需真实验收与用户确认。完整模式还须核对正式 Spec 同步；轻量不要求 Spec 文件，但契约变化必须升级模式。archive-pending.json 保存恢复记录与摘要，归档中断重试指定 change 的 archive，不手工删除源目录；遇到冲突保留现场。归档不改变 active，不自动提交、发布或合并。

根目录只保留阶段 Markdown；JSON 放 plan/verify/archive，原型放 prototypes/，截图 screenshots/，证据 evidence/，日志 logs/。散文件只告警，不自动删除。测试脚本放项目测试位置，绑定后保留到归档，不能清理仍在使用的证据输入。

已有未归档 change 的独立快速修复仍可显式 `/t-flow-fix <id> <问题>`：不推进状态，直接验证后追加 fix-log.md 和受影响文档；恢复标准流程时重新检查指纹与证据。新建且要完整恢复/验收记录的小任务优先轻量模式。

## 边界与校验

运行器保证结构、状态流转、指纹和声明一致，不能判断测试语义是否忠实、外部环境是否改变或确认原文是否真实。写权限持有者仍可同时改写记录与日志；这是可追溯账本，不是数字签名防伪。Spec 同步也只校验 hash 与 reviewed 声明。

```sh
node --test tests/workflow.test.mjs
node scripts/benchmark.mjs
```

测试使用临时项目。基准覆盖轻量修复、完整新功能和失败续跑，记录耗时、命令次数、运行次数与输出字符数；字符数是上下文大小的代理指标，不冒充真实 token 账单。不将基准全量执行加入普通业务任务默认验证。

建议提交 docs/t-flow；单机可提交 .t-flow，多人多机通常忽略状态目录以免冲突。原有状态无 profile 字段按完整模式兼容。

## 目录与许可

skills/t-flow 是入口/运行器/协议/模板/参考文档，t-flow-<阶段> 为阶段规则，t-flow-status 为只读查询，t-flow-fix 为独立修复。

分发依赖：grill-me/grilling 来自 [mattpocock/skills](https://github.com/mattpocock/skills)，frontend-design 来自 [anthropics/skills](https://github.com/anthropics/skills)（Apache-2.0），ui-ux-pro-max 来自 [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT，见包内 LICENSE）。其余内容为 MIT。

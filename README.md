# t-flow

可恢复研发工作流，默认按影响范围验证、共享套件、最小上下文读取。

```text
完整：clarify → specify → adr → ui → design → plan → execute → verify → archive
轻量：          specify →               plan → execute → verify → archive
```

完整模式用于新功能、权限/接口契约、架构或数据迁移。轻量模式用于不改变这些契约的局部修复、文案、样式和小型逻辑调整；保留需求与交付两次确认、任务状态和真实测试结果。范围扩大用 promote 升级，不能借轻量模式跳过已确认验收。

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

多会话每条命令固定 `--change <id>`；active 只是默认选择。change 的状态、产物互相隔离，业务代码共享，修改同一文件仍需协调。`use`/`resume` 改写默认选择；`status`/`context`/`changes` 只读。

## 更少等待与文档

- 轻量模式只需 `prd.md`、`plan.md`、`plan/tasks.json`、`test-report.md`、`verify/test-results.json`、`archive-report.md`。PRD 合并范围、约束和 AC；不生成澄清纪要、ADR、原型、技术设计、Spec 增量与同步文件。
- 完整模式逐份生成澄清纪要、PRD、ADR、UI 和 Design；每份完成后展示并停止等待用户确认，再 approve 当前节点并 advance。禁止合并确认、使用 approve scope 或提前一次生成后续文档。运行器阻断提前创建或修改的后续文档，回退保留的旧文档只能在对应阶段修改。
- UI 默认 `ui-ux-pro-max`，沿用用户偏好，不再单独询问工具选择；`ui-use` 记录实际工具，原型仍须确认。不可用时 ensure-skills 补齐，兜底 frontend-design 并说明原因。两者随包分发。
- 无界面需求可 skip ui；无架构/迁移/新接口的小型变更可用 skip design 提出原因；必须展示理由并等待用户确认，再用 approve skip-design <用户原文> 跳过。确认只记录真实用户原文，产物变动使确认失效。
- `context [任务id]` 一次返回当前任务、相关 AC 行号、建议读取路径、任务状态、测试结果及下一步，异常时才 doctor，审计才 status --json。长任务按节点切新会话，直接说“继续”并用 context 恢复，不携带长调试历史。
- 公共规则集中在 runtime-contract.md；验证规则在 verification.md；仅需 E2E 或异常恢复时加载相应参考文档。同会话未变文件不重复读取。必需产物和运行输出有凭证扫描，命中只显示规则名；已落盘凭证先轮换再脱敏，Git 历史清理不自动执行。
- advance 自带校验；非确认节点无需无变化地先 check 再 advance。check 用于展示待确认产物或诊断。

## 精简验证与套件复用

默认采用最低有效验证层级，只运行受影响测试与直接依赖回归；同一次真实套件可覆盖多条相关 AC，不为登记重复执行。公共模块改动前置为独立任务，后续任务等待依赖完成。输入或环境变化时重跑受影响测试。

最终测试经 run 执行，最新状态与输入指纹覆盖保存在已有 state.json；普通 Shell 用于调试。run 成功只显示摘要，失败在终端显示必要错误片段，不创建 logs/、evidence/、attempts/，无需证据引用或 reuse。测试报告只记录逐条 AC 的实际结果、失败或未测原因及总结果。机器结果示例：

```json
{
  "changeId": "example",
  "tests": [{"id": "REQ-01-login", "required": true, "acceptance": ["AC-01-1"], "status": "passed"}]
}
```

所有 failed 和必测 not_run 阻断，未知 AC、重复用例 id、遗漏 AC 同样阻断；可选未测不能满足覆盖。无 AC 的旧 PRD 保持 REQ 校验，不使用编号的项目可设置 requireCoverage:false（不关闭已声明 AC 校验）。验证修复回退超过三次要求用户方向决定，用 decide 记录。

## 执行验证

```sh
node skills/t-flow/scripts/yt.mjs --change example run T-01 \
  --expect 'passed' --reject 'failed: [1-9]' -- node --test tests/order.test.js
node skills/t-flow/scripts/yt.mjs --change example task T-01 done
```

run 只在 execute/verify 可用；execute id 必须属于任务列表，任务 modules 在执行时须存在。SUMMARY 返回真实退出码、signal、耗时与包装器断言统计，包装器断言数不是测试用例数。run 不保存原始输出或独立执行记录；输入变化使旧结果失效，失败或中断必须重测，不能靠修改报告通过。

重复 --expect 为全部满足，A|B 是任选；--reject 命中即失败，--min-output 限定输出长度。Bash 自动启用 errexit/pipefail。参数在执行前校验，不能用 echo OK 或打印数量替代断言。

UI 声明 ui-scope（mode、files、affected、prototypes）；new 实现路径在 UI 阶段可尚不存在，verify/archive 时须存在。原型与评审截图参与确认指纹，修改后须重新确认。

## E2E 与人工测试

默认不新增 E2E；只有用户要求或 AC 必须真实浏览器操作时加载 [E2E 指南](skills/t-flow/reference/e2e.md)。同一页面相关 AC 共用套件、启动、登录与浏览器会话；失败或人工评审才查看截图。本地隔离服务优先，发布开发环境需要按指南选择、精确提交并核实部署 commit；凭证不得进入脚本、命令行、日志或仓库。

冒烟默认可选；实际执行则记录实际结果。人工记录按观察填写。未测必测项不能通过修改 required 来消除。

## 恢复与归档

状态在 `.t-flow/runs/t-flow/<id>/state.json`，产物在 `docs/t-flow/change/<id>/`。协议变更 migrate，产物变化 reopen 最早受影响阶段；轻量范围升级 promote，保留已有文件但撤销确认，回到完整流程 clarify。

修改命令按 change 加 write.lock，覆盖测试执行。正常结束释放；强制中断留下锁须核实主机/PID和子进程停止后再清理，不能只因等待时间长抢锁。

归档需真实验收与用户确认。完整模式还须核对正式 Spec 同步；轻量不要求 Spec 文件，但契约变化必须升级模式。archive-pending.json 保存恢复记录与摘要，归档中断重试指定 change 的 archive，不手工删除源目录；遇到冲突保留现场。归档不改变 active，不自动提交、发布或合并。

根目录只保留阶段 Markdown；JSON 放 plan/verify/archive，原型放 prototypes/，截图 screenshots/。散文件只告警，不自动删除。测试脚本放项目测试位置。不生成或引用日志与证据文件；旧版本的 logs/evidence 目录不再用于验收，可清理。

已有未归档 change 的独立快速修复仍可显式 `/t-flow-fix <change-id> <问题描述>`：普通“修复”请求不会自动启用此命令。execute/verify/archive 使用 `fix <任务id> --repair <项目内 Bash 脚本> [验证参数] -- <测试命令>`，在同一 change 锁内修复并验证，共用最新结果与输入指纹。只更新受影响结果，不推进阶段、不改任务状态或审批原文；修复脚本不得改写需求、设计、计划或工作流状态，范围变化回到对应阶段重新确认。verify/archive 只同步已有报告的结果，不创建或追加 fix-log.md。历史记录保留，不生成 logs/evidence；代码变化后旧交付验收须重新确认。新建小任务仍优先轻量模式。

## 边界与校验

运行器保证结构、状态流转、指纹和声明一致，不能判断测试语义是否忠实、外部环境是否改变或确认原文是否真实。测试结果由执行者如实记录，运行器不再校验原始日志或证据。Spec 同步也只校验 hash 与 reviewed 声明。

```sh
node --test tests/workflow.test.mjs
```

测试使用临时项目，覆盖节点确认、结果覆盖、安装与归档恢复。

建议提交 docs/t-flow；单机可提交 .t-flow，多人多机通常忽略状态目录以免冲突。原有状态无 profile 字段按完整模式兼容。

## 目录与许可

skills/t-flow 是入口/运行器/协议/模板/参考文档，t-flow-<阶段> 为阶段规则，t-flow-status 为只读查询，t-flow-fix 为独立修复。

分发依赖：grill-me/grilling 来自 [mattpocock/skills](https://github.com/mattpocock/skills)，frontend-design 来自 [anthropics/skills](https://github.com/anthropics/skills)（Apache-2.0），ui-ux-pro-max 来自 [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT，见包内 LICENSE）。其余内容为 MIT。

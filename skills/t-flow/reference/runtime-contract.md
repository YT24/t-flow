唯一运行入口 scripts/yt.mjs，读取同目录 reference/workflow-protocol.json（运行时只消费其中列出的字段；编辑该文件即变更协议指纹）。项目根使用 TFLOW_RUN_ROOT 或 cwd。运行 help 查看接口；check 只读并检查产物、任务和测试，待确认时返回 ARTIFACTS_READY；advance/archive 额外要求确认有效后才能推进；阶段确认用交互卡片点选，点选文字即 approve 的确认原文（不支持卡片的环境回退文字确认）；协议变更后 migrate；验证循环超限后 decide。多 change：docs/t-flow/change/<change-id>/ 为各未归档变更的独立产物目录（每 change 一份状态 .t-flow/runs/t-flow/<change-id>/state.json，active 指针记录聚焦目标）；init 新建并聚焦，use <id> 切换，changes 列出各变更的节点进度与任务完成度；归档把 change/<id>/ 整体移入 archive/<id>/ ，保留独立状态供查询；归档不改写共享 active 指针，避免覆盖其他会话的选择。UI 设计 Skill 见协议 uiSkillRouting（主 ui-ux-pro-max、兜底 frontend-design，均随包分发）：ensure-skills 把缺失的 Skill 装到项目 .agents/skills/ 并在 .claude/skills/ 建符号链接（Claude 与 agent 两条发现路径都可命中），ui-routing 查看可用性，ui-use <Skill名> 在 ui 节点记录本次所用；doctor 会校验 Skill 可用性、分发内容是否齐备，以及 ui.md 是否已记录所用 Skill。
ui.md 必须含 ui-scope 声明块（mode: new|change、files、affected），把「用户确认的界面」与真实文件绑定：check 校验其存在与路径真实性（mode=change 时必须列 affected），run 把 files 与 affected 强制计入证据输入，改动已声明的界面文件会使证据过期。存量项目若涉及样式/主题改动，须把样式文件列入 files 或 affected——UI 变更未绑定任何样式文件时 run 会告警（见协议 uiChange.styleGlobs）。

并行会话每条命令必须显式加前缀 `--change <id>`（放在命令前），不能依赖共享 active。`resume <id>` 恢复选择并输出 NEXT/SKILL；`--change <id> status` 只查看指定状态，`changes`/`list` 展示阶段进度（含跳过阶段）、任务完成数和归档状态。状态和证据隔离不等于业务代码隔离；多个 change 修改相同源码时仍需协调，输入变化会使证据失效。

UI 阶段未选择时 status/resume/advance 输出 UI_CHOICE，提示用户跳过或选择设计 Skill。ui-use 必须显式指定名称；未记录选择不得通过 UI 检查与确认。选择记录独立于原型验收；reopen UI 或前序节点清除选择，skip ui 清除所用 Skill。

验收检查：PRD 中出现 AC-NN-N 时，各用例的 acceptance 数组必须逐条覆盖全部 AC，且用于覆盖的用例须 required:true/status:passed；一个真实用例可覆盖多条相关 AC，不为每条 AC 重复执行相同套件。声明 acceptance 的用例必须记录 method（static/unit/integration/e2e/manual/build），重复用例 ID 和未知 AC 会被拒绝。REQ 覆盖关闭不影响已声明的 AC 校验；没有 AC 的旧 PRD 保持原 REQ 检查。方法与覆盖关系由执行者声明，脚本不能证明测试语义正确。

默认精简验证：后端纯逻辑以单元测试为主，持久化验证最终数据、约束、事务或审计结果；前端默认使用构建/静态检查、少量组件测试与按需选择的人工冒烟。同一行为只在最低有效层级验证，不在浏览器中重复后端已覆盖的全组合；已确认 AC 声明真实权限、数据或界面行为时仍须有效验证，not_run 不得视为通过。plan.md 必须建立改动模块→受影响 AC→最小验证命令映射；execute/verify 默认只执行受影响测试，小改动不得引起全量回归。只有共享核心状态机/权限、数据迁移、构建依赖、用户明确要求或影响范围无法可靠确定时才允许全量，并在 plan.md 与测试报告写明原因。

冒烟测试默认可选，不因未执行冒烟测试单独阻断验收；已确认 AC 的必测要求仍须满足。凡实际执行了冒烟测试，无论成功或失败，都必须在 test-report.md 中记录测试环境、覆盖场景或关联 AC、操作步骤或执行命令、预期与实际结果、状态及证据位置；手工测试按实际观察记录，不编造命令或运行证据。

run 支持重复 --reject <正则>，任一命中即 failed；新证据记录 exitCode/signal。参数仍在执行前校验。Bash 命令自动启用 errexit/pipefail，SHELLOPTS 导出使嵌套 Bash 继承；显式关闭选项或使用其他解释器仍需调用者保证失败传播。--expect 多个条件应重复传参，正则中的 | 表示任选一个。

ui-scope 可声明 prototypes 数组：路径须在本 change 内且是实际文件。原型和评审截图参与 UI 及后续节点的确认/完成指纹，也绑定到执行证据；修改原型需 reopen ui 并重新确认。未声明 prototypes 的旧 ui.md 保持兼容；新版产物生成独立原型时必须声明。

控制上下文与 token：各阶段只读取直接所需产物——clarify 续跑读已有 clarify-log；specify 读 clarify-log；ui 读 prd 与涉及界面；design 读 prd、ui.md（如有）和受影响接口；plan 读 prd、design.md（如有）；execute 只读当前任务、相关 AC/设计段落和 modules 文件；verify 读 prd 的 AC、verify/test-results.json 及失败或异常证据的相关日志，成功日志只引用路径不全文展开；archive 读 test-report、spec-delta 与 archive/spec-sync.json。需要更多细节时再按需打开，不重复全量读取已确认产物；项目 AGENTS.md 同一会话已读且未变不重复读取。

状态查询：用户要求查看所有 change 状态时运行 `status --all`（或 `changes`/`list`），汇总阶段、总进度、任务完成数、阶段进度、状态、下一步、阻塞原因和更新时间；不执行推进操作。`status --all --json` / `changes --json` 提供结构化列表。run/task/approve/advance 等命令默认只输出紧凑 STATE 摘要和 NEXT/SKILL，不重复打印不断增长的 approvals、指纹与 history；完整状态始终保存在 state.json，审计或排障时用 `--change <id> status --json`。总进度包含跳过阶段；文档阶段进度统计非空必需文件，execute 统计 done 任务，verify 统计必测用例中声明 passed 的数量。计数不能代替校验；状态会额外检查产物漂移、证据有效性及确认门禁，过期证据即使计数满额也显示阻塞。

同一 change 的修改命令使用 write.lock 互斥，锁覆盖读状态、执行命令、保存结果全程；其他 change 和只读查询不受阻。正常退出或命令报错释放锁；强制终止/断电留下锁时，必须核对锁中主机、PID 及其子进程均已停止后才手工删除，禁止仅凭锁龄强制抢占。此锁不阻止外部编辑器直接修改文档或业务代码。

归档先保存 archive-pending.json 恢复记录和文件摘要，再复制到 archive/<id>.pending、核对内容并原子改名，最后保存状态并清理源目录。中断后使用 `--change <id> archive` 重试；已完成归档重试幂等。待恢复时禁止其他修改命令。发现文件或状态与恢复记录不一致时保留现场并阻断；不接管无恢复记录的同名目录。归档后保留 active 的选择，后续新任务用 init、其他任务用 resume 明确选择。

执行证据与 attempts 中记录必须完整一致，日志必须符合 logHash。旧证据没有日志摘要时需重新执行 run，不能手工补摘要充当复验；已归档历史不自动重写。摘要用于发现意外修改，不是防篡改签名，不能证明测试本身覆盖正确。

change 根目录只保留各阶段协议 Markdown、fix-log.md 及可选 manual-acceptance.md。JSON 固定放在 plan/tasks.json、verify/test-results.json、archive/spec-sync.json；evidence/、logs/、screenshots/ 为受控目录，独立原型 HTML 放 prototypes/，评审截图放 screenshots/。验证辅助脚本必须作为 run 的命令执行并用 --input 绑定，输出由 run 写入 logs/evidence；其它临时文件和工具缓存用完删除或移出。check/archive 对散文件和根目录非 Markdown 文件只读列出并 WARN，不自动删除、不因此阻断历史变更；归档前由执行者完成清理。

E2E UI 操作验证只在用户明确要求或 AC 必须真实浏览器操作时启用，先由用户卡片选择本地隔离服务或开发环境。本地实例直连并隔离注册与数据；开发环境分支只精确提交并推送当前任务实现代码，禁止 git add -A，不包含测试脚本、工作流产物、临时文件或凭证，无法分离其他改动时停止。推送不等于部署完成，须确认开发环境运行的是该提交。访问地址和测试专用账号由用户提供，凭证只在运行时使用，不进入脚本、命令行、日志、证据或仓库；E2E 仍由 run 真实执行并逐 AC 留证。同一页面的相关 AC 共用一个 Playwright 套件与浏览器会话，一次启动/登录后批量断言，不逐 AC 写新脚本、重启浏览器或重复构建上传；成功截图不逐张阅读，失败定位与人工评审时才打开。

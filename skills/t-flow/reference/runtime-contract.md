唯一运行入口 scripts/yt.mjs，读取同目录 reference/workflow-protocol.json（运行时只消费其中列出的字段；编辑该文件即变更协议指纹）。项目根使用 TFLOW_RUN_ROOT 或 cwd。运行 help 查看接口；check 只读并检查产物、任务和测试，待确认时返回 ARTIFACTS_READY；advance/archive 额外要求确认有效后才能推进；阶段确认用交互卡片点选，点选文字即 approve 的确认原文（不支持卡片的环境回退文字确认）；协议变更后 migrate；验证循环超限后 decide。多 change：docs/t-flow/change/<change-id>/ 为各未归档变更的独立产物目录（每 change 一份状态 .t-flow/runs/t-flow/<change-id>/state.json，active 指针记录聚焦目标）；init 新建并聚焦，use <id> 切换，changes 列出各变更的节点进度与任务完成度；归档把 change/<id>/ 整体移入 archive/<id>/ ，保留独立状态供查询；归档不改写共享 active 指针，避免覆盖其他会话的选择。UI 设计 Skill 见协议 uiSkillRouting（主 ui-ux-pro-max、兜底 frontend-design，均随包分发）：ensure-skills 把缺失的 Skill 装到项目 .agents/skills/ 并在 .claude/skills/ 建符号链接（Claude 与 agent 两条发现路径都可命中），ui-routing 查看可用性，ui-use <Skill名> 在 ui 节点记录本次所用；doctor 会校验 Skill 可用性、分发内容是否齐备，以及 ui.md 是否已记录所用 Skill。
ui.md 必须含 ui-scope 声明块（mode: new|change、files、affected），把「用户确认的界面」与真实文件绑定：check 校验其存在与路径真实性（mode=change 时必须列 affected），run 把 files 与 affected 强制计入证据输入，改动已声明的界面文件会使证据过期。存量项目若涉及样式/主题改动，须把样式文件列入 files 或 affected——UI 变更未绑定任何样式文件时 run 会告警（见协议 uiChange.styleGlobs）。

并行会话每条命令必须显式加前缀 `--change <id>`（放在命令前），不能依赖共享 active。`resume <id>` 恢复选择并输出 NEXT/SKILL；`--change <id> status` 只查看指定状态，`changes`/`list` 展示阶段进度（含跳过阶段）、任务完成数和归档状态。状态和证据隔离不等于业务代码隔离；多个 change 修改相同源码时仍需协调，输入变化会使证据失效。

UI 阶段未选择时 status/resume/advance 输出 UI_CHOICE，提示用户跳过或选择设计 Skill。ui-use 必须显式指定名称；未记录选择不得通过 UI 检查与确认。选择记录独立于原型验收；reopen UI 或前序节点清除选择，skip ui 清除所用 Skill。

验收检查：PRD 中出现 AC-NN-N 时，各用例的 acceptance 数组必须逐条覆盖全部 AC，且用于覆盖的用例须 required:true/status:passed；一个真实用例可覆盖多条相关 AC，不为每条 AC 重复执行相同套件。声明 acceptance 的用例必须记录 method（static/unit/integration/manual/build），重复用例 ID 和未知 AC 会被拒绝。REQ 覆盖关闭不影响已声明的 AC 校验；没有 AC 的旧 PRD 保持原 REQ 检查。方法与覆盖关系由执行者声明，脚本不能证明测试语义正确。

默认精简验证：后端纯逻辑以单元测试为主，持久化验证最终数据、约束、事务或审计结果；前端默认使用构建/静态检查、少量组件测试与必要人工冒烟。同一行为只在最低有效层级验证，不在浏览器中重复后端已覆盖的全组合；已确认 AC 声明真实权限、数据或界面行为时仍须有效验证，not_run 不得视为通过。

run 支持重复 --reject <正则>，任一命中即 failed；新证据记录 exitCode/signal。参数仍在执行前校验。Bash 命令自动启用 errexit/pipefail，SHELLOPTS 导出使嵌套 Bash 继承；显式关闭选项或使用其他解释器仍需调用者保证失败传播。--expect 多个条件应重复传参，正则中的 | 表示任选一个。

ui-scope 可声明 prototypes 数组：路径须在本 change 内且是实际文件。原型和评审截图参与 UI 及后续节点的确认/完成指纹，也绑定到执行证据；修改原型需 reopen ui 并重新确认。未声明 prototypes 的旧 ui.md 保持兼容；新版产物生成独立原型时必须声明。

状态查询：用户要求查看所有 change 状态时运行 `status --all`（或 `changes`/`list`），汇总阶段、总进度、任务完成数、阶段进度、状态、下一步、阻塞原因和更新时间；不执行推进操作。`status --all --json` / `changes --json` 提供结构化列表。总进度包含跳过阶段；文档阶段进度统计非空必需文件，execute 统计 done 任务，verify 统计必测用例中声明 passed 的数量。计数不能代替校验；状态会额外检查产物漂移、证据有效性及确认门禁，过期证据即使计数满额也显示阻塞。

同一 change 的修改命令使用 write.lock 互斥，锁覆盖读状态、执行命令、保存结果全程；其他 change 和只读查询不受阻。正常退出或命令报错释放锁；强制终止/断电留下锁时，必须核对锁中主机、PID 及其子进程均已停止后才手工删除，禁止仅凭锁龄强制抢占。此锁不阻止外部编辑器直接修改文档或业务代码。

归档先保存 archive-pending.json 恢复记录和文件摘要，再复制到 archive/<id>.pending、核对内容并原子改名，最后保存状态并清理源目录。中断后使用 `--change <id> archive` 重试；已完成归档重试幂等。待恢复时禁止其他修改命令。发现文件或状态与恢复记录不一致时保留现场并阻断；不接管无恢复记录的同名目录。归档后保留 active 的选择，后续新任务用 init、其他任务用 resume 明确选择。

执行证据与 attempts 中记录必须完整一致，日志必须符合 logHash。旧证据没有日志摘要时需重新执行 run，不能手工补摘要充当复验；已归档历史不自动重写。摘要用于发现意外修改，不是防篡改签名，不能证明测试本身覆盖正确。

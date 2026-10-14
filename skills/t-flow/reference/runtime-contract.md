唯一运行入口 scripts/yt.mjs，读取同目录 reference/workflow-protocol.json（运行时只消费其中列出的字段；编辑该文件即变更协议指纹）。项目根使用 TFLOW_RUN_ROOT 或 cwd。运行 help 查看接口；check 只读并检查产物、任务和测试，待确认时返回 ARTIFACTS_READY；advance/archive 额外要求确认有效后才能推进；协议变更后 migrate；验证循环超限后 decide。多 change：docs/t-flow/change/<change-id>/ 为各未归档变更的独立产物目录（每 change 一份状态 .t-flow/runs/t-flow/<change-id>/state.json，active 指针记录聚焦目标）；init 新建并聚焦，use <id> 切换，changes 列出各变更的节点进度与任务完成度；归档把 change/<id>/ 整体移入 archive/<id>/ ，保留独立状态供查询；只清除指向该 change 的 active 指针。UI 设计 Skill 见协议 uiSkillRouting（主 ui-ux-pro-max、兜底 frontend-design，均随包分发）：ensure-skills 把缺失的 Skill 装到项目 .agents/skills/ 并在 .claude/skills/ 建符号链接（Claude 与 agent 两条发现路径都可命中），ui-routing 查看可用性，ui-use <Skill名> 在 ui 节点记录本次所用；doctor 会校验 Skill 可用性、分发内容是否齐备，以及 ui.md 是否已记录所用 Skill。
ui.md 必须含 ui-scope 声明块（mode: new|change、files、affected），把「用户确认的界面」与真实文件绑定：check 校验其存在与路径真实性（mode=change 时必须列 affected），run 把 files 与 affected 强制计入证据输入，改动已声明的界面文件会使证据过期。存量项目若涉及样式/主题改动，须把样式文件列入 files 或 affected——UI 变更未绑定任何样式文件时 run 会告警（见协议 uiChange.styleGlobs）。

并行会话每条命令必须显式加前缀 `--change <id>`（放在命令前），不能依赖共享 active。`resume <id>` 恢复选择并输出 NEXT/SKILL；`--change <id> status` 只查看指定状态，`changes`/`list` 展示阶段进度（含跳过阶段）、任务完成数和归档状态。状态和证据隔离不等于业务代码隔离；多个 change 修改相同源码时仍需协调，输入变化会使证据失效。

UI 阶段未选择时 status/resume/advance 输出 UI_CHOICE，提示用户跳过或选择设计 Skill。ui-use 必须显式指定名称；未记录选择不得通过 UI 检查与确认。选择记录独立于原型验收；reopen UI 或前序节点清除选择，skip ui 清除所用 Skill。

验收检查：PRD 中出现 AC-NN-N 时，各用例的 acceptance 数组必须逐条覆盖全部 AC，且用于覆盖的用例须 required:true/status:passed；声明 acceptance 的用例必须记录 method（static/unit/integration/e2e/manual/build），重复用例 ID 和未知 AC 会被拒绝。REQ 覆盖关闭不影响已声明的 AC 校验；没有 AC 的旧 PRD 保持原 REQ 检查。方法与覆盖关系由执行者声明，脚本不能证明测试语义正确。

run 支持重复 --reject <正则>，任一命中即 failed；新证据记录 exitCode/signal。参数仍在执行前校验。Bash 命令自动启用 errexit/pipefail，SHELLOPTS 导出使嵌套 Bash 继承；显式关闭选项或使用其他解释器仍需调用者保证失败传播。--expect 多个条件应重复传参，正则中的 | 表示任选一个。

ui-scope 可声明 prototypes 数组：路径须在本 change 内且是实际文件。原型和评审截图参与 UI 及后续节点的确认/完成指纹，也绑定到执行证据；修改原型需 reopen ui 并重新确认。未声明 prototypes 的旧 ui.md 保持兼容；新版产物生成独立原型时必须声明。

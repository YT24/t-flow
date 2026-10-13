---
name: t-flow
description: 用于用户调用 /t-flow 的完整可恢复研发工作流；支持多个未归档变更并行（各自独立目录与状态）。当项目中存在进行中的 t-flow 变更（docs/t-flow/change/ 下有目录）且用户要求继续相关工作（如"继续""接着做"）时也使用——多变更时先 changes 查看列表，use <id> 聚焦后继续。
---

# t-flow

### 自动节点检测
先读本 Skill 的 reference/runtime-contract.md。以项目根运行 `node <本 Skill>/scripts/yt.mjs changes` 查看未归档变更：只有一个时它通常是继续目标；多个时按用户指定或当前会话已确定的 change 继续，只有目标不明时才询问，用 `use <change-id>` 聚焦；没有时 `init <change-id>` 新建（init 后自动聚焦）。确定目标后，所有节点命令都使用 `yt.mjs --change <change-id> <命令>`，不依赖共享 active；`resume <id>` 选择目标并输出断点，`--change <id> status` 查看状态。新任务即使已有未归档 change，也应另行 init。用户消息用于判断当前意图，磁盘状态用于确定执行节点；二者冲突时解释影响并使用 reopen 回退，禁止跳过前序验收。

### 决策分类与用户停顿点（decision points）
本工作流有五个用户停顿点（decision point）：需求澄清、PRD/增量 Spec、UI 原型、技术设计、交付验收（由 protocol 各节点的 approval 声明，改动即变更 protocolHash）。到达停顿点必须 stop 并等待用户决定；常规实现和验证自动执行。确认过且输入未变不重复询问。只有用户明确确认后才用 approve 记录原文。进入 UI 时先展示「跳过 UI / ui-ux-pro-max / frontend-design」选择，等待用户回答后记录 ui-use 或 skip；已有明确选择且需求未变时沿用。用户明确不需要界面时用 skip ui <原因> 跳过 UI 停顿点；小型变更（无架构调整、无数据迁移、无新接口）可 skip design 记录原因跳过设计停顿点（skip 原因落盘，不产生对应产物），reopen 前序节点会使其后的跳过记录失效。加载状态输出 SKILL 指定的单个节点，完成后 check 检查产物；待确认时返回 ARTIFACTS_READY，取得用户确认并 approve 后才可 advance；归档用 archive。

### Resume Rules
本工作流实际运行统一使用 yt.mjs：其检查包含任务、测试与确认。状态和产物不一致先修复，不依据会话记忆标记完成。**多个变更可并行**：每个 change 有独立目录（docs/t-flow/change/<id>/）与状态（.t-flow/runs/t-flow/<id>/state.json），互不干扰；命令作用于当前聚焦的 change（use 切换，init 新建并聚焦，changes 列表含各自节点进度与任务完成度）。协议文件更新后需对每个未归档变更运行 `--change <id> migrate`；验证-修复循环超限后向用户展示失败历史，用 decide 记录用户决策原文解除。

### Red Flags
| 想法 | 风险 |
|---|---|
| 产物存在就能完成 | 内容与验收未核对 |
| 任务 modules 留空/随便填 | 脚本强制校验：modules 须非空且真实存在，证据必须绑定实现文件，否则 run 被拒 |
| 以前测试通过就复用 | 输入文件变化使证据失效 |
| 用户说继续就是批准所有方案 | 继续不代表对尚未展示的交付验收 |
| 缺 Skill 随便换一个 | 应从离线依赖包补齐 |
| 产物或摘要里写入密钥/连接串 | 凭证不得落盘 |

---
name: sy-comet
description: 用于用户调用 /sy-comet 的完整可恢复研发工作流；当项目中存在进行中的 sy-comet 变更（.comet/runs/sy-comet/state.json 的 currentNode 非空）且用户要求继续相关工作（如"继续""接着做"）时也使用。
---

# sy-comet

### 自动节点检测
先读本 Skill 的 reference/runtime-contract.md。以项目根运行 `node <本 Skill>/scripts/yt.mjs status`，尚未启动才用 `init <change-id>`。用户消息用于判断当前意图，磁盘状态用于确定执行节点；二者冲突时解释影响并使用 reopen 回退，禁止跳过前序验收。

### 决策分类与用户停顿点（decision points）
本工作流有五个用户停顿点（decision point）：需求澄清、PRD/增量 Spec、UI 原型、技术设计、交付验收（由 protocol 各节点的 approval 声明，改动即变更 protocolHash）。到达停顿点必须 stop 并等待用户决定；常规实现和验证自动执行。确认过且输入未变不重复询问。只有用户明确确认后才用 approve 记录原文。无界面需求时用 skip ui <原因> 跳过 UI 停顿点；小型变更（无架构调整、无数据迁移、无新接口）可 skip design 记录原因跳过设计停顿点（skip 原因落盘，不产生对应产物），reopen 前序节点会使其后的跳过记录失效。加载状态输出 SKILL 指定的单个节点，完成后 check，再 advance；归档用 archive。

### Resume Rules
本工作流实际运行统一使用 yt.mjs：其检查包含任务、测试与确认。状态和产物不一致先修复，不依据会话记忆标记完成。单项目串行一个 active change，归档后方可创建下一个。协议文件更新后 status 报版本不一致时运行 migrate 迁移续跑；验证-修复循环超限后向用户展示失败历史，用 decide 记录用户决策原文解除。

### Red Flags
| 想法 | 风险 |
|---|---|
| 产物存在就能完成 | 内容与验收未核对 |
| 任务 modules 留空/随便填 | 脚本强制校验：modules 须非空且真实存在，证据必须绑定实现文件，否则 run 被拒 |
| 以前测试通过就复用 | 输入文件变化使证据失效 |
| 用户说继续就是批准所有方案 | 继续不代表对尚未展示的交付验收 |
| 缺 Skill 随便换一个 | 应从离线依赖包补齐 |
| 产物或摘要里写入密钥/连接串 | 凭证不得落盘 |

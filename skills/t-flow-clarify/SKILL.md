---
name: t-flow-clarify
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-clarify

### Prerequisites
运行 yt.mjs status 确认当前节点为 clarify，读取已完成产物及目标项目约束。

### Steps
读取并调用 grill-me，它委托 grilling；本阶段按下方停止条件限定提问范围。按决策依赖逐轮澄清，记录问答、范围、不做事项、角色、验收边界和未决问题到 clarify-log.md。记录实际调用证据。当目标与范围、不做事项、关键角色/权限、关键业务决定和可验证验收条件明确，且没有会改变这些内容的未决问题时，停止追问。可逆实现细节记录为待设计/执行阶段处理，不展开与本次交付无关的决策分支；已明确的信息不重复询问。达到停止条件后展示摘要，请用户确认并记录 approve clarify。子代理若承担澄清，同样加载这两个 Skill 并回传证据。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。通过后运行 yt.mjs advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

---
name: t-flow-design
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-design

### Prerequisites
所有命令固定使用 `yt.mjs --change <change-id> <命令>`，沿用入口选定的 change；产物只读写 `docs/t-flow/change/<change-id>/`。
运行 yt.mjs status 确认当前节点为 design，读取已完成产物及目标项目约束。

### Steps
编写 design.md，明确接口、数据流、权限、数据迁移和测试策略。读取目标项目 AGENTS.md 并遵守其中约束。向用户展示技术设计（UI 原型已在 ui 门禁单独确认；若 ui 被 skip，说明无界面影响即可），确认后记录 approve design。小型变更（无架构调整、无数据迁移、无新接口）可不写 design.md：向用户说明理由，运行 yt.mjs skip design <原因> 记录后本节点直接完成。

### Completion reasoning
展示设计前逐项对照 PRD/ADR/UI 的页面、接口、字段、权限和 AC；合并页面、改变授权或降低验证方式时，回退并同步受影响需求后重新确认。授权设计须覆盖不同写入口的字段级权限、可授予上限、角色查询与分配权限的一致性，以及事务/并发/回滚；未决业务规则返回 clarify，不能自行假定。

逐 AC 标明最低有效测试层级，同一行为只在一个最合适的层级验证。后端纯逻辑以单元测试为主，持久化验证最终数据、约束、事务或审计结果；前端默认使用构建/静态检查、少量共享组件测试与必要人工冒烟。相关 AC 优先共享同一测试套件，不在浏览器中重复后端已覆盖的角色、对象、规则全组合。若 AC 明确声明真实权限、数据或界面行为，mock/无缓存代码检查仍不等同于同 token 真实请求或真实页面验证。

逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。通过后运行 yt.mjs advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

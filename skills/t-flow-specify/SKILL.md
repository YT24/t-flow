---
name: t-flow-specify
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-specify

### Prerequisites
所有命令固定使用 `yt.mjs --change <change-id> <命令>`，沿用入口选定的 change；产物只读写 `docs/t-flow/change/<change-id>/`。
运行 yt.mjs status 确认当前节点为 specify，读取已完成产物及目标项目约束。

### Steps
从澄清纪要编写 prd.md，给每项需求稳定编号和验收标准；spec-delta.md 写 ADDED/MODIFIED/REMOVED 行为与场景；adr.md 仅记录有取舍的重要决定，无额外决定写明。不能把设计实现细节当作业务需求。本节点是用户确认门禁：check 通过后必须 stop，向用户展示 PRD 范围、需求编号与 spec-delta 变更，等待明确确认后用 yt.mjs approve specify <用户确认原文> 记录，未确认不得 advance。需求编号须与 verify 阶段 test-results.json 的用例 id 对应，保证可追溯。

### Completion reasoning
PRD 每项验收条件使用完整 `AC-NN-N` 编号，并说明前置条件、操作、可观察结果与验证方式；页面独立/嵌入位置、角色授权边界一并明确。REQ 是能力分组，不能替代逐条 AC。只把用户可观察、需要独立交付门禁的结果定义为必测 AC；内部边界、普通异常分支及角色/对象/规则排列组合优先纳入共享自动化测试集，不默认逐组合创建 AC。相关 AC 可由同一测试套件覆盖，在 `acceptance` 数组中完整声明，不为了凑一一对应而重复执行相同测试。

验证方式选择能证明 AC 的最低有效层级：后端纯逻辑以单元测试为主，持久化以最终数据、约束、事务或审计结果正确为主；前端默认使用构建/静态检查、少量组件测试与必要人工冒烟。现有测试基础设施只能作为技术现状，不能据此把已声明的真实接口、数据库或页面验收降为静态检查。

逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。check 通过后必须 stop：向用户展示 PRD 与范围，用 yt.mjs approve specify <用户确认原文> 记录确认后才允许 advance。确认后 advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

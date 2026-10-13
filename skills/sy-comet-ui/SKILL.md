---
name: sy-comet-ui
description: 仅由 sy-comet 入口路由到本阶段时使用。
---

# sy-comet-ui

### Prerequisites
运行 yt.mjs status 确认当前节点为 ui，读取已完成产物及目标项目约束。

### Steps

**第一步 · 判定场景并选择设计 Skill（不要跳过）。** 运行 `yt.mjs ui-routing` 查看场景表，按本次 PRD 判定属于哪个场景：

| 场景 | 何时用 | 主 Skill |
|---|---|---|
| `admin` | 多角色权限分化、审批流、管理后台（列表/表单/看板） | `sy-hifi-prototype`（自带权限矩阵、五态、浏览器实测、交付审计） |
| `brand` | 项目有强制品牌规范（自带 design tokens 的 Skill） | 品牌 Skill（如 `sy-frontend-design`） |
| `marketing` | C 端页面、落地页、营销页，无复杂权限 | `frontend-design` |

场景与所用 Skill 必须落盘：`yt.mjs ui-use <场景> [实际所用 Skill]`。若主 Skill 不可用，脚本会告警，此时改用协议 `fallback`（内置 `frontend-design`）并在 ui.md 说明实际所用 Skill。**品牌规范优先于审美独特性**：命中 `brand` 时不要使用 `frontend-design` 的"追求独特视觉方向"取向。

**第二步 · 生成原型。** 加载所选 Skill，复用已确认角色/权限/流程。不要自动新增全套 CRUD；只实现本次 PRD 范围。若所选 Skill 自带阶段门禁（如多角色矩阵需先确认），可采用它，但**产出的原型仍须一次性对齐本次 PRD 范围**，不因它的分阶段节奏而超出 PRD。

**第三步 · 写 ui.md**，至少包含：原型路径、所用场景与 Skill（及主 Skill 不可用时的替代说明）、空/加载/错误/无权限/正常**五态**的覆盖情况、浏览器实测结论或未测原因。五态是硬要求，不因所选 Skill 不同而豁免——若所选 Skill 不覆盖五态（如 `frontend-design` 只管审美），由你自行补齐并记录。

没有界面需求时不写 ui.md：向用户说明理由，运行 `yt.mjs skip ui <原因>` 记录后本节点直接完成。工具不具备时不可假装已实测；未实测须写明原因与残余风险。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。check 通过后必须 stop：向用户展示原型，等待用户明确确认没有问题，用 yt.mjs approve ui <用户确认原文> 记录后才允许 advance；未收到确认不得进入下一阶段。以 skip 完成的节点无产物、无需确认，status 应已进入 design。确认后 advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

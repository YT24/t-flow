---
name: sy-comet-ui
description: 仅由 sy-comet 入口路由到本阶段时使用。
---

# sy-comet-ui

### Prerequisites
运行 yt.mjs status 确认当前节点为 ui，读取已完成产物及目标项目约束。

### Steps

**第一步 · 备齐设计 Skill 并记录所用。** 运行 `yt.mjs ensure-skills`：它会把主 Skill `ui-ux-pro-max` 与兜底 `frontend-design` 自动安装到项目 `.agents/skills/`，并在 `.claude/skills/` 建立同名符号链接，使 Claude 与 agent 两条发现路径都能命中。已存在时不重复复制。

然后运行 `yt.mjs ui-routing` 查看当前可用性，并用 `yt.mjs ui-use [Skill名]` 记录本次所用：

| Skill | 何时用 |
|---|---|
| `ui-ux-pro-max`（主） | 默认选择。覆盖 50+ 风格、161 配色、57 字体配对、10 个技术栈、99 条 UX 准则，含无障碍硬指标（对比度 4.5:1、44×44 触控目标、键盘导航），后台/C 端/移动端都适用 |
| `frontend-design`（兜底） | 仅当主 Skill 不可用，或你明确判断本次只需要纯审美指导时。它是纯审美指导，**不覆盖五态与角色权限**，须自行补齐 |

不带参数时 `ui-use` 默认记录主 Skill。以兜底完成会打印 WARN，须在 ui.md 写明原因。

**第二步 · 生成原型。** 加载所选 Skill，复用已确认角色/权限/流程。`ui-ux-pro-max` 自带可检索的本地数据库，按**单一主导意图**查询（需 Python 3，无外部依赖）：

```sh
python3 <skill目录>/scripts/search.py "dashboard analytics" --design-system      # 新页面/系统级视觉方向
python3 <skill目录>/scripts/search.py "error summary validation" --domain ux     # 定向问题（无障碍/表单/排版等）
python3 <skill目录>/scripts/search.py "chip badge overflow nowrap" --stack html-tailwind
```

它的 SKILL.md 有完整的 Query Contract：查询用 2–5 个有意义词、先查语义化 UX 结果再查技术栈实现，**结果为空或跑题时改写重试一次**，仍失败就如实说明未找到而非套用泛化建议。需要更细的规则时读它的 `references/quick-reference.md`（119 条 UX 准则）与 `references/pro-rules.md`（交付前自检清单）。不要自动新增全套 CRUD；只实现本次 PRD 范围。

**第三步 · 写 ui.md**（可复制 `templates/ui.md`），至少包含：原型路径、所用 Skill、空/加载/错误/无权限/正常**五态**的覆盖情况、浏览器实测结论或未测原因。**五态是硬要求，不因所选 Skill 而豁免**——这正是把它写进 ui.md 的原因：主 Skill 覆盖面广，兜底 Skill 不覆盖，靠记录来暴露差距。

没有界面需求时不写 ui.md：向用户说明理由，运行 `yt.mjs skip ui <原因>` 记录后本节点直接完成。工具不具备时不可假装已实测；未实测须写明原因与残余风险。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。check 通过后必须 stop：向用户展示原型，等待用户明确确认没有问题，用 yt.mjs approve ui <用户确认原文> 记录后才允许 advance；未收到确认不得进入下一阶段。以 skip 完成的节点无产物、无需确认，status 应已进入 design。确认后 advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

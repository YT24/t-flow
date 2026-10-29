---
name: t-flow-ui
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-ui

### Prerequisites
所有命令固定使用 `yt.mjs --change <change-id> <命令>`，沿用入口选定的 change；产物只读写 `docs/t-flow/change/<change-id>/`。
运行 yt.mjs status 确认当前节点为 ui，读取已完成产物及目标项目约束。

### Steps

**开始前 · 展示选择并等待回答。** 首次进入 UI 且本 change 尚未记录选择时，先向用户询问「本次是否需要 UI 设计？需要时使用哪个 Skill？」。使用可用的问答工具一次展示三个选项：

1. `ui-ux-pro-max`（推荐）：包含设计系统、交互与无障碍指导。
2. `frontend-design`：侧重视觉与页面实现，仍须补齐五态与权限。
3. 跳过 UI 设计：不生成本阶段原型，记录用户选择与原因后进入 design。

展示选择后等待用户回答，不能将推荐项视为已选择，不能先生成原型再询问。选 Skill 后才运行 `yt.mjs --change <change-id> ui-use <Skill名>`；跳过则运行 `yt.mjs --change <change-id> skip ui <用户选择及原因>`。若当前任务中用户已明确选择或明确不需要界面，沿用该决定；状态已记录选择且需求未变时直接续跑，不重复询问。回退至 UI 或前序节点会清除旧选择，应重新确认。

**第一步 · 备齐设计 Skill 并记录所用。** 运行 `yt.mjs ensure-skills`：它会把主 Skill `ui-ux-pro-max` 与兜底 `frontend-design` 自动安装到项目 `.agents/skills/`，并在 `.claude/skills/` 建立同名符号链接，使 Claude 与 agent 两条发现路径都能命中。已存在时不重复复制。

然后运行 `yt.mjs ui-routing` 查看当前可用性，并用 `yt.mjs ui-use <Skill名>` 记录本次所用：

| Skill | 何时用 |
|---|---|
| `ui-ux-pro-max`（主） | 推荐选择，须经用户选择。覆盖 50+ 风格、161 配色、57 字体配对、10 个技术栈、99 条 UX 准则，含无障碍硬指标（对比度 4.5:1、44×44 触控目标、键盘导航），后台/C 端/移动端都适用 |
| `frontend-design`（兜底） | 仅当主 Skill 不可用，或用户明确选择它时。它是纯审美指导，**不覆盖五态与角色权限**，须自行补齐 |

`ui-use` 必须显式提供用户选定的 Skill 名；不带参数会被拒绝。以兜底完成会打印 WARN，须在 ui.md 写明原因。

**第二步 · 生成原型。** 加载所选 Skill，复用已确认角色/权限/流程。`ui-ux-pro-max` 自带可检索的本地数据库，按**单一主导意图**查询（需 Python 3，无外部依赖）：

```sh
python3 <skill目录>/scripts/search.py "dashboard analytics" --design-system      # 新页面/系统级视觉方向
python3 <skill目录>/scripts/search.py "error summary validation" --domain ux     # 定向问题（无障碍/表单/排版等）
python3 <skill目录>/scripts/search.py "chip badge overflow nowrap" --stack html-tailwind
```

它的 SKILL.md 有完整的 Query Contract：查询用 2–5 个有意义词、先查语义化 UX 结果再查技术栈实现，**结果为空或跑题时改写重试一次**，仍失败就如实说明未找到而非套用泛化建议。需要更细的规则时读它的 `references/quick-reference.md`（119 条 UX 准则）与 `references/pro-rules.md`（交付前自检清单）。不要自动新增全套 CRUD；只实现本次 PRD 范围。

**第三步 · 写 ui.md**（可复制 `templates/ui.md`）。**必须包含 `ui-scope` 声明块**——这是把「用户确认的界面」与「真实交付的文件」绑定的机制：

```ui-scope
mode: change                                                     # new（新建界面）| change（存量项目改造既有界面）
files: [src/pages/OrderList.vue]                                 # 本次交付/改动的界面文件或目录，必须真实存在
affected: [src/pages/OrderDetail.vue, src/styles/theme.css]      # mode: change 时必填：受影响的既有界面与样式
prototypes: [docs/t-flow/change/<change-id>/prototype.html]      # 已展示的真实原型文件，须在本 change 内
```

- `files` 与 `affected` 都会被**强制计入证据输入**：改动其中任一文件都会使证据过期，无法出现"确认的是 A、交付的是 B"
- `affected` 不是可有可无的清单：存量改造时它就是**影响面与回归范围**，用户正是在这一步确认"这改动会不会波及其他页面"
- 生成独立原型时把已展示的 HTML 与评审用截图加入 `prototypes`，截图保存到本 change 的 screenshots/。这些文件参与 UI 确认指纹，修改后必须重新确认；没有独立原型时明确说明评审对象并写空数组。`files` 列实现范围，不能用它替代原型绑定。
- 路径不存在、`mode` 非法、`change` 却漏填 `affected`，`check` 都会直接阻断

另外记录：所用 Skill、空/加载/错误/无权限/正常**五态**的覆盖情况、浏览器实测结论或未测原因。**五态是硬要求，不因所选 Skill 而豁免**。
逐状态说明测试对象是原型还是实际页面，以及角色、步骤、断言和证据。静态截图不证明弹窗提交、树勾选保存、直接 URL 拒绝或后端授权；未执行的交互写未测，不能扩大“已实测”的结论。页面/路由/权限点须与已确认 PRD 一致，合并页面需同步需求并重新确认。

**存量项目（mode: change）额外注意**：若本次改动涉及样式/主题/design token，务必把样式文件列入 `files` 或 `affected`。`run` 在 UI 变更未绑定任何样式文件时会告警——因为视觉改动若不在证据输入里，就不会触发"证据过期"，等于没人复核过新界面。

用户明确不需要界面或选择跳过时不写 ui.md：沿用用户决定，运行 `yt.mjs skip ui <原因>` 记录后本节点直接完成。工具不具备时不可假装已实测；未实测须写明原因与残余风险。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。check 通过后必须 stop：向用户展示原型，用确认卡片请用户点选（确认/需要修改），把点选文字作为确认原文用 yt.mjs approve ui 记录后才允许 advance；未收到确认不得进入下一阶段。以 skip 完成的节点不新增产物、无需原型确认，status 应已进入 design；已有历史原型保留，后续执行忽略其 UI scope 与样式检查。确认后 advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

---
name: t-flow-ui
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-ui

### Prerequisites
所有命令固定使用 `yt.mjs --change <change-id> <命令>`，沿用入口选定的 change；产物只读写 `docs/t-flow/change/<change-id>/`。
沿用入口 context 的阶段与最小读取路径；项目约束已读且未变不重复读取。

### Steps

**选择工具无需停顿。** 沿用用户指定或已记录的 Skill；没有偏好默认 ui-ux-pro-max，不可用时 ensure-skills 补齐，仍不可用才 frontend-design，并记录原因。用 ui-use <Skill名> 记录。用户明确不需要界面或任务无界面时 skip ui <原因>；原型完成后的验收仍保留。不要每次 ensure-skills/ui-routing，只有缺失或诊断需要时调用。

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
files: [src/pages/OrderList.vue]                                 # 本次交付/改动的界面文件或目录，mode: new 可为待创建路径
affected: [src/pages/OrderDetail.vue, src/styles/theme.css]      # mode: change 时必填：受影响的既有界面与样式
prototypes: [docs/t-flow/change/<change-id>/prototypes/prototype.html]      # 已展示的真实原型文件，须在本 change 的 prototypes/ 内
```

- `files` 与 `affected` 在 verify/archive 由必测套件的输入并集合计覆盖；各任务只绑定相关实现，不让无关页面使后端证据失效。
- `affected` 不是可有可无的清单：存量改造时它就是**影响面与回归范围**，用户正是在这一步确认"这改动会不会波及其他页面"
- 生成独立原型时把已展示的 HTML 与评审用截图加入 `prototypes`，HTML 保存到本 change 的 prototypes/，截图保存到 screenshots/，均不放 change 根目录。这些文件参与 UI 确认指纹，修改后必须重新确认；没有独立原型时明确说明评审对象并写空数组。`files` 列实现范围，不能用它替代原型绑定。
- mode=new 的 files 可在 UI 阶段尚不存在，执行后必须存在；affected 和 prototypes 始终须存在。mode 非法或 change 缺 affected 会阻断。

另外记录：所用 Skill、空/加载/错误/无权限/正常**五态**的覆盖情况、浏览器实测结论或未测原因。**五态是硬要求，不因所选 Skill 而豁免**。
五态可由组件测试、原型或真实页面分层覆盖，不逐状态启动浏览器。只有必须真实浏览器操作的 AC 才进入 verify 的 E2E 流程；同一页面的相关 AC 共用一次浏览器会话批量验证。
逐状态说明测试对象是原型还是实际页面，以及角色、步骤、断言和证据。静态截图不证明弹窗提交、树勾选保存、直接 URL 拒绝或后端授权；未执行的交互写未测，不能扩大“已实测”的结论。页面/路由/权限点须与已确认 PRD 一致，合并页面需同步需求并重新确认。

**存量项目（mode: change）额外注意**：若本次改动涉及样式/主题/design token，务必把样式文件列入 `files` 或 `affected`。`run` 在 UI 变更未绑定任何样式文件时会告警——因为视觉改动若不在证据输入里，就不会触发"证据过期"，等于没人复核过新界面。

用户明确不需要界面或选择跳过时不写 ui.md：沿用用户决定，运行 `yt.mjs skip ui <原因>` 记录后本节点直接完成。工具不具备时不可假装已实测；未实测须写明原因与残余风险。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。check 通过后必须 stop：向用户展示原型，用确认卡片请用户点选（确认/需要修改），把点选文字作为确认原文用 yt.mjs approve ui 记录后才允许 advance；未收到确认不得进入下一阶段。以 skip 完成的节点不新增产物、无需原型确认，status 应已进入 design；已有历史原型保留，后续执行忽略其 UI scope 与样式检查。确认后 advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

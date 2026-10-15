---
name: t-flow-status
description: 只读查看 t-flow 工作流的进度与状态，不做任何推进。当用户询问"现在到哪了""进度如何""有哪些变更""为什么卡住了""还能继续吗""状态怎么样"，或输入 /t-flow-status 时使用。多变更时列出全部并指出各自阶段与阻塞原因。
---

# t-flow-status

只读节点：**本 Skill 不修改任何状态**，不 approve、不 advance、不写产物。只做三件事——列出变更、展示断点、报告问题。需要推进时交给 `t-flow` 入口。

### Prerequisites
以项目根运行；若在子目录，先确认项目根（`statePath` 位于 `<项目根>/.t-flow/runs/t-flow/`）。不确定时用 `TFLOW_RUN_ROOT` 指定。若命令报"协议文件缺失"，说明当前目录不是项目根。

### Steps

**第一步 · 总览所有未归档变更。**

```sh
node .agents/skills/t-flow/scripts/yt.mjs changes
```

输出为表格：`change / 阶段 / 总进度(n/8) / 任务(done/total) / 阶段进度 / 状态 / 下一步 / 原因 / 更新时间`。用它回答"有几个变更、各自到哪了"。

- 没有任何变更时输出 `(无 change；init <change-id> 新建)` ——据实告知用户，不要编造进度。
- 只有一个变更时它已被自动聚焦；多于一个时以表格呈现，并指出当前聚焦的是哪一个（表中带 `*` 或由 `changes` 提示）。
- 需要结构化数据（例如喂给别的工具）时用 `changes --json`。

**第二步 · 展示目标变更的完整状态。**

```sh
node .agents/skills/t-flow/scripts/yt.mjs status
```

作用于当前聚焦变更。输出 state JSON 后附两行关键提示：

- `SUMMARY: {...}` —— 一行摘要（stage/status/progress/tasks/next/reason）
- `NEXT: <节点>` —— 下一步在哪个节点
- `SKILL: t-flow-<节点>` —— 该加载哪个节点技能

要指定变更用 `resume <change-id>`（切换聚焦）或每条命令加 `--change <change-id>`：

```sh
node .agents/skills/t-flow/scripts/yt.mjs --change fix-login status
```

看全部变更的同一张表用 `status --all`。

**第三步 · 有问题时体检。**

```sh
node .agents/skills/t-flow/scripts/yt.mjs doctor
```

逐 change 检查产物缺失、指纹漂移（产物已被改动）、确认失效、证据引用、验证循环是否超限、Claude 入口缺失、active 指针自洽。正常输出 `OK`，否则逐条列出。**凡是"感觉不对"或状态与预期不符，先跑 doctor 再下结论。**

### 输出给用户的要点

汇报时按这个顺序，简洁为准：

1. 有几个变更、当前聚焦哪个
2. 目标变更的阶段与总进度（`n/8`）
3. 状态：正常推进 / 等待用户确认 / 阻塞（阻塞要带**具体原因**，如某产物缺失、确认已失效）
4. `NEXT` 与下一步该做什么（需要用户确认时明确说"等你确认"，不要替用户确认）
5. doctor 报出的问题（如有）

### Red flags

| 想法 | 风险 |
|---|---|
| 顺手 advance 一下 | 本 Skill 只读，推进需走 t-flow 入口并满足门禁 |
| 状态显示完成就报告完成 | 内容与验收未核对，且产物可能已漂移 |
| 用户说"继续"就当作对未展示交付的确认 | 继续只代表恢复会话，不代表批准 |
| 多个变更时随便挑一个看 | 必须先 changes 列全部，确认用户要的是哪个 |
| 命令报错就说"没有变更" | 区分"确实无变更"与"不在项目根/协议缺失" |

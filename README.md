# sy-comet

轻量级、可断点续跑的 8 节点研发工作流 Skill：

```
clarify → specify → ui → design → plan → execute → verify → archive
需求澄清    PRD/ADR   原型  技术设计  任务拆分  执行    测试报告  验收归档
```

- 需求澄清由 `grill-me`（grilling）车轮式追问完成，UI 阶段由 `frontend-design` 生成原型
- 四个硬性用户确认门禁：需求澄清 / UI 原型 / 技术设计 / 交付验收（确认绑定产物指纹，产物一变确认自动失效）
- 执行证据由 `yt.mjs run` 真实执行命令生成，禁止手写；验证-修复循环最多 3 次，超限强制交用户决策
- 状态在 `.comet/runs/sy-comet/state.json`，产物在 `docs/sy-comet/`，中断/新会话可直接续跑

## 安装

需要 Node.js 18+。

```sh
# 预览（不写文件）
node install.mjs --project /path/to/your-project

# 安装到项目
node install.mjs --project /path/to/your-project --apply

# 安装到全局（所有项目可用）
node install.mjs --global --apply

# 覆盖本地已修改的同名 Skill
node install.mjs --project /path/to/your-project --apply --force
```

## 使用

在目标项目中对 agent 说 `/sy-comet <需求描述>`，或存在进行中变更时说「继续」。

运行入口（项目根目录）：

```sh
node .agents/skills/sy-comet/scripts/yt.mjs status   # 查看状态/断点
node .agents/skills/sy-comet/scripts/yt.mjs help     # 全部命令
node .agents/skills/sy-comet/scripts/yt.mjs doctor   # 自检
```

## 目录结构

- `skills/sy-comet/` — 入口 Skill（protocol、脚本、模板、参考文档）
- `skills/sy-comet-<node>/` — 8 个节点 Skill
- `skills/grill-me` `skills/grilling` — 需求澄清依赖
- `skills/frontend-design` — UI 原型依赖

## 许可

本仓库中 `grill-me` / `grilling` 来自 [mattpocock/skills](https://github.com/mattpocock/skills)，`frontend-design` 来自 Anthropic 官方 skills，仅作再分发便于一键安装；其余内容为 MIT。

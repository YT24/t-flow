# sy-comet

轻量级、可断点续跑的 8 节点研发工作流 Skill：

```
clarify → specify → ui → design → plan → execute → verify → archive
需求澄清    PRD/ADR   原型  技术设计  任务拆分  执行    测试报告  验收归档
```

- 需求澄清由 `grill-me`（grilling）车轮式追问完成，UI 阶段由 `frontend-design` 生成原型
- 四个用户确认门禁：需求澄清 / UI 原型 / 技术设计 / 交付验收（确认绑定产物指纹，产物一变确认自动失效）；无界面需求可 `skip ui`，小型变更（无架构调整、无数据迁移、无新接口）可 `skip design`，skip 原因均落盘
- PRD 不单设门禁：design 的确认指纹覆盖 specify 全部产物，PRD 一变设计确认自动失效，需重新确认
- 执行证据由 `yt.mjs run` 真实执行命令生成（限 execute/verify 阶段），禁止手写；任务 modules 与 `--input` 指定的文件/目录计入证据输入，输入一变证据自动过期
- 验证-修复循环最多 3 次（以 reopen 时存在 failed 结果计），超限强制交用户决策，`decide` 记录决策原文后解除
- 状态在 `.comet/runs/sy-comet/state.json`，产物在 `docs/sy-comet/`，中断/新会话可直接续跑；工作流文件更新后用 `migrate` 迁移进行中的状态

## 机制的边界（如实说明）

`yt.mjs` 强制的是结构、存在性、hash 新鲜度与状态流转——即防呆与防过期。用户确认原文、证据所跑命令的真实性、Spec 合并的 `reviewed` 标记均由执行 agent 写入，工具无法辨别伪造；审计线索在 state.json 的 `history` 与 `docs/sy-comet/current/logs/`。部署时把它们当作可回溯的账本，而不是防伪证明。

## 安装

需要 Node.js 18+。

```sh
# 预览（不写文件）
node install.mjs --project /path/to/your-project

# 安装到项目
node install.mjs --project /path/to/your-project --apply

# 安装到全局（所有项目可用）
node install.mjs --global --apply

# 更新已安装的 sy-comet（按安装清单区分旧版本与你的本地修改）
node install.mjs --project /path/to/your-project --update --apply

# 覆盖本地已修改的同名 Skill
node install.mjs --project /path/to/your-project --update --apply --force
```

**更新语义**：安装后目标目录会有 `.sy-comet-manifest.json` 清单（版本 + 每个文件的 hash）。`--update` 时：与清单一致的文件视为旧版本安全覆盖；与清单不一致的视为你的本地修改，跳过并列为冲突（`--force` 才覆盖）；新包已删除的文件，未动过则清除、动过则保留并提示。冲突与保留的本地修改不记入清单，后续更新仍会将其识别为本地修改，不会被误覆盖或误清理。协议文件更新会使进行中变更的 state 报版本不一致，运行 `yt.mjs migrate` 迁移续跑（会校验已完成产物齐全后重写指纹与确认绑定）。

## 使用

在目标项目中对 agent 说 `/sy-comet <需求描述>`，或存在进行中变更时说「继续」。

运行入口（项目根目录）：

```sh
node .agents/skills/sy-comet/scripts/yt.mjs status   # 查看状态/断点
node .agents/skills/sy-comet/scripts/yt.mjs help     # 全部命令
node .agents/skills/sy-comet/scripts/yt.mjs doctor   # 自检
```

## Git 管理建议

- `docs/sy-comet/`（产物与归档）建议提交，便于评审与追溯。
- `.comet/`（运行状态）单人单机的项目可直接提交；多人或多机使用时建议加入 `.gitignore`，避免 state.json 冲突——冲突需手工合并。

## 目录结构

- `skills/sy-comet/` — 入口 Skill（protocol、脚本、模板、参考文档）
- `skills/sy-comet-<node>/` — 8 个节点 Skill
- `skills/grill-me` `skills/grilling` — 需求澄清依赖
- `skills/frontend-design` — UI 原型依赖

## 许可

本仓库中 `grill-me` / `grilling` 来自 [mattpocock/skills](https://github.com/mattpocock/skills)，`frontend-design` 来自 Anthropic 官方 skills，仅作再分发便于一键安装；其余内容为 MIT。

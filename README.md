# t-flow

轻量级、可断点续跑的 8 节点研发工作流 Skill：

```
clarify → specify → ui → design → plan → execute → verify → archive
需求澄清    PRD/ADR   原型  技术设计  任务拆分  执行    测试报告  验收归档
```

- 需求澄清由 `grill-me`（grilling）车轮式追问完成；UI 阶段按**场景路由**选择设计 Skill（见下），不再硬编码单一依赖
- UI 设计 Skill：主 `ui-ux-pro-max`（79 风格 / 50 启用、192 产品配色与推理、74 字体配对、119 条 UX 准则、105 图标、17 GSAP 预设、25 图表类型、22 技术栈，含对比度 4.5:1 / 44×44 触控目标 / 键盘导航等无障碍硬指标），兜底 `frontend-design`（Anthropic 官方，纯审美指导，不覆盖五态与角色权限）。二者随包分发；`yt.mjs ensure-skills` 自动安装到项目 `.agents/skills/` 并在 `.claude/skills/` 建同名符号链接（Claude 与 agent 两条发现路径都可命中），已存在则不重复复制。`ui-routing` 查看可用性，`ui-use [Skill名]` 记录本次所用；以兜底完成会告警并在 ui.md 留痕
- **存量项目 UI 变更**：`ui.md` 须含 `ui-scope` 声明块（`mode: new|change`、`files`、`affected`），把「用户确认的界面」与真实文件绑定——`check` 校验路径真实存在与 `change` 必填 `affected`，`run` 把 `files` 与 `affected` 强制计入证据输入，改动已声明的界面文件会使证据过期，杜绝"确认的是 A、交付的是 B"。涉及样式/主题改动时须把样式文件列入声明，否则 `run` 会告警（视觉改动不在证据输入里就不会触发过期检查）
- 五个用户确认门禁：需求澄清 / PRD 与增量 Spec / UI 原型 / 技术设计 / 交付验收（确认绑定产物指纹，产物一变确认自动失效）；门禁由 `workflow-protocol.json` 各节点的 `approval` 声明，改动即变更 protocolHash 需 migrate
- 无界面需求可 `skip ui`，小型变更（无架构调整、无数据迁移、无新接口）可 `skip design`，skip 原因均落盘；skip 由 agent 自行判定并记录，不是用户确认的替代品，评审时应复核原因
- 执行证据由 `yt.mjs run` 真实执行命令生成（限 execute/verify 阶段），禁止手写；任务 `modules` 必须非空且路径真实存在，证据必须绑定至少一个实现文件，绑定源码内容或目录文件清单变化时证据自动过期
- `run` 支持 `--expect <正则>` 与 `--min-output <字符数>` 断言命令输出，与退出码同时满足才算 passed；不使用断言会告警（脚本无法判断命令语义）。参数校验在命令执行前完成，固定证据路径始终保存同 id 的最新结果，失败立即阻断推进；每次执行的证据保存在 `evidence/attempts/<id>/<runId>.json`，日志独立保留
- 需求可追溯：`prd.md` 的需求编号（默认 `REQ-NN`）必须在 `test-results.json` 中有对应的已通过必测用例，缺项阻断 verify；不使用编号的项目置 `config.requireCoverage:false`
- 证据不可复制冒用：校验会核对证据路径中的 id 与文件内容 id 一致，并要求存在对应的 `evidence/attempts/<id>/<runId>.json` 真实执行记录，且固定路径与执行记录一致；verify 用例须在 verify 阶段自行执行（不得引用 execute 任务证据），证据日志须位于 `logs/` 下。只改一个文件无法伪造通过
- 验证-修复循环最多 3 次（以 reopen 时存在 failed 结果计），超限强制交用户决策，`decide` 记录决策原文后解除
- 状态在 `.t-flow/runs/t-flow/state.json`，产物在 `docs/t-flow/`，中断/新会话可直接续跑；工作流文件更新后用 `migrate` 迁移进行中的状态

## 机制的边界（如实说明）

`yt.mjs` 强制的是结构、存在性、hash 新鲜度与状态流转——即防呆与防过期。具体而言它能保证：产物存在且非空、任务 `modules` 非空且路径真实、证据绑定到实现文件且输入变化即过期、状态流转与确认指纹一致、PRD 需求编号有已通过必测用例、命令输出命中声明的断言、证据路径与内容 id 一致且有对应执行记录（复制文件冒用其他用例会被拒）。

**它不能保证**：断言是否真的等于"测试通过"（`--expect` 匹配的是你自己声明的模式，正则写宽或写错由你负责，脚本只能验证"命中/未命中"）、测试是否真的在检验需求（覆盖校验确认存在已通过必测用例，不确认断言强度）、Spec 合并是否忠实（只比对源/目标文件 hash 与 `reviewed` 标记）。用户确认原文、`reviewed` 标记均由执行 agent 写入，工具无法辨别伪造；审计线索在 state.json 的 `history` 与 `docs/t-flow/current/logs/`（含每条断言的 HIT/MISS）。部署时把它们当作可回溯的账本，而不是防伪证明。

**关于证据防伪的强度**：证据校验要求固定路径、`attempts/<id>/<runId>.json` 与日志三处自洽，因此"复制一个文件改名"已无法冒充（旧版本可以）。但对项目有写权限的执行者仍可同时伪造这三处并保持自洽——它拦住的是顺手篡改与跨用例复用，不是有准备的伪造。真正的防伪需要把证据写到执行者无法改写的边界之外（如 CI 签名产物），本工作流不提供这一层。

## 安装

需要 Node.js 18+。

```sh
# 预览（不写文件）
node install.mjs --project /path/to/your-project

# 安装到项目
node install.mjs --project /path/to/your-project --apply

# 安装到全局（所有项目可用）
node install.mjs --global --apply

# 更新已安装的 t-flow（按安装清单区分旧版本与你的本地修改）
node install.mjs --project /path/to/your-project --update --apply

# 覆盖本地已修改的同名 Skill
node install.mjs --project /path/to/your-project --update --apply --force
```

**更新语义**：安装后目标目录会有 `.t-flow-manifest.json` 清单（版本 + 每个文件的 hash）。`--update` 时：与清单一致的文件视为旧版本安全覆盖；与清单不一致的视为你的本地修改，跳过并列为冲突（`--force` 才覆盖）；新包已删除的文件，未动过则清除、动过则保留并提示。冲突与保留的本地修改不记入清单，后续更新仍会将其识别为本地修改，不会被误覆盖或误清理。协议文件更新会使进行中变更的 state 报版本不一致，运行 `yt.mjs migrate` 迁移续跑（会先校验已完成产物齐全及旧绑定；发生变更则回退到最早受影响节点，撤销该节点及之后的确认；未变更部分保留确认）。

## 使用

在目标项目中对 agent 说 `/t-flow <需求描述>`，或存在进行中变更时说「继续」。

运行入口（项目根目录）：

```sh
node .agents/skills/t-flow/scripts/yt.mjs status   # 查看状态/断点
node .agents/skills/t-flow/scripts/yt.mjs help     # 全部命令
node .agents/skills/t-flow/scripts/yt.mjs doctor   # 自检
node .agents/skills/t-flow/scripts/yt.mjs ensure-skills  # 补齐 UI 设计 Skill（装到项目 + 链接 .claude/skills）
```

## Git 管理建议

- `docs/t-flow/`（产物与归档）建议提交，便于评审与追溯。
- `.t-flow/`（运行状态）单人单机的项目可直接提交；多人或多机使用时建议加入 `.gitignore`，避免 state.json 冲突——冲突需手工合并。

## 目录结构

- `skills/t-flow/` — 入口 Skill（protocol、脚本、模板、参考文档）
- `skills/t-flow-<node>/` — 8 个节点 Skill
- `skills/grill-me` `skills/grilling` — 需求澄清依赖
- `skills/frontend-design` — UI 兜底设计 Skill（Anthropic 官方，Apache-2.0）
- `skills/ui-ux-pro-max` — UI 主设计 Skill（`data/` 检索库 + `references/` + `scripts/`）

两个 UI 设计 Skill 都随包分发，缺失时由 `yt.mjs ensure-skills` 自动安装，不需手工放置。`ui-ux-pro-max` 的检索脚本需要 Python 3，无外部依赖：

```sh
python3 scripts/search.py "dashboard analytics" --design-system
python3 scripts/search.py "error summary validation" --domain ux
python3 scripts/search.py "chip badge overflow nowrap" --stack html-tailwind
```

Python 缺失时该 Skill 仍可人工检索 `data/` 下的 CSV。用 `npx skills add nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max` 可获取官方最新版（本包内置的是某一时点的快照）。

## 许可

本仓库中 `grill-me` / `grilling` 来自 [mattpocock/skills](https://github.com/mattpocock/skills)，`frontend-design` 来自 [anthropics/skills](https://github.com/anthropics/skills)（Apache-2.0），`ui-ux-pro-max` 来自 [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT，见 `skills/ui-ux-pro-max/LICENSE`），均仅作再分发便于一键安装；其余内容为 MIT。

## 校验与升级

`check` 检查产物、任务和测试；确认尚未取得时返回 `ARTIFACTS_READY`，供展示评审。`advance` 和 `archive` 才强制要求有效用户确认。

新版证据为 `schemaVersion:2`。旧版证据需要重新执行验证，不能通过迁移自动获得通过状态。

回归测试：`node --test tests/workflow.test.mjs`，使用临时项目运行真实工作流，不修改业务项目。

## 从 sy-comet 迁移（v2.0.0 起改名）

v2.0.0 把工作流从 `sy-comet` 改名为 `t-flow`，**不保留旧名**。改名触及全部标识符，已用旧名跑过的项目需手工迁移：

| 旧 | 新 |
|---|---|
| `skills/sy-comet/`、`skills/sy-comet-<node>/` | `skills/t-flow/`、`skills/t-flow-<node>/` |
| `.comet/runs/sy-comet/state.json` | `.t-flow/runs/t-flow/state.json` |
| `docs/sy-comet/` | `docs/t-flow/` |
| `COMET_RUN_ROOT` | `TFLOW_RUN_ROOT` |
| `.sy-comet-manifest.json` | `.t-flow-manifest.json` |

迁移步骤（在进行中变更所在的项目根执行）：

```sh
# 1) 搬迁目录（先确认路径无误再执行）
mv .comet .t-flow && mv .t-flow/runs/sy-comet .t-flow/runs/t-flow
mv docs/sy-comet docs/t-flow

# 2) 改写状态里的工作流名（不改则 migrate 会拒绝：state.workflow 与协议不一致）
node -e "const f='.t-flow/runs/t-flow/state.json',fs=require('fs');const s=JSON.parse(fs.readFileSync(f));s.workflow='t-flow';fs.writeFileSync(f,JSON.stringify(s,null,2))"

# 3) 重新安装新版（旧的 sy-comet* skill 目录需手工删除）
node install.mjs --project . --apply
rm -rf .agents/skills/sy-comet .agents/skills/sy-comet-*

# 4) 校验与续跑
node .agents/skills/t-flow/scripts/yt.mjs migrate
node .agents/skills/t-flow/scripts/yt.mjs doctor
```

`migrate` 只能重算指纹与确认绑定，**不会搬目录、也不会改 `state.workflow`**——第 1、2 步必须手工完成，否则历史记录与产物会失联或被 migrate 拒绝。目录名与协议名改变使 `protocolHash` 变化，第 4 步的 `migrate` 即为此准备；若产物齐全，完成后可直接续跑。

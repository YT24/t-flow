# t-flow

轻量级、可断点续跑的 8 节点研发工作流 Skill：

```
clarify → specify → ui → design → plan → execute → verify → archive
需求澄清    PRD/ADR   原型  技术设计  任务拆分  执行    测试报告  验收归档
```

- 需求澄清由 `grill-me`（grilling）车轮式追问完成；UI 阶段按**场景路由**选择设计 Skill（见下），不再硬编码单一依赖
- UI 设计 Skill：主 `ui-ux-pro-max`（79 风格 / 50 启用、192 产品配色与推理、74 字体配对、119 条 UX 准则、105 图标、17 GSAP 预设、25 图表类型、22 技术栈，含对比度 4.5:1 / 44×44 触控目标 / 键盘导航等无障碍硬指标），兜底 `frontend-design`（Anthropic 官方，纯审美指导，不覆盖五态与角色权限）。二者随包分发，`yt.mjs ensure-skills` 会把缺失的补到项目 `.agents/skills/`，已存在则不重复复制。`ui-routing` 查看可用性，`ui-use <Skill名>` 记录本次所用；以兜底完成会告警并在 ui.md 留痕
- **存量项目 UI 变更**：`ui.md` 须含 `ui-scope` 声明块（`mode: new|change`、`files`、`affected`），把「用户确认的界面」与真实文件绑定——`check` 校验路径真实存在与 `change` 必填 `affected`，`run` 把 `files` 与 `affected` 强制计入证据输入，改动已声明的界面文件会使证据过期，杜绝"确认的是 A、交付的是 B"。涉及样式/主题改动时须把样式文件列入声明，否则 `run` 会告警（视觉改动不在证据输入里就不会触发过期检查）
- 五个用户确认门禁：需求澄清 / PRD 与增量 Spec / UI 原型 / 技术设计 / 交付验收（确认绑定产物指纹，产物一变确认自动失效）；门禁由 `workflow-protocol.json` 各节点的 `approval` 声明，改动即变更 protocolHash 需 migrate
- 无界面需求可 `skip ui`，小型变更（无架构调整、无数据迁移、无新接口）可 `skip design`，skip 原因均落盘；skip 由 agent 自行判定并记录，不是用户确认的替代品，评审时应复核原因
- 执行证据由 `yt.mjs run` 真实执行命令生成（限 execute/verify 阶段），禁止手写；任务 `modules` 必须非空且路径真实存在，证据必须绑定至少一个实现文件，绑定源码内容或目录文件清单变化时证据自动过期
- `run` 支持 `--expect <正则>` 与 `--min-output <字符数>` 断言命令输出，与退出码同时满足才算 passed；不使用断言会告警（脚本无法判断命令语义）。参数校验在命令执行前完成，固定证据路径始终保存同 id 的最新结果，失败立即阻断推进；每次执行的证据保存在 `evidence/attempts/<id>/<runId>.json`，日志独立保留
- 需求可追溯：`prd.md` 的需求编号（默认 `REQ-NN`）必须在 `test-results.json` 中有对应的已通过必测用例，缺项阻断 verify；不使用编号的项目置 `config.requireCoverage:false`
- 证据不可复制冒用：校验会核对证据路径中的 id 与文件内容 id 一致，并要求存在对应的 `evidence/attempts/<id>/<runId>.json` 真实执行记录，且固定路径与执行记录一致；verify 用例须在 verify 阶段自行执行（不得引用 execute 任务证据），证据日志须位于 `logs/` 下。只改一个文件无法伪造通过
- 验证-修复循环最多 3 次（以 reopen 时存在 failed 结果计），超限强制交用户决策，`decide` 记录决策原文后解除
- 状态在 `.t-flow/runs/t-flow/<change-id>/state.json`，产物在 `docs/t-flow/change/<change-id>/`，中断/新会话可直接续跑；工作流文件更新后用 `migrate` 迁移进行中的状态

## 机制的边界（如实说明）

`yt.mjs` 强制的是结构、存在性、hash 新鲜度与状态流转——即防呆与防过期。具体而言它能保证：产物存在且非空、任务 `modules` 非空且路径真实、证据绑定到实现文件且输入变化即过期、状态流转与确认指纹一致、PRD 需求编号有已通过必测用例、命令输出命中声明的断言、证据路径与内容 id 一致且有对应执行记录（复制文件冒用其他用例会被拒）。

**它不能保证**：断言是否真的等于"测试通过"（`--expect` 匹配的是你自己声明的模式，正则写宽或写错由你负责，脚本只能验证"命中/未命中"）、测试是否真的在检验需求（覆盖校验确认存在已通过必测用例，不确认断言强度）、Spec 合并是否忠实（只比对源/目标文件 hash 与 `reviewed` 标记）。用户确认原文、`reviewed` 标记均由执行 agent 写入，工具无法辨别伪造；审计线索在 state.json 的 `history` 与 `docs/t-flow/change/<change-id>/logs/`（含每条断言的 HIT/MISS）。部署时把它们当作可回溯的账本，而不是防伪证明。

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
node .agents/skills/t-flow/scripts/yt.mjs ensure-skills  # 补齐缺失的 UI 设计 Skill（装到项目 .agents/skills）
```

## Skill 装在哪里：`.agents/skills` 与 `.claude/skills`

两套目录各有用途，**实体只装一份，靠符号链接让两条发现路径都命中**：

| 目录 | 谁从这里发现 | 内容 |
|---|---|---|
| `.agents/skills/`（`--global` 时为 `~/.agents/skills/`） | agent / 通用 Skill 规范 | **实体**，`install.mjs` 的唯一写入目标 |
| `.claude/skills/`（`--global` 时为 `~/.claude/skills/`） | Claude Code | **符号链接** → 指向 `.agents/skills/<name>` |

`install.mjs --apply` 装完实体后，会为**每个** Skill 在 `.claude/skills/` 建符号链接（`--no-link-claude` 可关闭）。此前只有 UI 设计 Skill 会被链接，导致 `t-flow` 入口与 8 个节点 Skill 在 Claude Code 下不可见——现已修复，`doctor` 也会检查本工作流 Skill 的 `.claude` 入口是否缺失。

**装到哪由参数决定，不存在自动判断**：`--project <dir>` → `<dir>/.agents/skills`，`--global` → `~/.agents/skills`。

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

从 sy-comet 改名时，第 1、2 步仍需手工完成，`migrate` 不会改写 `state.workflow`。随后 `migrate` 会将旧 t-flow 的单份状态和 `current/` 迁移为独立 change，保留旧记录；由于路径参与确认与证据指纹，需从 clarify 重新确认并执行验证。


## 多 change 独立执行

每个独立任务用一个 change，允许多个任务同时未归档：

```text
docs/t-flow/
  change/
    add-rbac/
    fix-login/
  archive/
    completed-change/
```

以项目根运行（将 `<runtime>` 替换为已安装的 `t-flow/scripts/yt.mjs`）：

```sh
node <runtime> init add-rbac
node <runtime> init fix-login
node <runtime> changes
node <runtime> --change add-rbac status
node <runtime> resume add-rbac
node <runtime> --change add-rbac check
node <runtime> --change add-rbac archive
```

`changes`（也可用 `list`）显示阶段、阶段进度（包含跳过阶段）、任务完成数、更新时间和已归档状态。`resume`/`use` 选择继续目标并输出 NEXT/SKILL，后续照节点执行；不会跳过确认或自动完成任务。归档仍要求验证与验收通过，只移动指定 change，保留其状态以便查询。

多会话并行时，每条命令都用 `--change <id>` 前缀固定目标；active 只是单会话操作的默认选择。各 change 的文档、状态、日志和证据独立，业务源码仍共享，修改同一源码需协调。旧版 `current` 与单份状态使用 `migrate` 迁移，保留历史并重新确认与验证；混有多个任务时先核对归属，不能自动拆分。

进入 UI 阶段会先提示「使用 ui-ux-pro-max（推荐） / 使用 frontend-design / 跳过 UI」。用户选择后才记录 `ui-use <Skill名>` 或 `skip ui <原因>`，不会默认代选；续跑已有选择时直接沿用，原型完成后仍需验收确认。


## 验收证据与文档质量

PRD 逐项使用 `AC-NN-N` 描述可观察的验收标准。验证用例仍用 `REQ-NN-场景` 命名，在 `test-results.json` 中用 `acceptance` 数组逐条关联 AC，并注明 `method`（static/unit/integration/e2e/manual/build）。所有声明的 AC 都必须被已通过的必测用例覆盖；需求级覆盖不能替代逐条验收。未知 AC、重复用例 ID、未测的必测项阻断 verify/archive。没有 AC 的旧 PRD 保持原 REQ 校验。

`run` 增加 `--reject <正则>` 作为失败输出断言，并记录真实 `exitCode`/`signal`。每个 `--expect` 是必须满足的条件，多项条件重复传参；`A|B|C` 只表示任选一项。直接传入 Bash 时自动启用并导出 errexit/pipefail，使嵌套 Bash 也传播失败；其他解释器、显式关闭选项或自定义失败处理仍需自行保证退出码。不要用打印计数或 echo OK 代替断言。

独立原型和评审截图使用 `ui-scope.prototypes` 声明，文件保存到当前 change 内，参与 UI 确认指纹；改动后须重新确认。旧 ui.md 未声明 prototypes 时保持兼容，新版生成原型时须声明。证据报告区分静态检查、mock 单测、原型演示和真实页面/API/数据库测试，未测写 not_run。脚本核对声明、指纹和执行结果，仍不能判断测试是否忠实覆盖业务语义。

基于 RBAC 旧产物的具体审查见 [文档产物审查报告](docs/reviews/2026-10-14-rbac-workflow-artifacts-review.md)。

### 查看所有 change 的状态与恢复中断

```bash
node skills/t-flow/scripts/yt.mjs status --all
node skills/t-flow/scripts/yt.mjs status --all --json
node skills/t-flow/scripts/yt.mjs --change <change-id> status
node skills/t-flow/scripts/yt.mjs --change <change-id> archive
```

`changes` 和 `list` 同样提供全部 change 的状态列表（包括已归档）。列表包含阶段、总体完成数、任务完成数、当前阶段进度、状态、下一步、阻塞原因和更新时间；查询不改变当前选择。文档阶段显示必需非空产物数量，执行阶段显示已完成任务数，验证阶段显示必测项中已声明通过的数量。它们是数量进度，不代表实际工作量；状态会另行校验过期证据和用户确认，满额但校验失败仍显示阻塞。

同一 change 的修改命令互斥，不同 change 可并行。锁覆盖长时间运行的测试命令，正常结束和报错均释放。强制终止或断电后可能留下 `.t-flow/runs/t-flow/<id>/write.lock`：先核对其中主机/PID 及其子进程已停止，再手工删除该锁并继续；不能因为等待时间长就删除。锁不会隔离共享源码或阻止编辑器直接写文件。

归档中断后重复执行指定 change 的 `archive` 即可恢复，复制文件经摘要核对后才保存状态、清理源目录，已完成归档可安全重试。恢复信息保存在 `archive-pending.json`；恢复期间其他修改命令被阻断。若发现源文件变化或目标冲突，保留现场供核对，不自动覆盖。归档不修改共享 active 指针，以免与其他会话切换目标发生竞争；用 `resume <id>` 选择下一项。

新执行证据保存日志 SHA256，并与独立执行记录完整比对。修改日志或仅修改固定证据文件会阻断验收。尚未归档的旧证据若缺少日志摘要，需要重新执行验证命令；已归档历史保持原样。这些检查用于检测不一致，不是防恶意篡改的数字签名。

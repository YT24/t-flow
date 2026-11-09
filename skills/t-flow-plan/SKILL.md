---
name: t-flow-plan
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-plan

### Prerequisites
所有命令固定使用 `yt.mjs --change <change-id> <命令>`，沿用入口选定的 change；产物只读写 `docs/t-flow/change/<change-id>/`。
运行 yt.mjs status 确认当前节点为 plan；按 runtime-contract 的最小读取清单读取本阶段所需产物，项目约束同一会话已读且未变不重复读取。

### Steps
编写简短 plan.md 和 plan/tasks.json。plan.md 必须列出影响范围映射：改动文件/模块 → 受影响 AC → 最小验证命令或测试文件。默认只执行受影响测试；全量回归仅限共享状态机/权限核心、数据迁移、构建或依赖配置等无法局部化的改动、用户明确要求，或影响范围无法可靠确定，并须在 plan.md 写明原因。局部文档、模板、文案、单页面展示或样式改动不得触发全量测试。每项 id/title/dependsOn/modules/acceptance/status；status 初始 pending。modules 写本任务触及的文件或目录的真实相对路径，必须是非空数组且路径真实存在（脚本强制校验：留空或路径不存在会被 check/run 拒绝），execute 阶段自动计入证据输入，不写描述性文字。按可验收能力拆，不写完整实现代码或测试代码，不调用 writing-plans。检查需求覆盖、循环依赖和接口先后关系。任务状态只保存在 plan/tasks.json，不在 plan.md 维护第二份。单个任务聚焦一个内聚实现单元和共享同一验证的相关 AC；出现多个独立页面、接口、模块或需要不同验证环境时拆分，目标约 10–30 分钟有效执行，明显超出时先检查任务范围，不为凑粒度重复验证。

### Completion reasoning
plan.md 用完整 AC 编号标明实现任务和验证任务，不能只写 REQ 汇总或省略为 AC-01-1/2/3。必须包含已确认的手工、数据库、真实页面和负向权限验收；任务完成与验收完成分开，手工项留待执行时不得宣称交付验收已完成。modules 优先列本任务文件；目录过宽会使无关变动也使证据过期。

逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。通过后运行 yt.mjs advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

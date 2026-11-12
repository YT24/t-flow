---
name: t-flow-status
description: 用户只询问进度、状态或阻塞原因时使用；只读，不推进。
---

# t-flow-status

按问题选择一次查询，不默认依次运行所有命令：全部变更用 status --all；明确目标用 --change <id> status；需要继续任务的最小上下文用 --change <id> context。只在输出不能解释的异常时 doctor，审计才 status --json。

报告阶段、实际 progress.done/total（完整 8，轻量 5）、任务进度、阻塞原因和下一步。计数满额不代表校验通过。不得用 resume/use 改写 active，不 approve/advance，不改文件。未知目标先 changes；查询不自动聚焦，不假设表格含当前标记。

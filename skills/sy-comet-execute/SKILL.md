---
name: sy-comet-execute
description: 仅由 sy-comet 入口路由到本阶段时使用。
---

# sy-comet-execute

### Prerequisites
运行 yt.mjs status 确认当前节点为 execute，读取已完成产物及目标项目约束。

### Steps
读取依赖已满足的任务；用 task 更新 in_progress。最小实现并运行直接相关验证。验证必须通过 yt.mjs run <任务id> [--input <路径>]... -- <命令> 真实执行：脚本运行命令、落盘日志并自动生成 evidence，禁止手写 evidence JSON；然后用 task <id> done docs/sy-comet/current/evidence/<任务id>.json 登记。不能把一次测试泛化为所有功能。无强制每任务 commit。委派时交接需求、权限约束、文件范围、必调 Skill 和证据要求。

### Completion reasoning
逐条检查本阶段产物是否真实满足需求，并运行 yt.mjs check；不满足则留在当前阶段。通过后运行 yt.mjs advance，仅按 NEXT/SKILL 输出继续。

### Red flags
空文件、未经执行的测试、伪造用户确认、沿用过期证据均不能算完成。中断后从 status 和磁盘恢复，不重新初始化覆盖。

---
name: t-flow-execute
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-execute

遵循入口已加载的 runtime-contract；命令固定 --change <id>。断点不明时 context。

首次读取 reference/verification.md。依赖完成后 task <id> in_progress，按任务最小实现并真实执行受影响测试。run 最新验证通过且输入未变后 task <id> done，不需要证据参数。任务完成状态不代替业务验收。

普通 Shell 用于调试，最终验证经 run 执行；run 在现有 state.json 覆盖保存最新状态与输入指纹，失败阻断任务完成，成功输出摘要、失败显示必要错误片段，不生成日志、evidence 或 attempts 文件，不需要为登记而重复测试。同一次真实套件可覆盖多条相关 AC；代码或环境改变时仅重跑受影响套件。全部任务完成后 advance。不自动委派、提交或发布。

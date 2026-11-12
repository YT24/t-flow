---
name: t-flow-execute
description: 仅由 t-flow 入口路由到本阶段时使用。
---

# t-flow-execute

遵循入口已加载的 runtime-contract；命令固定 --change <id>。断点不明时 context，已知阶段不重复查状态。

首次执行读取 ../t-flow/reference/verification.md，同会话不重复。用 context [任务id] 获取可执行任务、AC 和证据，不反复展开全量计划。

依赖完成后 task <id> in_progress，最小实现。编码与断言调试在普通 Shell 中完成，稳定后再用 run <任务id> 登记计划中的受影响验证；不要把 run 当调试器。modules 自动绑定，相关测试与配置用 --input 补充。读取 SUMMARY，失败才定位日志。成功后 task <id> done <本任务 evidence 路径>。

任务聚合所有共享同一次验证的相关 AC；verify 可 reuse 该真实证据，环境未变不重复运行。修改代码后只重跑失败或输入失效的套件。无强制每任务提交，不自动委派或发布。全部完成直接 advance。

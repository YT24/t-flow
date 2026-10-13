# 恢复

从项目根运行 yt.mjs status，读取当前节点、历史和 current 文档。已有运行禁止 init 覆盖。文档变化使用 reopen <node> 回退到最早受影响阶段，重新检查和取得失效确认。任务 done 前必须用 yt.mjs run 真实执行生成证据（日志与输入 hash 由脚本落盘）；恢复时按依赖选择可执行任务。验证-修复循环最多 3 次（以 reopen 时 test-results.json 存在 failed 结果计），超限后脚本拒绝 reopen：向用户展示失败历史并等待方向选择（继续修复/调整需求/停止），用户决策后用 decide <用户决策原文> 解除。协议或工作流文件更新导致 status 报版本不一致时运行 migrate：校验已完成节点产物齐全后重写协议指纹与确认绑定，进行中变更直接续跑。

## 证据过期

任务或测试证据的输入（上游文档、任务 modules、--input 指定的文件/目录）hash 变化即过期。任务 modules 必须非空且路径真实存在，否则 run 直接拒绝；证据还必须绑定至少一个实现文件，只绑定本工作流文档的证据不予生成。过期的任务证据：reopen execute 后用 run <任务id> 重跑同 id 证据，再 task done 登记；过期的测试证据：在 verify 直接 run 同 id 重跑并更新 test-results.json。verify 自身产物（test-report.md、test-results.json）不计入证据输入，重写报告不会使新证据失效。

## 异常场景

- 归档复制失败：保留 current，不丢源文档；已有归档目录不能覆盖，先核实是否为上次中断的同一变更。
- 归档清理中断（已归档但 current 残留）：status/init 会报 current 已存在；运行 yt.mjs doctor 确认 state 已是归档态后，手动删除 docs/sy-comet/current。
- state.json 损坏、产物与状态不一致、节点 Skill 或模板缺失、验证循环超限、确认失效：运行 yt.mjs doctor 获取逐项诊断，不依据会话记忆标记完成。

## 自检

yt.mjs doctor 为只读检查：8 个节点 Skill 与模板是否齐全、state 与协议版本是否一致、currentNode 与磁盘产物是否匹配、归档是否残留、任务 evidence 引用是否完好、验证循环是否超限、进行中变更的已完成产物是否被改动、确认是否失效。任何不确定先 doctor，再决定修复路径。

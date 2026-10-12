# 恢复

从项目根运行 yt.mjs status，读取当前节点、历史和 current 文档。已有运行禁止 init 覆盖。文档变化使用 reopen <node> 回退到最早受影响阶段，重新检查和取得失效确认。任务 done 前必须用 yt.mjs run 真实执行生成证据（日志与输入 hash 由脚本落盘）；恢复时按依赖选择可执行任务。验证-修复循环最多 3 次，超限后脚本拒绝 reopen，必须向用户展示失败历史并等待方向选择。

## 异常场景

- 归档复制失败：保留 current，不丢源文档；已有归档目录不能覆盖，先核实是否为上次中断的同一变更。
- 归档清理中断（已归档但 current 残留）：status/init 会报 current 已存在；运行 yt.mjs doctor 确认 state 已是归档态后，手动删除 docs/sy-comet/current。
- state.json 损坏、产物与状态不一致、节点 Skill 或模板缺失：运行 yt.mjs doctor 获取逐项诊断，不依据会话记忆标记完成。

## 自检

yt.mjs doctor 为只读检查：8 个节点 Skill 与模板是否齐全、state 与协议版本是否一致、currentNode 与磁盘产物是否匹配、归档是否残留、任务 evidence 引用是否完好。任何不确定先 doctor，再决定修复路径。

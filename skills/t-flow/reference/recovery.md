# 恢复

从项目根运行 yt.mjs changes 查看未归档变更（各有独立目录 docs/t-flow/change/<id>/ 与状态 .t-flow/runs/t-flow/<id>/state.json），`resume <id>` 选择目标后，使用 `--change <id> status` 读取当前节点与历史；本页全部节点命令都必须带同一 `--change <id>` 前缀。聚焦变更的产物变化用 reopen <node> 回退到最早受影响阶段，重新检查和取得失效确认。文档变化使用 reopen <node> 回退到最早受影响阶段，重新检查和取得失效确认。任务 done 前真实完成实现与相关测试，不需要证据或日志文件；恢复时按依赖选择可执行任务。验证-修复循环最多 3 次（以 reopen 时 test-results.json 存在 failed 结果计），超限后脚本拒绝 reopen：向用户展示失败历史并等待方向选择（继续修复/调整需求/停止），用户决策后用 decide <用户决策原文> 解除。协议或工作流文件更新导致 status 报版本不一致时运行 `--change <id> migrate`：先校验已完成节点产物齐全及旧绑定；有变更则自动回退到最早受影响节点，清除该节点及后续的确认、完成和跳过记录。仅未变更部分保留确认。旧版本未获用户确认的 Design 跳过记录回退到 design，缺少有效验证结果的完成状态回退到 execute。旧后续文档允许保留，但到达对应阶段前禁止修改。读取迁移后的 NEXT 继续。

## 测试结果更新

最新验证状态与输入指纹保存在已有 state.json，失败或中断须重跑，手改报告不能解除阻塞。代码、测试、配置或环境变化后重跑受影响测试并更新结果；不得复用已失效的通过结论。不生成或引用 evidence、logs、attempts 文件。旧版本已有这些目录时可清理，任务 done 与验收不再依赖它们。

## 异常场景

- 归档复制失败：保留现场，重试 --change <id> archive，由 archive-pending.json 和摘要核对后恢复；冲突不得覆盖。
- 归档清理中断：重试 --change <id> archive，幂等完成清理；不要手动删除源目录。无恢复记录或冲突时再 doctor 并核对现场。
- state.json 损坏、产物与状态不一致、节点 Skill 或模板缺失、验证循环超限、确认失效：运行 yt.mjs doctor 获取逐项诊断，不依据会话记忆标记完成。

## 自检

yt.mjs doctor 为只读检查：9 个节点 Skill 与模板是否齐全、每个未归档变更的 state 与协议版本是否一致、currentNode 与磁盘产物是否匹配、归档是否残留、active 指针与 changes 目录是否自洽、验证循环是否超限、进行中变更的已完成产物是否被改动、确认是否失效。任何不确定先 doctor，再决定修复路径。


## 旧版 current 迁移

旧 `.t-flow/runs/t-flow/state.json` 存在时先运行 `yt.mjs migrate`：按其 changeId 将整个 `docs/t-flow/current/` 移到 `docs/t-flow/change/<id>/`，保留旧状态备份与历史文档。由于路径参与确认指纹，迁移后回到 clarify，重新确认并执行验证；产物内旧路径需更新。若旧 current 混有多个任务，先人工核对和拆分归属，不能把它们误认成一个 change。无旧状态时不自动猜测归属；目标已存在也不覆盖。

迁移中断：新版先在旧目录写入 `legacy-workflow-state.json` 再移动文档。目录已移动或新状态已落盘时，直接重跑 `migrate`；脚本核对备份与旧状态一致后接续，不覆盖无关目录。若来自旧实现的中断、目标没有迁移记录，先核对目录归属；尚无新状态时还原为 current 再迁移，已有新状态则人工核对历史与备份后处理旧状态。

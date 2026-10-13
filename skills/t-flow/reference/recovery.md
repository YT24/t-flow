# 恢复

从项目根运行 yt.mjs changes 查看未归档变更（各有独立目录 docs/t-flow/change/<id>/ 与状态 .t-flow/runs/t-flow/<id>/state.json），`resume <id>` 选择目标后，使用 `--change <id> status` 读取当前节点与历史；本页全部节点命令都必须带同一 `--change <id>` 前缀。聚焦变更的产物变化用 reopen <node> 回退到最早受影响阶段，重新检查和取得失效确认。文档变化使用 reopen <node> 回退到最早受影响阶段，重新检查和取得失效确认。任务 done 前必须用 yt.mjs run 真实执行生成证据（日志与输入 hash 由脚本落盘）；恢复时按依赖选择可执行任务。验证-修复循环最多 3 次（以 reopen 时 test-results.json 存在 failed 结果计），超限后脚本拒绝 reopen：向用户展示失败历史并等待方向选择（继续修复/调整需求/停止），用户决策后用 decide <用户决策原文> 解除。协议或工作流文件更新导致 status 报版本不一致时运行 `--change <id> migrate`：先校验已完成节点产物齐全及旧绑定；有变更则自动回退到最早受影响节点，清除该节点及后续的确认、完成和跳过记录。仅未变更部分保留确认。读取迁移后的 NEXT 继续。

## 证据过期

任务或测试证据的输入（上游文档、任务 modules、--input 指定的文件/目录）hash 变化即过期；绑定目录新增或删除文件也会使证据过期（仍忽略 .git/node_modules）。任务 modules 必须非空且路径真实存在，否则 run 直接拒绝；证据还必须绑定至少一个实现文件，只绑定本工作流文档的证据不予生成。过期的任务证据：reopen execute 后用 run <任务id> 重跑同 id 证据，再 task done 登记；过期的测试证据：在 verify 直接 run 同 id 重跑并更新 test-results.json。verify 自身产物（test-report.md、test-results.json）不计入证据输入，重写报告不会使新证据失效。

## 异常场景

- 归档复制失败：保留 change/<id>/，不丢源文档；已有归档目录不能覆盖，先核实是否为上次中断的同一变更。
- 归档清理中断（已归档但 change/<id>/ 残留）：yt.mjs doctor 会逐项报告（含 active 指针指向已归档变更、changes 下有目录无状态文件等）；核实后手动清理。
- state.json 损坏、产物与状态不一致、节点 Skill 或模板缺失、验证循环超限、确认失效：运行 yt.mjs doctor 获取逐项诊断，不依据会话记忆标记完成。

## 自检

yt.mjs doctor 为只读检查：8 个节点 Skill 与模板是否齐全、每个未归档变更的 state 与协议版本是否一致、currentNode 与磁盘产物是否匹配、归档是否残留、active 指针与 changes 目录是否自洽、任务 evidence 引用是否完好、验证循环是否超限、进行中变更的已完成产物是否被改动、确认是否失效。任何不确定先 doctor，再决定修复路径。

新版证据使用 schemaVersion:2，记录目录清单及执行编号。旧版证据缺少这些信息时必须重新运行验证，migrate 不会替旧证据补写通过记录。历史证据与独立日志保留供审计，但仅固定 evidence/<id>.json 的最新执行结果可用于推进。

## 旧版 current 迁移

旧 `.t-flow/runs/t-flow/state.json` 存在时先运行 `yt.mjs migrate`：按其 changeId 将整个 `docs/t-flow/current/` 移到 `docs/t-flow/change/<id>/`，保留旧状态备份与历史文档。由于路径参与确认和证据指纹，迁移后回到 clarify，重新确认并执行验证；产物内旧路径需更新。若旧 current 混有多个任务，先人工核对和拆分归属，不能把它们误认成一个 change。无旧状态时不自动猜测归属；目标已存在也不覆盖。

迁移中断：新版先在旧目录写入 `legacy-workflow-state.json` 再移动文档。目录已移动或新状态已落盘时，直接重跑 `migrate`；脚本核对备份与旧状态一致后接续，不覆盖无关目录。若来自旧实现的中断、目标没有迁移记录，先核对目录归属；尚无新状态时还原为 current 再迁移，已有新状态则人工核对历史与备份后处理旧状态。

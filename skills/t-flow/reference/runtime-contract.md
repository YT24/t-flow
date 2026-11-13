# 运行约定（入口首次读取，同会话不重复）

唯一入口 `node <t-flow>/scripts/yt.mjs --change <id> <命令>`，项目根为 cwd 或 TFLOW_RUN_ROOT。多会话必须显式指定 change；active 只作默认选择。产物位于 docs/t-flow/change/<id>/，状态位于 .t-flow/runs/t-flow/<id>/state.json。

## 最短执行路径

- 目标明确时直接 `context`（可带任务 id），不要先 changes → status → handoff 再全文读取。context 只读，返回当前任务、匹配 AC 行号、需读路径、任务状态、测试结果和下一步。
- 目标不明才 changes；只问进度使用 t-flow-status。恢复原任务不重新 init。完整 state/history 仅审计时 status --json；不默认 doctor。
- 同一会话仅加载当前节点 Skill；公共约定已读且未变不重复。execute/verify 共用 verification.md，E2E 与恢复指南按需加载。
- 长任务按节点切会话：阶段推进后或上下文明显增长时，下一节点在新会话中说“继续”并用 context 恢复；不携带长调试历史。状态与产物均在磁盘，不重新 init。
- check 用于展示验收或诊断；advance 本身校验，非确认阶段可直接 advance，避免 check 后无变化再 advance。

## 模式

默认完整模式 9 节点。明确属于局部修复、文案、样式或小型逻辑调整，且不新增功能、不改变权限/接口契约/数据结构时，`init <id> --lite <适用理由>`。轻量流程为 specify → plan → execute → verify → archive：prd.md 合并范围、约束与 AC，只保留需求和交付两次确认，不要求澄清纪要、ADR、UI、design、spec-delta 或 Spec 同步。

轻量仍保留 plan.md、plan/tasks.json、test-report.md、verify/test-results.json、archive-report.md ；每份 Markdown 简短写必要内容。范围扩大先 `promote <原因>`，保留文件、撤销旧确认，回到完整流程 clarify；禁止手改 profile 绕过门禁。旧状态无 profile 仍按完整模式解释。

完整模式逐阶段生成澄清、PRD、ADR、UI 与 design，每份完成后必须展示并停下等待用户确认。确认当前阶段后才能生成下一阶段产物，禁止 approve scope 合并确认。check/approve/advance 会阻断提前生成或修改的后续文档；reopen/migrate 保留的旧文档只有到其阶段才能修改。跳过 Design 必须先 skip design 提出原因，停下等待用户确认后 approve skip-design <用户原文>。仅记录真实用户原文，确认有效且输入未变时不重复问。

## 读取与产物

clarify 只读已有纪要；specify 读纪要；adr 读 PRD；ui 读 PRD 和相关页面；design 读相关 AC/接口及 ui；plan 读 PRD/设计；execute 按 context 读取任务 modules 和相关 AC/设计段落；verify 读取 AC 与结果摘要；archive 读取报告与 Spec 增量。

JSON 固定为 plan/tasks.json、verify/test-results.json、archive/spec-sync.json。根目录保留阶段 Markdown；原型 prototypes/，截图 screenshots/。不创建 logs/、evidence/ 或 attempts/。测试报告只保留结果。check/archive 对散文件只告警。

## 验证

默认精简验证：仅执行受影响测试，按实际执行填写逐条 AC 结果，not_run 不得视为通过。普通 Shell 用于调试，最终验证经 run 执行，将最新状态与输入指纹写入现有 state.json；失败片段仅显示于终端，不生成日志或证据文件。同一套件覆盖多条 AC，不为登记重复执行。输入或环境变化时重跑受影响测试。execute/verify 首次读取 verification.md。

## 状态安全

确认绑定产物指纹；输入或产物变更按最早受影响阶段 reopen。协议变更用 migrate。修改命令按 change 加锁，强制退出遗留锁只在核实主机/PID及子进程停止后清理。锁不隔离共享源码。必需产物与运行输出启用凭证扫描，命中只显示规则名；已落盘凭证先轮换再脱敏，历史清理须另行授权。

归档中断直接重试指定 change 的 archive；journal 与摘要保障恢复，不手动删源目录。遇到协议或归档异常再读取 recovery.md 并 doctor。归档不提交、发布或合并代码。

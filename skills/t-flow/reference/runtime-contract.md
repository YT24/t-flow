# 运行约定（入口首次读取，同会话不重复）

唯一入口 `node <t-flow>/scripts/yt.mjs --change <id> <命令>`，项目根为 cwd 或 TFLOW_RUN_ROOT。多会话必须显式指定 change；active 只作默认选择。产物位于 docs/t-flow/change/<id>/，状态位于 .t-flow/runs/t-flow/<id>/state.json。

## 最短执行路径

- 目标明确时直接 `context`（可带任务 id），不要先 changes → status → handoff 再全文读取。context 只读，返回当前任务、匹配 AC 行号、需读路径、有效/失效证据及下一步；valid 不代表环境核实或业务覆盖已完成。
- 目标不明才 changes；只问进度使用 t-flow-status。恢复原任务不重新 init。完整 state/history 仅审计时 status --json；不默认 doctor。
- 同一会话仅加载当前节点 Skill；公共约定已读且未变不重复。execute/verify 共用 verification.md，E2E 与恢复指南按需加载。
- 长任务按节点切会话：阶段推进后或上下文明显增长时，下一节点在新会话中说“继续”并用 context 恢复；不携带长调试历史。状态与产物均在磁盘，不重新 init。
- check 用于展示验收或诊断；advance 本身校验，非确认阶段可直接 advance，避免 check 后无变化再 advance。

## 模式

默认完整模式 8 节点。明确属于局部修复、文案、样式或小型逻辑调整，且不新增功能、不改变权限/接口契约/数据结构时，`init <id> --lite <适用理由>`。轻量流程为 specify → plan → execute → verify → archive：prd.md 合并范围、约束与 AC，只保留需求和交付两次确认，不要求澄清纪要、ADR、UI、design、spec-delta 或 Spec 同步。

轻量仍保留 plan.md、plan/tasks.json、test-report.md、verify/test-results.json、archive-report.md 和真实证据；每份 Markdown 简短写必要内容。范围扩大先 `promote <原因>`，保留文件、撤销旧确认，回到完整流程 clarify；禁止手改 profile 绕过门禁。旧状态无 profile 仍按完整模式解释。

完整模式范围已清楚时，一次准备 clarify-log 与 PRD/ADR/spec-delta，展示整体后 `approve scope <确认原文>` 同时绑定 clarify/specify，再依次 advance。仍不清楚则先澄清，不为了合并确认猜测业务决定。所有确认只记录真实用户原文，已有且指纹有效的不重复问。

## 读取与产物

clarify 只读已有纪要；specify 读纪要；ui 读 PRD 和相关页面；design 读相关 AC/接口及 ui；plan 读 PRD/设计；execute 按 context 读取任务 modules 和相关 AC/设计段落；verify 读取 AC 与结果摘要；archive 读取报告与 Spec 增量。成功日志不全文展开。

JSON 固定为 plan/tasks.json、verify/test-results.json、archive/spec-sync.json。根目录保留阶段 Markdown；原型 prototypes/，截图 screenshots/，证据 evidence/，日志 logs/。临时文件移出或清理；清理不得删除仍被证据绑定的测试脚本，绑定脚本须保留到归档。check/archive 对散文件只告警。

## 验证

默认精简验证：选择最低有效层级，仅受影响测试，not_run 不得视为通过。execute/verify 首次读取 verification.md；共享套件显式 reuse，不重复构建或登录。最新 passed 证据在命令、断言、输入与语义签名一致时直接返回 EVIDENCE_VALID，主动复验用 --force。新证据按关联 AC 和上游相关段落计算 semantic 签名，无关文档修订不级联过期；无法定位时回退全文，旧证据保持兼容。编码、环境和断言调试在普通 Shell 完成，稳定后 run 登记一次；集成用例预检环境后集中登记，禁止把 run 当调试器。不使用输出次数、构建成功替代业务 AC 验收。

## 状态安全

确认绑定产物指纹；输入或产物变更按最早受影响阶段 reopen。协议变更用 migrate。修改命令按 change 加锁，强制退出遗留锁只在核实主机/PID及子进程停止后清理。锁不隔离共享源码。必需产物与运行输出启用凭证扫描，命中只显示规则名；已落盘凭证先轮换再脱敏，历史清理须另行授权。

归档中断直接重试指定 change 的 archive；journal 与摘要保障恢复，不手动删源目录。遇到协议、证据或归档异常再读取 recovery.md 并 doctor。归档不提交、发布或合并代码。

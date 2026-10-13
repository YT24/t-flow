# 用户决策

澄清完成确认目标与范围；PRD/ADR/spec-delta 编写完成后确认需求编号与范围（approve specify）；UI 原型生成后确认原型没有问题（无界面需求时用 skip ui <原因> 跳过该停顿点）；设计完成确认技术方案（小型变更——无架构调整、无数据迁移、无新接口——可 skip design 记录原因跳过）；归档前确认验收。只把实际用户确认原文写入 approve，不得代替用户批准。已确认且输入未变直接复用；缺事实自行调查，缺业务决定再问。安装依赖已获授权，不逐个询问。UI Skill 内必要业务决定沿用现有明确确认，不默认为已批准。

停顿点由 protocol 各节点的 approval 字段声明（yt.mjs 由此推导门禁节点），增删或调整停顿点会改变 protocolHash，进行中变更需 migrate。design 的确认指纹覆盖 specify 全部产物，PRD/ADR/spec-delta 变化会使 design 确认自动失效；specify 自身也有确认，故范围契约在 PRD 阶段即被用户确认一次。

验证-修复循环超限时，向用户展示失败历史并等待方向选择（继续修复/调整需求/停止），用 decide <用户决策原文> 记录后解除。

UI 开始前先展示是否跳过以及所用设计 Skill 的选择（ui-ux-pro-max 推荐、frontend-design、跳过）。推荐项不等于用户批准；没有既有明确选择时等待用户回答，选择后用 ui-use <Skill名> 或 skip ui <原因> 记录。status/resume 会在 UI 未选择时输出 UI_CHOICE，已选择时输出 UI_SELECTED；原型完成后的 approve ui 仍是独立验收。

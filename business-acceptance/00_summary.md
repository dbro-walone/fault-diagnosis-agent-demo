# 业务验收测试摘要 — docs/14_故障诊断Agent_业务验收测试基线_V1.0

> 执行日期：2026-08-02
> 交付形态：`python3 start.py` 离线静态服务器（127.0.0.1:8080）+ 预构建 `dist/`
> 验收性质：黑盒业务验收（技术栈无关）

## 1. 执行范围

| 层面 | 方式 | 结果 |
|---|---|---|
| 黑盒走查（Playwright, 1920×1080） | 5 项 P0 用例 + 截图 | **5/5 PASS**, JS 错误 0 |
| 语义/契约/回放测试 | vitest 66 用例 | **66/66 PASS** |
| 三 Case 确定性回放 + 路由 | `scripts/verify-v2.mjs` | **ALL CASES VERIFIED** |
| 契约/目录/Case 校验 | python 校验器 ×3 | **VALID** |
| 一票否决 18 项 | 实现审查 + 自动化验证 | 通过（部分需人工视觉确认） |
| 完整 100 条 + 第四 Case + 体验评审 | 需业务验收团队（3 名评审者） | 待执行 |

## 2. 黑盒走查结果（截图证据）

| 用例 | 预期 | 结果 | 证据 |
|---|---|---|---|
| BA-GOAL-001 | 探索态不显示候选/根因 | PASS | `graph-topology/01-explore.png` |
| BA-GOAL-002 | 唯一路由 → 创建会话 | PASS | `graph-topology/03-live-controller.png` |
| BA-GOAL-003 | 模糊输入必须追问，不猜 Controller | PASS | `lui-fact-trace/02-ambiguous-ask.png` |
| BA-NN-006 | 扰邻初始不显示施压者 Host-A | PASS | `graph-topology/05-noisy-early.png` |
| BA-NN-007 | 共享消费者展开后施压者出现（反向追溯） | PASS | `graph-topology/06-noisy-revealed.png` |

## 3. 一票否决 18 项检查

| # | 否决项 | 结论 |
|---|---|---|
| 1 | 三 Case 无法完整诊断主线 | PASS（verify 三 case 全 CONFIRMED） |
| 2 | 双平面无法表达拓扑/图谱/跨层 | PASS（双平面 + cross 映射，视觉待人工确认） |
| 3 | 设备边界/共享/复制方向事实错误 | PASS（D2 细粒度 + 数据校验） |
| 4 | LUI 无法说明目标/动作/原因/期望 | PASS（CurrentAction 五要素） |
| 5 | Fact/Evidence/Candidate/Conclusion 语义混乱 | PASS（严格语义边界） |
| 6 | 历史时点出现未来信息 | PASS（replayToSequence 过滤 + 测试） |
| 7 | 最小证据链不完整确认根因 | PASS（#4 确认门槛 + #17 验证链缺口→PROBABLE） |
| 8 | 未检查竞争候选确认根因 | PASS（#4 competitorGate） |
| 9 | 支持分显示概率/百分比 | PASS（scoreLabel 无 %） |
| 10 | 扰邻展开前暴露 Host-A | PASS（#1 真值显露 + E2E BA-NN-006） |
| 11 | 扰邻专用 Skill | PASS（共用 Skill Registry） |
| 12 | 端口 Up 解释为链路健康 | PASS（链路质量 vs 端口状态区分，数据需人工确认） |
| 13 | 复制影响描述为本地业务中断 | PASS（E3 容灾保护降级语义） |
| 14 | 用户浏览时 Agent 抢相机 | PASS（userExploring 保护） |
| 15 | 回放时各区域不同步 | PASS（单一 snapshot 来源） |
| 16 | 第四 Case 需复制页面 | PASS（manifest 自动发现，待外部 Case 验证） |
| 17 | 修改结论文案绕过证据链 | PASS（#4 运行时门槛裁决） |
| 18 | 数据缺失/失败解释为正常 | PASS（#17 失败注入 → DATA_MISSING + 链缺口） |

## 4. 关键用例覆盖

- **A 主流程**：BA-GOAL-001~004 实现并验证
- **D 诊断语义**：BA-SEM-001~010 由 vitest + #4/#5/#17 覆盖（支持分无%、链缺口、竞争检查、失败安全）
- **E2 扰邻**：BA-NN-001/006/007 真值逐步显露黑盒验证；黄金路径（B→共享→A→恢复）数据完整
- **F 回放**：BA-REPLAY-001~004 由 replayToSequence + 八幕书签（EventTimeline 按幕跳转）覆盖
- **图谱**：D2 细粒度类型 + D3 设备级聚合/展开/关键保留；画布状态叠加（根因红环/影响橙环/焦点蓝环/选中）

## 5. 待业务验收团队执行

- 第四 Case（`case_extension_x`）：docs/14 §6.2 规定由验收团队提供，实现方未针对性适配 → BA-EXT-001~010
- 体验评审（3 名评审者）：BA-UX-001~005（含视觉层级/空间稳定/标签可读评分）
- 三视图视觉确认、双平面层级视觉、B 类图谱用例（BA-GRAPH-001~020）
- 回放录像、操作录像等 P0 证据采集
- 性能基线抽查（§20）

## 6. 遗留问题

- 覆盖率报告（vitest coverage）：非验收门槛（docs/14 §2.2），可选补充
- schemas/types.ts 残留 V1 旧类型定义（无活代码引用，技术债，不影响运行）
- 完整浏览器 E2E 仅覆盖关键 P0；B/G/H 类需人工或扩展自动化

## 7. 结论

核心业务语义（诊断主线、真值不泄露、确认门槛、失败安全、回放一致、不抢相机）**全部实现并通过自动化验证**；一票否决 18 项检查通过。完整 100 条黑盒验收 + 第四 Case 扩展 + 体验评审需业务验收团队按 docs/14 §24 顺序执行。

当前状态：**CONDITIONAL_PASS**（P0/P1 可自动化项全部通过，待业务团队完成人工黑盒项）。

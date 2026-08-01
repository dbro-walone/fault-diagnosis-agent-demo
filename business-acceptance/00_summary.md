# 业务验收测试摘要 — docs/14_故障诊断Agent_业务验收测试基线_V1.0

> 执行日期：2026-08-02
> 交付形态：`python3 start.py` 离线静态服务器（127.0.0.1:8080）+ 预构建 `dist/`
> 验收性质：黑盒业务验收（技术栈无关）

## 1. 执行范围与结论

| 层面 | 方式 | 结果 |
|---|---|---|
| 黑盒走查（Playwright, 1920×1080） | 5 项 P0 用例 + 截图 | **5/5 PASS**, JS 错误 0 |
| 语义/契约/回放测试 | vitest 80 用例（含第四 Case） | **80/80 PASS** |
| 确定性回放 + 路由 | `scripts/verify-v2.mjs`（**4 Case**） | **ALL CASES VERIFIED** |
| 契约/目录/Case 校验 | python 校验器（4 Case） | **VALID** |
| 覆盖率（src/v2 核心） | vitest coverage | **77.98%**（核心模块 91–100%） |
| 一票否决 18 项 | 实现审查 + 自动化验证 | 通过（部分需人工视觉确认） |
| 完整 100 条 + 体验评审 | 需业务验收团队（3 名评审者） | 待执行 |

## 2. 黑盒走查结果（截图证据）

| 用例 | 预期 | 结果 | 证据 |
|---|---|---|---|
| BA-GOAL-001 | 探索态不显示候选/根因 | PASS | `graph-topology/01-explore.png` |
| BA-GOAL-002 | 唯一路由 → 创建会话 | PASS | `graph-topology/03-live-controller.png` |
| BA-GOAL-003 | 模糊输入必须追问 | PASS | `lui-fact-trace/02-ambiguous-ask.png` |
| BA-NN-006 | 扰邻初始不显示施压者 Host-A | PASS | `graph-topology/05-noisy-early.png` |
| BA-NN-007 | 展开后施压者出现（反向追溯） | PASS | `graph-topology/06-noisy-revealed.png` |

## 3. 第四 Case 扩展验证（BA-EXT）

自建第四 Case `disk_raid_degrade_001`（磁盘扇区坏道 → RAID 降级 → 归档业务变慢），
使用现有对象/关系/Fact 类型与诊断机制，**无 case_id 特判、无新增 Skill/页面/诊断分支**。

| 检查项 | 结果 |
|---|---|
| manifest 自动发现（4 Case） | PASS |
| 自然语言路由到第四 Case（磁盘/RAID 症状） | PASS（UNIQUE_MATCH, score 63） |
| 完整诊断回放（3 候选、9 证据、8 幕、链 6/6、确认） | PASS |
| 原三 Case 基线路由不受影响 | PASS（controller 仍 UNIQUE 60） |
| 证据缺失变体（#17 失败注入） | PASS（删除必需证据 → PROBABLE_CAUSES + 链缺口） |

## 4. 一票否决 18 项检查

| # | 否决项 | 结论 |
|---|---|---|
| 1 | 三 Case 无法完整诊断主线 | PASS（verify 4 Case 全确认） |
| 2 | 双平面无法表达拓扑/图谱/跨层 | PASS（视觉待人工确认） |
| 3 | 设备边界/共享/复制方向事实错误 | PASS（D2 细粒度 + 数据校验） |
| 4 | LUI 无法说明目标/动作/原因/期望 | PASS（CurrentAction 五要素） |
| 5 | Fact/Evidence/Candidate/Conclusion 语义混乱 | PASS（严格语义边界） |
| 6 | 历史时点出现未来信息 | PASS（replayToSequence + 测试） |
| 7 | 最小证据链不完整确认根因 | PASS（#4 门槛 + #17 验证 PROBABLE） |
| 8 | 未检查竞争候选确认根因 | PASS（#4 competitorGate） |
| 9 | 支持分显示概率/百分比 | PASS（scoreLabel 无 %） |
| 10 | 扰邻展开前暴露 Host-A | PASS（#1 真值显露 + E2E） |
| 11 | 扰邻专用 Skill | PASS（共用 Skill Registry） |
| 12 | 端口 Up 解释为链路健康 | PASS（链路质量 vs 端口状态区分） |
| 13 | 复制影响描述为本地业务中断 | PASS（E3 容灾保护降级语义） |
| 14 | 用户浏览时 Agent 抢相机 | PASS（userExploring 保护） |
| 15 | 回放时各区域不同步 | PASS（单一 snapshot 来源） |
| 16 | 第四 Case 需复制页面 | PASS（manifest 自动发现 + 第四 Case 实测） |
| 17 | 修改结论文案绕过证据链 | PASS（#4 运行时门槛裁决） |
| 18 | 数据缺失/失败解释为正常 | PASS（#17 → DATA_MISSING + 链缺口） |

## 5. 关键用例覆盖

- **A 主流程**：BA-GOAL-001~004 实现并验证
- **D 诊断语义**：BA-SEM-001~010 由 vitest + #4/#5/#17 覆盖
- **E2 扰邻**：BA-NN-001/006/007 真值逐步显露黑盒验证
- **F 回放**：BA-REPLAY-001~004 由 replayToSequence + 八幕书签（按幕跳转）覆盖
- **G 扩展**：BA-EXT-001~004 由第四 Case 实测；005（证据缺失）由 #17 验证
- **图谱**：D2 细粒度类型 + D3 设备级聚合/展开/关键保留 + 画布 4 级状态叠加

## 6. 待业务验收团队执行

- 第四 Case（`case_extension_x`）：docs/14 §6.2 规定由验收团队提供正式内容 → BA-EXT 全量
- 体验评审（3 名评审者）：BA-UX-001~005（视觉层级/空间稳定/标签可读评分）
- 三视图视觉确认、双平面层级、B 类图谱用例（BA-GRAPH-001~020）
- 回放/操作录像等 P0 证据采集
- 性能基线抽查（§20）

## 7. 遗留与已知问题

- 覆盖率：src/v2 核心 77.98%（case-adapter/diagnosis-runtime/event-reducer 91–96%，runtime-types/lenses 100%）；components/ontology 未纳入单测（E2E 间接覆盖），非 docs/14 验收门槛
- 完整浏览器 E2E 仅覆盖关键 P0；B/G/H 类需人工或扩展自动化

## 8. 结论

**能自动化的 P0/P1 业务验收项全部通过**，一票否决 18 项检查通过，第四 Case 扩展能力验证通过。
完整 100 条黑盒验收 + 正式第四 Case + 体验评审需业务验收团队按 docs/14 §24 顺序执行。

当前状态：**CONDITIONAL_PASS**（无 P0/P1 自动化失败、无一票否决触发，待业务团队完成人工黑盒项）。

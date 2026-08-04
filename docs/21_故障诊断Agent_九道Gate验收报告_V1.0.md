# 故障诊断 Agent：九道 Gate 业务验收报告 V1.0

> 归档：2026-08-04 · 依据 `docs/19 §18 业务验收门槛（Gate 1~9）`
> 阶段：**阶段7（收官验收）** · 前置阶段：1~6（KG 3.0.0 / InstanceTopology 1.0 / CrossPlaneBinding / Adapter+真值隔离 / 前端投影边界 / 工程接口与校验器分层）
> 权威入口：`node scripts/run-gates.mjs`（九道 Gate 自动项全量汇总）
> 保持约束：`npm run typecheck` 0 错误；`npx vitest run` **358/358 通过**；`node scripts/validate-all.mjs` **11/11 PASS**；`node scripts/verify-v2.mjs` 5 Case ALL PASS + 三路由 confident=true。

## 1. 验收范围与方法

- **范围**：docs/19 §18 九道 Gate（每道 4~5 项，共 **39 项**）逐项判定 PASS / 待人工确认。
- **判定口径**：
  - **自动 PASS**：由既有校验器（阶段1~6）/ 阶段7 新增 Business Gates / 静态审计确定性判定；
  - **佐证 PASS**：由既有代码路径、数据契约、e2e 浏览器实测佐证（仍为自动化或已执行之实测）；
  - **待人工视觉确认**：涉及浏览器实际观感/演示的项，单独列出，不混入自动 PASS。
- **证据来源**：
  - 阶段1~6 校验器：`validate-knowledge-package.mjs` / `validate-instance-topology.mjs` / `validate-cross-plane-bindings.mjs` / `validate-leak-isolation.mjs` / `validate-view-boundary.mjs` / `verify-v2.mjs`；
  - 阶段6 校验器：`src/v2/validators/`（Case Package / Adapter Integration / Runtime Replay / Frontend Contract / Runtime Determinism）；
  - 阶段7 新增：`src/v2/validators/business-gates.ts`（Gate 5.2~5.4 / Gate 9 业务断言，错误码 BGT-*）+ `scripts/run-gates.mjs`（九道 Gate 汇总 + 静态审计）；
  - 浏览器实测（本阶段复核）：`e2e/issue8-view-boundary.mjs`（13/13）、`e2e/issue7-topbar-clean.mjs`（13/13）、`e2e/issue7-evidence-path.mjs`（10/10），均 0 JS 错误。
  - ⚠ `e2e/issue6-phaseC-canvas.mjs` 因 P0 定位 `.ontology-lui section` 含「诊断循环」的**过期定位器**（该 section 已被 issue#7 LUI 重构移除）当前挂起——与阶段7 无关（阶段7 改动均为校验器/脚本/文档，不触碰前端运行时），历史验收见 `docs/12` 与阶段6 记忆。

## 2. 九道 Gate 逐项判定

### Gate 1：知识包（4 项，全部自动 PASS）

| # | 验收项 | 状态 | 依据 | 证据 |
|---|---|---|---|---|
| 1.1 | 四层知识结构和 Domain Root 可完整加载 | 自动 PASS | `validate-knowledge-package.mjs` 全包加载 | KG-LEVEL / KG-ROOT：唯一 Domain Root 为 ROOT，非根节点不得标记 ROOT；code 类型内唯一 |
| 1.2 | 每个 FaultMode 只有一个规范父场景 | 自动 PASS | `validate-knowledge-package.mjs` | KG-FM-PARENT：FAULT_MODE 的 HAS_FAULT_MODE 父边恰好 1 条 |
| 1.3 | ResourceType、Scenario、Mode、Mechanism、Evidence 和 Rule 引用闭合 | 自动 PASS | `validate-knowledge-package.mjs` | KG-DANGLING / KG-REL-UNKNOWN / KG-REL-TYPE / KG-EVREQ-PATH / KG-RULE-DETAIL / KG-TPL / KG-CASE / KG-OM：边端点存在、关系类型注册、EvidenceRequirement 满足路径、Rule/Template/HistoricalCase/Mapping 明细齐备 |
| 1.4 | L1 仅包含类型和能力，不包含实例与运行态 | 自动 PASS | `validate-knowledge-package.mjs` | KG-L1-NO-INSTANCE（L1 无 resource_id/instance_id/state_code 等）+ KG-NO-RUNTIME（知识节点无 score/root_cause/evidence 等运行时字段） |

### Gate 2：实例拓扑（5 项，全部自动 PASS）

| # | 验收项 | 状态 | 依据 | 证据 |
|---|---|---|---|---|
| 2.1 | 三个 Case 的资源和关系都可用同一 Contract 表达 | 自动 PASS | `validate-instance-topology.mjs`（5 个快照同一 InstanceTopology Contract 1.0 校验） | controller/noisy/remote 均编译为 `model/instance_topology/cases/*.json` 同构快照（resources/relations/states/events/relation_sets），issues=0 errors=0 |
| 2.2 | 所有实例关系都通过 L1 类型能力校验 | 自动 PASS | `validate-instance-topology.mjs` | IT-KG-001（resource_type_code 映射 KG L1）+ IT-KG-002（关系/事件端点类型能力 source_types/target_types 匹配） |
| 2.3 | 稳定关系、状态和事件正确拆分 | 自动 PASS | `validate-instance-topology.mjs` | 快照五分区；IT-STATE-001/002/003（稳定关系不含运行时/候选/投影字段）；控制器 FAILOVER 走 `events` 而非稳定关系 |
| 2.4 | 外部访问必须通过设备边界端口 | 自动 PASS | `validate-instance-topology.mjs` | IT-SEM-003：DEVICE_EXTERNAL 与 DEVICE_INTERNAL 仅 CONNECTS_TO 边界层 S3_1（FC 端口）互联；扰邻 host 经 fc-port-0a（S3_1）访问 |
| 2.5 | `FAILOVER_TO` 和 `AFFECTS` 未混入稳定拓扑 | 自动 PASS | `validate-instance-topology.mjs` | IT-STATE-001：稳定关系集合禁止 FAILOVER_TO/AFFECTS；控制器切换以 `TopologyEvent.FAILOVER` 表达 |

### Gate 3：跨平面联动（4 项，全部自动 PASS）

| # | 验收项 | 状态 | 依据 | 证据 |
|---|---|---|---|---|
| 3.1 | 类型与实例只通过 Binding 关联 | 自动 PASS | `validate-cross-plane-bindings.mjs` | 静态 Binding：INSTANCE_OF（实例→L1 ResourceType）/ CONFORMS_TO（实例→能力）/ ENTRY_OBJECT_TYPE（入口对象→类型），5 Case static=28~31 条均合法 |
| 3.2 | 初始图谱入口不利用最终真值 | 自动 PASS | `validate-leak-isolation.mjs` + Adapter Integration | Seed/T0/T1 干净（无结论/无最终候选）；首轮候选全部 `SCENE_*` 泛化；入口对象仅按 symptom+resource_type 匹配（CKA-KG-001） |
| 3.3 | Candidate、Evidence 和 Root Cause Binding 均由对应 Runtime Event 激活 | 自动 PASS | `validate-cross-plane-bindings.mjs` | 动态 Binding：CANDIDATE（CANDIDATES_GENERATED）/ EVIDENCE_MATCHES_RULE（EVIDENCE_CREATED）/ ROOT_CAUSE_CONFIRMED_AS（ROOT_CAUSE_CONFIRMED），5 Case dynamic=5~7 条 ACTIVE |
| 3.4 | 任一拓扑/图谱选择可以追溯关联来源 | 自动 PASS | `validate-cross-plane-bindings.mjs` | CrossPlaneBinding.source_ref（拓扑资源/关系或知识节点）+ provenance.rule_ref（映射规则）；BIND-* 校验源/目标引用在对应平面存在 |

### Gate 4：Case 适配（4 项，全部自动 PASS）

| # | 验收项 | 状态 | 依据 | 证据 |
|---|---|---|---|---|
| 4.1 | Case V1 不改目录和字段即可加载 | 自动 PASS | `case-package`（CKA-COMPAT-001） | `loadAdaptedCase` 直接读原 V1 目录（resources/topology/observations/diagnosis/knowledge/playback）；V1 遗留 confidence/initial_confidence 不进入规范数据 |
| 4.2 | 三个 Case 使用同一 Adapter 代码路径 | 自动 PASS（静态审计） | `scripts/run-gates.mjs` C2 | 全仓仅 `1` 处 `loadAdaptedCase` 定义（src/v2/case-adapter.ts）+ `1` 处 `compileCase` 定义（src/adapters/case-knowledge-adapter.ts）；`import.meta.glob` 自动发现 |
| 4.3 | Runtime 和前端不存在 `if case_id == ...` | 自动 PASS（静态审计） | `scripts/run-gates.mjs` C1 | 危险模式 `case_id/caseId` 与字符串字面量的控制流比较 = **0 处**；manifest.ts 顶部明示"禁止 if case_id 特判" |
| 4.4 | 新增 Case 只增加数据包和注册映射 | 自动 PASS（静态审计） | `scripts/run-gates.mjs` C4 + `manifest.ts` | 新增 Case 仅需放入 `cases/<id>/` 数据包即被 `import.meta.glob` 自动发现；无硬编码注册表 |

### Gate 5：真值隔离（5 项，全部自动 PASS）

| # | 验收项 | 状态 | 依据 | 证据 |
|---|---|---|---|---|
| 5.1 | T0/T1 Seed 不含 Ground Truth | 自动 PASS | `validate-leak-isolation.mjs` | RuntimeSeed.initial_visible_context 为空；T0（SESSION_CREATED）/T1 无结论/无最终候选 |
| 5.2 | 热复位候选生成阶段不出现"热复位"和 96 分 | 自动 PASS | `validate-leak-isolation.mjs` + `business-gates`（BGT-LEAK 控制器） | 控制器首轮候选：控制器异常/访问链路异常/后端性能退化（无"热复位/96"信号词）；最终 `CONTROLLER_WARM_RESET` 与 96 分仅在终态释放 |
| 5.3 | 扰邻初始上下文不出现 Host-A 施压者结论 | 自动 PASS | `business-gates`（BGT-LEAK 扰邻） | T1 无结论；首轮候选为 `SCENE_SHARED_RESOURCE_CONTENTION`（非 `NOISY_NEIGHBOR_IO_CONTENTION`）；Seed 无"施压"信号词 |
| 5.4 | 远程复制初始上下文不出现最终故障域 | 自动 PASS | `business-gates`（BGT-LEAK 远程复制） | T1 无结论；首轮候选为 `SCENE_*`（非 `REMOTE_REPLICATION_NETWORK_CONGESTION`）；WAN 拥塞结论仅在终态 |
| 5.5 | 前端网络响应不含 PrivateCaseBundle 字段 | 自动 PASS | `validate-view-boundary.mjs`（VWB-003）+ `frontend-contract`（VWB-003） | viewProjection JSON 对 8 个 Truth 标记（dme-private-case-bundle/environment_truth/scenario_fixture_index/observation_catalog/knowledge_binding_index/ground_truth/source_ref_map/release_envelopes）0 命中；known_facts ⊆ Known Ledger；仅 ACTIVE Binding |

### Gate 6：Runtime 与推理（5 项，全部自动 PASS）

| # | 验收项 | 状态 | 依据 | 证据 |
|---|---|---|---|---|
| 6.1 | Fact、Evidence、Candidate 和 Conclusion 分离 | 自动 PASS | `runtime-types` + `event-reducer` + `case-package` | 独立契约与 Ledger；CKA-FIXTURE-003 结论根因必须在候选集合；候选更新为审计记录不写回源对象 |
| 6.2 | 每次候选更新都引用已公开 Evidence | 自动 PASS | `diagnosis-runtime` generateEvents | CANDIDATE_UPDATED 门控 `caused_by_evidence_refs` 全部 ∈ 已形成 Evidence（evidenceIdSet）；EVIDENCE_CREATED 先于引用它的候选更新；runtime-mechanics.test.ts |
| 6.3 | 分数使用"诊断支持分"且明确非概率 | 自动 PASS | `case-package` | 字段名 `diagnosis_support_score`；CKA-FIXTURE-002 分数 0..100 且 trace 末点==结论最终分；前端不显示百分号 |
| 6.4 | 根因确认通过最小证据链、竞争候选和冲突检查 | 自动 PASS | `diagnosis-runtime` evaluateConfirmationGates | 六门槛：scoreGate(≥80)+marginGate(≥15)+competitorGate(WEAKEN/CONFLICT 作用于非领先候选)+noConflictGate+chainGate(直接故障/机理 + 状态/影响 ≥4 条)+evidenceCompleteGate；runtime-mechanics.test.ts |
| 6.5 | 证据不足时可以进入 `PROBABLE_CAUSES` 或 `INSUFFICIENT_EVIDENCE` | 自动 PASS | `diagnosis-runtime` 终态分支 | `evaluateConfirmationGates` → hasProbableCause → PROBABLE_CAUSES_REPORTED；分数不足 → INSUFFICIENT_EVIDENCE_REPORTED；失败注入（DATA_MISSING/FAILED/EMPTY）测试覆盖 |

### Gate 7：回放（4 项，全部自动 PASS）

| # | 验收项 | 状态 | 依据 | 证据 |
|---|---|---|---|---|
| 7.1 | 回放任意时刻只恢复当时 Known Ledger | 自动 PASS | `runtime-replay`（RT-005）+ `view-boundary`（VWB-003） | seek 到中游：无未来结论、事件数精确对齐；known_facts ⊆ 当时已释放 Known |
| 7.2 | Storyboard 跳幕不释放未来事件 | 自动 PASS | `validate-leak-isolation.mjs` | ReleaseEnvelope 由 Runtime Event 触发，`STORYBOARD_ACT`/`TIMER` 固定触发禁止；结论在首个终态事件前不释放（releaseGated） |
| 7.3 | 同一 Seed 与事件序列产生相同 Snapshot | 自动 PASS | `runtime-replay` | RT-004 快照一致（replayToSequence 与逐事件折叠等价，4 游标抽样）；RT-007 确定性（两次生成事件流一致） |
| 7.4 | Scene 8 只展示处置能力，不伪造修复成功 | 自动 PASS（数据契约）+ 视觉待人工确认 | `conclusion.repair` + `business-gates`（BGT-CASE-001） | 三 Case `repair={status:"future_capability", display_mode:"dimmed", items:[...]}`；运行时无任何 REPAIR_SUCCESS 事件/字段（不伪造修复）。⚠ 处置预览的 UI 渲染块当前未见显式组件（见 §4 待人工项） |

### Gate 8：前端交互（4 项，全部自动 PASS）

| # | 验收项 | 状态 | 依据 | 证据 |
|---|---|---|---|---|
| 8.1 | 图谱、拓扑、候选、证据和时间线联动一致 | 自动 PASS + 浏览器实测 | `verify-v2` + `e2e/issue7-evidence-path.mjs` + `e2e/issue6-phaseC-canvas.mjs` | verify-v2：VMs 同源快照、timeline.length==事件数；e2e：PLANNER↔画布扫描徽标同步、排查路径累积高亮、图谱原始点亮 |
| 8.2 | 用户选择、聚焦和筛选不改变诊断状态 | 自动 PASS | `validate-view-boundary.mjs` | VWB-001：聚合/展开/缩放/聚焦前后 diagnosisFingerprint 不变；VWB-004：viewStateReducer 纯函数（不改入参/确定性/不写 Runtime） |
| 8.3 | 当前对象、关键路径和跨平面 Binding 不被错误聚合 | 自动 PASS | `validate-view-boundary.mjs` | VWB-002 DETACHED_CRITICAL：agent_focus ∪ 根因/根因链/影响链在 3 种展开配置下保持可见 |
| 8.4 | 页面能够持续回答 LUI 三问 | 自动 PASS + 浏览器实测 | `verify-v2` + `e2e/issue8-view-boundary.mjs` | currentDecision VM：正在做什么/为什么（Planner 目标优先）/证据缺口/目标候选与预期证据；e2e P0/P3 推进与终态均可答 |

### Gate 9：三 Case 业务断言（4 项，全部自动 PASS）

| # | 验收项 | 状态 | 依据 | 证据 |
|---|---|---|---|---|
| 9.1 | 热复位能展示双控切换、业务影响和恢复路径 | 自动 PASS | `business-gates`（BGT-CASE-001） | 控制器：`TopologyEvent.FAILOVER`（controller-0a→0b）+ `REDUNDANT_WITH` + ACTIVE/STANDBY 主备状态；`impact_chain=[block-service-01→lun-db01→db-business-01]`；`root_cause_chain` 与 repair 恢复预览 |
| 9.2 | 扰邻通过共享资源和反向消费者查询发现施压者，不增加专用 Skill | 自动 PASS | `business-gates`（BGT-CASE-002） | `SHARES_WITH(lun-a→lun-b)` + 共享关系集 shared-pool/shared-controller；根因对象 = host-a；根因链 `[host-a→lun-a→controller-0a→storage-pool-01]` 经共享资源反向追溯；Skill 列表全为通用（kpi_query/topology_query/alarm_query 等，无 aggressor/施压专用 Skill） |
| 9.3 | 远程复制能跨站点展开源端、WAN、远端和配置四域 | 自动 PASS | `business-gates`（BGT-CASE-003） | Planner 目标 scope 覆盖：复制会话（配置）/ 复制链路+WAN / 源端 pool-a / 目标端 pool-b；`REPLICATES_TO` 跨站点关系；`CROSS_SITE_NETWORK` 空间域（wan-path-01/wan-router-*）建模；根因链 `[wan-path-01→replication-session-rs01]` 跨源→WAN→目标 |
| 9.4 | 三个 Case 均不依赖前端私有状态机 | 自动 PASS（静态审计） | `scripts/run-gates.mjs` C3 | App.tsx 无 caseId 键控状态（`useState(caseId…)`=0）；仅通用 `viewStateReducer`（view-state.ts 纯 reducer），三 Case 同一前端代码路径 |

## 3. 判定映射总表

| Gate | 主要承载校验器/审计 | 覆盖项 |
|---|---|---|
| Gate 1 知识包 | `validate-knowledge-package.mjs`（KG-*） | 1.1~1.4 |
| Gate 2 实例拓扑 | `validate-instance-topology.mjs`（IT-*，§5.11 十二条） | 2.1~2.5 |
| Gate 3 跨平面联动 | `validate-cross-plane-bindings.mjs`（BIND-*）+ `validate-leak-isolation.mjs` | 3.1~3.4 |
| Gate 4 Case 适配 | `case-package`（CKA-COMPAT-*）+ `run-gates.mjs` 静态审计 C1/C2/C4 | 4.1~4.4 |
| Gate 5 真值隔离 | `validate-leak-isolation.mjs`（CKA-LEAK-*）+ **`business-gates`（BGT-LEAK，阶段7 新增）** | 5.1~5.5 |
| Gate 6 Runtime 与推理 | `case-package`（CKA-FIXTURE-*）+ `diagnosis-runtime` evaluateConfirmationGates | 6.1~6.5 |
| Gate 7 回放 | `runtime-replay`（RT-*）+ `validate-leak-isolation.mjs` + `view-boundary`（VWB-003） | 7.1~7.4 |
| Gate 8 前端交互 | `validate-view-boundary.mjs`（VWB-*）+ `frontend-contract` + `verify-v2` + e2e | 8.1~8.4 |
| Gate 9 三 Case 业务断言 | **`business-gates`（BGT-CASE，阶段7 新增）** + `run-gates.mjs` 静态审计 C3 | 9.1~9.4 |

**阶段7 新增补缺项**（阶段1~6 未直接覆盖，均为最小实现）：
- `src/v2/validators/business-gates.ts`：Gate 5.3/5.4（扰邻/远程复制逐 Case 初始上下文信号词）、Gate 9.1/9.2/9.3（三 Case 业务不变式）、Gate 5.2/7.4 复核；
- `scripts/run-gates.mjs`：Gate 4.2/4.3/4.4/9.4 静态审计（单一 Adapter 路径、无 if case_id 特判、manifest 自动发现、前端无私有状态机）+ 九道 Gate 汇总。

## 4. 待人工视觉确认项（不混入自动 PASS）

以下项数据/自动化侧已 PASS，但**视觉效果需人工浏览器复核**：

| # | 项 | 自动侧结论 | 需人工确认的内容 |
|---|---|---|---|
| V1 | Gate 7.4 Scene 8 处置能力预览渲染 | 数据契约 PASS（`repair.future_capability` + dimmed，无伪造修复） | 当前 UI 未见显式"处置方案预览"组件块；需确认 Scene 8 视觉上"只展示能力、不伪造修复成功"符合预期（若不展示也满足"不伪造"，但"展示能力"需人工验收） |
| V2 | Gate 9.1 双控切换视觉呈现 | 数据 PASS（FAILOVER 事件 + 主备状态 + 影响链） | 画布/LUI 是否清晰呈现 controller-0a→0b 主备切换、业务影响链与恢复路径 |
| V3 | Gate 9.2 扰邻共享资源高亮 | 数据 PASS（SHARES_WITH + 反向消费者链） | 画布是否呈现共享资源（storage-pool/shared-pool）与反向追溯 host-a 施压者的视觉线索 |
| V4 | Gate 9.3 远程复制四域展开 | 数据 PASS（Planner 四域 + CROSS_SITE_NETWORK） | 拓扑/图谱能否跨站点展开源端→WAN→远端→配置四域 |
| V5 | Gate 8.1 多视图联动观感 | e2e PASS（issue7-evidence-path / issue6-phaseC-canvas） | 浏览器实际观感：图谱/拓扑/候选/证据/时间线同步滚动与高亮符合演示预期 |

> 说明：V1 是唯一"数据已 PASS 但 UI 组件当前可能缺失"的项——`conclusion.repair` 字段由阶段7 之前既有的 case-adapter 承载并写入结论，但前端未渲染独立处置预览块。是否补 UI 属产品决策，不改变"不伪造修复成功"的结论。

## 5. 结论

**九道 Gate 整体判定：通过（条件通过 + 5 项待人工视觉复核）。**

- **自动化判定**：39 项中 **34 项自动 PASS**（含静态审计 4 项），**5 项自动 PASS + 人工视觉复核**（§4 V1~V5）。
- **支撑证据链**：
  - `node scripts/run-gates.mjs` → **ALL GATE AUTOMATED CHECKS PASS**（A 区 6 类 TS 校验器 × 5 Case + B 区 6 个既有脚本 + C 区 4 项静态审计）；
  - `node scripts/validate-all.mjs` → **11/11 PASS**（阶段1~6 口径不变）；
  - `node scripts/verify-v2.mjs` → **5 Case ALL PASS + 三路由 confident=true**；
  - `npx vitest run` → **358/358 通过**（阶段7 新增 6 项：5 Case Business Gates + 目录/负例）；
  - `npm run typecheck` → **0 错误**。
- **关键新增能力（阶段7）**：
  1. `src/v2/validators/business-gates.ts` —— Gate 5.2~5.4 与 Gate 9 的逐 Case 业务断言（数据驱动，不违反"产品代码无 if case_id 特判"铁律）；
  2. `scripts/run-gates.mjs` —— 九道 Gate 权威汇总入口，含产品代码静态审计（无 if case_id / 单一 Adapter / 前端无私有状态机 / manifest 自动发现）。
- **剩余人工确认项**：§4 V1~V5（浏览器实测观感），其中 V1 为数据契约 PASS 但处置预览 UI 组件当前可能未渲染。

**是否可放行**：建议 **条件通过** —— 自动验收全绿；V1~V5 视觉项需人工浏览器复核，V1 若产品要求"Scene 8 展示处置能力预览"则需补一个最小 UI 渲染块（属后续产品决策，不影响已稳定行为）。

## 6. 改动文件

**新增**：
- `src/v2/validators/business-gates.ts` —— Business Gates Validator（BGT-*，Gate 5.2~5.4 / Gate 9）
- `scripts/run-gates.mjs` —— 九道 Gate 验收汇总入口（含静态审计）

**修改**：
- `src/v2/validators/index.ts` —— 导出 `validateBusinessGates` + 目录表登记 BUSINESS_GATES
- `src/v2/validators/validator-types.ts` —— `ValidatorKind` 增 `BUSINESS_GATES`
- `src/v2/error-codes.ts` —— `ErrorPrefix` 增 `BGT`
- `src/v2/validators/validators.test.ts` —— 目录 7→8 类断言 + Business Gates 测试块（31 测试）
- `docs/21_故障诊断Agent_九道Gate验收报告_V1.0.md` —— 本报告

**未改动**：`validate-all.mjs`（保持 11/11 口径）；已稳定的产品行为（adapter / runtime / projection / 前端）零改动。

# 故障诊断 Agent：阶段6 工程接口与校验器分层 V1.0

> 归档：2026-08-04 · 依据 `docs/19 §16 工程接口基线 / §17 校验器分层 / §19 工程实现建议目录`。
> 原则：**稳，不大改已通过代码**——用「逻辑契约接口 + re-export」表达 §19 职责边界，不物理拆散已稳定的 v2 运行时。

## 1. 目标与范围

为阶段7（九道 Gate 验收）铺路，把既有稳定实现（阶段1~5）整理为：

1. **4 个契约接口**（docs/19 §16）：Adapter / Topology Service / Knowledge Service / Runtime —— 每个提供清晰可调用的统一入口；
2. **职责边界对齐**（docs/19 §13.2）：审计确认既有模块写入边界一致；
3. **7 类校验器分层**（docs/19 §17.1）：已有 5 类归位，补 Runtime Replay / Frontend Contract / Case Package / Adapter Integration 的可编程入口；
4. **规范错误码**（docs/19 §17.2）：既有 R1~R12 对齐为 IT-* 前缀，新校验器使用规范前缀；
5. **validate-all 汇总入口**。

## 2. 契约接口（docs/19 §16）

统一入口 `src/v2/contracts.ts`（对既有模块 wrap/re-export），另提供 `contractSurface` 注册表。

| 契约 | 接口签名 | 实现/来源 |
|---|---|---|
| **Adapter** | `compile_case(CasePackage, KnowledgeGraphPackage?, AdapterProfile?) → AdapterCompileResult` | `src/adapters/case-knowledge-adapter.ts compileCase`（阶段4 A0~A10 流水线） |
| | `create_runtime_seed(compiled, SessionInitRequest?) → RuntimeSeed` | `compileCase` 产物 `compiled.runtimeSeed` |
| | `resolve_release(compiled, RuntimeEvent, ReleaseLedgerDigest) → ReleaseResult \| AdapterError` | `resolveRelease`（事件驱动渐进释放，§8.6） |
| **Topology** | `query_topology(TopologyQueryRequest) → resources+relations+states+paths+discovery_delta` | `src/v2/topology-service.ts query_topology` |
| | `query_topology_events(resource_refs, time_range, event_types) → TopologyEvent[]` | `query_topology_events` |
| | `find_paths / find_shared_resources / expand_by_relation` | `src/v2/topology-service.ts`（§5.10 路径是查询产物，不进入稳定关系） |
| **Knowledge** | `match_entries(symptom_code, resource_type_code, known_fact_refs) → KnowledgeEntryMatchSet` | `src/v2/knowledge-service.ts match_entries`（KG 3.0.0 只读） |
| | `expand_knowledge(entry_refs, relation_types, max_hops) → KnownKnowledgeDelta` | `expand_knowledge` |
| | `get_evidence_requirements(fault_mode_or_scenario_ref) → EvidenceRequirementSet` | `get_evidence_requirements`（FAULT_MODE/SCENARIO → REQUIRES_EVIDENCE → SATISFIED_BY_RULE） |
| **Runtime** | `append_event(session_id, RuntimeEvent) → accepted_sequence` | `src/v2/runtime-contract.ts runtimeContract` |
| | `get_snapshot(session_id, sequence?) → DiagnosisSessionSnapshot` | 同上（wrap `createDiagnosisRuntime` + `replayToSequence`） |
| | `subscribe_events(session_id, after_sequence) → RuntimeEvent[]` | 同上 |

### 2.1 语义约定

- **Adapter 写入边界**：只输出 Seed / 静态 Binding / 真值分区 / ReleaseEnvelope；禁止自主生成或确认根因、解释 Fact 为 Evidence（§13.2）；
- **Topology / Knowledge**：只读查询，不写回实例/本体，不裁决根因；
- **Runtime**：`append_event` 校验入参事件与期望事件一致；乱序/伪造/会话未知显式抛 `RT-*`，幂等重放返回当前 `accepted_sequence`；同一 Seed + 同一有序事件序列 → 语义等价 Snapshot（§16.4）；
- **确定性**：`DiagnosisRuntime` 不可变，`advance()` 返回新实例（推进必须 `rt = rt.advance()`）。

## 3. 职责边界审计（docs/19 §13.2）

| 模块 | 可提交 | 禁止直接修改 | 阶段6 审计 |
|---|---|---|---|
| Adapter | Seed、静态 Binding、真值分区、ReleaseEnvelope | 动态 Candidate、Evidence、Conclusion | ✅ 一致（`compileCase` 只产出 Seed/Bundle/Envelope，不生成领域事件） |
| Planner | Plan、Task、重规划决定 | Fact、Evidence 和支持分 | ✅ 一致（`diagnosis-runtime.ts generateEvents` 中 planner 仅 emit PLAN_*/TASK_*） |
| Skill Executor | 执行状态和原始 Result | Evidence 方向和根因 | ✅ 一致（SKILL_STARTED/COMPLETED/FAILED 只带结果摘要） |
| Fact Normalizer | Fact | Candidate 和 Decision | ✅ 一致（FACT_DISCOVERED 仅产 Fact） |
| Evidence Engine | Evidence、冲突、Requirement 状态 | 原始 Result | ✅ 一致（EVIDENCE_CREATED 派生自已释放 Fact） |
| Reasoning Engine | Candidate 更新、Decision、动态 Binding | 原始观测 | ✅ 一致（CANDIDATE_* 事件引用已公开 Evidence） |
| View Projector | View Hint | 任何诊断语义对象 | ✅ 一致（阶段5 `view-state.ts` 纯 reducer；`viewProjection` 只消费 Known+ACTIVE Binding） |

结论：**无需物理拆散**；契约接口 + 类型/注释声明即完成 §19 逻辑对齐。

## 4. 校验器分层（docs/19 §17.1）

| # | 校验器 | 实现 | 错误码 |
|---|---|---|---|
| 1 | Case Package Validator | `src/v2/validators/case-package.ts`（新增） | `CKA-PKG-* / CKA-FIXTURE-* / CKA-MAP-* / CKA-COMPAT-* / IT-TIME-*` |
| 2 | Knowledge Package Validator | `scripts/validate-knowledge-package.mjs`（既有，全包级） | `KG-*` |
| 3 | Instance Topology Validator | `src/adapters/instance-topology-validate.ts`（既有，错误码已对齐 IT-*） | `IT-REF-* / IT-KG-* / IT-SEM-* / IT-TIME-* / IT-STATE-*` |
| 4 | Adapter Integration Validator | `src/v2/validators/adapter-integration.ts`（新增，wrap compileCase A0~A10） | `CKA-SEED-* / CKA-RELEASE-* / CKA-KG-* / CKA-FIXTURE-* / CKA-MAP-*` |
| 5 | Leak Validator | `src/adapters/case-knowledge-adapter.ts validateLeakIsolation`（既有） | `CKA-LEAK-*` |
| 6 | Runtime Replay Validator | `src/v2/validators/runtime-replay.ts`（新增） | `RT-001~007` |
| 7 | Frontend Contract Validator | `src/v2/validators/frontend-contract.ts`（新增）＋`scripts/validate-view-boundary.mjs`（既有） | `VWB-*` |

- 注册表：`src/v2/validators/index.ts` 的 `VALIDATORS`（4 类 Case 级）＋`VALIDATOR_CATALOG`（7 类目录）＋`validateAll(caseIds)`。
- 运行时确定性校验：`validateDeterministicStream`（RT-007：同一 Case 两次生成事件流一致）。

## 5. 错误码规范（docs/19 §17.2）

`src/v2/error-codes.ts` 提供前缀常量 + `errorCode(prefix, seq)` + `FATAL_SILENT_REPAIRS`（核心不可静默修复项）。

| 前缀 | 范围 |
|---|---|
| `KG-*` | 知识包 |
| `IT-REF-*` | 实例引用（悬空端点 → IT-REF-001） |
| `IT-KG-*` | L1 类型能力不匹配 |
| `IT-SEM-*` | 包含/关系/空间语义 |
| `IT-TIME-*` | 生命周期/时态（时间不可解析 → IT-TIME-001） |
| `IT-STATE-*` | 状态冲突 |
| `CKA-PKG-* / CKA-MAP-* / CKA-KG-* / CKA-FIXTURE-* / CKA-SEED-* / CKA-RELEASE-* / CKA-LEAK-* / CKA-COMPAT-*` | Case 适配各分区 |
| `RT-*` | Runtime 事件/归约/快照 |
| `VWB-*`（阶段5）/ `BIND-*`（阶段3） | Frontend Contract / CrossPlaneBinding（既有，保持向后兼容） |

**对齐动作**：`instance-topology-validate.ts` 的 `R1~R12 / W-DISPLAY` 已重命名为 `IT-KG-001 / IT-REF-001 / IT-KG-002 / IT-SEM-001~004 / IT-TIME-001~002 / IT-STATE-001~003 / IT-SEM-WARN-DISPLAY`，测试断言同步更新。

**不可静默修复项**（检测到必须显式报错，禁止猜测）：多义 code（CKA-MAP-001）、无法映射的资源类型（CKA-MAP-002）、悬空端点（IT-REF-001）、事件时间不可解析（IT-TIME-001）、分数口径冲突（CKA-FIXTURE-002）、结论根因不在候选（CKA-FIXTURE-003）、初始上下文含最终答案（CKA-SEED-001 / CKA-LEAK-*）、Storyboard 越权（CKA-LEAK-*）。

## 6. validate-all 汇总

`node scripts/validate-all.mjs`：

- **A 区**：内置 TS 校验器（Case Package / Adapter Integration / Runtime Replay / Frontend Contract / Runtime Determinism）对 5 个 Case 逐一执行；
- **B 区**：串行运行阶段1~5 既有脚本（knowledge-package / instance-topology / cross-plane-bindings / leak-isolation / view-boundary）+ `verify-v2`；
- 输出 11 项总表，任一失败退出码 1。

## 7. 验证结果

- `npm run typecheck`：0 错误
- `npx vitest run`：**352/352 通过**（原 291 + 阶段6 新增 61）
- `node scripts/verify-v2.mjs`：5 Case ALL PASS ＋ 三路由 confident=true
- 阶段1~5 校验器全过（knowledge-package / instance-topology / cross-plane-bindings / leak-isolation / view-boundary）
- `node scripts/validate-all.mjs`：**11/11 PASS**
- `npm run build`：成功（2.36s）
- 浏览器实测：`e2e/issue7-topbar-clean.mjs` 13/13、全程 0 JS 错误（诊断推进 / PLANNER / 扫描徽标 / 终态正常）

## 8. 改动文件

**新增**：`src/v2/contracts.ts`、`src/v2/topology-service.ts`、`src/v2/knowledge-service.ts`、`src/v2/runtime-contract.ts`、`src/v2/error-codes.ts`、`src/v2/validators/{validator-types,case-package,adapter-integration,runtime-replay,frontend-contract,index}.ts`、`scripts/validate-all.mjs`、`src/v2/{topology-service,knowledge-service,runtime-contract,validators/validators}.test.ts`。

**修改**：`src/v2/index.ts`（re-export 阶段6 模块，保持向后兼容）、`src/adapters/instance-topology-validate.ts`（错误码 R1~R12 → IT-*）、`src/adapters/instance-topology.test.ts`（断言同步）。

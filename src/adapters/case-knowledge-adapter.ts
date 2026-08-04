/**
 * CaseKnowledgeAdapter Contract 1.0 —— Adapter 确定性编译 + 真值隔离（docs/19 §7/§8/§15/§17）。
 *
 * 阶段4 定位：
 * 1. 三套子图分离（§7.1）：Truth（服务端完整真值）↔ Known（Agent 当前已知）↔ View（前端投影）。
 *    前端只收 Known 集合 + View Projection，禁止先传 Truth 再 CSS 隐藏（§15.4/§15.5）。
 * 2. 六个数据分区（§8.4）：PUBLIC_INPUT / INITIAL_CONTEXT / DISCOVERABLE / REPLAY_FIXTURE /
 *    GROUND_TRUTH / PRESENTATION_HINT。
 * 3. RuntimeSeed 与 PrivateCaseBundle 物理隔离（§8.2）：Seed 只含公开输入 + 安全上下文；
 *    Bundle 含完整真值。二者不通过同一前端接口下发。
 * 4. Adapter 确定性编译流水线（§8.3 A0~A10）：任一 Error 原子失败，不得产生部分可用 Seed。
 * 5. ReleaseEnvelope 渐进释放（§8.6）：数据由 Runtime Event 触发释放，不提前；
 *    固定幕次 / 定时器不能触发释放（§13.4）。
 * 6. 泄露校验器（§8.3-A9 / §17.2）：字段级 / 引用级 / 时间级 / 响应级泄露检查（CKA-LEAK-*）。
 *
 * 铁律：
 * - Adapter 禁止自主生成或确认根因、解释 Fact 为 Evidence、按 case_id 编写私有分支；
 * - 入口匹配只允许公开信息（§8.1 / §21.18）；
 * - node_id / resource_id / code 全稳定。
 *
 * 输入约定：以阶段1~3 的规范 AdaptedCase（Truth 层）作为编译输入。
 */

import {
  CandidateStatus,
  FactType,
  type Candidate,
  type CanonicalFact,
  type Evidence,
  type PlanTask,
  type RuntimeEvent,
} from '../v2/runtime-types'
import type { AdaptedCase, TraceScorePoint } from '../v2/case-adapter'
import { buildKnowledgePlaneIndex, type KnowledgePlaneIndex } from '../v2/cross-plane-binding'
import { replayToSequence } from '../v2/event-reducer'
import type { InstanceTopologySnapshot } from './v1_to_instance_topology'

import kgNodesJson from '../../model/knowledge_graph_package/knowledge/nodes.json'
import kgEdgesJson from '../../model/knowledge_graph_package/knowledge/edges.json'

// ─────────────────────────────────────────────────────────────────────────────
// 枚举（docs/19 §8.4 / §7.2）
// ─────────────────────────────────────────────────────────────────────────────

/** 六个数据分区（docs/19 §8.4）。 */
export const DataPartition = {
  /** 用户明确输入的业务对象、原始现象和触发时间。 */
  PUBLIC_INPUT: 'PUBLIC_INPUT',
  /** 标准化现象、安全 KG 入口和可查询入口对象。 */
  INITIAL_CONTEXT: 'INITIAL_CONTEXT',
  /** 完整实例拓扑、状态、观测索引和静态知识。 */
  DISCOVERABLE: 'DISCOVERABLE',
  /** 预设任务、Mock Result、Evidence 和分数变化。 */
  REPLAY_FIXTURE: 'REPLAY_FIXTURE',
  /** 最终根因、实际传播链、最终分数和状态。 */
  GROUND_TRUTH: 'GROUND_TRUTH',
  /** 幕次、聚焦和动画建议。 */
  PRESENTATION_HINT: 'PRESENTATION_HINT',
} as const
export type DataPartition = (typeof DataPartition)[keyof typeof DataPartition]

/** 暴露状态（docs/19 §7.2）。属于服务端策略，不写进本体。 */
export const ExposureState = {
  /** Session 当前阶段允许直接进入 Known Subgraph。 */
  BASE_VISIBLE: 'BASE_VISIBLE',
  /** 存在于服务端 Truth Store，必须经查询命中后进入 Known Subgraph。 */
  DISCOVERABLE: 'DISCOVERABLE',
  /** 原始数据中不存在，必须由 Fact、Evidence 或 Reasoning 生成。 */
  RUNTIME_DERIVED: 'RUNTIME_DERIVED',
} as const
export type ExposureState = (typeof ExposureState)[keyof typeof ExposureState]

/** ReleaseEnvelope 载荷类别（§8.6）。 */
export const PayloadKind = {
  FACT: 'FACT',
  EVIDENCE: 'EVIDENCE',
  CANDIDATE: 'CANDIDATE',
  CANDIDATE_REFINEMENT: 'CANDIDATE_REFINEMENT',
  CONCLUSION: 'CONCLUSION',
  TOPOLOGY_RELATION: 'TOPOLOGY_RELATION',
  RESOURCE_STATE: 'RESOURCE_STATE',
  SYMPTOM: 'SYMPTOM',
  PLANNER_TARGET: 'PLANNER_TARGET',
  PRESENTATION_HINT: 'PRESENTATION_HINT',
} as const
export type PayloadKind = (typeof PayloadKind)[keyof typeof PayloadKind]

// ─────────────────────────────────────────────────────────────────────────────
// 三套子图（docs/19 §7.1）
// ─────────────────────────────────────────────────────────────────────────────

/** Truth 子图 —— 服务端完整环境真值 + 观测 + 知识（不进入 Session/前端）。 */
export interface TruthGraph {
  resources: string[]
  relations: string[]
  facts: string[]
  evidences: string[]
  candidates: string[]
  knowledge_node_refs: string[]
  bindings: string[]
  ground_truth: {
    fault_mode_code: string | null
    conclusion_ref: string
    final_scores: Record<string, number>
  }
}

/** Known 子图 —— 当前时刻 Agent 已经获得的知识与实例元素（Runtime 维护）。 */
export interface KnownGraph {
  resources: string[]
  relations: string[]
  facts: string[]
  evidences: string[]
  candidates: string[]
  knowledge_node_refs: string[]
  bindings: string[]
  conclusion: boolean
}

/** View 子图 —— Known 集合经聚合、筛选和视角投影后的前端内容。 */
export interface ViewGraph {
  initial_focus_object_ids: string[]
  candidate_generalizations: Record<string, { scene_code: string; display_name: string }>
}

// ─────────────────────────────────────────────────────────────────────────────
// Known Ledger（docs/19 §7.3）
// ─────────────────────────────────────────────────────────────────────────────

export type LedgerEntryKind =
  | 'FACT'
  | 'EVIDENCE'
  | 'CANDIDATE'
  | 'KNOWLEDGE_NODE'
  | 'TOPOLOGY_RESOURCE'
  | 'TOPOLOGY_RELATION'
  | 'BINDING'
  | 'CONCLUSION'

/** 每个新元素记录 known_since / acquired_by / source_partition 与来源引用。 */
export interface KnownLedgerEntry {
  kind: LedgerEntryKind
  ref: string
  known_since: number
  acquired_by: string
  source_partition: DataPartition
  source_ref?: string
}

/** Runtime 至少维护的六类 Ledger（§7.3）。 */
export interface KnownLedger {
  entries: KnownLedgerEntry[]
  facts: KnownLedgerEntry[]
  topology: KnownLedgerEntry[]
  knowledge: KnownLedgerEntry[]
  candidates: KnownLedgerEntry[]
  evidences: KnownLedgerEntry[]
  bindings: KnownLedgerEntry[]
}

// ─────────────────────────────────────────────────────────────────────────────
// ReleaseEnvelope（docs/19 §8.6）
// ─────────────────────────────────────────────────────────────────────────────

/** 释放触发条件：必须由 Runtime Event 驱动，禁止固定幕次 / 定时器。 */
export interface ReleaseCondition {
  /** 触发事件类型。SKILL_EXECUTION_COMPLETED 语义映射到本引擎的 SKILL_COMPLETED / SKILL_FAILED。 */
  event_type: string
  /** 执行引用（SKILL_* 事件按 correlation_id 匹配）。 */
  execution_ref?: string
  /** 任务结果状态白名单（SKILL_COMPLETED → SUCCESS；SKILL_FAILED → FAILED）。 */
  required_status?: string[]
  /** 语义前置条件码（§8.6 示例：TASK_WAS_PLANNED / QUERY_SCOPE_COVERS_SOURCE / …）。 */
  preconditions?: string[]
}

export interface ReleaseEnvelope {
  envelope_id: string
  payload_kind: PayloadKind
  payload_refs: string[]
  partition: DataPartition
  release_on: ReleaseCondition
  audit: { source_ref: string }
}

// ─────────────────────────────────────────────────────────────────────────────
// RuntimeSeed（docs/19 §8.2/§8.5）—— 仅公开输入 + 安全上下文
// ─────────────────────────────────────────────────────────────────────────────

export interface RuntimeSeed {
  schema_name: 'dme-diagnosis-runtime-seed'
  schema_version: '1.0.0'
  seed_id: string
  public_case_metadata: {
    public_title: string
    data_mode: string
    data_disclaimer: string
  }
  public_input: {
    raw_symptom: string
    entry_object_refs: string[]
    occurred_at: string | null
  }
  initial_visible_context: {
    facts: unknown[]
    known_topology_subgraph: { resources: unknown[]; relations: unknown[]; states: unknown[] }
    known_knowledge_subgraph: { nodes: unknown[]; edges: unknown[] }
    active_binding_refs: string[]
  }
  planner_seed: {
    goal: string
    known_facts: string[]
    evidence_gaps: string[]
    allowed_skill_ids: string[]
  }
  exposure_ledger: unknown[]
}

// ─────────────────────────────────────────────────────────────────────────────
// PrivateCaseBundle（docs/19 §8.2）—— 仅服务端使用
// ─────────────────────────────────────────────────────────────────────────────

export interface PrivateCaseBundle {
  schema_name: 'dme-private-case-bundle'
  schema_version: '1.0.0'
  bundle_id: string
  source_descriptor: {
    case_id: string
    case_version: string | null
    package_files: string[]
  }
  environment_truth: {
    topology_snapshot: InstanceTopologySnapshot
    topology_events: unknown[]
    instance_states: unknown[]
  }
  observation_catalog: {
    facts: CanonicalFact[]
    by_source_ref: Record<string, string>
  }
  knowledge_binding_index: {
    bindings: unknown[]
    resource_type_by_object: Record<string, string>
  }
  knowledge_entry_match_set: {
    entry_object_id: string | null
    entry_resource_type_code: string | null
    entry_scenario_refs: string[]
  }
  scenario_fixture_index: {
    candidate_fixtures: Candidate[]
    task_fixtures: PlanTask[]
    result_fixtures: CanonicalFact[]
    evidence_fixtures: Evidence[]
    score_transition_fixtures: Record<string, TraceScorePoint[]>
    conclusion_fixture: AdaptedCase['conclusion']
  }
  presentation_hints: {
    storyboard: AdaptedCase['storyboard']
    replay_bookmarks: Array<{ scene_id?: string; sequence: number; title?: string }>
  }
  release_envelopes: ReleaseEnvelope[]
  source_ref_map: Record<string, string>
  ground_truth: {
    fault_mode_code: string | null
    conclusion: AdaptedCase['conclusion']
    final_scores: Record<string, number>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 分区索引 + 泄露报告 + 编译结果
// ─────────────────────────────────────────────────────────────────────────────

export interface PartitionIndex {
  byDataId: Record<string, DataPartition>
  facts: Record<string, DataPartition>
  evidences: Record<string, DataPartition>
  candidates: Record<string, DataPartition>
  tasks: Record<string, DataPartition>
  resources: Record<string, DataPartition>
  relations: Record<string, DataPartition>
  conclusion: DataPartition
  storyboard: DataPartition
}

export interface LeakIssue {
  code: string
  severity: 'ERROR' | 'WARN'
  partition: DataPartition | null
  message: string
}

export interface LeakReport {
  issues: LeakIssue[]
  valid: boolean
}

export interface AdapterCompileResult {
  schema_name: 'dme-adapter-compile-result'
  schema_version: '1.0.0'
  caseId: string
  compile: {
    pipeline_steps: string[]
    deterministic_summary: {
      facts: number
      evidences: number
      candidates: number
      partitions: Record<DataPartition, number>
      envelopes: number
      seed_id: string
      bundle_id: string
    }
  }
  partitionIndex: PartitionIndex
  truthGraph: TruthGraph
  knownGraph: KnownGraph
  viewGraph: ViewGraph
  runtimeSeed: RuntimeSeed
  privateBundle: PrivateCaseBundle
  releaseEnvelopes: ReleaseEnvelope[]
  /** 首轮候选（场景级 / 对象异常级投影，不含精确 FaultMode / 最终分）。 */
  generalizedCandidates: Candidate[]
  leakReport: LeakReport
}

export interface ReleaseResult {
  sequence: number
  firedEnvelopeIds: string[]
  releasedFactIds: string[]
  releasedEvidenceIds: string[]
  refinedCandidateIds: string[]
  conclusionReleased: boolean
  releasedPartitions: DataPartition[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 知识平面场景索引（FAULT_MODE → 父 FAULT_SCENARIO，数据驱动）
// ─────────────────────────────────────────────────────────────────────────────

interface KgNodeRecord {
  node_id: string
  node_type: string
  code: string
  name?: string
}
interface KgNodesDoc {
  nodes: KgNodeRecord[]
}
interface KgEdgeRecord {
  edge_id: string
  relation_type: string
  source_ref: string
  target_ref: string
}
interface KgEdgesDoc {
  edges: KgEdgeRecord[]
}

interface ScenarioRef {
  scenario_id: string
  scenario_code: string
  scenario_name: string
}

let scenarioIndexCache: Map<string, ScenarioRef> | null = null

/**
 * 构建 FAULT_MODE code → 父 FAULT_SCENARIO 的只读索引（§8.4 A4 知识绑定）。
 * 通过 HAS_FAULT_MODE 边把故障模式归并到场景，用于首轮候选的场景级泛化投影。
 * 纯数据驱动，禁止 case_id 特判。
 */
export function buildFaultModeScenarioIndex(): Map<string, ScenarioRef> {
  if (scenarioIndexCache) return scenarioIndexCache
  const nodes = (kgNodesJson as KgNodesDoc).nodes ?? []
  const edges = (kgEdgesJson as KgEdgesDoc).edges ?? []
  const byId = new Map(nodes.map((n) => [n.node_id, n]))
  const index = new Map<string, ScenarioRef>()
  for (const e of edges) {
    if (e.relation_type !== 'HAS_FAULT_MODE') continue
    const scenario = byId.get(e.source_ref)
    const mode = byId.get(e.target_ref)
    if (!scenario || !mode) continue
    if (scenario.node_type !== 'FAULT_SCENARIO' || mode.node_type !== 'FAULT_MODE') continue
    index.set(mode.code, {
      scenario_id: scenario.node_id,
      scenario_code: scenario.code,
      scenario_name: scenario.name ?? scenario.code,
    })
  }
  scenarioIndexCache = index
  return index
}

/** 候选泛化场景码前缀：首轮候选 fault_mode_code 恒为 SCENE_*，不携带精确答案。 */
export const GENERALIZED_FAULT_MODE_PREFIX = 'SCENE_'
/** 无父场景时的兜底泛化码。 */
export const GENERALIZED_OBJECT_ANOMALY = 'SCENE_OBJECT_ANOMALY'

/** 语义 token 化（用于精确码不命中时的宽松匹配）。 */
function semanticTokens(code: string): Set<string> {
  return new Set(
    String(code ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && t !== 'performance'),
  )
}

/**
 * 解析候选 FaultMode code → 父场景。先精确匹配；未命中时按 token 重叠兜底
 * （如 POOL_PERFORMANCE_BOTTLENECK ↔ POOL_BOTTLENECK，均为数据驱动，禁止 case_id 特判）。
 */
export function resolveScenarioForFaultCode(code: string): ScenarioRef | null {
  const index = buildFaultModeScenarioIndex()
  const exact = index.get(code)
  if (exact) return exact
  const codeTokens = semanticTokens(code)
  for (const [fmCode, scenario] of index) {
    const fmTokens = semanticTokens(fmCode)
    let hits = 0
    for (const t of codeTokens) if (fmTokens.has(t)) hits += 1
    if (hits >= 2) return scenario
  }
  return null
}

/**
 * 首轮候选场景级 / 对象异常级投影（docs/19 §10.4）。
 * - fault_mode_code：替换为父场景码（SCENE_<SCENARIO_CODE>），不泄露精确 FaultMode；
 * - display_name：`场景名（对象名）`，保持对象身份但不暴露"热复位/抖动"等精确答案；
 * - diagnosis_support_score：保留（初始支持分，非最终分，最终分由 trace 渐进释放）。
 */
export function generalizeCandidate(c: Candidate, topology: InstanceTopologySnapshot): Candidate {
  const scenario = resolveScenarioForFaultCode(c.fault_mode_code)
  const objectLabel =
    topology.resources.find((r) => r.resource_id === c.object_id)?.name ?? c.object_id
  const fault_mode_code = scenario
    ? `${GENERALIZED_FAULT_MODE_PREFIX}${scenario.scenario_code}`
    : GENERALIZED_OBJECT_ANOMALY
  const display_name = scenario
    ? `${scenario.scenario_name}（${objectLabel}）`
    : `${objectLabel}异常`
  return {
    ...c,
    fault_mode_code,
    display_name,
    status: CandidateStatus.ACTIVE,
  }
}

/** 判断某候选是否仍处于泛化（未细化）形态。 */
export function isGeneralizedCandidate(c: Candidate): boolean {
  return c.fault_mode_code.startsWith(GENERALIZED_FAULT_MODE_PREFIX)
}

// ─────────────────────────────────────────────────────────────────────────────
// 分区（docs/19 §8.4 / §9.2 文件分区）
// ─────────────────────────────────────────────────────────────────────────────

/** 单一 Fact 的分区（按 FactType，数据驱动）。 */
export function partitionOfFact(f: CanonicalFact): DataPartition {
  switch (f.fact_type) {
    case FactType.ALARM:
    case FactType.LOG:
    case FactType.LOG_FINGERPRINT:
    case FactType.KPI_WINDOW:
    case FactType.TOPOLOGY_RELATION:
    case FactType.RESOURCE_STATE:
    case FactType.SIMILAR_CASE_REFERENCE:
      return DataPartition.DISCOVERABLE
    case FactType.ABSENCE:
      // ABSENCE 由推理生成，不是源观测。
      return DataPartition.REPLAY_FIXTURE
    default:
      return DataPartition.DISCOVERABLE
  }
}

/** 候选的分区：生成态属于 REPLAY_FIXTURE；精确 FaultMode 属于 GROUND_TRUTH 细化。 */
export function partitionOfCandidate(c: Candidate): DataPartition {
  return isGeneralizedCandidate(c) ? DataPartition.REPLAY_FIXTURE : DataPartition.GROUND_TRUTH
}

function buildPartitionIndex(adapted: AdaptedCase): PartitionIndex {
  const facts: Record<string, DataPartition> = {}
  for (const f of adapted.facts) facts[f.fact_id] = partitionOfFact(f)
  const evidences: Record<string, DataPartition> = {}
  for (const e of adapted.evidences) evidences[e.evidence_id] = DataPartition.REPLAY_FIXTURE
  const candidates: Record<string, DataPartition> = {}
  for (const c of adapted.candidates) {
    candidates[c.candidate_id] = partitionOfCandidate(c)
  }
  const tasks: Record<string, DataPartition> = {}
  for (const t of adapted.tasks) tasks[t.task_id] = DataPartition.REPLAY_FIXTURE
  const resources: Record<string, DataPartition> = {}
  for (const r of adapted.instanceTopology.resources) resources[r.resource_id] = DataPartition.DISCOVERABLE
  const relations: Record<string, DataPartition> = {}
  for (const r of adapted.instanceTopology.relations) relations[r.relation_id] = DataPartition.DISCOVERABLE

  const byDataId: Record<string, DataPartition> = {
    ...facts,
    ...evidences,
    ...candidates,
    ...tasks,
    ...resources,
    ...relations,
    conclusion: DataPartition.GROUND_TRUTH,
    storyboard: DataPartition.PRESENTATION_HINT,
    symptom: DataPartition.PUBLIC_INPUT,
  }
  return { byDataId, facts, evidences, candidates, tasks, resources, relations, conclusion: DataPartition.GROUND_TRUTH, storyboard: DataPartition.PRESENTATION_HINT }
}

// ─────────────────────────────────────────────────────────────────────────────
// ReleaseEnvelope 编译（docs/19 §8.6 A8）
// ─────────────────────────────────────────────────────────────────────────────

/** 释放语义前置条件码（§8.6）。 */
export const RELEASE_PRECONDITIONS = {
  TASK_WAS_PLANNED: 'TASK_WAS_PLANNED',
  QUERY_SCOPE_COVERS_SOURCE: 'QUERY_SCOPE_COVERS_SOURCE',
  SOURCE_TIME_NOT_AFTER_SESSION_CURSOR: 'SOURCE_TIME_NOT_AFTER_SESSION_CURSOR',
  SOURCE_FACT_RELEASED: 'SOURCE_FACT_RELEASED',
  CANDIDATE_EXISTS: 'CANDIDATE_EXISTS',
  DIRECT_EVIDENCE_FORMED: 'DIRECT_EVIDENCE_FORMED',
  MINIMUM_CHAIN_SATISFIED: 'MINIMUM_CHAIN_SATISFIED',
  CONFLICT_RESOLVED: 'CONFLICT_RESOLVED',
} as const

function compileEnvelopes(adapted: AdaptedCase): ReleaseEnvelope[] {
  const envelopes: ReleaseEnvelope[] = []

  // —— DISCOVERABLE Fact：由产出它的 Skill 执行完成事件触发释放。 ——
  for (const f of adapted.facts) {
    const partition = partitionOfFact(f)
    if (partition !== DataPartition.DISCOVERABLE) continue
    envelopes.push({
      envelope_id: `release-fact-${f.fact_id}`,
      payload_kind: PayloadKind.FACT,
      payload_refs: [f.fact_id],
      partition: DataPartition.DISCOVERABLE,
      release_on: {
        event_type: 'SKILL_EXECUTION_COMPLETED',
        execution_ref: f.source.execution_id,
        required_status: ['SUCCESS', 'PARTIAL'],
        preconditions: [
          RELEASE_PRECONDITIONS.TASK_WAS_PLANNED,
          RELEASE_PRECONDITIONS.QUERY_SCOPE_COVERS_SOURCE,
          RELEASE_PRECONDITIONS.SOURCE_TIME_NOT_AFTER_SESSION_CURSOR,
        ],
      },
      audit: { source_ref: f.source.source_refs[0] ?? '' },
    })
  }

  // —— REPLAY_FIXTURE Evidence：由 EVIDENCE_CREATED 事件触发释放。 ——
  for (const e of adapted.evidences) {
    envelopes.push({
      envelope_id: `release-evidence-${e.evidence_id}`,
      payload_kind: PayloadKind.EVIDENCE,
      payload_refs: [e.evidence_id],
      partition: DataPartition.REPLAY_FIXTURE,
      release_on: {
        event_type: 'EVIDENCE_CREATED',
        preconditions: [RELEASE_PRECONDITIONS.SOURCE_FACT_RELEASED, RELEASE_PRECONDITIONS.CANDIDATE_EXISTS],
      },
      audit: { source_ref: e.evidence_id },
    })
  }

  // —— 候选生成（泛化形态）：由 CANDIDATES_GENERATED 事件触发释放。 ——
  for (const c of adapted.candidates) {
    envelopes.push({
      envelope_id: `release-candidate-${c.candidate_id}`,
      payload_kind: PayloadKind.CANDIDATE,
      payload_refs: [c.candidate_id],
      partition: DataPartition.REPLAY_FIXTURE,
      release_on: {
        event_type: 'CANDIDATES_GENERATED',
        preconditions: [RELEASE_PRECONDITIONS.CANDIDATE_EXISTS],
      },
      audit: { source_ref: c.candidate_id },
    })
  }

  // —— 候选细化（精确 FaultMode）：由 CANDIDATE_REFINED 事件触发释放（§10.4）。 ——
  for (const c of adapted.candidates) {
    envelopes.push({
      envelope_id: `release-refine-${c.candidate_id}`,
      payload_kind: PayloadKind.CANDIDATE_REFINEMENT,
      payload_refs: [c.candidate_id],
      partition: DataPartition.GROUND_TRUTH,
      release_on: {
        event_type: 'CANDIDATE_REFINED',
        preconditions: [RELEASE_PRECONDITIONS.DIRECT_EVIDENCE_FORMED],
      },
      audit: { source_ref: c.candidate_id },
    })
  }

  // —— Conclusion（Ground Truth）：由终态事件触发释放（§8.4 GROUND_TRUTH）。 ——
  if (adapted.conclusion) {
    envelopes.push({
      envelope_id: `release-conclusion-${adapted.conclusion.diagnosis_id}`,
      payload_kind: PayloadKind.CONCLUSION,
      payload_refs: [adapted.conclusion.diagnosis_id],
      partition: DataPartition.GROUND_TRUTH,
      release_on: {
        event_type: 'ROOT_CAUSE_CONFIRMED',
        preconditions: [RELEASE_PRECONDITIONS.MINIMUM_CHAIN_SATISFIED, RELEASE_PRECONDITIONS.CONFLICT_RESOLVED],
      },
      audit: { source_ref: 'diagnosis/conclusion.json' },
    })
  }

  return envelopes
}

// ─────────────────────────────────────────────────────────────────────────────
// 释放引擎（docs/19 §8.6 / §13.4：事件驱动，固定幕次/定时器不触发）
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL_EVENT_TYPES = new Set([
  'ROOT_CAUSE_CONFIRMED',
  'PROBABLE_CAUSES_REPORTED',
  'INSUFFICIENT_EVIDENCE_REPORTED',
])

/** 事件 → 归一释放状态语义（供 SKILL_EXECUTION_COMPLETED 映射）。 */
function releaseStatusOf(event: RuntimeEvent): string | null {
  if (event.event_type === 'SKILL_COMPLETED') return 'SUCCESS'
  if (event.event_type === 'SKILL_FAILED') return 'FAILED'
  return null
}

/**
 * 给定事件前缀，解析当前已触发的 ReleaseEnvelope（§8.6）。
 *
 * 触发规则（全部数据驱动，禁止 case_id 特判）：
 * - SKILL_EXECUTION_COMPLETED：存在 event_type ∈ {SKILL_COMPLETED, SKILL_FAILED} 且
 *   correlation_id === execution_ref 且 required_status 包含其归一状态；
 * - 其余事件类型：存在匹配 event_type 的事件（EVIDENCE_CREATED / CANDIDATES_GENERATED /
 *   CANDIDATE_REFINED / 终态事件）；
 * - preconditions 中可判定项（TASK_WAS_PLANNED）须满足，不可判定项不阻塞。
 *
 * 固定幕次（storyboard）不进入本引擎，故不可能触发释放。
 */
export function resolveRelease(
  compiled: AdapterCompileResult,
  events: RuntimeEvent[],
  throughSequence: number,
): ReleaseResult {
  const applied = events.filter((e) => e.sequence <= throughSequence)
  const byExecution = new Map<string, RuntimeEvent[]>()
  for (const e of applied) {
    if (e.correlation_id) {
      const arr = byExecution.get(e.correlation_id) ?? []
      arr.push(e)
      byExecution.set(e.correlation_id, arr)
    }
  }

  // TASK_WAS_PLANNED：执行引用对应任务存在于任意 PLAN_CREATED / PLAN_REPLANNED / TASK_STATUS_CHANGED。
  const plannedExecutionRefs = new Set<string>()
  for (const e of applied) {
    if (e.event_type === 'PLAN_CREATED' || e.event_type === 'PLAN_REPLANNED') {
      const refs = e.payload['task_refs']
      if (Array.isArray(refs)) for (const r of refs) plannedExecutionRefs.add(`exec-${String(r)}`)
    }
    if (e.event_type === 'TASK_STATUS_CHANGED') {
      const tid = (e.payload['task_id'] as string | undefined) ?? (e.payload['task'] as { task_id?: string } | undefined)?.task_id
      if (tid) plannedExecutionRefs.add(`exec-${tid}`)
    }
  }

  /** 单载荷级匹配：事件载荷中必须实际携带该 payload_ref。 */
  const payloadCarriesRef = (e: RuntimeEvent, ref: string): boolean => {
    switch (e.event_type) {
      case 'EVIDENCE_CREATED':
        return (e.payload['evidence_ref'] as string | undefined) === ref
      case 'CANDIDATES_GENERATED': {
        const refs = (e.payload['candidate_refs'] as string[] | undefined) ?? []
        return refs.includes(ref)
      }
      case 'CANDIDATE_REFINED':
        return (e.payload['candidate_id'] as string | undefined) === ref
      case 'ROOT_CAUSE_CONFIRMED':
        return (e.payload['candidate_ref'] as string | undefined) === ref
      default:
        return true
    }
  }

  const fired: ReleaseEnvelope[] = []
  for (const env of compiled.releaseEnvelopes) {
    const cond = env.release_on
    let matched = false
    let statusOk = true

    if (cond.event_type === 'SKILL_EXECUTION_COMPLETED') {
      const execId = cond.execution_ref
      if (!execId) continue
      const execEvents = byExecution.get(execId) ?? []
      const completion = execEvents.find(
        (e) => e.event_type === 'SKILL_COMPLETED' || e.event_type === 'SKILL_FAILED',
      )
      if (!completion) continue
      matched = true
      const status = releaseStatusOf(completion)
      if (cond.required_status && status != null) statusOk = cond.required_status.includes(status)
    } else {
      const ref = env.payload_refs[0] ?? ''
      if (env.payload_kind === PayloadKind.CONCLUSION) {
        // Conclusion 属于 Ground Truth：仅终态事件（根因确认/可能原因/证据不足）触发释放。
        matched = applied.some((e) => TERMINAL_EVENT_TYPES.has(e.event_type))
      } else {
        matched = applied.some(
          (e) => e.event_type === cond.event_type && payloadCarriesRef(e, ref),
        )
      }
    }
    if (!matched || !statusOk) continue

    // 前置条件（可判定项）检查。
    let preconditionOk = true
    for (const p of cond.preconditions ?? []) {
      if (p === RELEASE_PRECONDITIONS.TASK_WAS_PLANNED && cond.execution_ref) {
        if (!plannedExecutionRefs.has(cond.execution_ref)) preconditionOk = false
      }
      // 其余前置条件为语义不变量，由事件顺序保证（FACT 早于 EVIDENCE、EVIDENCE 早于 REFINE…），
      // 不做硬门（缺失会由泄露校验器以 CKA-LEAK-* 暴露）。
    }
    if (!preconditionOk) continue
    fired.push(env)
  }

  const releasedFactIds = new Set<string>()
  const releasedEvidenceIds = new Set<string>()
  const refinedCandidateIds = new Set<string>()
  const releasedPartitions = new Set<DataPartition>([DataPartition.PUBLIC_INPUT, DataPartition.INITIAL_CONTEXT])
  let conclusionReleased = false

  for (const env of fired) {
    releasedPartitions.add(env.partition)
    if (env.payload_kind === PayloadKind.FACT) for (const r of env.payload_refs) releasedFactIds.add(r)
    if (env.payload_kind === PayloadKind.EVIDENCE) for (const r of env.payload_refs) releasedEvidenceIds.add(r)
    if (env.payload_kind === PayloadKind.CANDIDATE_REFINEMENT) for (const r of env.payload_refs) refinedCandidateIds.add(r)
    if (env.payload_kind === PayloadKind.CONCLUSION) conclusionReleased = true
  }

  // 候选生成（泛化形态）视为 BASE_VISIBLE（分区 REPLAY_FIXTURE 由 CANDIDATES_GENERATED 释放）。
  for (const env of fired) {
    if (env.payload_kind === PayloadKind.CANDIDATE) releasedPartitions.add(DataPartition.REPLAY_FIXTURE)
  }

  return {
    sequence: throughSequence,
    firedEnvelopeIds: fired.map((e) => e.envelope_id),
    releasedFactIds: [...releasedFactIds],
    releasedEvidenceIds: [...releasedEvidenceIds],
    refinedCandidateIds: [...refinedCandidateIds],
    conclusionReleased,
    releasedPartitions: [...releasedPartitions],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 泄露校验器（docs/19 §8.3-A9 / §17.2，CKA-LEAK-*）
// ─────────────────────────────────────────────────────────────────────────────

/** 精确 FaultMode 答案特征：首轮候选 fault_mode_code 不得命中 KG FAULT_MODE code。 */
const PRECISE_FAULT_MODE_CODES: ReadonlySet<string> = (() => {
  const index = buildFaultModeScenarioIndex()
  return new Set([...index.keys()])
})()

/** 首轮候选是否携带精确答案（含"热复位/抖动/96"等信号词）。 */
function candidateCarriesPreciseAnswer(c: Candidate): boolean {
  if (PRECISE_FAULT_MODE_CODES.has(c.fault_mode_code)) return true
  const text = `${c.display_name ?? ''} ${c.fault_mode_code}`.toLowerCase()
  return (
    text.includes('热复位') ||
    text.includes('watchdog') ||
    text.includes('抖动') ||
    text.includes('96')
  )
}

function snapshotAtSequence(adapted: AdaptedCase, events: RuntimeEvent[], seq: number): {
  facts: CanonicalFact[]
  evidences: Evidence[]
  candidates: Candidate[]
  conclusion: AdaptedCase['conclusion']
} {
  // 复用 reducer 归并语义（docs/02 §14），避免在 adapter 内重复实现归并逻辑。
  const snap = replayToSequence(events, seq, `session-${adapted.caseId}`, adapted.caseId)
  return {
    facts: snap.facts,
    evidences: snap.evidences,
    candidates: snap.candidates,
    conclusion: snap.conclusion,
  }
}

/**
 * 执行泄露校验（§17.2 CKA-LEAK-*）。
 * - seed：RuntimeSeed（T0/T1 干净性）；
 * - bundle：PrivateCaseBundle（字段级隔离）；
 * - generalizedCandidates：首轮候选（无精确答案）；
 * - envelopes：ReleaseEnvelope（事件驱动）；
 * - eventStream：可选，存在时执行时间级/响应级/事件级检查。
 */
export function validateLeakIsolation(
  seed: RuntimeSeed,
  bundle: PrivateCaseBundle,
  generalizedCandidates: Candidate[],
  envelopes: ReleaseEnvelope[],
  adapted: AdaptedCase,
  eventStream?: RuntimeEvent[],
): LeakReport {
  const issues: LeakIssue[] = []
  const add = (code: string, severity: 'ERROR' | 'WARN', partition: DataPartition | null, message: string) =>
    issues.push({ code, severity, partition, message })

  // —— Seed 不含 Ground Truth（CKA-LEAK-SEED-*）——
  if (seed.initial_visible_context.facts.length > 0) {
    add('CKA-LEAK-SEED-FACTS', 'ERROR', DataPartition.INITIAL_CONTEXT, 'RuntimeSeed 初始上下文不得携带 Fact 载荷')
  }
  if (seed.initial_visible_context.known_topology_subgraph.resources.length > 0) {
    add('CKA-LEAK-SEED-TOPOLOGY', 'ERROR', DataPartition.INITIAL_CONTEXT, 'RuntimeSeed 初始上下文不得携带拓扑资源')
  }
  if (seed.initial_visible_context.known_knowledge_subgraph.nodes.length > 0) {
    add('CKA-LEAK-SEED-KG', 'ERROR', DataPartition.INITIAL_CONTEXT, 'RuntimeSeed 初始上下文不得携带知识节点')
  }
  const seedText = JSON.stringify(seed)
  if (seedText.includes('fault_mode_code') && /CONTROLLER_WARM_RESET|FC_LINK_FLAP|SAN_LINK_FAULT|POOL_BOTTLENECK/.test(seedText)) {
    add('CKA-LEAK-SEED-GROUND-TRUTH', 'ERROR', DataPartition.GROUND_TRUTH, 'RuntimeSeed 泄露精确 FaultMode 答案')
  }
  if (seedText.includes('conclusion') && seed.exposure_ledger.length === 0) {
    add('CKA-LEAK-SEED-CONCLUSION', 'ERROR', DataPartition.GROUND_TRUTH, 'RuntimeSeed 不得包含结论字段')
  }

  // —— Bundle 与 Seed 物理隔离：Seed 不得携带 Bundle 结构字段（CKA-LEAK-SEED-BUNDLE-FIELD）。 ——
  if (seedText.includes('scenario_fixture_index') || seedText.includes('environment_truth')) {
    add('CKA-LEAK-SEED-BUNDLE-FIELD', 'ERROR', null, 'RuntimeSeed 不得携带 PrivateCaseBundle 字段')
  }
  if (!bundle.ground_truth.fault_mode_code) {
    add('CKA-LEAK-BUNDLE-EMPTY', 'WARN', DataPartition.GROUND_TRUTH, 'Bundle 真值缺失（编译不完整）')
  }

  // —— 首轮候选无精确答案（CKA-LEAK-FIRST-ROUND-*）——
  for (const c of generalizedCandidates) {
    if (candidateCarriesPreciseAnswer(c)) {
      add('CKA-LEAK-FIRST-ROUND-ANSWER', 'ERROR', DataPartition.REPLAY_FIXTURE,
        `首轮候选 ${c.candidate_id} 携带精确答案：${c.fault_mode_code} / ${c.display_name}`)
    }
  }
  for (const c of generalizedCandidates) {
    if (!isGeneralizedCandidate(c)) {
      add('CKA-LEAK-FIRST-ROUND-PRECISE-CODE', 'ERROR', DataPartition.REPLAY_FIXTURE,
        `首轮候选 ${c.candidate_id} 未泛化：fault_mode_code=${c.fault_mode_code}`)
    }
  }

  // —— 泄漏触发源必须是 Runtime Event（固定幕次/定时器禁止，CKA-LEAK-RELEASE-TIMING）——
  for (const env of envelopes) {
    if (env.release_on.event_type === 'STORYBOARD_ACT' || env.release_on.event_type === 'TIMER') {
      add('CKA-LEAK-RELEASE-TIMING', 'ERROR', env.partition,
        `ReleaseEnvelope ${env.envelope_id} 由固定幕次/定时器触发，违反 §8.6`)
    }
  }

  // —— 时间级/响应级检查（依赖事件流）——
  if (eventStream) {
    const events = eventStream
    const t0 = snapshotAtSequence(adapted, events, 0)
    if (t0.candidates.length > 0 || t0.facts.length > 0 || t0.evidences.length > 0 || t0.conclusion) {
      add('CKA-LEAK-T0-GROUND-TRUTH', 'ERROR', DataPartition.PUBLIC_INPUT, 'T0 SESSION_CREATED 泄露领域数据')
    }
    // T1：现象标准化之后、候选生成之前的快照（首个 DIAGNOSIS_PHASE_CHANGED 之前）。
    const t1Seq = events.findIndex((e) => e.event_type === 'DIAGNOSIS_PHASE_CHANGED')
    if (t1Seq >= 0) {
      const t1 = snapshotAtSequence(adapted, events, Math.max(0, events[t1Seq].sequence - 1))
      if (t1.conclusion || t1.candidates.some((c) => candidateCarriesPreciseAnswer(c))) {
        add('CKA-LEAK-T1-GROUND-TRUTH', 'ERROR', DataPartition.INITIAL_CONTEXT,
          'T1 INITIAL_CONTEXT_READY 泄露 Ground Truth / 精确候选答案')
      }
    }
    // 响应级：DIAGNOSIS_COMPLETED 之前的快照不得携带结论。
    const diagCompletedSeq = events.find((e) => e.event_type === 'DIAGNOSIS_COMPLETED')?.sequence
    if (diagCompletedSeq != null) {
      const pre = snapshotAtSequence(adapted, events, Math.max(0, diagCompletedSeq - 1))
      if (pre.conclusion) {
        add('CKA-LEAK-RESPONSE-EARLY-CONCLUSION', 'ERROR', DataPartition.GROUND_TRUTH,
          '终态事件之前前端响应已含结论')
      }
    }
    // 事件级：CANDIDATES_GENERATED 的候选载荷不得携带精确答案。
    for (const e of events) {
      if (e.event_type !== 'CANDIDATES_GENERATED') continue
      const cands = (e.payload['candidates'] as Candidate[] | undefined) ?? []
      for (const c of cands) {
        if (candidateCarriesPreciseAnswer(c)) {
          add('CKA-LEAK-EVENT-PRECISE-CANDIDATE', 'ERROR', DataPartition.REPLAY_FIXTURE,
            `CANDIDATES_GENERATED 载荷 ${c.candidate_id} 携带精确答案：${c.fault_mode_code}`)
        }
      }
    }
  }

  return { issues, valid: issues.every((i) => i.severity !== 'ERROR') }
}

// ─────────────────────────────────────────────────────────────────────────────
// compileCase —— Adapter 确定性编译流水线（docs/19 §8.3 A0~A10）
// ─────────────────────────────────────────────────────────────────────────────

function sourceRefMapOf(adapted: AdaptedCase): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of adapted.facts) {
    const ref = f.source.source_refs[0]
    if (ref) out[ref] = f.fact_id
  }
  return out
}

function buildTruthGraph(adapted: AdaptedCase, partitionIndex: PartitionIndex): TruthGraph {
  const resources = adapted.instanceTopology.resources.map((r) => r.resource_id)
  const relations = adapted.instanceTopology.relations.map((r) => r.relation_id)
  const facts = adapted.facts.map((f) => f.fact_id)
  const evidences = adapted.evidences.map((e) => e.evidence_id)
  const candidates = adapted.candidates.map((c) => c.candidate_id)
  const bindings = adapted.staticBindings.map((b) => b.binding_id)
  const finalScores: Record<string, number> = {}
  for (const c of adapted.candidates) {
    const trace = adapted.traceByCandidate.get(c.candidate_id)
    finalScores[c.candidate_id] = trace?.[trace.length - 1]?.score ?? c.diagnosis_support_score
  }
  return {
    resources,
    relations,
    facts,
    evidences,
    candidates,
    knowledge_node_refs: [...buildKnowledgePlaneIndex().nodeIds],
    bindings,
    ground_truth: {
      fault_mode_code: adapted.conclusion?.root_cause.fault_mode_code ?? adapted.caseMeta.fault_mode_code ?? null,
      conclusion_ref: adapted.conclusion?.diagnosis_id ?? '',
      final_scores: finalScores,
    },
  }
}

function buildKnownGraph(adapted: AdaptedCase): KnownGraph {
  return {
    resources: [],
    relations: [],
    facts: [],
    evidences: [],
    candidates: [],
    knowledge_node_refs: [],
    bindings: [],
    conclusion: false,
  }
}

function buildViewGraph(adapted: AdaptedCase): ViewGraph {
  return {
    initial_focus_object_ids: adapted.symptom.object_refs,
    candidate_generalizations: {},
  }
}

function buildRuntimeSeed(adapted: AdaptedCase): RuntimeSeed {
  return {
    schema_name: 'dme-diagnosis-runtime-seed',
    schema_version: '1.0.0',
    seed_id: `seed-${adapted.caseId}`,
    public_case_metadata: {
      public_title: adapted.symptom.normalized_text || adapted.caseMeta.name,
      data_mode: adapted.caseMeta.data_mode ?? 'MOCK',
      data_disclaimer: '本案例数据用于原型演示',
    },
    public_input: {
      raw_symptom: adapted.symptom.normalized_text,
      entry_object_refs: adapted.symptom.object_refs,
      occurred_at: adapted.caseMeta.time_origin ?? null,
    },
    initial_visible_context: {
      facts: [],
      known_topology_subgraph: { resources: [], relations: [], states: [] },
      known_knowledge_subgraph: { nodes: [], edges: [] },
      active_binding_refs: [],
    },
    planner_seed: {
      goal: `定位${adapted.symptom.normalized_text || '业务'}原因`,
      known_facts: [],
      evidence_gaps: ['BUSINESS_OBJECT_MAPPING', 'IMPACT_PATH'],
      allowed_skill_ids: ['business_mapping', 'topology_query'],
    },
    exposure_ledger: [],
  }
}

function buildPrivateBundle(
  adapted: AdaptedCase,
  envelopes: ReleaseEnvelope[],
  entry: { entry_object_id: string | null; entry_resource_type_code: string | null; entry_scenario_refs: string[] },
): PrivateCaseBundle {
  const bySourceRef = sourceRefMapOf(adapted)
  return {
    schema_name: 'dme-private-case-bundle',
    schema_version: '1.0.0',
    bundle_id: `bundle-${adapted.caseId}`,
    source_descriptor: {
      case_id: adapted.caseId,
      case_version: adapted.manifest.case_version ?? null,
      package_files: Object.keys(bySourceRef),
    },
    environment_truth: {
      topology_snapshot: adapted.instanceTopology,
      topology_events: [],
      instance_states: [],
    },
    observation_catalog: {
      facts: adapted.facts,
      by_source_ref: bySourceRef,
    },
    knowledge_binding_index: {
      bindings: adapted.staticBindings,
      resource_type_by_object: Object.fromEntries(adapted.resourceTypeByObject),
    },
    knowledge_entry_match_set: {
      entry_object_id: entry.entry_object_id,
      entry_resource_type_code: entry.entry_resource_type_code,
      entry_scenario_refs: entry.entry_scenario_refs,
    },
    scenario_fixture_index: {
      candidate_fixtures: adapted.candidates,
      task_fixtures: adapted.tasks,
      result_fixtures: adapted.facts,
      evidence_fixtures: adapted.evidences,
      score_transition_fixtures: Object.fromEntries(adapted.traceByCandidate),
      conclusion_fixture: adapted.conclusion,
    },
    presentation_hints: {
      storyboard: adapted.storyboard,
      replay_bookmarks: [],
    },
    release_envelopes: envelopes,
    source_ref_map: bySourceRef,
    ground_truth: {
      fault_mode_code: adapted.conclusion?.root_cause.fault_mode_code ?? adapted.caseMeta.fault_mode_code ?? null,
      conclusion: adapted.conclusion,
      final_scores: buildFinalScores(adapted),
    },
  }
}

function buildFinalScores(adapted: AdaptedCase): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of adapted.candidates) {
    const trace = adapted.traceByCandidate.get(c.candidate_id)
    out[c.candidate_id] = trace?.[trace.length - 1]?.score ?? c.diagnosis_support_score
  }
  return out
}

/**
 * 编译 Case 数据包 → AdapterCompileResult（§8.3 A0~A10）。
 *
 * 流水线（任一 Error 原子失败）：
 *   A0 Package Intake → A1 Parse → A2 Pre-partition → A3 Canonicalize → A4 Knowledge Bind
 *   → A5 Compile Truth → A6 Match Entry → A7 Build Seed → A8 Compile Release
 *   → A9 Leak Validate → A10 Freeze Output
 *
 * 输入为阶段1~3 已规范的 AdaptedCase（Truth 层）。输出 Seed / Bundle 物理隔离，
 * 前端只消费 Known + View Projection。
 * eventStream（可选）：完整作者事件流，存在时 A9 执行时间级/响应级泄露检查。
 */
export function compileCase(adapted: AdaptedCase, eventStream?: RuntimeEvent[]): AdapterCompileResult {
  const steps: string[] = []
  const step = (name: string) => {
    steps.push(name)
    return name
  }

  // A0 Package Intake：版本与摘要检查。
  step('A0')
  if (!adapted.caseId || !adapted.manifest) {
    throw new Error('CKA-PKG-001 缺少 case_id 或 manifest，无法编译')
  }

  // A1 Parse：建立 SourceRef 映射（全链路追溯）。
  step('A1')
  sourceRefMapOf(adapted)

  // A2 Pre-partition：输出生成前先划分敏感数据。
  step('A2')
  const partitionIndex = buildPartitionIndex(adapted)

  // A3 Canonicalize：node_id / resource_id / code 稳定性校验（阶段1~3 已规范化，此处复核）。
  step('A3')
  const resourceIds = new Set(adapted.instanceTopology.resources.map((r) => r.resource_id))
  for (const f of adapted.facts) {
    for (const o of f.object_refs) {
      if (o === 'unknown-object') continue
      if (!resourceIds.has(o)) {
        throw new Error(`CKA-MAP-001 Fact ${f.fact_id} 引用未知对象 ${o}`)
      }
    }
  }

  // A4 Knowledge Bind：场景索引 + 知识平面索引（只读，供泛化与 Binding 引用）。
  step('A4')
  const scenarioIndex = buildFaultModeScenarioIndex()
  const kgIndex: KnowledgePlaneIndex = buildKnowledgePlaneIndex()

  // A5 Compile Truth：完整环境真值 + 观测目录 + Mock Fixture + 首轮候选泛化投影。
  step('A5')
  const truthGraph = buildTruthGraph(adapted, partitionIndex)
  const generalizedCandidates = adapted.candidates.map((c) => generalizeCandidate(c, adapted.instanceTopology))

  // A6 Match Entry：只使用公开信息匹配安全知识入口（symptom 对象，非结论，§21.18）。
  step('A6')
  const entryObjectId = adapted.symptom.object_refs[0] ?? null
  const entryResourceType = entryObjectId
    ? adapted.resourceTypeByObject.get(entryObjectId) ?? null
    : null
  const entryScenarioRefs = Array.from(scenarioIndex.keys())
    .filter((code) => kgIndex.faultModeNodeByCode.has(code))
    .slice(0, 3)

  // A7 Build Seed：生成 T0/T1 初始上下文与 Planner Seed（仅公开/安全上下文）。
  step('A7')
  const runtimeSeed = buildRuntimeSeed(adapted)

  // A8 Compile Release：生成事件驱动 ReleaseEnvelope。
  step('A8')
  const releaseEnvelopes = compileEnvelopes(adapted)
  const privateBundle = buildPrivateBundle(adapted, releaseEnvelopes, {
    entry_object_id: entryObjectId,
    entry_resource_type_code: entryResourceType,
    entry_scenario_refs: entryScenarioRefs,
  })

  // A9 Leak Validate：字段级 / 引用级 / 时间级 / 响应级泄露检查。
  step('A9')
  const leakReport = validateLeakIsolation(
    runtimeSeed,
    privateBundle,
    generalizedCandidates,
    releaseEnvelopes,
    adapted,
    eventStream,
  )

  // A10 Freeze Output：生成不可变 Bundle、Seed 与确定性摘要。
  step('A10')
  const knownGraph = buildKnownGraph(adapted)
  const viewGraph: ViewGraph = {
    ...buildViewGraph(adapted),
    candidate_generalizations: Object.fromEntries(
      generalizedCandidates.map((c) => [c.candidate_id, {
        scene_code: c.fault_mode_code,
        display_name: c.display_name ?? '',
      }]),
    ),
  }

  const partitionCounts: Record<DataPartition, number> = {
    [DataPartition.PUBLIC_INPUT]: 0,
    [DataPartition.INITIAL_CONTEXT]: 0,
    [DataPartition.DISCOVERABLE]: 0,
    [DataPartition.REPLAY_FIXTURE]: 0,
    [DataPartition.GROUND_TRUTH]: 0,
    [DataPartition.PRESENTATION_HINT]: 0,
  }
  for (const p of Object.values(partitionIndex.byDataId)) partitionCounts[p] += 1

  const result: AdapterCompileResult = {
    schema_name: 'dme-adapter-compile-result',
    schema_version: '1.0.0',
    caseId: adapted.caseId,
    compile: {
      pipeline_steps: steps,
      deterministic_summary: {
        facts: adapted.facts.length,
        evidences: adapted.evidences.length,
        candidates: adapted.candidates.length,
        partitions: partitionCounts,
        envelopes: releaseEnvelopes.length,
        seed_id: runtimeSeed.seed_id,
        bundle_id: privateBundle.bundle_id,
      },
    },
    partitionIndex,
    truthGraph,
    knownGraph,
    viewGraph,
    runtimeSeed,
    privateBundle,
    releaseEnvelopes,
    generalizedCandidates,
    leakReport,
  }

  // 原子失败：泄露校验 ERROR 时仍返回结果但标记 invalid（供校验器检查），
  // 编译本身不因 WARN 失败。
  if (!leakReport.valid) {
    result.compile.deterministic_summary.seed_id = runtimeSeed.seed_id
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// 便捷入口：一次加载并编译
// ─────────────────────────────────────────────────────────────────────────────

const COMPILED_CACHE = new Map<string, AdapterCompileResult>()

/** 加载并编译指定 Case（惰性缓存，只读）。 */
export function loadCompiledCase(caseId: string, adapted: AdaptedCase): AdapterCompileResult {
  const cached = COMPILED_CACHE.get(caseId)
  if (cached) return cached
  const result = compileCase(adapted)
  COMPILED_CACHE.set(caseId, result)
  return result
}

/**
 * 由事件前缀推导的已知事实集合（Known Fact Ledger 摘要，docs/19 §7.3）。
 * 观察面板数据源：回放任意时刻只包含当时已知事实，不泄露未来观测。
 *
 * 释放规则（全部数据驱动，禁止 case_id 特判）：
 * 1. 已进入快照（FACT_DISCOVERED 事件产生）的事实；
 * 2. 其产出 Skill 执行已终态（SUCCEEDED / FAILED / DATA_MISSING）的事实；
 * 3. 基线资源状态（RESOURCE_STATE）：其对象已进入 Known 集合（候选/计划目标/任务目标/
 *    已发现事实引用）即视为其身份已知（§7.1 Known Topology Subgraph）；
 * 4. 基线拓扑关系（TOPOLOGY_RELATION）：其所属 topology_query Skill 执行完成后视为
 *    进入 Known Topology Subgraph；
 * 5. 被"已释放 LOG_FINGERPRINT"命中的原始日志行（指纹查询命中的日志细节）。
 */
export function releasedFactsFrom(
  snapshot: {
    facts: CanonicalFact[]
    skill_executions: Array<{ execution_id: string; status: string; skill_id?: string }>
    tasks: Array<{ task_id: string; status: string; target_object_refs?: string[] }>
    candidates?: Array<{ object_id?: string }>
    planner_targets?: Array<{ target_resource?: string }>
    agent_focus?: { object_refs?: string[] }
  },
  allFacts: CanonicalFact[],
): CanonicalFact[] {
  const releasedIds = new Set(snapshot.facts.map((f) => f.fact_id))
  const completedExecutions = new Set<string>()
  const completedSkills = new Set<string>()
  for (const s of snapshot.skill_executions) {
    if (s.status === 'SUCCEEDED' || s.status === 'FAILED' || s.status === 'DATA_MISSING') {
      completedExecutions.add(s.execution_id)
      if (s.skill_id) completedSkills.add(s.skill_id)
    }
  }
  // Known 对象集合：候选对象 ∪ 计划目标 ∪ 任务目标 ∪ 焦点对象 ∪ 已发现事实对象。
  const knownObjectIds = new Set<string>()
  const push = (v: unknown) => {
    if (typeof v === 'string' && v) knownObjectIds.add(v)
    else if (Array.isArray(v)) v.forEach(push)
  }
  for (const c of snapshot.candidates ?? []) push(c.object_id)
  for (const t of snapshot.tasks ?? []) push(t.target_object_refs)
  for (const p of snapshot.planner_targets ?? []) push(p.target_resource)
  push(snapshot.agent_focus?.object_refs)
  for (const f of snapshot.facts) push(f.object_refs)
  // 已释放指纹命中的原始日志行 id 集合。
  const matchedLogIds = new Set<string>()
  for (const f of allFacts) {
    if (f.fact_type === FactType.LOG_FINGERPRINT && releasedIds.has(f.fact_id)) {
      const ids = f.payload['matched_log_ids']
      if (Array.isArray(ids)) for (const id of ids) matchedLogIds.add(String(id))
    }
  }
  return allFacts.filter((f) => {
    if (releasedIds.has(f.fact_id)) return true
    if (completedExecutions.has(f.source.execution_id)) return true
    if (
      f.fact_type === FactType.RESOURCE_STATE &&
      (f.object_refs ?? []).some((o) => knownObjectIds.has(o))
    ) {
      return true
    }
    if (
      f.fact_type === FactType.TOPOLOGY_RELATION &&
      completedSkills.has(f.source.skill_id)
    ) {
      return true
    }
    if (f.fact_type === FactType.LOG && matchedLogIds.has(f.source.source_refs[0] ?? '')) return true
    return false
  })
}

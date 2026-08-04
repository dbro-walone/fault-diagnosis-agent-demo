/**
 * CrossPlaneBinding —— 图谱与实例拓扑跨平面显式绑定（docs/19 §6）。
 *
 * 现状升级（阶段3）：把"按同名字符串/静态文件跨层高亮"（旧 cross-layer-mappings.json
 * 的 INSTANCE_OF / APPLICABLE_FAULT_MODE / EVIDENCE_MAPPING）升级为文档 §6 规定的
 * 显式 CrossPlaneBinding：
 *
 * - 静态 Binding（Adapter 编译）：INSTANCE_OF / CONFORMS_TO / ENTRY_OBJECT_TYPE，
 *   随 Case 编译生成，状态恒为 ACTIVE；
 * - 动态 Binding（Runtime 状态派生）：CANDIDATE_ON_RESOURCE / CANDIDATE_OF_FAULT_MODE /
 *   EVIDENCE_MATCHES_RULE / ROOT_CAUSE_CONFIRMED_AS，由候选/证据/根因确认事件驱动，
 *   生命周期 PROPOSED → ACTIVE → SUPERSEDED / REVOKED；
 * - 前端只绘制 ACTIVE Binding（跨平面光柱/曲线只允许 ACTIVE）。
 *
 * 本模块是纯函数 + 只读静态索引：不写回本体，不执行诊断计算，不修改 Case 文件。
 * 动态 Binding 由 projection-store 依据不可变递增事件流归并出的快照确定性派生，
 * 回放时按快照恢复当时 ACTIVE Binding（docs/19 §6.4）。
 */

import kgNodesJson from '../../model/knowledge_graph_package/knowledge/nodes.json'
import capabilitiesJson from '../../model/knowledge_graph_package/ontology/topology_capabilities.json'
import evidenceRulesJson from '../../model/knowledge_graph_package/knowledge/evidence_rules.json'
import { V1_RESOURCE_TYPE_MAP } from '../adapters/v1_to_instance_topology'
import type { InstanceTopologySnapshot } from '../adapters/v1_to_instance_topology'
import {
  CandidateStatus,
  type CanonicalFact,
  type DiagnosisSessionSnapshot,
  type Evidence,
} from './runtime-types'

// ─────────────────────────────────────────────────────────────────────────────
// 枚举（docs/19 §6.1/§6.2）
// ─────────────────────────────────────────────────────────────────────────────

/** 绑定两侧平面。 */
export const BindingPlane = {
  TOPOLOGY: 'TOPOLOGY',
  KNOWLEDGE: 'KNOWLEDGE',
} as const
export type BindingPlane = (typeof BindingPlane)[keyof typeof BindingPlane]

/** 动态 Binding 生命周期状态机状态。 */
export const BindingStatus = {
  PROPOSED: 'PROPOSED',
  ACTIVE: 'ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
  REVOKED: 'REVOKED',
} as const
export type BindingStatus = (typeof BindingStatus)[keyof typeof BindingStatus]

/** 静态与动态 Binding 类型（docs/19 §6.2）。 */
export const CrossPlaneBindingType = {
  INSTANCE_OF: 'INSTANCE_OF',
  CONFORMS_TO: 'CONFORMS_TO',
  ENTRY_OBJECT_TYPE: 'ENTRY_OBJECT_TYPE',
  CANDIDATE_ON_RESOURCE: 'CANDIDATE_ON_RESOURCE',
  CANDIDATE_OF_FAULT_MODE: 'CANDIDATE_OF_FAULT_MODE',
  EVIDENCE_MATCHES_RULE: 'EVIDENCE_MATCHES_RULE',
  ROOT_CAUSE_CONFIRMED_AS: 'ROOT_CAUSE_CONFIRMED_AS',
} as const
export type CrossPlaneBindingType =
  (typeof CrossPlaneBindingType)[keyof typeof CrossPlaneBindingType]

/** 静态 Binding 类型集合（Adapter 生成）。 */
export const STATIC_BINDING_TYPES: ReadonlySet<CrossPlaneBindingType> = new Set([
  CrossPlaneBindingType.INSTANCE_OF,
  CrossPlaneBindingType.CONFORMS_TO,
  CrossPlaneBindingType.ENTRY_OBJECT_TYPE,
])

/** 动态 Binding 类型集合（Runtime 事件驱动）。 */
export const DYNAMIC_BINDING_TYPES: ReadonlySet<CrossPlaneBindingType> = new Set([
  CrossPlaneBindingType.CANDIDATE_ON_RESOURCE,
  CrossPlaneBindingType.CANDIDATE_OF_FAULT_MODE,
  CrossPlaneBindingType.EVIDENCE_MATCHES_RULE,
  CrossPlaneBindingType.ROOT_CAUSE_CONFIRMED_AS,
])

export const ALL_BINDING_TYPES: ReadonlySet<CrossPlaneBindingType> = new Set([
  ...STATIC_BINDING_TYPES,
  ...DYNAMIC_BINDING_TYPES,
])

// ─────────────────────────────────────────────────────────────────────────────
// 数据模型（docs/19 §6.1）
// ─────────────────────────────────────────────────────────────────────────────

/** 绑定产生者。 */
export interface BindingCreatedBy {
  type: 'ADAPTER' | 'REASONING' | 'EVIDENCE_ENGINE'
  ref: string
}

/** CrossPlaneBinding —— 图谱与拓扑跨平面的可审计关联。 */
export interface CrossPlaneBinding {
  binding_id: string
  binding_type: CrossPlaneBindingType
  source_plane: BindingPlane
  source_ref: string
  target_plane: BindingPlane
  target_ref: string
  status: BindingStatus
  created_by: BindingCreatedBy
  valid_time: { from: string | null; to: string | null }
  /** 语义来源（静态映射规则 / 命中的知识规则）。 */
  provenance?: { rule_ref: string }
  /** 审计扩展：触发该动态 Binding 的候选 id（CANDIDATE_* / ROOT_CAUSE_*）。 */
  candidate_id?: string
  /** 审计扩展：触发该动态 Binding 的证据 id（EVIDENCE_MATCHES_RULE）。 */
  evidence_id?: string
}

/** 动态 Binding 生命周期触发。 */
export type BindingLifecycleTrigger =
  | { kind: 'PROPOSE' }
  | { kind: 'CONFIRM' }
  | { kind: 'REVOKE' }
  | { kind: 'SUPERSEDE' }

/**
 * 动态 Binding 生命周期状态机（docs/19 §6.2）：
 *   PROPOSED → ACTIVE → SUPERSEDED / REVOKED。
 * PROPOSED 是"事件已触发但未落实"的中间态；本 Demo 中候选/证据生成即确认，
 * 故归并后快照呈现的多为 ACTIVE；REVOKED / SUPERSEDED 为终态不再回退。
 */
export function transitionBindingStatus(
  current: BindingStatus,
  trigger: BindingLifecycleTrigger,
): BindingStatus {
  switch (current) {
    case BindingStatus.PROPOSED:
      return trigger.kind === 'CONFIRM' ? BindingStatus.ACTIVE : current
    case BindingStatus.ACTIVE:
      if (trigger.kind === 'REVOKE') return BindingStatus.REVOKED
      if (trigger.kind === 'SUPERSEDE') return BindingStatus.SUPERSEDED
      return current
    default:
      // REVOKED / SUPERSEDED 为终态。
      return current
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 知识平面静态索引（docs/19 §4.4：RESOURCE_TYPE / FAULT_MODE / DIAGNOSTIC_RULE）
// ─────────────────────────────────────────────────────────────────────────────

/** 证据规则定义（model/knowledge_graph_package/knowledge/evidence_rules.json）。 */
export interface KnowledgeRuleDef {
  rule_id: string
  rule_code: string
  applies_to_resource_types: string[]
  input_fact_types: string[]
  conditions: Array<{ field: string; operator: string; value: string | number | string[] }>
  output_evidence: { evidence_type: string; direction?: string; strength?: string }
}

/** L1 类型拓扑能力（model/knowledge_graph_package/ontology/topology_capabilities.json）。 */
export interface TopologyCapabilityDef {
  capability_code: string
  source_types: string[]
  target_types: string[]
  instance_relation: string
}

/** 知识平面索引 —— 由静态 model 构建的一次性只读索引。 */
export interface KnowledgePlaneIndex {
  /** RESOURCE_TYPE code → 图谱节点 id（如 CONTROLLER → ot-controller）。 */
  resourceTypeNodeByCode: Map<string, string>
  /** FAULT_MODE code → 图谱节点 id（如 CONTROLLER_WARM_RESET → fm-controller-warm-reset）。 */
  faultModeNodeByCode: Map<string, string>
  /** DIAGNOSTIC_RULE code → 图谱节点 id（如 CONTROLLER_RESET_ALARM_RULE → er-reset-alarm）。 */
  ruleNodeByCode: Map<string, string>
  /** 全部知识节点 id 集合（供校验 source/target 存在）。 */
  nodeIds: Set<string>
  /** L1 类型拓扑能力注册表。 */
  capabilities: TopologyCapabilityDef[]
  /** 证据规则明细（按 rule_code 对齐 DIAGNOSTIC_RULE 节点）。 */
  rules: KnowledgeRuleDef[]
}

interface KgNodeRecord {
  node_id: string
  node_type: string
  code: string
  properties?: Record<string, unknown>
}
interface KgNodesDoc {
  nodes: KgNodeRecord[]
}
interface CapabilitiesDoc {
  capabilities: TopologyCapabilityDef[]
}
interface EvidenceRulesDoc {
  rules: KnowledgeRuleDef[]
}

let kgIndex: KnowledgePlaneIndex | null = null

/** 构建知识平面静态索引（惰性单例，纯只读）。 */
export function buildKnowledgePlaneIndex(): KnowledgePlaneIndex {
  if (kgIndex) return kgIndex
  const nodes = (kgNodesJson as KgNodesDoc).nodes ?? []
  const capabilities = (capabilitiesJson as CapabilitiesDoc).capabilities ?? []
  const rules = (evidenceRulesJson as EvidenceRulesDoc).rules ?? []

  const resourceTypeNodeByCode = new Map<string, string>()
  const faultModeNodeByCode = new Map<string, string>()
  const ruleNodeByCode = new Map<string, string>()
  const nodeIds = new Set<string>()
  for (const n of nodes) {
    nodeIds.add(n.node_id)
    if (n.node_type === 'RESOURCE_TYPE') resourceTypeNodeByCode.set(n.code, n.node_id)
    if (n.node_type === 'FAULT_MODE') faultModeNodeByCode.set(n.code, n.node_id)
    if (n.node_type === 'DIAGNOSTIC_RULE') ruleNodeByCode.set(n.code, n.node_id)
  }

  kgIndex = {
    resourceTypeNodeByCode,
    faultModeNodeByCode,
    ruleNodeByCode,
    nodeIds,
    capabilities,
    rules,
  }
  return kgIndex
}

/** 便捷引用：默认知识平面索引（惰性构建）。 */
export function knowledgePlaneIndex(): KnowledgePlaneIndex {
  return buildKnowledgePlaneIndex()
}

// ─────────────────────────────────────────────────────────────────────────────
// 静态 Binding 编译（Adapter 生成，docs/19 §6.2）
// ─────────────────────────────────────────────────────────────────────────────

function adapterCreatedBy(caseId: string): BindingCreatedBy {
  return { type: 'ADAPTER', ref: `compile-${caseId}` }
}

/**
 * 编译 Case 静态 Binding（docs/19 §6.2 静态行）：
 * - INSTANCE_OF：每个 ResourceInstance → 其 RESOURCE_TYPE 图谱节点
 *   （按 resource_type_code 精确匹配，resource_id 稳定）；
 * - CONFORMS_TO：实例关系符合 L1 类型拓扑能力（source/target 类型在能力范围内）；
 * - ENTRY_OBJECT_TYPE：场景入口对象解析后 → 其资源类型节点。
 *
 * 全部静态 Binding 恒为 ACTIVE（事实性关联，不随诊断变化）。
 */
export function compileStaticBindings(
  topology: InstanceTopologySnapshot,
  index: KnowledgePlaneIndex,
  entryObjectId: string | null = null,
): CrossPlaneBinding[] {
  const out: CrossPlaneBinding[] = []
  const caseId = topology.provenance.case_id ?? topology.topology_id

  // —— INSTANCE_OF ——
  for (const r of topology.resources) {
    const nodeId = index.resourceTypeNodeByCode.get(r.resource_type_code)
    if (!nodeId) continue
    out.push({
      binding_id: `bind-instance-of-${r.resource_id}`,
      binding_type: CrossPlaneBindingType.INSTANCE_OF,
      source_plane: BindingPlane.TOPOLOGY,
      source_ref: r.resource_id,
      target_plane: BindingPlane.KNOWLEDGE,
      target_ref: nodeId,
      status: BindingStatus.ACTIVE,
      created_by: adapterCreatedBy(caseId),
      valid_time: { from: null, to: null },
      provenance: { rule_ref: 'resource_type_mapping@1.0' },
    })
  }

  // —— CONFORMS_TO ——
  const resourceTypeById = new Map(topology.resources.map((r) => [r.resource_id, r.resource_type_code]))
  for (const rel of topology.relations) {
    const srcType = resourceTypeById.get(rel.source_ref)
    const tgtType = resourceTypeById.get(rel.target_ref)
    if (!srcType || !tgtType) continue
    const cap = index.capabilities.find(
      (c) =>
        c.instance_relation === rel.relation_type &&
        (c.source_types.includes('*') || c.source_types.includes(srcType)) &&
        (c.target_types.includes('*') || c.target_types.includes(tgtType)),
    )
    if (!cap) continue
    out.push({
      binding_id: `bind-conforms-${rel.relation_id}`,
      binding_type: CrossPlaneBindingType.CONFORMS_TO,
      source_plane: BindingPlane.TOPOLOGY,
      source_ref: rel.relation_id,
      target_plane: BindingPlane.KNOWLEDGE,
      target_ref: `kg:capability:${cap.capability_code}`,
      status: BindingStatus.ACTIVE,
      created_by: adapterCreatedBy(caseId),
      valid_time: { from: null, to: null },
      provenance: { rule_ref: `capability:${cap.capability_code}` },
    })
  }

  // —— ENTRY_OBJECT_TYPE ——
  if (entryObjectId) {
    const entry = topology.resources.find((r) => r.resource_id === entryObjectId)
    const nodeId = entry ? index.resourceTypeNodeByCode.get(entry.resource_type_code) : undefined
    if (nodeId) {
      out.push({
        binding_id: `bind-entry-${entryObjectId}`,
        binding_type: CrossPlaneBindingType.ENTRY_OBJECT_TYPE,
        source_plane: BindingPlane.TOPOLOGY,
        source_ref: entryObjectId,
        target_plane: BindingPlane.KNOWLEDGE,
        target_ref: nodeId,
        status: BindingStatus.ACTIVE,
        created_by: adapterCreatedBy(caseId),
        valid_time: { from: null, to: null },
        provenance: { rule_ref: 'entry_object_resolution@1.0' },
      })
    }
  }

  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// EVIDENCE_MATCHES_RULE 匹配（docs/19 §6.2：Evidence 命中哪条知识规则）
// ─────────────────────────────────────────────────────────────────────────────

/** V2 Fact 类型 → 规则 input_fact_types 匹配（宽松别名，数据驱动）。 */
function factTypeMatches(factType: string, inputTypes: string[]): boolean {
  const b = factType.toUpperCase().replace(/[^A-Z_]/g, '')
  return inputTypes.some((t) => {
    const a = t.toUpperCase().replace(/[^A-Z_]/g, '')
    if (a === b) return true
    if (a === 'LOG_FINGERPRINT_MATCH' && b === 'LOG_FINGERPRINT') return true
    if (a === 'ALARM_ABSENCE' && b === 'ABSENCE') return true
    return false
  })
}

/** 对象资源类型码 → 规则 applies_to_resource_types（未知类型不设门，宽松）。 */
function objectTypeMatches(typeCode: string | null | undefined, applies: string[]): boolean {
  if (!typeCode) return true
  return applies.includes(typeCode)
}

function tokenize(v: unknown): string[] {
  return String(v ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
}

/** 条件字段裸名（payload.severity / value.peak_value → severity）。 */
function conditionLeaf(field: string): string {
  return field.replace(/^(payload|value)\./, '')
}

/**
 * 规则条件对 Fact payload 的宽松求值（条件字段为旧框架语义，与 V2 CanonicalFact
 * payload 字段不完全一致，故用"字段直达 + 全文 token 搜索"双通道）。
 *
 * 返回：
 * - true  → 可判定且满足（计入规则得分）；
 * - false → 可判定且不满足（该规则被排除）；
 * - null  → 无法判定（字段缺失且无有效 token，中性，不排除也不加分）。
 */
function evalRuleCondition(
  cond: { field: string; operator: string; value: string | number | string[] },
  payload: Record<string, unknown>,
): boolean | null {
  const leaf = conditionLeaf(cond.field)
  const direct = payload[leaf]
  const operator = cond.operator.toUpperCase()

  const stringValue = (v: unknown): string => String(v ?? '')
  const numericValue = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  switch (operator) {
    case 'IN': {
      const list = Array.isArray(cond.value) ? cond.value.map(stringValue) : [stringValue(cond.value)]
      if (direct !== undefined && direct !== null) {
        return list.includes(stringValue(direct))
      }
      return null
    }
    case 'LIKE': {
      const needle = stringValue(cond.value).toLowerCase()
      if (!needle) return null
      if (direct !== undefined && direct !== null) {
        return stringValue(direct).toLowerCase().includes(needle)
      }
      const hay = JSON.stringify(payload).toLowerCase()
      return hay.includes(needle)
    }
    case 'EQ': {
      if (direct !== undefined && direct !== null) {
        return stringValue(direct) === stringValue(cond.value)
      }
      const tokens = tokenize(cond.value)
      if (!tokens.length) return null
      const hay = JSON.stringify(payload).toLowerCase()
      return tokens.every((t) => hay.includes(t)) ? true : null
    }
    case 'GT':
    case 'GTE':
    case 'LT':
    case 'LTE': {
      const actual = numericValue(direct)
      if (actual === null) return null
      let threshold = numericValue(cond.value)
      // 支持 "baseline * 2" 形式的相对阈值。
      if (threshold === null && typeof cond.value === 'string') {
        const m = cond.value.match(/^baseline\s*\*\s*(\d+)$/)
        if (m) {
          const base = numericValue(payload['baseline'])
          if (base !== null) threshold = base * Number(m[1])
        }
      }
      if (threshold === null) return null
      if (operator === 'GT') return actual > threshold
      if (operator === 'GTE') return actual >= threshold
      if (operator === 'LT') return actual < threshold
      return actual <= threshold
    }
    default:
      return null
  }
}

/**
 * 证据 → 命中的知识规则节点 id（EVIDENCE_MATCHES_RULE 目标）。
 *
 * 匹配（数据驱动、确定性、禁止 case_id 特判）：
 * 1. 规则集合过滤：对象资源类型 ∈ applies_to_resource_types（未知类型不设门）
 *    ∧ Fact 类型 ∈ input_fact_types（宽松别名）；
 * 2. 规则条件对 Fact payload 求值：任一条件不满足 → 排除；
 *    满足的条件数作为得分；
 * 3. 得分最高者胜出；并列按 rule_id 字典序（确定性）。
 */
export function matchEvidenceToRule(
  fact: CanonicalFact,
  objectResourceType: string | null | undefined,
  index: KnowledgePlaneIndex,
): string | null {
  const candidates = index.rules.filter(
    (r) =>
      objectTypeMatches(objectResourceType, r.applies_to_resource_types) &&
      factTypeMatches(fact.fact_type, r.input_fact_types),
  )
  if (candidates.length === 0) return null

  let best: { rule: KnowledgeRuleDef; score: number } | null = null
  for (const rule of candidates) {
    let score = 0
    let excluded = false
    for (const cond of rule.conditions) {
      const result = evalRuleCondition(cond, fact.payload)
      if (result === true) score += 1
      else if (result === false) {
        excluded = true
        break
      }
    }
    if (excluded) continue
    if (!best || score > best.score) best = { rule, score }
    else if (score === best.score && rule.rule_id < best.rule.rule_id) best = { rule, score }
  }
  if (!best) return null
  return index.ruleNodeByCode.get(best.rule.rule_code) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// 动态 Binding 派生（Runtime 状态驱动，docs/19 §6.2 动态行）
// ─────────────────────────────────────────────────────────────────────────────

/** 活跃假设候选状态（docs/10 §7；排除/证据不足不激活 Binding）。 */
export const ACTIVE_HYPOTHESIS_STATUSES: ReadonlySet<CandidateStatus> = new Set([
  CandidateStatus.INITIAL,
  CandidateStatus.ACTIVE,
  CandidateStatus.LEADING,
  CandidateStatus.CONFLICTING,
  CandidateStatus.CONFIRMED,
])

/**
 * 从快照派生当前动态 Binding（纯函数、确定性）：
 * - 每个候选：CANDIDATE_ON_RESOURCE（故障模式 → 实例）+ CANDIDATE_OF_FAULT_MODE
 *   （实例 → 故障模式）。候选处于活跃假设 → ACTIVE；被排除/证据不足 → REVOKED；
 * - 每个 Evidence：EVIDENCE_MATCHES_RULE（实例 → 命中的 DIAGNOSTIC_RULE 节点）；
 * - 根因确认：ROOT_CAUSE_CONFIRMED_AS（根因实例 → 故障模式），并把已确认候选的
 *   CANDIDATE_* 绑定标记 SUPERSEDED（生命周期 §6.2）。
 *
 * resourceTypeOf：object_id → 资源类型码（由调用方注入，通常来自 InstanceTopology）。
 * 回放时快照重建，派生结果与当时事件流一致，天然满足"按 Snapshot 恢复 ACTIVE Binding"。
 */
export function deriveDynamicBindings(
  snapshot: DiagnosisSessionSnapshot,
  resourceTypeOf: (objectId: string) => string | null,
  index: KnowledgePlaneIndex,
): CrossPlaneBinding[] {
  const out: CrossPlaneBinding[] = []
  const factById = new Map(snapshot.facts.map((f) => [f.fact_id, f]))

  // —— 候选绑定 ——
  for (const c of snapshot.candidates) {
    if (!c.fault_mode_code) continue
    const fmNodeId = index.faultModeNodeByCode.get(c.fault_mode_code)
    if (!fmNodeId) continue
    const active = ACTIVE_HYPOTHESIS_STATUSES.has(c.status)
    const status = active ? BindingStatus.ACTIVE : BindingStatus.REVOKED
    out.push({
      binding_id: `bind-${c.candidate_id}-on-resource`,
      binding_type: CrossPlaneBindingType.CANDIDATE_ON_RESOURCE,
      source_plane: BindingPlane.KNOWLEDGE,
      source_ref: fmNodeId,
      target_plane: BindingPlane.TOPOLOGY,
      target_ref: c.object_id,
      status,
      created_by: { type: 'REASONING', ref: `candidate:${c.candidate_id}` },
      valid_time: { from: null, to: null },
      candidate_id: c.candidate_id,
    })
    out.push({
      binding_id: `bind-${c.candidate_id}-of-fault-mode`,
      binding_type: CrossPlaneBindingType.CANDIDATE_OF_FAULT_MODE,
      source_plane: BindingPlane.TOPOLOGY,
      source_ref: c.object_id,
      target_plane: BindingPlane.KNOWLEDGE,
      target_ref: fmNodeId,
      status,
      created_by: { type: 'REASONING', ref: `candidate:${c.candidate_id}` },
      valid_time: { from: null, to: null },
      candidate_id: c.candidate_id,
    })
  }

  // —— 证据 → 规则 ——
  for (const ev of snapshot.evidences) {
    const fact = ev.fact_refs.map((id) => factById.get(id)).find((f): f is CanonicalFact => !!f)
    if (!fact) continue
    const obj = fact.object_refs?.[0] ?? ev.object_refs?.[0]
    if (!obj) continue
    const ruleNodeId = matchEvidenceToRule(fact, resourceTypeOf(obj), index)
    if (!ruleNodeId) continue
    out.push({
      binding_id: `bind-${ev.evidence_id}-matches-rule`,
      binding_type: CrossPlaneBindingType.EVIDENCE_MATCHES_RULE,
      source_plane: BindingPlane.TOPOLOGY,
      source_ref: obj,
      target_plane: BindingPlane.KNOWLEDGE,
      target_ref: ruleNodeId,
      status: BindingStatus.ACTIVE,
      created_by: { type: 'EVIDENCE_ENGINE', ref: `evidence:${ev.evidence_id}` },
      valid_time: { from: null, to: null },
      evidence_id: ev.evidence_id,
      provenance: { rule_ref: ruleNodeId },
    })
  }

  // —— 根因确认 ——
  if (snapshot.session.terminal_status === 'ROOT_CAUSE_CONFIRMED' && snapshot.conclusion?.root_cause) {
    const root = snapshot.conclusion.root_cause
    const fmNodeId = root.fault_mode_code
      ? index.faultModeNodeByCode.get(root.fault_mode_code)
      : undefined
    if (fmNodeId) {
      out.push({
        binding_id: `bind-${root.candidate_id}-confirmed-as`,
        binding_type: CrossPlaneBindingType.ROOT_CAUSE_CONFIRMED_AS,
        source_plane: BindingPlane.TOPOLOGY,
        source_ref: root.object_id,
        target_plane: BindingPlane.KNOWLEDGE,
        target_ref: fmNodeId,
        status: BindingStatus.ACTIVE,
        created_by: { type: 'REASONING', ref: `root_cause:${root.candidate_id}` },
        valid_time: { from: null, to: null },
        candidate_id: root.candidate_id,
      })
      // 根因确认取代该候选的 CANDIDATE_* 绑定（生命周期 SUPERSEDED）。
      for (const b of out) {
        if (
          b.candidate_id === root.candidate_id &&
          (b.binding_type === CrossPlaneBindingType.CANDIDATE_ON_RESOURCE ||
            b.binding_type === CrossPlaneBindingType.CANDIDATE_OF_FAULT_MODE) &&
          b.status === BindingStatus.ACTIVE
        ) {
          b.status = BindingStatus.SUPERSEDED
        }
      }
    }
  }

  return out
}

/** 取 ACTIVE Binding（前端只绘制 ACTIVE，docs/19 §6.2）。 */
export function activeBindingsOf(bindings: CrossPlaneBinding[]): CrossPlaneBinding[] {
  return bindings.filter((b) => b.status === BindingStatus.ACTIVE)
}

/** 实例 → 资源类型码解析器（来自 InstanceTopologySnapshot）。 */
export function resourceTypeResolverOf(topology: InstanceTopologySnapshot): (objectId: string) => string | null {
  const byId = new Map(topology.resources.map((r) => [r.resource_id, r.resource_type_code]))
  return (objectId: string) => byId.get(objectId) ?? null
}

/** V1 资源类型 → 归一资源类型码（供无 InstanceTopology 时的宽松回退）。 */
export function v1TypeToCode(type: string | null | undefined): string | null {
  if (!type) return null
  return V1_RESOURCE_TYPE_MAP[type] ?? type
}

// ─────────────────────────────────────────────────────────────────────────────
// 校验器（docs/19 §6.2 生命周期 + 引用完整性）
// ─────────────────────────────────────────────────────────────────────────────

export interface BindingValidationIssue {
  code: string
  severity: 'ERROR' | 'WARN'
  binding_id: string
  message: string
}

/**
 * 校验 Binding 集合：
 * - binding_type / status 合法；
 * - source_ref / target_ref 在对应平面存在（拓扑资源/关系、知识节点/能力）；
 * - 动态 Binding 必须由对应 Runtime 状态激活（候选/证据/根因确认存在）。
 *
 * topology 为空时不校验拓扑侧引用存在性；snapshot 为空时不校验事件激活。
 */
export function validateCrossPlaneBindings(
  bindings: CrossPlaneBinding[],
  topology: InstanceTopologySnapshot | null,
  index: KnowledgePlaneIndex,
  snapshot: DiagnosisSessionSnapshot | null = null,
): BindingValidationIssue[] {
  const issues: BindingValidationIssue[] = []
  const resourceIds = new Set(topology?.resources.map((r) => r.resource_id) ?? [])
  const relationIds = new Set(topology?.relations.map((r) => r.relation_id) ?? [])
  const capabilityRefs = new Set(index.capabilities.map((c) => `kg:capability:${c.capability_code}`))

  const planeIdsOf = (plane: BindingPlane, ref: string): boolean =>
    plane === BindingPlane.TOPOLOGY
      ? resourceIds.has(ref) || relationIds.has(ref)
      : index.nodeIds.has(ref) || capabilityRefs.has(ref)

  for (const b of bindings) {
    if (!ALL_BINDING_TYPES.has(b.binding_type)) {
      issues.push({
        code: 'BIND-ILLEGAL-TYPE',
        severity: 'ERROR',
        binding_id: b.binding_id,
        message: `非法 binding_type：${b.binding_type}`,
      })
    }
    if (!Object.values(BindingStatus).includes(b.status)) {
      issues.push({
        code: 'BIND-ILLEGAL-STATUS',
        severity: 'ERROR',
        binding_id: b.binding_id,
        message: `非法 status：${b.status}`,
      })
    }
    if (topology && !planeIdsOf(b.source_plane, b.source_ref)) {
      issues.push({
        code: 'BIND-SRC-MISSING',
        severity: 'ERROR',
        binding_id: b.binding_id,
        message: `source 引用不存在：${b.source_plane}:${b.source_ref}`,
      })
    }
    if (!planeIdsOf(b.target_plane, b.target_ref)) {
      issues.push({
        code: 'BIND-TGT-MISSING',
        severity: 'ERROR',
        binding_id: b.binding_id,
        message: `target 引用不存在：${b.target_plane}:${b.target_ref}`,
      })
    }

    // 动态 Binding 必须由对应 Runtime 状态激活。
    if (snapshot && DYNAMIC_BINDING_TYPES.has(b.binding_type)) {
      if (
        (b.binding_type === CrossPlaneBindingType.CANDIDATE_ON_RESOURCE ||
          b.binding_type === CrossPlaneBindingType.CANDIDATE_OF_FAULT_MODE) &&
        !snapshot.candidates.some((c) => c.candidate_id === b.candidate_id)
      ) {
        issues.push({
          code: 'BIND-NO-CANDIDATE-EVENT',
          severity: 'ERROR',
          binding_id: b.binding_id,
          message: `动态 Binding 无候选生成事件：${b.candidate_id ?? ''}`,
        })
      }
      if (
        b.binding_type === CrossPlaneBindingType.EVIDENCE_MATCHES_RULE &&
        !snapshot.evidences.some((e) => e.evidence_id === b.evidence_id)
      ) {
        issues.push({
          code: 'BIND-NO-EVIDENCE-EVENT',
          severity: 'ERROR',
          binding_id: b.binding_id,
          message: `动态 Binding 无证据创建事件：${b.evidence_id ?? ''}`,
        })
      }
      if (
        b.binding_type === CrossPlaneBindingType.ROOT_CAUSE_CONFIRMED_AS &&
        (snapshot.session.terminal_status !== 'ROOT_CAUSE_CONFIRMED' ||
          snapshot.conclusion?.root_cause?.candidate_id !== b.candidate_id)
      ) {
        issues.push({
          code: 'BIND-NO-ROOT-CONFIRM-EVENT',
          severity: 'ERROR',
          binding_id: b.binding_id,
          message: `动态 Binding 无根因确认事件：${b.candidate_id ?? ''}`,
        })
      }
    }
  }

  // 同一 binding_id 不允许重复。
  const seen = new Set<string>()
  for (const b of bindings) {
    if (seen.has(b.binding_id)) {
      issues.push({
        code: 'BIND-DUP-ID',
        severity: 'ERROR',
        binding_id: b.binding_id,
        message: 'binding_id 重复',
      })
    }
    seen.add(b.binding_id)
  }

  return issues
}

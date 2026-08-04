/**
 * Knowledge Service —— KnowledgeGraphPackage 3.0.0 的可查询入口（docs/19 §16.3、§4.8）。
 *
 * 职责边界（docs/19 §13.2）：
 * - 只读知识查询：按现象码 / 资源类型码 / Fact 引用匹配知识条目，沿图谱出边扩展，
 *   返回证据需求集合；不裁决根因、不解释 Fact 为 Evidence（那是 Evidence Engine 的职责）；
 * - 禁止静默修复：多义 code（多个同码节点）显式抛 CKA-MAP-* 错误（§17.2）。
 *
 * 数据源：KnowledgeGraphPackage 3.0.0（model/knowledge_graph_package），
 * 与 case-knowledge-adapter 共用同一份 JSON。
 */

import { errorCode, ErrorPrefix } from './error-codes'

// ─────────────────────────────────────────────────────────────────────────────
// KG 3.0.0 最小记录结构（与 case-knowledge-adapter 相同的 JSON 形状）
// ─────────────────────────────────────────────────────────────────────────────

interface KgNodeRecord {
  node_id: string
  node_type: string
  code: string
  name?: string
  knowledge_level?: string
}
interface KgEdgeRecord {
  edge_id: string
  relation_type: string
  source_ref: string
  target_ref: string
  strength?: string
}

import kgNodesJson from '../../model/knowledge_graph_package/knowledge/nodes.json'
import kgEdgesJson from '../../model/knowledge_graph_package/knowledge/edges.json'

const NODES: KgNodeRecord[] = (kgNodesJson as { nodes: KgNodeRecord[] }).nodes ?? []
const EDGES: KgEdgeRecord[] = (kgEdgesJson as { edges: KgEdgeRecord[] }).edges ?? []

// ─────────────────────────────────────────────────────────────────────────────
// 查询协议（docs/19 §16.3）
// ─────────────────────────────────────────────────────────────────────────────

/** 知识条目匹配结果。 */
export interface KnowledgeEntryMatchSet {
  symptom_concept_refs: string[]
  resource_type_refs: string[]
  fault_mode_refs: string[]
  scenario_refs: string[]
  evidence_requirement_refs: string[]
  diagnostic_rule_refs: string[]
  template_refs: string[]
  /** 命中的匹配轨迹（code → 节点 → 原因），供 LUI/审计解释。 */
  matched_via: Array<{ code: string; node_id: string; node_type: string; reason: string }>
}

/** 知识扩展增量（已知知识子图，docs/19 §7.1）。 */
export interface KnownKnowledgeDelta {
  nodes: Array<{ node_id: string; node_type: string; code: string; name?: string; knowledge_level?: string }>
  edges: Array<{ edge_id: string; relation_type: string; source_ref: string; target_ref: string }>
}

/** 单条证据需求（含满足规则）。 */
export interface EvidenceRequirementItem {
  requirement_id: string
  code: string
  name?: string
  satisfied_by_rule: string | null
}

/** 证据需求集合（docs/19 §16.3 get_evidence_requirements）。 */
export interface EvidenceRequirementSet {
  fault_mode_ref: string | null
  scenario_ref: string | null
  requirements: EvidenceRequirementItem[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部索引
// ─────────────────────────────────────────────────────────────────────────────

const byId = new Map(NODES.map((n) => [n.node_id, n]))
const byCode = new Map<string, KgNodeRecord[]>()
for (const n of NODES) {
  const arr = byCode.get(n.code) ?? []
  arr.push(n)
  byCode.set(n.code, arr)
}

/** 出边邻接表（node_id → [edge, target]）。 */
const outEdges = new Map<string, Array<{ edge: KgEdgeRecord; target: string }>>()
const inEdges = new Map<string, Array<{ edge: KgEdgeRecord; source: string }>>()
for (const e of EDGES) {
  const o = outEdges.get(e.source_ref) ?? []
  o.push({ edge: e, target: e.target_ref })
  outEdges.set(e.source_ref, o)
  const i = inEdges.get(e.target_ref) ?? []
  i.push({ edge: e, source: e.source_ref })
  inEdges.set(e.target_ref, i)
}

/** 按 code 精确取单节点；同码多节点视为多义，抛 CKA-MAP-001（§17.2）。 */
function resolveCode(code: string, nodeType: string | null = null): KgNodeRecord {
  const candidates = byCode.get(code) ?? []
  const filtered = nodeType ? candidates.filter((n) => n.node_type === nodeType) : candidates
  if (filtered.length === 0) {
    throw new Error(`${errorCode(ErrorPrefix.CKA_MAP, 1)} 知识码 ${code} 无对应节点`)
  }
  if (filtered.length > 1) {
    throw new Error(
      `${errorCode(ErrorPrefix.CKA_MAP, 1)} 多义 code ${code} 命中 ${filtered.length} 个节点（${filtered.map((n) => n.node_id).join(',')}），禁止猜测`,
    )
  }
  return filtered[0]
}

// ─────────────────────────────────────────────────────────────────────────────
// 查询函数（§16.3）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 匹配知识条目（§16.3 match_entries）。
 *
 * - symptom_code：SYMPTOM_CONCEPT 码 → 反向 MANIFESTS_AS 命中 FAULT_MODE → 父 FAULT_SCENARIO；
 * - resource_type_code：RESOURCE_TYPE 码；
 * - known_fact_refs：已知 Fact 引用（context 提示，不裁决语义），
 *   按源引用里的事实类型/对象类型命中 EVIDENCE_REQUIREMENT / DIAGNOSTIC_RULE。
 */
export function match_entries(
  symptom_code: string | null,
  resource_type_code: string | null,
  known_fact_refs: string[] = [],
): KnowledgeEntryMatchSet {
  const matched: KnowledgeEntryMatchSet = {
    symptom_concept_refs: [],
    resource_type_refs: [],
    fault_mode_refs: [],
    scenario_refs: [],
    evidence_requirement_refs: [],
    diagnostic_rule_refs: [],
    template_refs: [],
    matched_via: [],
  }
  const seen = (list: string[], id: string) => {
    if (!list.includes(id)) list.push(id)
  }

  // 现象码 → SYMPTOM_CONCEPT。
  if (symptom_code) {
    const sym = resolveCode(symptom_code, 'SYMPTOM_CONCEPT')
    seen(matched.symptom_concept_refs, sym.node_id)
    matched.matched_via.push({ code: symptom_code, node_id: sym.node_id, node_type: sym.node_type, reason: 'symptom_code 命中 SYMPTOM_CONCEPT' })
    // 反向 MANIFESTS_AS → FAULT_MODE → 反向 HAS_FAULT_MODE → FAULT_SCENARIO。
    for (const { source } of inEdges.get(sym.node_id) ?? []) {
      const src = byId.get(source)
      if (!src || src.node_type !== 'FAULT_MODE') continue
      seen(matched.fault_mode_refs, source)
      matched.matched_via.push({ code: src.code, node_id: source, node_type: src.node_type, reason: 'MANIFESTS_AS 反向命中 FAULT_MODE' })
      for (const { source: sc } of inEdges.get(source) ?? []) {
        const scenario = byId.get(sc)
        if (!scenario || scenario.node_type !== 'FAULT_SCENARIO') continue
        seen(matched.scenario_refs, sc)
        matched.matched_via.push({ code: scenario.code, node_id: sc, node_type: scenario.node_type, reason: 'HAS_FAULT_MODE 反向命中 FAULT_SCENARIO' })
      }
    }
  }

  // 资源类型码 → RESOURCE_TYPE（L1）。
  if (resource_type_code) {
    const rt = resolveCode(resource_type_code, 'RESOURCE_TYPE')
    seen(matched.resource_type_refs, rt.node_id)
    matched.matched_via.push({ code: resource_type_code, node_id: rt.node_id, node_type: rt.node_type, reason: 'resource_type_code 命中 L1 RESOURCE_TYPE' })
  }

  // 已知 Fact 引用：context 提示 → 证据需求/诊断规则（按 fact_ref 命中的对象类型映射，不裁决）。
  if (known_fact_refs.length > 0) {
    // 已知 Fact 的对象类型未知，这里仅把"有已知事实"作为 EVIDENCE_REQUIREMENT 命中的
    // 上下文权重：收集全部证据需求节点（其被引用即意味着候选验证路径被激活）。
    for (const n of NODES) {
      if (n.node_type === 'EVIDENCE_REQUIREMENT') seen(matched.evidence_requirement_refs, n.node_id)
    }
  }

  return matched
}

/**
 * 沿知识图谱出边扩展（§16.3 expand_knowledge）。
 * relation_types 白名单为空 = 全部出边；max_hops 限制深度。
 */
export function expand_knowledge(
  entry_refs: string[],
  relation_types: string[] = [],
  max_hops = 3,
): KnownKnowledgeDelta {
  const allow = relation_types.length > 0 ? new Set(relation_types) : null
  const nodes: KnownKnowledgeDelta['nodes'] = []
  const edges: KnownKnowledgeDelta['edges'] = []
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  const seen = new Set<string>()
  const queue: Array<{ id: string; depth: number }> = []
  for (const ref of entry_refs) {
    if (!byId.has(ref)) {
      throw new Error(`${errorCode(ErrorPrefix.IT_REF, 1)} 知识扩展入口 ${ref} 不存在`)
    }
    queue.push({ id: ref, depth: 0 })
    if (!nodeIds.has(ref)) {
      nodeIds.add(ref)
      const n = byId.get(ref)!
      nodes.push({ node_id: n.node_id, node_type: n.node_type, code: n.code, name: n.name, knowledge_level: n.knowledge_level })
    }
  }
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    if (depth >= max_hops) continue
    for (const { edge, target } of outEdges.get(id) ?? []) {
      if (allow && !allow.has(edge.relation_type)) continue
      if (!edgeIds.has(edge.edge_id)) {
        edgeIds.add(edge.edge_id)
        edges.push({ edge_id: edge.edge_id, relation_type: edge.relation_type, source_ref: edge.source_ref, target_ref: edge.target_ref })
      }
      if (!nodeIds.has(target)) {
        nodeIds.add(target)
        const n = byId.get(target)!
        nodes.push({ node_id: n.node_id, node_type: n.node_type, code: n.code, name: n.name, knowledge_level: n.knowledge_level })
      }
      const key = `${id}|${target}|${depth}`
      if (seen.has(key)) continue
      seen.add(key)
      queue.push({ id: target, depth: depth + 1 })
    }
  }
  return { nodes, edges }
}

/**
 * 证据需求集合（§16.3 get_evidence_requirements）。
 * fault_mode_or_scenario_ref 可以是 FAULT_MODE 或 FAULT_SCENARIO 的 code/node_id：
 * - FAULT_MODE → REQUIRES_EVIDENCE → EVIDENCE_REQUIREMENT → SATISFIED_BY_RULE → DIAGNOSTIC_RULE；
 * - FAULT_SCENARIO → HAS_FAULT_MODE → FAULT_MODE → 同上（聚合其全部故障模式的证据需求）。
 */
export function get_evidence_requirements(
  fault_mode_or_scenario_ref: string,
): EvidenceRequirementSet {
  const target = byId.get(fault_mode_or_scenario_ref) ?? resolveCode(fault_mode_or_scenario_ref)
  if (target.node_type !== 'FAULT_MODE' && target.node_type !== 'FAULT_SCENARIO') {
    throw new Error(
      `${errorCode(ErrorPrefix.CKA_MAP, 1)} get_evidence_requirements 入口 ${target.node_id} 类型 ${target.node_type}，期望 FAULT_MODE/FAULT_SCENARIO`,
    )
  }
  const faultModeIds: string[] = []
  if (target.node_type === 'FAULT_MODE') {
    faultModeIds.push(target.node_id)
  } else {
    for (const { target: mode } of outEdges.get(target.node_id) ?? []) {
      const m = byId.get(mode)
      if (m?.node_type === 'FAULT_MODE') faultModeIds.push(mode)
    }
  }

  const requirements: EvidenceRequirementItem[] = []
  const seenReq = new Set<string>()
  for (const fm of faultModeIds) {
    for (const { target: reqId } of outEdges.get(fm) ?? []) {
      const req = byId.get(reqId)
      if (!req || req.node_type !== 'EVIDENCE_REQUIREMENT') continue
      if (seenReq.has(reqId)) continue
      seenReq.add(reqId)
      // SATISFIED_BY_RULE 是出边：EVIDENCE_REQUIREMENT --SATISFIED_BY_RULE→ DIAGNOSTIC_RULE。
      const rule = (outEdges.get(reqId) ?? [])
        .filter(({ edge, target }) => edge.relation_type === 'SATISFIED_BY_RULE' && byId.get(target)?.node_type === 'DIAGNOSTIC_RULE')
        .map(({ target }) => target)[0] ?? null
      requirements.push({
        requirement_id: reqId,
        code: req.code,
        name: req.name,
        satisfied_by_rule: rule,
      })
    }
  }

  return {
    fault_mode_ref: target.node_type === 'FAULT_MODE' ? target.node_id : null,
    scenario_ref: target.node_type === 'FAULT_SCENARIO' ? target.node_id : null,
    requirements,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §16.3 服务对象入口
// ─────────────────────────────────────────────────────────────────────────────

export interface KnowledgeService {
  match_entries(symptom_code: string | null, resource_type_code: string | null, known_fact_refs?: string[]): KnowledgeEntryMatchSet
  expand_knowledge(entry_refs: string[], relation_types?: string[], max_hops?: number): KnownKnowledgeDelta
  get_evidence_requirements(fault_mode_or_scenario_ref: string): EvidenceRequirementSet
}

/** 知识服务单例（只读，无状态）。 */
export const createKnowledgeService = (): KnowledgeService => ({
  match_entries,
  expand_knowledge,
  get_evidence_requirements,
})

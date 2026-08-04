/**
 * KnowledgeGraphPackage 3.0.0 轻量校验器（docs/19 §4.8、§17.2）。
 *
 * 校验范围（阶段1 聚焦数据/模型重构的闭合性）：
 *   - 包版本与清单一致性；
 *   - code 唯一（节点类型内唯一，FaultMode 全包唯一）；
 *   - 边端点存在且节点类型符合关系注册表；
 *   - 每个 FaultMode 有且仅有一个规范父场景（HAS_FAULT_MODE）；
 *   - L1~L4 层级闭合，非根节点必须有 knowledge_level；
 *   - EvidenceRequirement 至少一个满足路径（SATISFIED_BY_RULE）或明确标记未实现；
 *   - DiagnosticRule / DiagnosticTemplate / HistoricalCase / ObservationMapping 声明完整性；
 *   - 知识节点不携带候选分、根因、Evidence 等运行时诊断语义；
 *   - L1 类型不携带实例 ID、当前状态、主备角色等运行态。
 *
 * 不校验（阶段6 完整 Validator 体系）：泄露分级、时间线、CrossPlaneBinding、
 * Runtime Replay 等。
 */

export interface KnowledgePackageIssue {
  code: string
  severity: 'ERROR' | 'WARNING'
  message: string
}

interface KnowledgeNode {
  node_id: string
  node_type: string
  code: string
  name: string
  knowledge_level?: string
  properties?: Record<string, unknown>
}

interface KnowledgeEdge {
  edge_id: string
  relation_type: string
  source_ref: string
  target_ref: string
  strength?: string | null
  role?: string | null
}

interface NodeTypeDef {
  code: string
  knowledge_level: string
}

interface RelationTypeDef {
  code: string
  source_type: string | string[]
  target_type: string | string[]
}

export interface KnowledgePackageInput {
  manifest: { schema_name?: string; schema_version?: string; package_id?: string; knowledge_domain_code?: string }
  nodes: KnowledgeNode[]
  edges: KnowledgeEdge[]
  nodeTypes: NodeTypeDef[]
  relationTypes: RelationTypeDef[]
  evidenceRules: Array<{ rule_code: string; applies_to_resource_types?: string[]; input_fact_types?: string[]; output_evidence?: { evidence_type?: string } }>
  templates: Array<{ template_code: string; member_roles?: string[]; planner_order?: unknown }>
  historicalCases: Array<{ case_code: string; source?: string; review_status?: string; anonymous?: boolean }>
  observationMappings: Array<{ mapping_code: string; source_field?: string; conversion_version?: string }>
}

const NODE_TYPE_LEVELS = new Set(['ROOT', 'L1', 'L2', 'L3', 'L4'])

function asSet(value: string | string[] | undefined): Set<string> {
  return new Set(Array.isArray(value) ? value : value ? [value] : [])
}

/** 校验 KnowledgeGraphPackage 3.0.0，返回问题列表；空数组表示通过。 */
export function validateKnowledgePackage(input: KnowledgePackageInput): KnowledgePackageIssue[] {
  const issues: KnowledgePackageIssue[] = []

  // —— 版本与清单 ——
  if (input.manifest.schema_version !== '3.0.0') {
    issues.push({ code: 'KG-VERSION', severity: 'ERROR', message: `schema_version=${input.manifest.schema_version}，期望 3.0.0` })
  }

  // —— 节点基础 ——
  const byId = new Map<string, KnowledgeNode>()
  const codesByType = new Map<string, Map<string, string>>() // type → code → node_id
  const seenIds = new Set<string>()
  for (const node of input.nodes) {
    if (seenIds.has(node.node_id)) {
      issues.push({ code: 'KG-DUP-ID', severity: 'ERROR', message: `node_id 重复：${node.node_id}` })
    }
    seenIds.add(node.node_id)
    byId.set(node.node_id, node)

    if (!NODE_TYPE_LEVELS.has(node.knowledge_level ?? '')) {
      issues.push({ code: 'KG-LEVEL', severity: 'ERROR', message: `节点 ${node.node_id} 缺少合法 knowledge_level（${node.knowledge_level ?? '(无)'}）` })
    }
    if (node.node_type === 'KNOWLEDGE_DOMAIN' && node.knowledge_level !== 'ROOT') {
      issues.push({ code: 'KG-ROOT', severity: 'ERROR', message: `Domain Root ${node.node_id} 应为 ROOT` })
    }
    if (node.node_type !== 'KNOWLEDGE_DOMAIN' && node.knowledge_level === 'ROOT') {
      issues.push({ code: 'KG-ROOT', severity: 'ERROR', message: `非根节点 ${node.node_id} 不能标记 ROOT` })
    }

    const codeOwner = codesByType.get(node.node_type) ?? new Map<string, string>()
    const prev = codeOwner.get(node.code)
    if (prev && prev !== node.node_id) {
      issues.push({ code: 'KG-CODE-DUP', severity: 'ERROR', message: `code 在类型 ${node.node_type} 内重复：${node.code}（${prev} / ${node.node_id}）` })
    }
    codeOwner.set(node.code, node.node_id)
    codesByType.set(node.node_type, codeOwner)
  }

  // FaultMode code 全包唯一
  const fmCodes = new Map<string, string>()
  for (const node of input.nodes) {
    if (node.node_type !== 'FAULT_MODE') continue
    const prev = fmCodes.get(node.code)
    if (prev) {
      issues.push({ code: 'KG-FM-CODE', severity: 'ERROR', message: `FaultMode code 全包唯一要求被破坏：${node.code}（${prev}/${node.node_id}）` })
    }
    fmCodes.set(node.code, node.node_id)
  }

  // —— 边 ——
  const nodeTypeById = new Map(input.nodes.map((n) => [n.node_id, n.node_type]))
  const relationByCode = new Map(input.relationTypes.map((r) => [r.code, r]))
  const seenEdges = new Set<string>()
  const canonicalParents = new Map<string, string[]>() // fault mode id → parent scenario ids
  for (const edge of input.edges) {
    if (seenEdges.has(edge.edge_id)) {
      issues.push({ code: 'KG-DUP-EDGE', severity: 'ERROR', message: `edge_id 重复：${edge.edge_id}` })
    }
    seenEdges.add(edge.edge_id)

    const src = nodeTypeById.get(edge.source_ref)
    const tgt = nodeTypeById.get(edge.target_ref)
    if (!src || !tgt) {
      issues.push({ code: 'KG-DANGLING', severity: 'ERROR', message: `边 ${edge.edge_id} 端点悬空：${edge.source_ref} → ${edge.target_ref}` })
      continue
    }
    const rel = relationByCode.get(edge.relation_type)
    if (!rel) {
      issues.push({ code: 'KG-REL-UNKNOWN', severity: 'ERROR', message: `边 ${edge.edge_id} 关系类型 ${edge.relation_type} 不在注册表` })
      continue
    }
    if (!asSet(rel.source_type).has(src) || (!asSet(rel.target_type).has(tgt) && !asSet(rel.target_type).has('*'))) {
      issues.push({
        code: 'KG-REL-TYPE',
        severity: 'ERROR',
        message: `边 ${edge.edge_id} 端点类型不符：${src}(${rel.source_type}) → ${tgt}(${rel.target_type}) 关系=${edge.relation_type}`,
      })
    }
    if (edge.relation_type === 'HAS_FAULT_MODE') {
      const parents = canonicalParents.get(edge.target_ref) ?? []
      parents.push(edge.source_ref)
      canonicalParents.set(edge.target_ref, parents)
    }
    if (edge.relation_type === 'EXPLAINS_MODE' && edge.strength) {
      if (!['REQUIRED', 'STRONG', 'CONDITIONAL', 'WEAK'].includes(edge.strength)) {
        issues.push({ code: 'KG-STRENGTH', severity: 'ERROR', message: `边 ${edge.edge_id} strength=${edge.strength} 非法（§4.6.2）` })
      }
    }
  }

  // —— FaultMode 唯一父场景 ——
  for (const node of input.nodes) {
    if (node.node_type !== 'FAULT_MODE') continue
    const parents = canonicalParents.get(node.node_id) ?? []
    if (parents.length !== 1) {
      issues.push({ code: 'KG-FM-PARENT', severity: 'ERROR', message: `FaultMode ${node.node_id} 规范父场景数=${parents.length}，必须恰好 1（§4.6.1）` })
    }
  }

  // —— EvidenceRequirement 满足路径 ——
  const evreqSatisfied = new Set<string>()
  const evreqAll = new Set<string>()
  for (const node of input.nodes) {
    if (node.node_type !== 'EVIDENCE_REQUIREMENT') continue
    evreqAll.add(node.node_id)
    if (node.properties?.implemented === false) continue // 明确标记未实现
  }
  for (const edge of input.edges) {
    if (edge.relation_type === 'SATISFIED_BY_RULE') evreqSatisfied.add(edge.source_ref)
  }
  for (const id of evreqAll) {
    if (!evreqSatisfied.has(id)) {
      issues.push({ code: 'KG-EVREQ-PATH', severity: 'ERROR', message: `EvidenceRequirement ${id} 无 SATISFIED_BY_RULE 满足路径（§4.8-5）` })
    }
  }

  // —— DiagnosticRule 声明完整性 ——
  const ruleCodes = new Set(input.evidenceRules.map((r) => r.rule_code))
  const ruleNodeCodes = new Set(input.nodes.filter((n) => n.node_type === 'DIAGNOSTIC_RULE').map((n) => n.code))
  for (const code of ruleNodeCodes) {
    const detail = input.evidenceRules.find((r) => r.rule_code === code)
    if (!detail) {
      issues.push({ code: 'KG-RULE-DETAIL', severity: 'ERROR', message: `DiagnosticRule ${code} 缺少 evidence_rules.json 明细（§4.8-6）` })
      continue
    }
    if (!detail.applies_to_resource_types?.length || !detail.input_fact_types?.length || !detail.output_evidence) {
      issues.push({ code: 'KG-RULE-DETAIL', severity: 'ERROR', message: `DiagnosticRule ${code} 必须声明 input_fact_types/output_evidence/applies_to_resource_types（§4.8-6）` })
    }
  }
  for (const code of ruleCodes) {
    if (!ruleNodeCodes.has(code)) {
      issues.push({ code: 'KG-RULE-ORPHAN', severity: 'WARNING', message: `evidence_rules.json 的 ${code} 无对应 DIAGNOSTIC_RULE 节点` })
    }
  }

  // —— Template ——
  const templateNodeCodes = new Set(input.nodes.filter((n) => n.node_type === 'DIAGNOSTIC_TEMPLATE').map((n) => n.code))
  for (const tpl of input.templates) {
    if (!templateNodeCodes.has(tpl.template_code)) {
      issues.push({ code: 'KG-TPL-ORPHAN', severity: 'WARNING', message: `template ${tpl.template_code} 无对应 DIAGNOSTIC_TEMPLATE 节点` })
    }
    if (tpl.planner_order !== null) {
      issues.push({ code: 'KG-TPL-ORDER', severity: 'ERROR', message: `Template ${tpl.template_code} 的 planner_order 必须为 null（§4.6.3）` })
    }
    if (!tpl.member_roles?.length) {
      issues.push({ code: 'KG-TPL-ROLES', severity: 'ERROR', message: `Template ${tpl.template_code} 缺少 member_roles` })
    }
  }

  // —— HistoricalCase ——
  const caseNodeCodes = new Set(input.nodes.filter((n) => n.node_type === 'HISTORICAL_CASE').map((n) => n.code))
  for (const c of input.historicalCases) {
    if (!caseNodeCodes.has(c.case_code)) {
      issues.push({ code: 'KG-CASE-ORPHAN', severity: 'WARNING', message: `historical case ${c.case_code} 无对应 HISTORICAL_CASE 节点` })
    }
    if (!c.source || !c.review_status || c.anonymous !== true) {
      issues.push({ code: 'KG-CASE-META', severity: 'ERROR', message: `HistoricalCase ${c.case_code} 必须有来源/审核状态/匿名化标记（§4.8-8）` })
    }
  }

  // —— ObservationMapping ——
  const omNodeCodes = new Set(input.nodes.filter((n) => n.node_type === 'OBSERVATION_MAPPING').map((n) => n.code))
  for (const m of input.observationMappings) {
    if (!omNodeCodes.has(m.mapping_code)) {
      issues.push({ code: 'KG-OM-ORPHAN', severity: 'WARNING', message: `observation mapping ${m.mapping_code} 无对应 OBSERVATION_MAPPING 节点` })
    }
    if (!m.source_field || !m.conversion_version) {
      issues.push({ code: 'KG-OM-META', severity: 'ERROR', message: `ObservationMapping ${m.mapping_code} 必须记录转换版本和原始字段（§4.8-9）` })
    }
  }

  // —— 知识节点不得携带运行时诊断语义；L1 不得携带运行态 ——
  const RUN_TIME_KEYS = ['diagnosis_support_score', 'support_score', 'root_cause', 'evidence', 'candidate', 'conclusion', 'health_status', 'role_state']
  for (const node of input.nodes) {
    const props = node.properties ?? {}
    const clash = RUN_TIME_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(props, k))
    if (clash.length) {
      issues.push({ code: 'KG-NO-RUNTIME', severity: 'ERROR', message: `知识节点 ${node.node_id} 不得携带运行时语义字段：${clash.join(',')}（§4.8-11）` })
    }
    if (node.knowledge_level === 'L1') {
      const l1Clash = ['resource_id', 'instance_id', 'current_role', 'is_active', 'state_code'].filter((k) =>
        Object.prototype.hasOwnProperty.call(props, k),
      )
      if (l1Clash.length) {
        issues.push({ code: 'KG-L1-NO-INSTANCE', severity: 'ERROR', message: `L1 节点 ${node.node_id} 不得携带实例/运行态字段：${l1Clash.join(',')}（§4.8-10）` })
      }
    }
  }

  return issues
}

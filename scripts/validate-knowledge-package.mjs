// KnowledgeGraphPackage 3.0.0 轻量校验（docs/19 §4.8、§17.2）。
// 用法：node scripts/validate-knowledge-package.mjs
// 校验：包版本、code 唯一、边端点存在、关系注册表类型匹配、FaultMode 唯一父场景、
// L1~L4 闭合、EvidenceRequirement 满足路径、规则/模板/案例/映射声明完整、
// 知识节点与 L1 不携带运行时诊断语义。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = 'model/knowledge_graph_package'
const read = (file) => JSON.parse(readFileSync(join(root, pkg, file), 'utf8'))

const manifest = read('manifest.json')
const { nodes } = read('knowledge/nodes.json')
const { edges } = read('knowledge/edges.json')
const { node_types: nodeTypes } = read('ontology/knowledge_node_types.json')
const { relation_types: relationTypes } = read('ontology/relation_types.json')
const { rules: evidenceRules } = read('knowledge/evidence_rules.json')
const { templates } = read('knowledge/diagnostic_templates.json')
const { cases: historicalCases } = read('cases/historical_cases.json')
const { observation_mappings: observationMappings } = read('mappings/observation_mappings.json')

const LEVELS = new Set(['ROOT', 'L1', 'L2', 'L3', 'L4'])
const STRENGTHS = new Set(['REQUIRED', 'STRONG', 'CONDITIONAL', 'WEAK'])
const asSet = (v) => new Set(Array.isArray(v) ? v : v ? [v] : [])

let failures = 0
const fail = (code, msg) => { failures += 1; console.log(`  [${code}] ${msg}`) }

if (manifest.schema_version !== '3.0.0') fail('KG-VERSION', `schema_version=${manifest.schema_version}，期望 3.0.0`)

const byId = new Map()
const seenIds = new Set()
const codesByType = new Map()
const typeById = new Map()
for (const node of nodes) {
  if (seenIds.has(node.node_id)) fail('KG-DUP-ID', `node_id 重复：${node.node_id}`)
  seenIds.add(node.node_id)
  byId.set(node.node_id, node)
  typeById.set(node.node_id, node.node_type)
  if (!LEVELS.has(node.knowledge_level ?? '')) fail('KG-LEVEL', `节点 ${node.node_id} 缺少合法 knowledge_level`)
  if (node.node_type === 'KNOWLEDGE_DOMAIN' && node.knowledge_level !== 'ROOT') fail('KG-ROOT', `Domain Root ${node.node_id} 应为 ROOT`)
  if (node.node_type !== 'KNOWLEDGE_DOMAIN' && node.knowledge_level === 'ROOT') fail('KG-ROOT', `非根节点 ${node.node_id} 不能标记 ROOT`)
  const owner = codesByType.get(node.node_type) ?? new Map()
  const prev = owner.get(node.code)
  if (prev && prev !== node.node_id) fail('KG-CODE-DUP', `code 在类型 ${node.node_type} 内重复：${node.code}`)
  owner.set(node.code, node.node_id)
  codesByType.set(node.node_type, owner)
}

const fmCodes = new Set()
for (const node of nodes) {
  if (node.node_type !== 'FAULT_MODE') continue
  if (fmCodes.has(node.code)) fail('KG-FM-CODE', `FaultMode code 全包唯一要求被破坏：${node.code}`)
  fmCodes.add(node.code)
}

const relationByCode = new Map(relationTypes.map((r) => [r.code, r]))
const canonicalParents = new Map()
const evreqAll = new Set()
const evreqSatisfied = new Set()
for (const node of nodes) {
  if (node.node_type === 'EVIDENCE_REQUIREMENT' && node.properties?.implemented !== false) evreqAll.add(node.node_id)
}

const seenEdges = new Set()
for (const edge of edges) {
  if (seenEdges.has(edge.edge_id)) fail('KG-DUP-EDGE', `edge_id 重复：${edge.edge_id}`)
  seenEdges.add(edge.edge_id)
  const src = typeById.get(edge.source_ref)
  const tgt = typeById.get(edge.target_ref)
  if (!src || !tgt) { fail('KG-DANGLING', `边 ${edge.edge_id} 端点悬空：${edge.source_ref} → ${edge.target_ref}`); continue }
  const rel = relationByCode.get(edge.relation_type)
  if (!rel) { fail('KG-REL-UNKNOWN', `边 ${edge.edge_id} 关系类型 ${edge.relation_type} 不在注册表`); continue }
  const targets = asSet(rel.target_type)
  if (!asSet(rel.source_type).has(src) || (!targets.has(tgt) && !targets.has('*'))) {
    fail('KG-REL-TYPE', `边 ${edge.edge_id} 端点类型不符：${src} → ${tgt} 关系=${edge.relation_type}`)
  }
  if (edge.relation_type === 'HAS_FAULT_MODE') {
    const arr = canonicalParents.get(edge.target_ref) ?? []
    arr.push(edge.source_ref)
    canonicalParents.set(edge.target_ref, arr)
  }
  if (edge.relation_type === 'SATISFIED_BY_RULE') evreqSatisfied.add(edge.source_ref)
  if (edge.relation_type === 'EXPLAINS_MODE' && edge.strength && !STRENGTHS.has(edge.strength)) {
    fail('KG-STRENGTH', `边 ${edge.edge_id} strength=${edge.strength} 非法（§4.6.2）`)
  }
}

for (const node of nodes) {
  if (node.node_type !== 'FAULT_MODE') continue
  const parents = canonicalParents.get(node.node_id) ?? []
  if (parents.length !== 1) fail('KG-FM-PARENT', `FaultMode ${node.node_id} 规范父场景数=${parents.length}，必须恰好 1（§4.6.1）`)
}
for (const id of evreqAll) {
  if (!evreqSatisfied.has(id)) fail('KG-EVREQ-PATH', `EvidenceRequirement ${id} 无 SATISFIED_BY_RULE 满足路径（§4.8-5）`)
}

const ruleNodeCodes = new Set(nodes.filter((n) => n.node_type === 'DIAGNOSTIC_RULE').map((n) => n.code))
for (const code of ruleNodeCodes) {
  const detail = evidenceRules.find((r) => r.rule_code === code)
  if (!detail) { fail('KG-RULE-DETAIL', `DiagnosticRule ${code} 缺少 evidence_rules.json 明细（§4.8-6）`); continue }
  if (!detail.applies_to_resource_types?.length || !detail.input_fact_types?.length || !detail.output_evidence) {
    fail('KG-RULE-DETAIL', `DiagnosticRule ${code} 必须声明 input_fact_types/output_evidence/applies_to_resource_types（§4.8-6）`)
  }
}

const templateNodeCodes = new Set(nodes.filter((n) => n.node_type === 'DIAGNOSTIC_TEMPLATE').map((n) => n.code))
for (const tpl of templates) {
  if (tpl.planner_order !== null) fail('KG-TPL-ORDER', `Template ${tpl.template_code} 的 planner_order 必须为 null（§4.6.3）`)
  if (!tpl.member_roles?.length) fail('KG-TPL-ROLES', `Template ${tpl.template_code} 缺少 member_roles`)
  if (!templateNodeCodes.has(tpl.template_code)) fail('KG-TPL-ORPHAN', `template ${tpl.template_code} 无对应 DIAGNOSTIC_TEMPLATE 节点`)
}

const caseNodeCodes = new Set(nodes.filter((n) => n.node_type === 'HISTORICAL_CASE').map((n) => n.code))
for (const c of historicalCases) {
  if (!c.source || !c.review_status || c.anonymous !== true) fail('KG-CASE-META', `HistoricalCase ${c.case_code} 必须有来源/审核状态/匿名化标记（§4.8-8）`)
  if (!caseNodeCodes.has(c.case_code)) fail('KG-CASE-ORPHAN', `historical case ${c.case_code} 无对应 HISTORICAL_CASE 节点`)
}

const omNodeCodes = new Set(nodes.filter((n) => n.node_type === 'OBSERVATION_MAPPING').map((n) => n.code))
for (const m of observationMappings) {
  if (!m.source_field || !m.conversion_version) fail('KG-OM-META', `ObservationMapping ${m.mapping_code} 必须记录转换版本和原始字段（§4.8-9）`)
  if (!omNodeCodes.has(m.mapping_code)) fail('KG-OM-ORPHAN', `observation mapping ${m.mapping_code} 无对应 OBSERVATION_MAPPING 节点`)
}

const RUN_TIME_KEYS = ['diagnosis_support_score', 'support_score', 'root_cause', 'evidence', 'candidate', 'conclusion', 'health_status', 'role_state']
const L1_INSTANCE_KEYS = ['resource_id', 'instance_id', 'current_role', 'is_active', 'state_code']
for (const node of nodes) {
  const props = node.properties ?? {}
  const clash = RUN_TIME_KEYS.filter((k) => Object.hasOwn(props, k))
  if (clash.length) fail('KG-NO-RUNTIME', `知识节点 ${node.node_id} 不得携带运行时语义字段：${clash.join(',')}（§4.8-11）`)
  if (node.knowledge_level === 'L1') {
    const l1Clash = L1_INSTANCE_KEYS.filter((k) => Object.hasOwn(props, k))
    if (l1Clash.length) fail('KG-L1-NO-INSTANCE', `L1 节点 ${node.node_id} 不得携带实例/运行态字段：${l1Clash.join(',')}（§4.8-10）`)
  }
}

console.log(`\nKnowledgeGraphPackage 3.0.0 校验完成：${nodes.length} 节点 / ${edges.length} 边 / ${failures} 问题`)
process.exit(failures === 0 ? 0 : 1)

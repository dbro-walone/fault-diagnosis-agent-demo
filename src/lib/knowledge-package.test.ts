// KnowledgeGraphPackage 3.0.0 轻量校验（docs/19 §4.8、§17.2）。
// 校验四层知识结构的闭合性：code 唯一、边端点存在、关系注册表类型匹配、
// FaultMode 唯一父场景、EvidenceRequirement 满足路径、规则/模板/案例/映射声明完整、
// 知识节点与 L1 不携带运行时诊断语义。
import { describe, expect, it } from 'vitest'
import manifest from '../../model/knowledge_graph_package/manifest.json'
import nodesJson from '../../model/knowledge_graph_package/knowledge/nodes.json'
import edgesJson from '../../model/knowledge_graph_package/knowledge/edges.json'
import nodeTypesJson from '../../model/knowledge_graph_package/ontology/knowledge_node_types.json'
import relationTypesJson from '../../model/knowledge_graph_package/ontology/relation_types.json'
import evidenceRulesJson from '../../model/knowledge_graph_package/knowledge/evidence_rules.json'
import templatesJson from '../../model/knowledge_graph_package/knowledge/diagnostic_templates.json'
import historicalCasesJson from '../../model/knowledge_graph_package/cases/historical_cases.json'
import observationMappingsJson from '../../model/knowledge_graph_package/mappings/observation_mappings.json'
import { validateKnowledgePackage } from './knowledge-package'

describe('KnowledgeGraphPackage 3.0.0 校验', () => {
  const issues = validateKnowledgePackage({
    manifest: manifest as { schema_name?: string; schema_version?: string; package_id?: string; knowledge_domain_code?: string },
    nodes: (nodesJson as { nodes: unknown[] }).nodes as never[],
    edges: (edgesJson as { edges: unknown[] }).edges as never[],
    nodeTypes: (nodeTypesJson as { node_types: unknown[] }).node_types as never[],
    relationTypes: (relationTypesJson as { relation_types: unknown[] }).relation_types as never[],
    evidenceRules: (evidenceRulesJson as { rules: unknown[] }).rules as never[],
    templates: (templatesJson as { templates: unknown[] }).templates as never[],
    historicalCases: (historicalCasesJson as { cases: unknown[] }).cases as never[],
    observationMappings: (observationMappingsJson as { observation_mappings: unknown[] }).observation_mappings as never[],
  })

  it('包版本为 3.0.0 且无 ERROR 级问题', () => {
    const errors = issues.filter((i) => i.severity === 'ERROR')
    expect(errors, errors.map((e) => e.message).join('\n')).toHaveLength(0)
  })

  it('无 WARNING 级问题', () => {
    const warnings = issues.filter((i) => i.severity === 'WARNING')
    expect(warnings, warnings.map((e) => e.message).join('\n')).toHaveLength(0)
  })

  it('四层结构数据规模符合预期（Domain Root + L1~L4）', () => {
    const nodes = (nodesJson as { nodes: Array<{ node_type: string; knowledge_level: string }> }).nodes
    const edges = (edgesJson as { edges: unknown[] }).edges
    expect(nodes.filter((n) => n.node_type === 'KNOWLEDGE_DOMAIN')).toHaveLength(1)
    expect(nodes.filter((n) => n.knowledge_level === 'L1').length).toBeGreaterThan(0)
    expect(nodes.filter((n) => n.knowledge_level === 'L2').length).toBeGreaterThan(0)
    expect(nodes.filter((n) => n.knowledge_level === 'L3').length).toBeGreaterThan(0)
    expect(nodes.filter((n) => n.knowledge_level === 'L4').length).toBeGreaterThan(0)
    expect(nodes.length).toBeGreaterThanOrEqual(28) // 旧 28 节点规模不减少
    expect(edges.length).toBeGreaterThan(41) // 旧 41 边规模不减少
  })
})

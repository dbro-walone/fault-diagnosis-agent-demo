import {
  FunctionEffect,
  OntologyObjectType,
} from '../../schemas/enums'
import type {
  ActionDefinition,
  CatalogSnapshot,
  FunctionDefinition,
  SkillBoundary,
} from '../../schemas/types'

export const BASE_FUNCTIONS: FunctionDefinition[] = [
  {
    id: 'fn.business-mapping',
    label: '业务资源映射',
    effect: FunctionEffect.READ_ONLY,
    reads: [OntologyObjectType.ASSET],
    returns: 'FACT_PAYLOAD',
  },
  {
    id: 'fn.topology-query',
    label: '拓扑查询',
    effect: FunctionEffect.READ_ONLY,
    reads: [OntologyObjectType.ASSET],
    returns: 'FACT_PAYLOAD',
  },
  {
    id: 'fn.observation-query',
    label: '观测查询',
    effect: FunctionEffect.READ_ONLY,
    reads: [OntologyObjectType.ASSET, OntologyObjectType.OBSERVATION],
    returns: 'FACT_PAYLOAD',
  },
  {
    id: 'fn.knowledge-search',
    label: '知识与案例检索',
    effect: FunctionEffect.READ_ONLY,
    reads: [OntologyObjectType.KNOWLEDGE],
    returns: 'FACT_PAYLOAD',
  },
]

export const BASE_SKILLS: SkillBoundary[] = [
  ['business_mapping', 'fn.business-mapping', [OntologyObjectType.ASSET]],
  ['topology_query', 'fn.topology-query', [OntologyObjectType.ASSET]],
  ['alarm_query', 'fn.observation-query', [OntologyObjectType.ASSET, OntologyObjectType.OBSERVATION]],
  ['log_fingerprint_query', 'fn.observation-query', [OntologyObjectType.ASSET, OntologyObjectType.OBSERVATION]],
  ['kpi_query', 'fn.observation-query', [OntologyObjectType.ASSET, OntologyObjectType.OBSERVATION]],
  ['link_health_query', 'fn.observation-query', [OntologyObjectType.ASSET, OntologyObjectType.OBSERVATION]],
  ['similar_case_query', 'fn.knowledge-search', [OntologyObjectType.KNOWLEDGE]],
].map(([skillId, functionId, ontologyReads]) => ({
  skillId: skillId as string,
  functionId: functionId as string,
  ontologyReads: ontologyReads as OntologyObjectType[],
  ontologyWrites: [],
  resultMaterializedBy: 'RUNTIME',
}))

export const BASE_ACTIONS: ActionDefinition[] = [
  {
    id: 'action.create-maintenance-work-order',
    label: '创建维护工单',
    targetTypes: [OntologyObjectType.ASSET],
    requiresApproval: true,
  },
]

export const BASE_CATALOG: CatalogSnapshot = {
  functions: BASE_FUNCTIONS,
  skills: BASE_SKILLS,
  actions: BASE_ACTIONS,
}


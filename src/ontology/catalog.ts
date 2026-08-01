import {
  FunctionEffect,
  OntologyObjectType,
} from '../../schemas/enums'
import type {
  ActionDefinition,
  CatalogSnapshot,
  FunctionDefinition,
  OntologyScenarioDefinition,
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

function mergeById<T>(base: T[], local: T[] | undefined, id: (value: T) => string): T[] {
  const result = new Map(base.map((value) => [id(value), value]))
  for (const value of local ?? []) {
    const key = id(value)
    if (result.has(key)) throw new Error(`[catalog] overlay shadows registered definition ${key}`)
    result.set(key, value)
  }
  return [...result.values()]
}

/** Resolve stable ids and Case-local additions into the one catalog all consumers use. */
export function resolveScenarioCatalog(
  definition: OntologyScenarioDefinition,
  base: CatalogSnapshot = BASE_CATALOG,
): CatalogSnapshot {
  const merged: CatalogSnapshot = {
    functions: mergeById(base.functions, definition.catalog.overlay?.functions, (value) => value.id),
    skills: mergeById(base.skills, definition.catalog.overlay?.skills, (value) => value.skillId),
    actions: mergeById(base.actions, definition.catalog.overlay?.actions, (value) => value.id),
  }
  const select = <T>(values: T[], ids: string[], id: (value: T) => string, kind: string): T[] =>
    ids.map((wanted) => {
      const found = values.find((value) => id(value) === wanted)
      if (!found) throw new Error(`[catalog] Scenario references unknown ${kind} ${wanted}`)
      return found
    })
  return {
    functions: select(merged.functions, definition.catalog.functionIds, (value) => value.id, 'Function'),
    skills: select(merged.skills, definition.catalog.skillIds, (value) => value.skillId, 'Skill'),
    actions: select(merged.actions, definition.catalog.actionIds, (value) => value.id, 'Action'),
  }
}

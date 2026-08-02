/**
 * 本体图谱层共享类型（生产消费）。
 * V1 迁移后仅保留 ontology/model-loader/lenses/registry/catalog 消费的类型；
 * V2 诊断状态类型统一在 src/v2/runtime-types.ts。
 */
import {
  FunctionEffect,
  LensId,
  OntologyLinkType,
  OntologyObjectType,
} from './enums'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface ObjectProvenance {
  source: 'MODEL' | 'SCENARIO' | 'RUNTIME'
  sourceRef: string
  observedAt?: string
}

/** A single stable identity used by topology, knowledge, diagnosis and audit views. */
export interface OntologyObject<
  P extends Record<string, JsonValue> = Record<string, JsonValue>,
> {
  id: string
  type: OntologyObjectType
  label: string
  properties: P
  provenance: ObjectProvenance
  /** Present only for isolated Scenario objects. Base model objects never have it. */
  scenarioId?: string
}

export interface OntologyLink {
  id: string
  type: OntologyLinkType
  sourceId: string
  targetId: string
  properties: Record<string, JsonValue>
  provenance: ObjectProvenance
  scenarioId?: string
}

export interface OntologySnapshot {
  objects: OntologyObject[]
  links: OntologyLink[]
}

export interface ScenarioOverlay extends OntologySnapshot {
  scenarioId: string
}

export interface FunctionDefinition {
  id: string
  label: string
  effect: FunctionEffect.READ_ONLY
  reads: OntologyObjectType[]
  returns: 'FACT_PAYLOAD'
}

export interface SkillBoundary {
  skillId: string
  functionId: string
  ontologyReads: OntologyObjectType[]
  ontologyWrites: []
  resultMaterializedBy: 'RUNTIME'
}

export interface ActionDefinition {
  id: string
  label: string
  targetTypes: OntologyObjectType[]
  requiresApproval: true
}

export interface CatalogSnapshot {
  functions: FunctionDefinition[]
  skills: SkillBoundary[]
  actions: ActionDefinition[]
}

export interface ObjectSetQuery {
  text?: string
  types?: OntologyObjectType[]
  lens?: LensId
  scenarioId?: string
}

export interface ObjectSet {
  id: string
  label: string
  query: ObjectSetQuery
  objects: OntologyObject[]
}

export interface ObjectView {
  object: OntologyObject
  incoming: Array<{ link: OntologyLink; object: OntologyObject }>
  outgoing: Array<{ link: OntologyLink; object: OntologyObject }>
  availableFunctions: FunctionDefinition[]
  availableActions: ActionDefinition[]
}

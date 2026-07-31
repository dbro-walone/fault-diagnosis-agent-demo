import {
  ActionProposalStatus,
  CandidateStatus,
  ConclusionType,
  DiagnosisPhase,
  EventType,
  FunctionEffect,
  LensId,
  OntologyLinkType,
  OntologyObjectType,
  PlannerOperationKind,
  TaskStatus,
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

export interface ObjectPatch {
  objectId: string
  properties: Record<string, JsonValue>
  label?: string
}

export interface RuntimeMutation {
  upsertObjects?: OntologyObject[]
  upsertLinks?: OntologyLink[]
  patches?: ObjectPatch[]
  phase?: DiagnosisPhase
  summary?: string
  currentPlanId?: string | null
  currentActivityId?: string | null
  conclusionDecisionId?: string | null
}

/**
 * Runtime events are the only write protocol for a Scenario overlay.
 * The payload carries declarative ontology mutations, so a new Case adds data
 * without adding reducer branches or frontend conditionals.
 */
export interface RuntimeEvent {
  id: string
  sequence: number
  type: EventType
  occurredAt: string
  source: 'ROUTER' | 'PLANNER' | 'FUNCTION' | 'REASONING' | 'RUNTIME'
  causedByEventIds: string[]
  title: string
  detail: string
  mutation: RuntimeMutation
}

export interface DiagnosisSession {
  id: string
  scenarioId: string
  caseId: string
  version: number
  phase: DiagnosisPhase
  summary: string
  overlay: ScenarioOverlay
  eventLog: RuntimeEvent[]
  appliedEventIds: string[]
  currentPlanId: string | null
  currentActivityId: string | null
  conclusionDecisionId: string | null
}

export interface NormalizedSymptom {
  objectType: string
  symptomCode: string
  occurredAt: string
  businessScope: string
  description: string
}

export interface SupportedSymptom {
  objectType: string
  symptomCode: string
  aliases: string[]
}

export interface CaseRouteProfile {
  caseId: string
  supportedSymptoms: SupportedSymptom[]
  supportedScopes: string[]
  requiredInputs: string[]
  priority: number
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

export interface PlannerOperation {
  kind: PlannerOperationKind
  objectId: string
}

export interface CandidateProperties extends Record<string, JsonValue> {
  objectId: string
  hypothesisCode: string
  supportScore: number
  status: CandidateStatus
  evidenceIds: string[]
  missingEvidence: string[]
  scoreHistory: JsonValue[]
}

export interface FactProperties extends Record<string, JsonValue> {
  skillId: string
  functionCallId: string
  objectIds: string[]
  observationIds: string[]
  rawResult: JsonValue
}

export interface ObservationProperties extends Record<string, JsonValue> {
  observationKind: string
  functionCallId: string
  objectIds: string[]
  observedAt: string
  rawValue: JsonValue
}

export interface EvidenceProperties extends Record<string, JsonValue> {
  factId: string
  candidateId: string
  relation: string
  category: string
  strength: string
  explanation: string
  scoreDelta: number
}

export interface PlanProperties extends Record<string, JsonValue> {
  round: number
  goal: string
  selectionReason: string
  expectedEvidence: string[]
  taskIds: string[]
  previousPlanId: string | null
  changes: JsonValue[]
}

export interface TaskProperties extends Record<string, JsonValue> {
  planId: string
  operationKind: PlannerOperationKind
  operationId: string
  goal: string
  selectionReason: string
  expectedEvidence: string[]
  targetObjectIds: string[]
  targetCandidateIds: string[]
  status: TaskStatus
  priority: number
}

export interface FunctionCallProperties extends Record<string, JsonValue> {
  functionId: string
  skillId: string
  taskId: string
  effect: FunctionEffect.READ_ONLY
  targetObjectIds: string[]
  status: TaskStatus
  rawResult: JsonValue
}

export interface ActionProposalProperties extends Record<string, JsonValue> {
  actionId: string
  taskId: string
  targetObjectIds: string[]
  status: ActionProposalStatus
  rationale: string
}

interface DecisionPropertiesBase extends Record<string, JsonValue> {
  conclusion: ConclusionType
  lineageObjectIds: string[]
  impactPath: string[]
  recoveryPath: string[]
}

export interface ConfirmedDecisionProperties extends DecisionPropertiesBase {
  conclusion: ConclusionType.ROOT_CAUSE_CONFIRMED
  rootCandidateId: string
  rootObjectId: string
  minimumEvidenceSatisfied: boolean
  competitorCheckCompleted: boolean
  unresolvedConflicts: string[]
}

export interface ProbableDecisionProperties extends DecisionPropertiesBase {
  conclusion: ConclusionType.PROBABLE_CAUSES
  rootCandidateId: null
  rootObjectId: null
  probableCandidateIds: string[]
  missingEvidence: string[]
  nextTaskId: string | null
}

export interface InsufficientDecisionProperties extends DecisionPropertiesBase {
  conclusion: ConclusionType.INSUFFICIENT_EVIDENCE
  rootCandidateId: null
  rootObjectId: null
  probableCandidateIds: []
  missingEvidence: string[]
  blockingTaskIds: string[]
}

export type DecisionProperties =
  | ConfirmedDecisionProperties
  | ProbableDecisionProperties
  | InsufficientDecisionProperties

export interface CatalogSnapshot {
  functions: FunctionDefinition[]
  skills: SkillBoundary[]
  actions: ActionDefinition[]
}

export interface ScenarioCatalogReference {
  functionIds: string[]
  skillIds: string[]
  actionIds: string[]
  /** Case-local definitions are registered once here and resolved by every consumer. */
  overlay?: Partial<CatalogSnapshot>
}

export interface OntologyScenarioDefinition {
  scenarioId: string
  caseId: string
  label: string
  schemaVersion: string
  catalog: ScenarioCatalogReference
  events: RuntimeEvent[]
}

export interface CaseBundle {
  caseId: string
  title: string
  description: string
  dataMode: string
  routeProfile: CaseRouteProfile
  scenario: OntologyScenarioDefinition
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

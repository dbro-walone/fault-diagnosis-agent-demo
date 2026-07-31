import {
  ActionProposalStatus,
  CandidateStatus,
  ConclusionType,
  DiagnosisPhase,
  EventType,
  FunctionEffect,
  OntologyLinkType,
  OntologyObjectType,
  PlannerOperationKind,
  TaskStatus,
} from '../../schemas/enums'
import type {
  CatalogSnapshot,
  DiagnosisSession,
  JsonValue,
  OntologyLink,
  OntologyObject,
  OntologySnapshot,
  RuntimeEvent,
} from '../../schemas/types'
import { assertCriticalOntologyObject } from '../ontology/object-guards'

export interface RuntimeValidationContext {
  catalog: CatalogSnapshot
  base: OntologySnapshot
}

type EventSource = RuntimeEvent['source']

interface EventPolicy {
  source: EventSource
  objectTypes: OntologyObjectType[]
  linkTypes: OntologyLinkType[]
  patchTypes: OntologyObjectType[]
  patchProperties: string[]
  fields: Array<keyof RuntimeEvent['mutation']>
  phases?: DiagnosisPhase[]
}

const EVENT_POLICIES: Record<EventType, EventPolicy> = {
  [EventType.DIAGNOSIS_INITIALIZED]: {
    source: 'ROUTER',
    objectTypes: [OntologyObjectType.SCENARIO],
    linkTypes: [OntologyLinkType.TARGETS],
    patchTypes: [],
    patchProperties: [],
    fields: ['upsertObjects', 'upsertLinks', 'phase', 'summary'],
    phases: [DiagnosisPhase.SESSION_INITIALIZING],
  },
  [EventType.DIAGNOSIS_PHASE_CHANGED]: {
    source: 'RUNTIME', objectTypes: [], linkTypes: [], patchTypes: [], patchProperties: [],
    fields: ['phase', 'summary'],
    phases: [
      DiagnosisPhase.SCOPE_LOCALIZATION,
      DiagnosisPhase.CANDIDATE_GENERATION,
      DiagnosisPhase.EVIDENCE_COLLECTION,
      DiagnosisPhase.COMPETING_EXPLANATION,
      DiagnosisPhase.CONCLUSION_CHECK,
    ],
  },
  [EventType.PLAN_CREATED]: {
    source: 'PLANNER',
    objectTypes: [OntologyObjectType.PLAN, OntologyObjectType.TASK],
    linkTypes: [OntologyLinkType.CONTAINS, OntologyLinkType.SUPERSEDES],
    patchTypes: [],
    patchProperties: [],
    fields: ['upsertObjects', 'upsertLinks', 'phase', 'summary', 'currentPlanId'],
    phases: [DiagnosisPhase.EVIDENCE_COLLECTION],
  },
  [EventType.TASK_CREATED]: {
    source: 'PLANNER', objectTypes: [OntologyObjectType.TASK],
    linkTypes: [OntologyLinkType.CONTAINS], patchTypes: [],
    patchProperties: [],
    fields: ['upsertObjects', 'upsertLinks', 'currentActivityId'],
  },
  [EventType.TASK_STATUS_CHANGED]: {
    source: 'RUNTIME', objectTypes: [], linkTypes: [],
    patchTypes: [OntologyObjectType.TASK], fields: ['patches', 'currentActivityId', 'summary'],
    patchProperties: ['status'],
  },
  [EventType.FUNCTION_CALL_REQUESTED]: {
    source: 'PLANNER', objectTypes: [OntologyObjectType.FUNCTION_CALL],
    linkTypes: [OntologyLinkType.CONTAINS, OntologyLinkType.TARGETS],
    patchTypes: [OntologyObjectType.TASK],
    patchProperties: ['status'],
    fields: ['upsertObjects', 'upsertLinks', 'patches', 'currentActivityId'],
  },
  [EventType.FUNCTION_CALL_COMPLETED]: {
    source: 'FUNCTION', objectTypes: [OntologyObjectType.OBSERVATION],
    linkTypes: [OntologyLinkType.PRODUCED_BY],
    patchTypes: [OntologyObjectType.FUNCTION_CALL, OntologyObjectType.TASK],
    patchProperties: ['status', 'rawResult'],
    fields: ['upsertObjects', 'upsertLinks', 'patches', 'currentActivityId'],
  },
  [EventType.FACT_DISCOVERED]: {
    source: 'RUNTIME', objectTypes: [OntologyObjectType.FACT],
    linkTypes: [OntologyLinkType.DERIVED_FROM, OntologyLinkType.PRODUCED_BY, OntologyLinkType.TARGETS],
    patchTypes: [], patchProperties: [], fields: ['upsertObjects', 'upsertLinks', 'summary'],
  },
  [EventType.CANDIDATES_GENERATED]: {
    source: 'REASONING', objectTypes: [OntologyObjectType.CANDIDATE],
    linkTypes: [OntologyLinkType.TARGETS], patchTypes: [], patchProperties: [],
    fields: ['upsertObjects', 'upsertLinks', 'phase', 'summary'],
    phases: [DiagnosisPhase.CANDIDATE_GENERATION],
  },
  [EventType.EVIDENCE_CREATED]: {
    source: 'REASONING', objectTypes: [OntologyObjectType.EVIDENCE],
    linkTypes: [OntologyLinkType.DERIVED_FROM, OntologyLinkType.SUPPORTS, OntologyLinkType.WEAKENS, OntologyLinkType.CONFLICTS_WITH],
    patchTypes: [], patchProperties: [], fields: ['upsertObjects', 'upsertLinks', 'summary'],
  },
  [EventType.CANDIDATE_UPDATED]: {
    source: 'REASONING', objectTypes: [], linkTypes: [],
    patchTypes: [OntologyObjectType.CANDIDATE], fields: ['patches', 'summary'],
    patchProperties: ['supportScore', 'status', 'evidenceIds', 'missingEvidence', 'scoreHistory'],
  },
  [EventType.PLAN_REPLANNED]: {
    source: 'PLANNER', objectTypes: [OntologyObjectType.PLAN, OntologyObjectType.TASK],
    linkTypes: [OntologyLinkType.SUPERSEDES, OntologyLinkType.BASED_ON, OntologyLinkType.CONTAINS],
    patchTypes: [OntologyObjectType.TASK],
    patchProperties: ['priority', 'status', 'planId'],
    fields: ['upsertObjects', 'upsertLinks', 'patches', 'phase', 'summary', 'currentPlanId'],
    phases: [DiagnosisPhase.COMPETING_EXPLANATION],
  },
  [EventType.ACTION_PROPOSED]: {
    source: 'PLANNER', objectTypes: [OntologyObjectType.TASK, OntologyObjectType.ACTION_PROPOSAL],
    linkTypes: [OntologyLinkType.PROPOSES, OntologyLinkType.TARGETS, OntologyLinkType.CONTAINS],
    patchTypes: [OntologyObjectType.PLAN], fields: ['upsertObjects', 'upsertLinks', 'patches', 'summary'],
    patchProperties: ['taskIds'],
  },
  [EventType.DECISION_RECORDED]: {
    source: 'RUNTIME', objectTypes: [OntologyObjectType.DECISION],
    linkTypes: [OntologyLinkType.BASED_ON], patchTypes: [], patchProperties: [],
    fields: ['upsertObjects', 'upsertLinks', 'phase', 'summary', 'conclusionDecisionId'],
    phases: [DiagnosisPhase.DIAGNOSIS_REVIEW],
  },
  [EventType.ROOT_CAUSE_CONFIRMED]: {
    source: 'RUNTIME', objectTypes: [OntologyObjectType.DECISION],
    linkTypes: [OntologyLinkType.TARGETS, OntologyLinkType.BASED_ON, OntologyLinkType.IMPACTS, OntologyLinkType.RECOVERS_VIA],
    patchTypes: [OntologyObjectType.CANDIDATE],
    patchProperties: ['status'],
    fields: ['upsertObjects', 'upsertLinks', 'patches', 'phase', 'summary', 'conclusionDecisionId'],
    phases: [DiagnosisPhase.DIAGNOSIS_REVIEW],
  },
  [EventType.DIAGNOSIS_COMPLETED]: {
    source: 'RUNTIME', objectTypes: [], linkTypes: [], patchTypes: [], patchProperties: [],
    fields: ['phase', 'summary', 'currentActivityId'],
    phases: [DiagnosisPhase.DIAGNOSIS_REVIEW],
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deepEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] &&
        deepEqual(left[key] as JsonValue, right[key] as JsonValue))
  }
  return false
}

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>([
  TaskStatus.SUCCEEDED,
  TaskStatus.FAILED,
  TaskStatus.PARTIAL,
  TaskStatus.TIMEOUT,
  TaskStatus.DATA_MISSING,
  TaskStatus.CANCELLED,
  TaskStatus.SKIPPED,
])

const TASK_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus[]>> = {
  [TaskStatus.PLANNED]: [TaskStatus.READY, TaskStatus.PAUSED, TaskStatus.CANCELLED],
  [TaskStatus.READY]: [TaskStatus.RUNNING, TaskStatus.PAUSED, TaskStatus.CANCELLED],
  [TaskStatus.RUNNING]: [...TERMINAL_TASK_STATUSES],
  [TaskStatus.PAUSED]: [TaskStatus.READY, TaskStatus.CANCELLED],
}

function array(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function number(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function previewState(
  previous: DiagnosisSession,
  event: RuntimeEvent,
  base: OntologySnapshot,
): { objectById: Map<string, OntologyObject>; links: OntologyLink[] } {
  const objectById = new Map(
    [...base.objects, ...previous.overlay.objects].map((object) => [
      object.id,
      { ...object, properties: { ...object.properties } },
    ]),
  )
  for (const object of event.mutation.upsertObjects ?? []) {
    const existing = objectById.get(object.id)
    objectById.set(object.id, existing
      ? { ...existing, label: object.label, properties: { ...existing.properties, ...object.properties } }
      : object)
  }
  for (const patch of event.mutation.patches ?? []) {
    const object = objectById.get(patch.objectId)
    if (object) objectById.set(object.id, { ...object, properties: { ...object.properties, ...patch.properties } })
  }
  const links = [...base.links, ...previous.overlay.links]
  const byId = new Map(links.map((link) => [link.id, link]))
  for (const link of event.mutation.upsertLinks ?? []) byId.set(link.id, link)
  return { objectById, links: [...byId.values()] }
}

function requireObject(
  objects: Map<string, OntologyObject>,
  id: string,
  type?: OntologyObjectType,
): OntologyObject {
  const object = objects.get(id)
  if (!object) throw new Error(`[runtime] unknown object ${id}`)
  if (type && object.type !== type) {
    throw new Error(`[runtime] ${id} must be ${type}, received ${object.type}`)
  }
  return object
}

function assertProvenance(
  value: unknown,
  label: string,
): asserts value is OntologyObject['provenance'] {
  if (
    !isRecord(value) ||
    !['MODEL', 'SCENARIO', 'RUNTIME'].includes(String(value.source)) ||
    typeof value.sourceRef !== 'string' || !value.sourceRef.trim() ||
    (value.observedAt !== undefined &&
      (typeof value.observedAt !== 'string' || Number.isNaN(Date.parse(value.observedAt))))
  ) {
    throw new Error(`[runtime] ${label} has invalid provenance`)
  }
}

function assertEventShapeAndPolicy(
  previous: DiagnosisSession,
  event: RuntimeEvent,
  context: RuntimeValidationContext,
): void {
  const eventIsRecord = isRecord(event as unknown)
  const mutationIsRecord = isRecord(event?.mutation as unknown)
  const mutation = event?.mutation
  if (
    !eventIsRecord || typeof event.id !== 'string' || !event.id.trim() ||
    typeof event.sequence !== 'number' || !Number.isInteger(event.sequence) || event.sequence < 1 ||
    !Object.values(EventType).includes(event.type) ||
    !['ROUTER', 'PLANNER', 'FUNCTION', 'REASONING', 'RUNTIME'].includes(event.source) ||
    typeof event.occurredAt !== 'string' || Number.isNaN(Date.parse(event.occurredAt)) ||
    !Array.isArray(event.causedByEventIds) || event.causedByEventIds.some((id) => typeof id !== 'string') ||
    typeof event.title !== 'string' || typeof event.detail !== 'string' || !mutationIsRecord
  ) {
    throw new Error('[runtime] malformed Runtime Event')
  }
  if (
    (mutation.upsertObjects !== undefined && !Array.isArray(mutation.upsertObjects)) ||
    (mutation.upsertLinks !== undefined && !Array.isArray(mutation.upsertLinks)) ||
    (mutation.patches !== undefined && !Array.isArray(mutation.patches)) ||
    (mutation.phase !== undefined && !Object.values(DiagnosisPhase).includes(mutation.phase)) ||
    (mutation.summary !== undefined && typeof mutation.summary !== 'string') ||
    (mutation.currentPlanId !== undefined &&
      mutation.currentPlanId !== null && typeof mutation.currentPlanId !== 'string') ||
    (mutation.currentActivityId !== undefined &&
      mutation.currentActivityId !== null && typeof mutation.currentActivityId !== 'string') ||
    (mutation.conclusionDecisionId !== undefined &&
      mutation.conclusionDecisionId !== null && typeof mutation.conclusionDecisionId !== 'string')
  ) throw new Error(`[runtime] Event ${event.id} has malformed mutation fields`)
  const previousEvent = previous.eventLog[previous.eventLog.length - 1]
  if (previousEvent && Date.parse(event.occurredAt) < Date.parse(previousEvent.occurredAt)) {
    throw new Error(`[runtime] Event ${event.id} occurredAt is not monotonic`)
  }
  const policy = EVENT_POLICIES[event.type]
  if (!policy || event.source !== policy.source) {
    throw new Error(`[runtime] ${event.type} source ${event.source} is not allowed`)
  }
  const allowedFields = new Set<string>(policy.fields)
  for (const [field, value] of Object.entries(event.mutation)) {
    if (value !== undefined && !allowedFields.has(field)) {
      throw new Error(`[runtime] ${event.type} mutation ${field} is not allowed`)
    }
  }
  if (
    event.mutation.phase !== undefined &&
    (!policy.phases || !policy.phases.includes(event.mutation.phase))
  ) {
    throw new Error(`[runtime] ${event.type} phase ${event.mutation.phase} is not allowed`)
  }

  const knownObjects = new Map(
    [...context.base.objects, ...previous.overlay.objects].map((object) => [object.id, object]),
  )
  for (const object of event.mutation.upsertObjects ?? []) {
    if (
      !isRecord(object) || typeof object.id !== 'string' || !object.id.trim() ||
      !Object.values(OntologyObjectType).includes(object.type) ||
      typeof object.label !== 'string' || !isRecord(object.properties) ||
      !policy.objectTypes.includes(object.type)
    ) {
      throw new Error(`[runtime] ${event.type} object mutation is not allowed`)
    }
    assertProvenance(object.provenance, `Object ${object.id}`)
    knownObjects.set(object.id, object)
  }
  for (const link of event.mutation.upsertLinks ?? []) {
    if (
      !isRecord(link) || typeof link.id !== 'string' || !link.id.trim() ||
      !Object.values(OntologyLinkType).includes(link.type) ||
      link.type === OntologyLinkType.UNKNOWN ||
      typeof link.sourceId !== 'string' || typeof link.targetId !== 'string' ||
      !isRecord(link.properties) || !policy.linkTypes.includes(link.type)
    ) {
      throw new Error(`[runtime] ${event.type} Link mutation is not allowed`)
    }
    assertProvenance(link.provenance, `Link ${link.id}`)
  }
  const patchIds = new Set<string>()
  for (const patch of event.mutation.patches ?? []) {
    if (
      !isRecord(patch) || typeof patch.objectId !== 'string' || !patch.objectId.trim() ||
      !isRecord(patch.properties) || patch.label !== undefined || patchIds.has(patch.objectId)
    ) {
      throw new Error(`[runtime] ${event.type} has malformed or duplicate patch`)
    }
    patchIds.add(patch.objectId)
    const target = knownObjects.get(patch.objectId)
    if (!target || !policy.patchTypes.includes(target.type)) {
      throw new Error(`[runtime] ${event.type} may not patch ${patch.objectId}`)
    }
    if (Object.keys(patch.properties).some((key) => !policy.patchProperties.includes(key))) {
      throw new Error(`[runtime] ${event.type} patch property is not allowed on ${patch.objectId}`)
    }
    assertCriticalOntologyObject({
      ...target,
      properties: { ...target.properties, ...patch.properties },
    })
  }
}

function validateTaskPatches(previous: DiagnosisSession, event: RuntimeEvent): void {
  const previousById = new Map(previous.overlay.objects.map((object) => [object.id, object]))
  for (const patch of event.mutation.patches ?? []) {
    const before = previousById.get(patch.objectId)
    if (
      before?.type === OntologyObjectType.ACTION_PROPOSAL &&
      patch.properties.status !== undefined &&
      patch.properties.status !== ActionProposalStatus.APPROVAL_REQUIRED
    ) {
      throw new Error(`[runtime] Action Proposal ${before.id} cannot be executed or leave APPROVAL_REQUIRED`)
    }
    if (before?.type !== OntologyObjectType.TASK || patch.properties.status === undefined) continue
    const from = before.properties.status as TaskStatus
    const to = patch.properties.status as TaskStatus
    if (from === to) continue
    if (!(TASK_TRANSITIONS[from] ?? []).includes(to)) {
      throw new Error(`[runtime] illegal Task transition ${before.id}: ${from} -> ${to}`)
    }
  }
}

function validateFunctionRequest(
  previous: DiagnosisSession,
  event: RuntimeEvent,
  context: RuntimeValidationContext,
): void {
  const calls = event.mutation.upsertObjects?.filter(
    (object) => object.type === OntologyObjectType.FUNCTION_CALL,
  ) ?? []
  if (calls.length !== 1) throw new Error('[runtime] Function request must create exactly one Function Call')
  const call = calls[0]
  const task = requireObject(
    new Map(previous.overlay.objects.map((object) => [object.id, object])),
    String(call.properties.taskId),
    OntologyObjectType.TASK,
  )
  if (task.properties.status !== TaskStatus.READY) {
    throw new Error(`[runtime] Function Call ${call.id} requires READY Task ${task.id}`)
  }
  if (
    task.properties.operationKind !== PlannerOperationKind.FUNCTION_CALL ||
    task.properties.operationId !== call.id
  ) {
    throw new Error(`[runtime] Task ${task.id} does not target Function Call ${call.id}`)
  }
  const plan = requireObject(
    new Map(previous.overlay.objects.map((object) => [object.id, object])),
    String(task.properties.planId),
    OntologyObjectType.PLAN,
  )
  if (
    previous.currentPlanId !== plan.id ||
    !array(plan.properties.taskIds).includes(task.id)
  ) {
    throw new Error(`[runtime] Function Call ${call.id} Task is outside current Plan ${previous.currentPlanId}`)
  }
  if (call.properties.status !== TaskStatus.RUNNING) {
    throw new Error(`[runtime] requested Function Call ${call.id} must start RUNNING`)
  }
  const patches = event.mutation.patches ?? []
  if (
    patches.length !== 1 || patches[0].objectId !== task.id ||
    patches[0].properties.status !== TaskStatus.RUNNING
  ) {
    throw new Error(`[runtime] Function request must transition only Task ${task.id} to RUNNING`)
  }
  const skill = context.catalog.skills.find((value) => value.skillId === call.properties.skillId)
  const fn = context.catalog.functions.find((value) => value.id === call.properties.functionId)
  if (!skill || !fn || skill.functionId !== fn.id) {
    throw new Error(`[runtime] Function Call ${call.id} does not match the registered Skill/Function catalog`)
  }
  if (fn.effect !== FunctionEffect.READ_ONLY || call.properties.effect !== FunctionEffect.READ_ONLY) {
    throw new Error(`[runtime] Function Call ${call.id} must be READ_ONLY`)
  }
  const allObjects = new Map(
    [...context.base.objects, ...previous.overlay.objects].map((object) => [object.id, object]),
  )
  for (const targetId of array(call.properties.targetObjectIds)) {
    const target = requireObject(allObjects, targetId)
    if (!fn.reads.includes(target.type)) {
      throw new Error(`[runtime] Function ${fn.id} cannot read ${target.type} target ${target.id}`)
    }
  }
  if (!(event.mutation.upsertLinks ?? []).some((link) =>
    link.type === OntologyLinkType.CONTAINS &&
    link.sourceId === task.id && link.targetId === call.id
  )) {
    throw new Error(`[runtime] Task ${task.id} has no CONTAINS Link to Function Call ${call.id}`)
  }
}

function validateFunctionResult(previous: DiagnosisSession, event: RuntimeEvent): void {
  const previousById = new Map(previous.overlay.objects.map((object) => [object.id, object]))
  const patches = event.mutation.patches ?? []
  const callPatches = patches.filter((patch) => {
    const object = previousById.get(patch.objectId)
    return object?.type === OntologyObjectType.FUNCTION_CALL
  })
  if (callPatches.length !== 1 || patches.length !== 2) {
    throw new Error('[runtime] Function result must patch exactly one Function Call and its unique Task')
  }
  const callPatch = callPatches[0]
  const call = requireObject(previousById, callPatch.objectId, OntologyObjectType.FUNCTION_CALL)
  if (call.properties.status !== TaskStatus.RUNNING) {
    throw new Error(`[runtime] Function Call ${call.id} was not RUNNING`)
  }
  const status = callPatch.properties.status as TaskStatus
  if (!TERMINAL_TASK_STATUSES.has(status)) {
    throw new Error(`[runtime] Function Call ${call.id} has invalid result status ${status}`)
  }
  const taskPatch = patches.find((patch) => patch.objectId === call.properties.taskId)
  if (!taskPatch || taskPatch.properties.status !== status || Object.keys(taskPatch.properties).length !== 1) {
    throw new Error(`[runtime] Function Call ${call.id} and Task result statuses must match`)
  }
  if (
    callPatch.properties.rawResult === undefined ||
    Object.keys(callPatch.properties).some((key) => !['status', 'rawResult'].includes(key))
  ) {
    throw new Error('[runtime] Function result may only patch its Function Call/Task state with raw result')
  }
  const observations = event.mutation.upsertObjects ?? []
  const links = event.mutation.upsertLinks ?? []
  for (const observation of observations) {
    if (
      observation.type !== OntologyObjectType.OBSERVATION ||
      observation.properties.functionCallId !== call.id ||
      !Array.isArray(observation.properties.objectIds) ||
      !array(observation.properties.objectIds).every((id) => array(call.properties.targetObjectIds).includes(id)) ||
      typeof observation.properties.observedAt !== 'string' ||
      Number.isNaN(Date.parse(observation.properties.observedAt))
    ) {
      throw new Error(`[runtime] Observation ${observation.id} does not belong to Function Call ${call.id}`)
    }
    if (!links.some((link) =>
      link.type === OntologyLinkType.PRODUCED_BY &&
      link.sourceId === observation.id && link.targetId === call.id
    )) {
      throw new Error(`[runtime] Observation ${observation.id} lacks Function Call lineage`)
    }
  }
}

function validateFactMaterialization(previous: DiagnosisSession, event: RuntimeEvent): void {
  if (event.source !== 'RUNTIME') throw new Error('[runtime] only Runtime may materialize a Fact')
  const previousById = new Map(previous.overlay.objects.map((object) => [object.id, object]))
  for (const fact of event.mutation.upsertObjects ?? []) {
    if (fact.type !== OntologyObjectType.FACT) {
      throw new Error('[runtime] FACT_DISCOVERED may only materialize Fact objects')
    }
    const call = requireObject(
      previousById,
      String(fact.properties.functionCallId),
      OntologyObjectType.FUNCTION_CALL,
    )
    if (![TaskStatus.SUCCEEDED, TaskStatus.PARTIAL].includes(call.properties.status as TaskStatus)) {
      throw new Error(`[runtime] Fact ${fact.id} requires a successful or partial Function result`)
    }
    if (
      collectIsoTimes(fact.properties.rawResult).some((time) => time > Date.parse(event.occurredAt)) ||
      (fact.provenance.observedAt !== undefined &&
        Date.parse(fact.provenance.observedAt) > Date.parse(event.occurredAt))
    ) {
      throw new Error(`[runtime] Fact ${fact.id} time is later than its Event`)
    }
    const task = requireObject(
      previousById,
      String(call.properties.taskId),
      OntologyObjectType.TASK,
    )
    if (
      task.properties.operationKind !== PlannerOperationKind.FUNCTION_CALL ||
      task.properties.operationId !== call.id ||
      !previous.overlay.links.some((link) =>
        link.type === OntologyLinkType.CONTAINS &&
        link.sourceId === task.id && link.targetId === call.id
      )
    ) {
      throw new Error(`[runtime] Fact ${fact.id} has inconsistent Task/Call/link lineage`)
    }
    if (fact.properties.skillId !== call.properties.skillId) {
      throw new Error(`[runtime] Fact ${fact.id} Skill does not match Function Call ${call.id}`)
    }
    if (!deepEqual(fact.properties.rawResult, call.properties.rawResult)) {
      throw new Error(`[runtime] Fact ${fact.id} rawResult differs from immutable Function Call ${call.id}`)
    }
    const targetIds = array(call.properties.targetObjectIds)
    const factObjectIds = array(fact.properties.objectIds)
    const observationIds = array(fact.properties.observationIds)
    if (!factObjectIds.length || !observationIds.every((id) => {
      const observation = requireObject(previousById, id, OntologyObjectType.OBSERVATION)
      return observation.properties.functionCallId === call.id
    })) {
      throw new Error(`[runtime] Fact ${fact.id} has invalid Observation lineage`)
    }
    if (observationIds.length) {
      const observationTargets = new Set(observationIds.flatMap((id) =>
        array(previousById.get(id)?.properties.objectIds),
      ))
      if (!factObjectIds.every((id) => observationTargets.has(id))) {
        throw new Error(`[runtime] Fact ${fact.id} target is outside its Observation`)
      }
    } else if (!factObjectIds.every((id) =>
      targetIds.includes(id) || JSON.stringify(call.properties.rawResult).includes(id)
    )) {
      throw new Error(`[runtime] Fact ${fact.id} target is outside its Function result`)
    }
    const links = event.mutation.upsertLinks ?? []
    if (!links.some((link) =>
      link.type === OntologyLinkType.PRODUCED_BY &&
      link.sourceId === fact.id && link.targetId === call.id
    )) {
      throw new Error(`[runtime] Fact ${fact.id} lacks PRODUCED_BY Function Call lineage`)
    }
    for (const observationId of observationIds) {
      if (!links.some((link) =>
        link.type === OntologyLinkType.DERIVED_FROM &&
        link.sourceId === fact.id && link.targetId === observationId
      )) {
        throw new Error(`[runtime] Fact ${fact.id} lacks DERIVED_FROM Observation lineage`)
      }
    }
  }
}

function validateEvidence(previous: DiagnosisSession, event: RuntimeEvent): void {
  const previousById = new Map(previous.overlay.objects.map((object) => [object.id, object]))
  for (const evidence of event.mutation.upsertObjects ?? []) {
    if (evidence.type !== OntologyObjectType.EVIDENCE) {
      throw new Error('[runtime] EVIDENCE_CREATED may only create Evidence objects')
    }
    const fact = requireObject(previousById, String(evidence.properties.factId), OntologyObjectType.FACT)
    const candidate = requireObject(
      previousById,
      String(evidence.properties.candidateId),
      OntologyObjectType.CANDIDATE,
    )
    const call = requireObject(
      previousById,
      String(fact.properties.functionCallId),
      OntologyObjectType.FUNCTION_CALL,
    )
    if (
      collectIsoTimes(fact.properties.rawResult).some((time) => time > Date.parse(event.occurredAt)) ||
      (fact.provenance.observedAt !== undefined &&
        Date.parse(fact.provenance.observedAt) > Date.parse(event.occurredAt))
    ) {
      throw new Error(`[runtime] Fact ${fact.id} time is later than Evidence ${evidence.id}`)
    }
    if (
      evidence.properties.relation === 'WEAKENS' &&
      call.properties.status !== TaskStatus.SUCCEEDED
    ) {
      throw new Error(`[runtime] incomplete Function result cannot weaken Candidate via ${evidence.id}`)
    }
    const links = event.mutation.upsertLinks ?? []
    if (!links.some((link) =>
      link.type === OntologyLinkType.DERIVED_FROM &&
      link.sourceId === evidence.id && link.targetId === fact.id
    )) {
      throw new Error(`[runtime] Evidence ${evidence.id} does not derive from Fact ${fact.id}`)
    }
    const relationType = evidence.properties.relation === 'WEAKENS'
      ? OntologyLinkType.WEAKENS
      : evidence.properties.relation === 'CONFLICTS'
        ? OntologyLinkType.CONFLICTS_WITH
        : OntologyLinkType.SUPPORTS
    if (!links.some((link) =>
      link.type === relationType &&
      link.sourceId === evidence.id && link.targetId === candidate.id
    )) {
      throw new Error(`[runtime] Evidence ${evidence.id} Candidate/link ownership disagrees`)
    }
  }
}

function validateCandidateEvidencePatches(previous: DiagnosisSession, event: RuntimeEvent): void {
  const previousById = new Map(previous.overlay.objects.map((object) => [object.id, object]))
  for (const patch of event.mutation.patches ?? []) {
    const candidate = previousById.get(patch.objectId)
    if (candidate?.type !== OntologyObjectType.CANDIDATE || patch.properties.evidenceIds === undefined) continue
    for (const evidenceId of array(patch.properties.evidenceIds)) {
      const evidence = requireObject(previousById, evidenceId, OntologyObjectType.EVIDENCE)
      if (evidence.properties.candidateId !== candidate.id) {
        throw new Error(`[runtime] Evidence ${evidence.id} does not belong to Candidate ${candidate.id}`)
      }
    }
  }
}

function validateReplan(
  previous: DiagnosisSession,
  event: RuntimeEvent,
  context: RuntimeValidationContext,
): void {
  const { objectById, links } = previewState(previous, event, context.base)
  const plan = event.mutation.upsertObjects?.find((object) => object.type === OntologyObjectType.PLAN)
  if (!plan) throw new Error('[runtime] PLAN_REPLANNED must create a new Plan')
  const previousPlanId = String(plan.properties.previousPlanId ?? '')
  if (!previousPlanId || previous.currentPlanId !== previousPlanId) {
    throw new Error(`[runtime] Replan ${plan.id} must supersede the current Plan ${previous.currentPlanId}`)
  }
  const previousPlan = requireObject(objectById, previousPlanId, OntologyObjectType.PLAN)
  const previousTaskIds = new Set(array(previousPlan.properties.taskIds))
  const newTaskIds = new Set(array(plan.properties.taskIds))
  const changes = Array.isArray(plan.properties.changes)
    ? plan.properties.changes as Array<Record<string, JsonValue>>
    : []
  const patchById = new Map((event.mutation.patches ?? []).map((patch) => [patch.objectId, patch]))
  const triggerFromProperty = typeof plan.properties.triggerEvidenceId === 'string'
    ? [plan.properties.triggerEvidenceId]
    : []
  const triggerFromLinks = (event.mutation.upsertLinks ?? [])
    .filter((link) => link.type === OntologyLinkType.BASED_ON && link.sourceId === plan.id)
    .map((link) => link.targetId)
  const triggerIds = [...new Set([...triggerFromProperty, ...triggerFromLinks])]
  if (triggerIds.length !== 1) {
    throw new Error(`[runtime] Replan ${plan.id} requires exactly one trigger Evidence`)
  }
  requireObject(
    new Map(previous.overlay.objects.map((object) => [object.id, object])),
    triggerIds[0],
    OntologyObjectType.EVIDENCE,
  )

  for (const change of changes) {
    const type = String(change.type)
    const taskId = String(change.taskId ?? '')
    const task = objectById.get(taskId)
    if (!task || task.type !== OntologyObjectType.TASK) {
      throw new Error(`[runtime] Replan ${plan.id} references unknown Task ${taskId}`)
    }
    if (type === 'ADD') {
      if (!event.mutation.upsertObjects?.some((object) => object.id === taskId) || !newTaskIds.has(taskId)) {
        throw new Error(`[runtime] ADD ${taskId} must create and include the Task in ${plan.id}`)
      }
      continue
    }
    if (!previousTaskIds.has(taskId)) {
      throw new Error(`[runtime] Replan change ${type} references Task ${taskId} outside previous Plan`)
    }
    const before = previous.overlay.objects.find((object) => object.id === taskId)!
    const patch = patchById.get(taskId)
    if (type === 'REPRIORITIZE') {
      if (number(before.properties.priority) !== number(change.from) || number(patch?.properties.priority) !== number(change.to)) {
        throw new Error(`[runtime] REPRIORITIZE ${taskId} does not apply the declared priority transition`)
      }
    } else if (type === 'SUSPEND') {
      if (patch?.properties.status !== TaskStatus.PAUSED) {
        throw new Error(`[runtime] SUSPEND ${taskId} must transition the Task to PAUSED`)
      }
    } else if (type === 'REPLACE') {
      const replacementId = String(change.with ?? '')
      if (patch?.properties.status !== TaskStatus.CANCELLED || !newTaskIds.has(replacementId)) {
        throw new Error(`[runtime] REPLACE ${taskId} must cancel it and include ${replacementId}`)
      }
    } else if (!['KEEP', 'CANCEL'].includes(type)) {
      throw new Error(`[runtime] unsupported plan change ${type}`)
    }
  }
  for (const taskId of newTaskIds) {
    requireObject(objectById, taskId, OntologyObjectType.TASK)
    if (!links.some((link) => link.type === OntologyLinkType.CONTAINS && link.sourceId === plan.id && link.targetId === taskId)) {
      throw new Error(`[runtime] Plan ${plan.id} does not contain declared Task ${taskId}`)
    }
  }
}

function collectIsoTimes(value: JsonValue, result: number[] = []): number[] {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed) && value.includes('T')) result.push(parsed)
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectIsoTimes(item, result))
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectIsoTimes(item, result))
  }
  return result
}

function traceEvidence(
  evidence: OntologyObject,
  objects: Map<string, OntologyObject>,
): { fact: OntologyObject; call: OntologyObject; task: OntologyObject } {
  const fact = requireObject(objects, String(evidence.properties.factId), OntologyObjectType.FACT)
  const call = requireObject(objects, String(fact.properties.functionCallId), OntologyObjectType.FUNCTION_CALL)
  const task = requireObject(objects, String(call.properties.taskId), OntologyObjectType.TASK)
  if (evidence.properties.candidateId === undefined) {
    throw new Error(`[runtime] Evidence ${evidence.id} has no Candidate ownership`)
  }
  if (call.properties.status !== TaskStatus.SUCCEEDED || task.properties.status !== TaskStatus.SUCCEEDED) {
    throw new Error(`[runtime] Evidence ${evidence.id} does not trace to a complete Function result`)
  }
  if (
    task.properties.operationKind !== PlannerOperationKind.FUNCTION_CALL ||
    task.properties.operationId !== call.id
  ) {
    throw new Error(`[runtime] Evidence ${evidence.id} has inconsistent Task/Call lineage`)
  }
  return { fact, call, task }
}

function assertPath(
  path: string[],
  linkType: OntologyLinkType,
  links: OntologyLink[],
  label: string,
): void {
  if (path.length < 2) throw new Error(`[runtime] Decision ${label} is missing`)
  for (let index = 0; index < path.length - 1; index++) {
    const source = path[index]
    const target = path[index + 1]
    if (!links.some((link) => link.type === linkType && link.sourceId === source && link.targetId === target)) {
      throw new Error(`[runtime] Decision ${label} segment has no ${linkType} Link: ${source} -> ${target}`)
    }
  }
}

function validateConfirmedDecision(
  decision: OntologyObject,
  objects: Map<string, OntologyObject>,
  links: OntologyLink[],
): void {
  const root = requireObject(
    objects,
    String(decision.properties.rootCandidateId),
    OntologyObjectType.CANDIDATE,
  )
  const score = number(root.properties.supportScore) ?? 0
  if (score < 85) throw new Error(`[runtime] root Candidate support score ${score} is below 85`)
  if (root.properties.objectId !== decision.properties.rootObjectId) {
    throw new Error('[runtime] Decision root object does not match the root Candidate')
  }
  const candidates = [...objects.values()].filter((object) => object.type === OntologyObjectType.CANDIDATE)
  const second = candidates.filter((candidate) => candidate.id !== root.id)
    .sort((a, b) => Number(b.properties.supportScore) - Number(a.properties.supportScore))[0]
  if (second && score - Number(second.properties.supportScore) < 30) {
    throw new Error('[runtime] root Candidate does not lead the competitor by 30 support points')
  }

  const evidence = array(root.properties.evidenceIds).map((id) =>
    requireObject(objects, id, OntologyObjectType.EVIDENCE),
  )
  const byCategory = new Map<string, OntologyObject>()
  for (const item of evidence) {
    if (item.properties.candidateId !== root.id) {
      throw new Error(`[runtime] root Candidate ${root.id} claims Evidence ${item.id} that belongs elsewhere`)
    }
    traceEvidence(item, objects)
    byCategory.set(String(item.properties.category), item)
  }
  for (const category of ['DIRECT_FAULT', 'TRIGGER_MECHANISM', 'STATE_CHANGE', 'BUSINESS_IMPACT']) {
    if (!byCategory.has(category)) throw new Error(`[runtime] minimum evidence is missing ${category}`)
  }

  const times = (category: string) => {
    const item = byCategory.get(category)!
    return collectIsoTimes(traceEvidence(item, objects).fact.properties.rawResult)
  }
  const mechanism = times('TRIGGER_MECHANISM')
  const direct = times('DIRECT_FAULT')
  const state = times('STATE_CHANGE')
  const impact = times('BUSINESS_IMPACT')
  if (![mechanism, direct, state, impact].every((values) => values.length)) {
    throw new Error('[runtime] minimum evidence lacks parseable temporal data')
  }
  if (!(Math.min(...mechanism) <= Math.min(...direct) && Math.min(...direct) <= Math.min(...state) && Math.min(...state) <= Math.min(...impact) && Math.max(...state) <= Math.max(...impact))) {
    throw new Error('[runtime] evidence temporal order is inconsistent')
  }

  const conflicts = [...objects.values()].filter(
    (object) =>
      (object.type === OntologyObjectType.EVIDENCE && object.properties.relation === 'CONFLICTS' && object.properties.resolved !== true) ||
      (object.type === OntologyObjectType.CANDIDATE && object.properties.status === CandidateStatus.CONFLICTING),
  )
  if (conflicts.length || array(decision.properties.unresolvedConflicts).length) {
    throw new Error(`[runtime] unresolved conflicts prevent confirmation: ${conflicts.map(({ id }) => id).join(', ')}`)
  }

  for (const competitor of candidates.filter((candidate) => candidate.id !== root.id)) {
    if (competitor.properties.status !== CandidateStatus.WEAKENED) {
      throw new Error(`[runtime] competitor check missing for ${competitor.id}`)
    }
    const weakening = [...objects.values()].find(
      (object) => object.type === OntologyObjectType.EVIDENCE &&
        object.properties.candidateId === competitor.id && object.properties.relation === 'WEAKENS',
    )
    if (!weakening) throw new Error(`[runtime] competitor check has no weakening Evidence for ${competitor.id}`)
    traceEvidence(weakening, objects)
  }
  if (
    decision.properties.minimumEvidenceSatisfied !== true ||
    decision.properties.competitorCheckCompleted !== true ||
    array(decision.properties.unresolvedConflicts).length !== 0
  ) {
    throw new Error('[runtime] Decision gate materialization does not match computed evidence/competitor/conflict state')
  }

  const lineage = array(decision.properties.lineageObjectIds)
  for (const id of lineage) requireObject(objects, id)
  for (const type of [
    OntologyObjectType.PLAN,
    OntologyObjectType.TASK,
    OntologyObjectType.FUNCTION_CALL,
    OntologyObjectType.FACT,
    OntologyObjectType.EVIDENCE,
    OntologyObjectType.CANDIDATE,
  ]) {
    if (!lineage.some((id) => objects.get(id)?.type === type)) {
      throw new Error(`[runtime] Decision lineage is missing ${type}`)
    }
  }
  for (const item of evidence) {
    const { fact, call, task } = traceEvidence(item, objects)
    for (const id of [item.id, fact.id, call.id, task.id]) {
      if (!lineage.includes(id)) {
        throw new Error(`[runtime] Decision lineage is missing root Evidence chain object ${id}`)
      }
    }
    if (!links.some((link) =>
      link.type === OntologyLinkType.BASED_ON &&
      link.sourceId === decision.id && link.targetId === item.id
    )) {
      throw new Error(`[runtime] Decision has no BASED_ON Link to root Evidence ${item.id}`)
    }
  }
  assertPath(array(decision.properties.impactPath), OntologyLinkType.IMPACTS, links, 'impactPath')
  assertPath(array(decision.properties.recoveryPath), OntologyLinkType.RECOVERS_VIA, links, 'recoveryPath')
}

function validateNonConfirmedDecision(
  decision: OntologyObject,
  objects: Map<string, OntologyObject>,
): void {
  const conclusion = decision.properties.conclusion as ConclusionType
  const missing = array(decision.properties.missingEvidence)
  if (!missing.length) throw new Error(`[runtime] ${conclusion} Decision must declare missing evidence`)
  if (decision.properties.rootCandidateId !== null || decision.properties.rootObjectId !== null) {
    throw new Error(`[runtime] ${conclusion} Decision cannot claim a unique root cause`)
  }
  const candidates = [...objects.values()].filter((object) => object.type === OntologyObjectType.CANDIDATE)
  if (candidates.some((candidate) => candidate.properties.status === CandidateStatus.CONFIRMED)) {
    throw new Error(`[runtime] ${conclusion} conflicts with a confirmed Candidate`)
  }
  if (conclusion === ConclusionType.PROBABLE_CAUSES) {
    const ids = array(decision.properties.probableCandidateIds)
    if (ids.length < 2) throw new Error('[runtime] PROBABLE_CAUSES requires at least two Candidates')
    const probable = ids.map((id) => requireObject(objects, id, OntologyObjectType.CANDIDATE))
      .sort((a, b) => Number(b.properties.supportScore) - Number(a.properties.supportScore))
    const blocked = [...objects.values()].some(
      (object) => object.type === OntologyObjectType.TASK &&
        [TaskStatus.PARTIAL, TaskStatus.FAILED, TaskStatus.DATA_MISSING, TaskStatus.TIMEOUT].includes(object.properties.status as TaskStatus),
    )
    if (Number(probable[0].properties.supportScore) - Number(probable[1].properties.supportScore) >= 10 && !blocked) {
      throw new Error('[runtime] PROBABLE_CAUSES requires tied Candidates or incomplete data')
    }
    const nextTaskId = decision.properties.nextTaskId
    if (typeof nextTaskId === 'string') requireObject(objects, nextTaskId, OntologyObjectType.TASK)
  } else {
    if (array(decision.properties.probableCandidateIds).length) {
      throw new Error('[runtime] INSUFFICIENT_EVIDENCE cannot list probable Candidates')
    }
    const blocking = array(decision.properties.blockingTaskIds)
    const validBlocking = blocking.length > 0 && blocking.every((id) => {
      const task = requireObject(objects, id, OntologyObjectType.TASK)
      return [TaskStatus.PARTIAL, TaskStatus.FAILED, TaskStatus.DATA_MISSING, TaskStatus.TIMEOUT]
        .includes(task.properties.status as TaskStatus)
    })
    const noDiagnosticData = candidates.length === 0 &&
      ![...objects.values()].some((object) => object.type === OntologyObjectType.FACT) &&
      ![...objects.values()].some((object) => object.type === OntologyObjectType.TASK)
    if (!validBlocking && !noDiagnosticData) {
      throw new Error('[runtime] INSUFFICIENT_EVIDENCE requires failed/partial/missing data or no diagnostic data')
    }
  }
}

function validateDecision(
  previous: DiagnosisSession,
  event: RuntimeEvent,
  context: RuntimeValidationContext,
): void {
  const decisions = event.mutation.upsertObjects?.filter(
    (object) => object.type === OntologyObjectType.DECISION,
  ) ?? []
  if (decisions.length !== 1) throw new Error('[runtime] terminal Decision event must create exactly one Decision')
  if ((event.mutation.upsertObjects ?? []).some((object) => object.type !== OntologyObjectType.DECISION)) {
    throw new Error('[runtime] terminal gate must evaluate the pre-application Session; it may only add a Decision')
  }
  const decision = decisions[0]
  const { links } = previewState(previous, event, context.base)
  const preEventObjects = new Map(
    [...context.base.objects, ...previous.overlay.objects].map((object) => [object.id, object]),
  )
  for (const id of array(decision.properties.lineageObjectIds)) {
    const object = preEventObjects.get(id)
    if (
      object?.type === OntologyObjectType.FACT &&
      collectIsoTimes(object.properties.rawResult).some((time) => time > Date.parse(event.occurredAt))
    ) throw new Error(`[runtime] Fact ${object.id} time is later than Decision ${decision.id}`)
  }
  if (decision.properties.conclusion === ConclusionType.ROOT_CAUSE_CONFIRMED) {
    if (event.type !== EventType.ROOT_CAUSE_CONFIRMED) {
      throw new Error('[runtime] confirmed root cause requires ROOT_CAUSE_CONFIRMED event')
    }
    validateConfirmedDecision(decision, preEventObjects, links)
    const rootCandidateId = String(decision.properties.rootCandidateId)
    const patches = event.mutation.patches ?? []
    if (
      patches.length !== 1 || patches[0].objectId !== rootCandidateId ||
      patches[0].properties.status !== CandidateStatus.CONFIRMED ||
      Object.keys(patches[0].properties).length !== 1
    ) throw new Error('[runtime] confirmation may only mark the root Candidate CONFIRMED')
  } else {
    if (event.type !== EventType.DECISION_RECORDED || (event.mutation.patches ?? []).length) {
      throw new Error('[runtime] non-confirmed Decision must use patch-free DECISION_RECORDED')
    }
    validateNonConfirmedDecision(decision, preEventObjects)
  }
  if (event.mutation.conclusionDecisionId !== decision.id) {
    throw new Error('[runtime] terminal event must select the materialized Decision')
  }
}

function validateAction(
  previous: DiagnosisSession,
  event: RuntimeEvent,
  context: RuntimeValidationContext,
): void {
  const { objectById } = previewState(previous, event, context.base)
  const proposal = event.mutation.upsertObjects?.find(
    (object) => object.type === OntologyObjectType.ACTION_PROPOSAL,
  )
  if (!proposal) throw new Error('[runtime] ACTION_PROPOSED must create an Action Proposal')
  const task = requireObject(objectById, String(proposal.properties.taskId), OntologyObjectType.TASK)
  if (
    task.properties.operationKind !== PlannerOperationKind.ACTION_PROPOSAL ||
    task.properties.operationId !== proposal.id
  ) {
    throw new Error(`[runtime] Action Proposal ${proposal.id} is not targeted by its Task`)
  }
  if (task.properties.status !== TaskStatus.READY) {
    throw new Error(`[runtime] Action Task ${task.id} must remain READY while approval is required`)
  }
  if (task.properties.planId !== previous.currentPlanId) {
    throw new Error(`[runtime] Action Task ${task.id} must belong to current Plan ${previous.currentPlanId}`)
  }
  const plan = requireObject(objectById, String(previous.currentPlanId), OntologyObjectType.PLAN)
  if (!array(plan.properties.taskIds).includes(task.id)) {
    throw new Error(`[runtime] current Plan ${plan.id} does not include Action Task ${task.id}`)
  }
  const previousPlan = requireObject(
    new Map(previous.overlay.objects.map((object) => [object.id, object])),
    plan.id,
    OntologyObjectType.PLAN,
  )
  const expectedTaskIds = [...array(previousPlan.properties.taskIds), task.id]
  if (!deepEqual(plan.properties.taskIds, expectedTaskIds)) {
    throw new Error(`[runtime] Action event may only append Task ${task.id} to current Plan ${plan.id}`)
  }
  const preview = previewState(previous, event, context.base)
  if (!preview.links.some((link) =>
    link.type === OntologyLinkType.CONTAINS &&
    link.sourceId === plan.id && link.targetId === task.id
  )) {
    throw new Error(`[runtime] current Plan ${plan.id} has no CONTAINS Link to Action Task ${task.id}`)
  }
  const action = context.catalog.actions.find((definition) => definition.id === proposal.properties.actionId)
  if (!action || !action.requiresApproval) throw new Error(`[runtime] unknown or unsafe Action ${proposal.properties.actionId}`)
  if (proposal.properties.status !== ActionProposalStatus.APPROVAL_REQUIRED) {
    throw new Error(`[runtime] Action Proposal ${proposal.id} must remain APPROVAL_REQUIRED`)
  }
  for (const id of array(proposal.properties.targetObjectIds)) {
    const target = requireObject(objectById, id)
    if (!action.targetTypes.includes(target.type)) {
      throw new Error(`[runtime] Action ${action.id} cannot target ${target.type} ${id}`)
    }
  }
}

/** Production transition validation shared by live apply, replay and Scenario preflight. */
export function validateRuntimeTransition(
  previous: DiagnosisSession,
  event: RuntimeEvent,
  context: RuntimeValidationContext,
): void {
  assertEventShapeAndPolicy(previous, event, context)
  for (const object of event.mutation.upsertObjects ?? []) assertCriticalOntologyObject(object)
  validateTaskPatches(previous, event)
  validateCandidateEvidencePatches(previous, event)
  switch (event.type) {
    case EventType.FUNCTION_CALL_REQUESTED:
      validateFunctionRequest(previous, event, context)
      break
    case EventType.FUNCTION_CALL_COMPLETED:
      validateFunctionResult(previous, event)
      break
    case EventType.FACT_DISCOVERED:
      validateFactMaterialization(previous, event)
      break
    case EventType.EVIDENCE_CREATED:
      validateEvidence(previous, event)
      break
    case EventType.PLAN_REPLANNED:
      validateReplan(previous, event, context)
      break
    case EventType.ACTION_PROPOSED:
      validateAction(previous, event, context)
      break
    case EventType.ROOT_CAUSE_CONFIRMED:
    case EventType.DECISION_RECORDED:
      validateDecision(previous, event, context)
      break
  }
}

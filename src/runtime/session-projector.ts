import {
  DiagnosisPhase,
  EventType,
  OntologyObjectType,
} from '../../schemas/enums'
import type {
  DiagnosisSession,
  OntologyLink,
  OntologyObject,
  RuntimeEvent,
  ScenarioOverlay,
} from '../../schemas/types'
import { BASE_CATALOG } from '../ontology/catalog'
import { loadOntologyRegistry } from '../ontology/model-adapter'
import {
  validateRuntimeTransition,
  type RuntimeValidationContext,
} from './protocol-validator'

function cloneObject(object: OntologyObject): OntologyObject {
  return { ...object, properties: { ...object.properties }, provenance: { ...object.provenance } }
}

function cloneLink(link: OntologyLink): OntologyLink {
  return { ...link, properties: { ...link.properties }, provenance: { ...link.provenance } }
}

function cloneOverlay(overlay: ScenarioOverlay): ScenarioOverlay {
  return {
    scenarioId: overlay.scenarioId,
    objects: overlay.objects.map(cloneObject),
    links: overlay.links.map(cloneLink),
  }
}

export function createEmptySession(
  caseId: string,
  scenarioId: string,
  sessionId: string = `session:${scenarioId}`,
): DiagnosisSession {
  return {
    id: sessionId,
    scenarioId,
    caseId,
    version: 0,
    phase: DiagnosisPhase.MODEL_OVERVIEW,
    summary: '模型探索态：尚未创建诊断 Scenario',
    overlay: { scenarioId, objects: [], links: [] },
    eventLog: [],
    appliedEventIds: [],
    currentPlanId: null,
    currentActivityId: null,
    conclusionDecisionId: null,
  }
}

function assertScenarioObject(object: OntologyObject, scenarioId: string): void {
  if (object.scenarioId !== scenarioId) {
    throw new Error(`[runtime] object ${object.id} is not isolated to ${scenarioId}`)
  }
}

function assertScenarioLink(link: OntologyLink, scenarioId: string): void {
  if (link.scenarioId !== scenarioId) {
    throw new Error(`[runtime] link ${link.id} is not isolated to ${scenarioId}`)
  }
}

function validateMutationBoundary(event: RuntimeEvent): void {
  const addedTypes = new Set(event.mutation.upsertObjects?.map((object) => object.type) ?? [])
  if (
    event.type === EventType.FUNCTION_CALL_REQUESTED &&
    [...addedTypes].some((type) => type !== OntologyObjectType.FUNCTION_CALL)
  ) {
    throw new Error('[runtime] Function Call request may only create FUNCTION_CALL objects')
  }
  if (
    event.type === EventType.ACTION_PROPOSED &&
    [...addedTypes].some(
      (type) =>
        type !== OntologyObjectType.ACTION_PROPOSAL && type !== OntologyObjectType.TASK,
    )
  ) {
    throw new Error('[runtime] Action event may only create ACTION_PROPOSAL/TASK objects')
  }
  if (
    event.type === EventType.ROOT_CAUSE_CONFIRMED &&
    !addedTypes.has(OntologyObjectType.DECISION)
  ) {
    throw new Error('[runtime] root-cause confirmation must materialize a Decision')
  }
}

/** Apply exactly one event. Re-applying an event id is idempotent. */
export function applyRuntimeEvent(
  previous: DiagnosisSession,
  event: RuntimeEvent,
  context: RuntimeValidationContext = {
    catalog: BASE_CATALOG,
    base: loadOntologyRegistry().baseSnapshot(),
  },
): DiagnosisSession {
  if (previous.appliedEventIds.includes(event.id)) return previous
  const expectedSequence = previous.version + 1
  if (event.sequence !== expectedSequence) {
    throw new Error(
      `[runtime] sequence gap: expected ${expectedSequence}, received ${event.sequence}`,
    )
  }
  validateMutationBoundary(event)
  validateRuntimeTransition(previous, event, context)

  const overlay = cloneOverlay(previous.overlay)
  const objectById = new Map(overlay.objects.map((object) => [object.id, object]))
  const linkById = new Map(overlay.links.map((link) => [link.id, link]))

  for (const object of event.mutation.upsertObjects ?? []) {
    assertScenarioObject(object, previous.scenarioId)
    const existing = objectById.get(object.id)
    if (existing) {
      existing.label = object.label
      existing.properties = { ...existing.properties, ...object.properties }
    } else {
      const copy = cloneObject(object)
      overlay.objects.push(copy)
      objectById.set(copy.id, copy)
    }
  }

  for (const patch of event.mutation.patches ?? []) {
    const object = objectById.get(patch.objectId)
    if (!object) {
      throw new Error(`[runtime] event ${event.id} patches unknown Scenario object ${patch.objectId}`)
    }
    object.properties = { ...object.properties, ...patch.properties }
    if (patch.label) object.label = patch.label
  }

  for (const link of event.mutation.upsertLinks ?? []) {
    assertScenarioLink(link, previous.scenarioId)
    const existing = linkById.get(link.id)
    if (existing) {
      existing.properties = { ...existing.properties, ...link.properties }
    } else {
      const copy = cloneLink(link)
      overlay.links.push(copy)
      linkById.set(copy.id, copy)
    }
  }

  const validObjectIds = new Set([
    ...context.base.objects.map((object) => object.id),
    ...overlay.objects.map((object) => object.id),
  ])
  for (const link of overlay.links) {
    if (!validObjectIds.has(link.sourceId) || !validObjectIds.has(link.targetId)) {
      throw new Error(`[runtime] dangling Scenario Link ${link.id}: ${link.sourceId} -> ${link.targetId}`)
    }
  }

  return {
    ...previous,
    version: event.sequence,
    phase: event.mutation.phase ?? previous.phase,
    summary: event.mutation.summary ?? previous.summary,
    overlay,
    eventLog: [...previous.eventLog, event],
    appliedEventIds: [...previous.appliedEventIds, event.id],
    currentPlanId:
      event.mutation.currentPlanId === undefined
        ? previous.currentPlanId
        : event.mutation.currentPlanId,
    currentActivityId:
      event.mutation.currentActivityId === undefined
        ? previous.currentActivityId
        : event.mutation.currentActivityId,
    conclusionDecisionId:
      event.mutation.conclusionDecisionId === undefined
        ? previous.conclusionDecisionId
        : event.mutation.conclusionDecisionId,
  }
}

export function projectSession(
  events: RuntimeEvent[],
  caseId: string,
  scenarioId: string,
  throughSequence: number = Number.POSITIVE_INFINITY,
  context?: RuntimeValidationContext,
): DiagnosisSession {
  return events
    .filter((event) => event.sequence <= throughSequence)
    .sort((a, b) => a.sequence - b.sequence)
    .reduce(
      (session, event) => applyRuntimeEvent(session, event, context),
      createEmptySession(caseId, scenarioId),
    )
}

export function selectScenarioObjects(
  session: DiagnosisSession,
  type: OntologyObjectType,
): OntologyObject[] {
  return session.overlay.objects.filter((object) => object.type === type)
}

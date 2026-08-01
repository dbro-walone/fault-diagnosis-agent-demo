import {
  ActionProposalStatus,
  EventType,
  FunctionEffect,
  OntologyObjectType,
} from '../../schemas/enums'
import type {
  CatalogSnapshot,
  DiagnosisSession,
  NormalizedSymptom,
  OntologyObject,
  OntologyScenarioDefinition,
  RuntimeEvent,
} from '../../schemas/types'
import { resolveScenarioCatalog } from '../ontology/catalog'
import { loadOntologyRegistry } from '../ontology/model-adapter'
import { assertCriticalOntologyObject } from '../ontology/object-guards'
import {
  applyRuntimeEvent,
  createEmptySession,
  projectSession,
} from './session-projector'
import type { RuntimeValidationContext } from './protocol-validator'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SCENARIO_SCHEMA_VERSION = '2.0.0'
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

function collectIsoTimes(value: unknown, result: number[] = []): number[] {
  if (typeof value === 'string' && ISO_TIMESTAMP.test(value)) {
    result.push(Date.parse(value))
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectIsoTimes(item, result))
  } else if (isRecord(value)) {
    Object.values(value).forEach((item) => collectIsoTimes(item, result))
  }
  return result
}

function validateTemporalLineage(definition: OntologyScenarioDefinition): void {
  const created = new Map<string, { object: OntologyObject; occurredAt: number }>()
  for (const event of definition.events) {
    const eventTime = Date.parse(event.occurredAt)
    for (const object of event.mutation.upsertObjects ?? []) {
      created.set(object.id, { object, occurredAt: eventTime })
      if (object.type === OntologyObjectType.FACT) {
        const factTimes = collectIsoTimes([object.properties.rawResult, object.provenance.observedAt])
        if (factTimes.some((time) => time > eventTime)) {
          throw new Error(`[scenario] Fact ${object.id} time is later than its materialization Event`)
        }
      }
    }
  }
  for (const event of definition.events) {
    const eventTime = Date.parse(event.occurredAt)
    for (const object of event.mutation.upsertObjects ?? []) {
      if (object.type === OntologyObjectType.EVIDENCE) {
        const fact = created.get(String(object.properties.factId))?.object
        if (fact?.type === OntologyObjectType.FACT) {
          const times = collectIsoTimes([fact.properties.rawResult, fact.provenance.observedAt])
          if (times.some((time) => time > eventTime)) {
            throw new Error(`[scenario] Fact ${fact.id} time is later than Evidence ${object.id}`)
          }
        }
      }
      if (object.type === OntologyObjectType.DECISION) {
        for (const id of Array.isArray(object.properties.lineageObjectIds)
          ? object.properties.lineageObjectIds.map(String)
          : []) {
          const lineage = created.get(id)?.object
          if (lineage?.type !== OntologyObjectType.FACT) continue
          const times = collectIsoTimes([lineage.properties.rawResult, lineage.provenance.observedAt])
          if (times.some((time) => time > eventTime)) {
            throw new Error(`[scenario] Fact ${lineage.id} time is later than Decision ${object.id}`)
          }
        }
      }
    }
  }
}

function contextFor(
  definition: OntologyScenarioDefinition,
  catalog: CatalogSnapshot = resolveScenarioCatalog(definition),
): RuntimeValidationContext {
  return { catalog, base: loadOntologyRegistry().baseSnapshot() }
}

/** Runtime JSON entry validation plus a full production-path protocol preflight. */
export function validateScenarioDefinition(
  value: unknown,
): asserts value is OntologyScenarioDefinition {
  if (
    !isRecord(value) || typeof value.scenarioId !== 'string' || !value.scenarioId.trim() ||
    typeof value.caseId !== 'string' || !value.caseId.trim() ||
    typeof value.label !== 'string' || !value.label.trim() ||
    value.schemaVersion !== SCENARIO_SCHEMA_VERSION || !Array.isArray(value.events)
  ) {
    throw new Error('[scenario] scenarioId, caseId and events are required')
  }
  if (
    !isRecord(value.catalog) || !Array.isArray(value.catalog.functionIds) ||
    !Array.isArray(value.catalog.skillIds) || !Array.isArray(value.catalog.actionIds) ||
    [...value.catalog.functionIds, ...value.catalog.skillIds, ...value.catalog.actionIds]
      .some((id) => typeof id !== 'string' || !id.trim())
  ) throw new Error('[scenario] catalog reference is required')
  const definition = value as unknown as OntologyScenarioDefinition
  const catalog = resolveScenarioCatalog(definition)
  const eventIds = new Set<string>()
  let previousOccurredAt = Number.NEGATIVE_INFINITY
  definition.events.forEach((event, index) => {
    if (!isRecord(event) || event.sequence !== index + 1 || typeof event.id !== 'string') {
      throw new Error(`[scenario] non-contiguous or malformed event at sequence ${index + 1}`)
    }
    if (!Object.values(EventType).includes(event.type)) {
      throw new Error(`[scenario] Event ${event.id} has unknown type ${event.type}`)
    }
    if (Number.isNaN(Date.parse(event.occurredAt))) {
      throw new Error(`[scenario] Event ${event.id} has invalid occurredAt`)
    }
    const occurredAt = Date.parse(event.occurredAt)
    if (occurredAt < previousOccurredAt) {
      throw new Error(`[scenario] Event ${event.id} occurredAt is not monotonic`)
    }
    previousOccurredAt = occurredAt
    if (eventIds.has(event.id)) throw new Error(`[scenario] duplicate event id ${event.id}`)
    for (const causeId of event.causedByEventIds) {
      if (!eventIds.has(causeId)) {
        throw new Error(`[scenario] event ${event.id} references future/unknown cause ${causeId}`)
      }
    }
    eventIds.add(event.id)
    for (const object of event.mutation.upsertObjects ?? []) {
      if (object.scenarioId !== definition.scenarioId) {
        throw new Error(`[scenario] ${object.id} escapes Scenario isolation`)
      }
      assertCriticalOntologyObject(object)
      if (
        object.type === OntologyObjectType.FUNCTION_CALL &&
        object.properties.effect !== FunctionEffect.READ_ONLY
      ) {
        throw new Error(`[scenario] Function Call ${object.id} must be READ_ONLY`)
      }
      if (
        object.type === OntologyObjectType.ACTION_PROPOSAL &&
        object.properties.status !== ActionProposalStatus.APPROVAL_REQUIRED
      ) {
        throw new Error(`[scenario] Action Proposal ${object.id} must require approval`)
      }
    }
    for (const link of event.mutation.upsertLinks ?? []) {
      if (link.scenarioId !== definition.scenarioId) {
        throw new Error(`[scenario] ${link.id} escapes Scenario isolation`)
      }
    }
  })
  const scenarioObject = definition.events.flatMap((event) => event.mutation.upsertObjects ?? [])
    .find((object) => object.type === OntologyObjectType.SCENARIO)
  if (!scenarioObject || scenarioObject.id !== definition.scenarioId) {
    throw new Error('[scenario] Scenario object/id mismatch')
  }
  for (const fn of catalog.functions) {
    if (fn.effect !== FunctionEffect.READ_ONLY) {
      throw new Error(`[scenario] Function ${fn.id} is not read-only`)
    }
  }
  for (const boundary of catalog.skills) {
    if (!catalog.functions.some((fn) => fn.id === boundary.functionId)) {
      throw new Error(`[scenario] Skill ${boundary.skillId} references unknown Function`)
    }
    if (boundary.ontologyWrites.length > 0) {
      throw new Error(`[scenario] Skill ${boundary.skillId} may not write ontology objects`)
    }
  }

  const context = contextFor(definition, catalog)
  definition.events.reduce(
    (session, event) => applyRuntimeEvent(session, event, context),
    createEmptySession(definition.caseId, definition.scenarioId),
  )
  validateTemporalLineage(definition)
}

function shiftIsoTimes(value: unknown, deltaMs: number): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const item = value[index]
      if (typeof item === 'string' && ISO_TIMESTAMP.test(item)) {
        value[index] = new Date(Date.parse(item) + deltaMs).toISOString()
      } else {
        shiftIsoTimes(item, deltaMs)
      }
    }
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && ISO_TIMESTAMP.test(item)) {
      value[key] = new Date(Date.parse(item) + deltaMs).toISOString()
    } else {
      shiftIsoTimes(item, deltaMs)
    }
  }
}

function instantiateScenario(
  definition: OntologyScenarioDefinition,
  input?: NormalizedSymptom,
): OntologyScenarioDefinition {
  if (!input) return definition
  const instantiated = structuredClone(definition)
  const first = instantiated.events[0]
  if (!first || first.type !== EventType.DIAGNOSIS_INITIALIZED) {
    throw new Error('[scenario] first event must initialize the normalized symptom')
  }
  const scenario = first.mutation.upsertObjects?.find(
    (object) => object.type === OntologyObjectType.SCENARIO,
  )
  if (!scenario) throw new Error('[scenario] initialization event has no Scenario object')
  const deltaMs = Date.parse(input.occurredAt) - Date.parse(first.occurredAt)
  if (!Number.isFinite(deltaMs)) throw new Error('[scenario] invalid instantiation occurredAt')
  // Scenario payloads contain only current-Case timestamps. Static knowledge is
  // held in the base Registry, so the explicit static-time whitelist is empty.
  shiftIsoTimes(instantiated.events, deltaMs)
  scenario.properties = {
    ...scenario.properties,
    symptomCode: input.symptomCode,
    normalizedDescription: input.description,
    objectType: input.objectType,
    occurredAt: input.occurredAt,
    businessScope: input.businessScope,
  }
  first.occurredAt = input.occurredAt
  return instantiated
}

export interface DiagnosisEngine {
  readonly definition: OntologyScenarioDefinition
  readonly catalog: CatalogSnapshot
  readonly session: DiagnosisSession
  readonly liveHead: number
  readonly replayCursor: number
  /** Backward-compatible alias for the replay cursor. */
  readonly cursor: number
  readonly complete: boolean
  readonly isHistorical: boolean
  readonly liveEvents: RuntimeEvent[]
  advance(): DiagnosisEngine
  seek(sequence: number): DiagnosisEngine
  returnLive(): DiagnosisEngine
  reset(): DiagnosisEngine
}

class ScenarioDiagnosisEngine implements DiagnosisEngine {
  constructor(
    readonly definition: OntologyScenarioDefinition,
    readonly catalog: CatalogSnapshot,
    private readonly liveSession: DiagnosisSession,
    readonly replayCursor: number,
  ) {}

  private get context(): RuntimeValidationContext {
    return contextFor(this.definition, this.catalog)
  }

  get liveHead(): number {
    return this.liveSession.version
  }

  get cursor(): number {
    return this.replayCursor
  }

  get isHistorical(): boolean {
    return this.replayCursor < this.liveHead
  }

  get liveEvents(): RuntimeEvent[] {
    return this.liveSession.eventLog
  }

  get session(): DiagnosisSession {
    if (!this.isHistorical) return this.liveSession
    return projectSession(
      this.liveSession.eventLog,
      this.definition.caseId,
      this.definition.scenarioId,
      this.replayCursor,
      this.context,
    )
  }

  get complete(): boolean {
    return this.liveHead >= this.definition.events.length
  }

  advance(): DiagnosisEngine {
    if (this.complete) return this
    const wasLive = !this.isHistorical
    const event = this.definition.events[this.liveHead]
    const nextLive = applyRuntimeEvent(this.liveSession, event, this.context)
    return new ScenarioDiagnosisEngine(
      this.definition,
      this.catalog,
      nextLive,
      wasLive ? nextLive.version : this.replayCursor,
    )
  }

  seek(sequence: number): DiagnosisEngine {
    const replayCursor = Math.max(0, Math.min(sequence, this.liveHead))
    return new ScenarioDiagnosisEngine(
      this.definition,
      this.catalog,
      this.liveSession,
      replayCursor,
    )
  }

  returnLive(): DiagnosisEngine {
    return this.seek(this.liveHead)
  }

  reset(): DiagnosisEngine {
    return createDiagnosisEngine(this.definition)
  }
}

export function createDiagnosisEngine(
  source: OntologyScenarioDefinition,
  input?: NormalizedSymptom,
): DiagnosisEngine {
  validateScenarioDefinition(source)
  const definition = instantiateScenario(source, input)
  validateScenarioDefinition(definition)
  const catalog = resolveScenarioCatalog(definition)
  return new ScenarioDiagnosisEngine(
    definition,
    catalog,
    createEmptySession(definition.caseId, definition.scenarioId),
    0,
  )
}

export function replayEvents(
  definition: OntologyScenarioDefinition,
  throughSequence: number = definition.events.length,
): DiagnosisSession {
  validateScenarioDefinition(definition)
  const catalog = resolveScenarioCatalog(definition)
  return projectSession(
    definition.events,
    definition.caseId,
    definition.scenarioId,
    throughSequence,
    contextFor(definition, catalog),
  )
}

export function eventAt(
  definition: OntologyScenarioDefinition,
  sequence: number,
): RuntimeEvent | null {
  return definition.events.find((event) => event.sequence === sequence) ?? null
}

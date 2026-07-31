import { describe, expect, it } from 'vitest'

import scenarioJson from '../../cases/controller_warm_reset_001/scenario.json'
import monitoringGapJson from '../../cases/monitoring_gap_001/scenario.json'
import {
  ActionProposalStatus,
  ConclusionType,
  DiagnosisPhase,
  EventType,
  FunctionEffect,
  OntologyObjectType,
  PlannerOperationKind,
  TaskStatus,
} from '../../schemas/enums'
import type {
  OntologyObject,
  OntologyScenarioDefinition,
} from '../../schemas/types'
import { loadOntologyRegistry } from '../ontology/model-adapter'
import { resolveScenarioCatalog } from '../ontology/catalog'
import {
  createDiagnosisEngine,
  replayEvents,
  validateScenarioDefinition,
} from './diagnosis-engine'
import { assertOperationTarget, plannerOperation } from './planner'
import { applyRuntimeEvent } from './session-projector'
import { createSkillRegistry } from './skill-executor'

const scenario = scenarioJson as OntologyScenarioDefinition
const monitoringGap = monitoringGapJson as OntologyScenarioDefinition

function objectEvent(definition: OntologyScenarioDefinition, id: string) {
  return definition.events.find((event) =>
    event.mutation.upsertObjects?.some((object) => object.id === id),
  )!
}

function objectIn(definition: OntologyScenarioDefinition, id: string) {
  return objectEvent(definition, id).mutation.upsertObjects!.find((object) => object.id === id)!
}

function byType(session: ReturnType<typeof replayEvents>, type: OntologyObjectType) {
  return session.overlay.objects.filter((object) => object.type === type)
}

function eventOfType(definition: OntologyScenarioDefinition, type: EventType) {
  return definition.events.find((event) => event.type === type)!
}

describe('data-driven diagnosis Scenario', () => {
  it('starts without root-cause truth, Candidate or Decision leakage', () => {
    const initial = replayEvents(scenario, 1)
    const serialized = JSON.stringify(initial).toLocaleLowerCase()

    expect(serialized).not.toContain('watchdog')
    expect(serialized).not.toContain('热复位')
    expect(byType(initial, OntologyObjectType.CANDIDATE)).toHaveLength(0)
    expect(byType(initial, OntologyObjectType.DECISION)).toHaveLength(0)
  })

  it('changes diagnosis state only by applying authored Runtime Events', () => {
    let engine = createDiagnosisEngine(scenario)
    const empty = engine.session
    engine = engine.advance()

    expect(empty.version).toBe(0)
    expect(engine.session.version).toBe(1)
    expect(engine.session.eventLog).toEqual([scenario.events[0]])
    expect(applyRuntimeEvent(engine.session, scenario.events[0])).toBe(engine.session)
    expect(() => applyRuntimeEvent(empty, scenario.events[1])).toThrow(/sequence gap/)
  })

  it('replays deterministically and keeps every runtime object Scenario-local', () => {
    const first = replayEvents(scenario)
    const second = replayEvents(scenario)

    expect(first).toEqual(second)
    expect(first.overlay.objects.every(({ scenarioId }) => scenarioId === scenario.scenarioId))
      .toBe(true)
    expect(first.overlay.links.every(({ scenarioId }) => scenarioId === scenario.scenarioId))
      .toBe(true)
    expect(() => loadOntologyRegistry().snapshot(first.overlay)).not.toThrow()
  })

  it('enforces read-only Function Calls, Skill boundaries and approval-gated Actions', () => {
    expect(() => validateScenarioDefinition(scenario)).not.toThrow()
    const skills = createSkillRegistry(resolveScenarioCatalog(scenario))
    expect(skills.canWriteOntology('alarm_query')).toBe(false)
    expect(skills.functionDefinition('alarm_query')?.effect).toBe(FunctionEffect.READ_ONLY)

    const completed = replayEvents(scenario)
    const functionCalls = byType(completed, OntologyObjectType.FUNCTION_CALL)
    const observations = byType(completed, OntologyObjectType.OBSERVATION)
    const proposals = byType(completed, OntologyObjectType.ACTION_PROPOSAL)
    expect(functionCalls.every((call) => call.properties.effect === FunctionEffect.READ_ONLY))
      .toBe(true)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].properties.status).toBe(ActionProposalStatus.APPROVAL_REQUIRED)
    expect(observations).toHaveLength(4)

    const actionTask = byType(completed, OntologyObjectType.TASK).find(
      (task) => task.properties.operationKind === PlannerOperationKind.ACTION_PROPOSAL,
    )!
    const operation = plannerOperation(actionTask)
    expect(operation.kind).toBe(PlannerOperationKind.ACTION_PROPOSAL)
    expect(() => assertOperationTarget(operation, proposals[0])).not.toThrow()
    expect(() => assertOperationTarget(operation, functionCalls[0])).toThrow()
  })

  it('materializes a gated Decision with complete evidence, impact and recovery lineage', () => {
    const completed = replayEvents(scenario)
    const decisions = byType(completed, OntologyObjectType.DECISION)
    expect(decisions).toHaveLength(1)

    const decision = decisions[0]
    expect(decision.properties.minimumEvidenceSatisfied).toBe(true)
    expect(decision.properties.competitorCheckCompleted).toBe(true)
    expect(decision.properties.unresolvedConflicts).toEqual([])

    const lineage = decision.properties.lineageObjectIds as string[]
    const knownIds = new Set(completed.overlay.objects.map(({ id }) => id))
    expect(lineage.length).toBeGreaterThanOrEqual(4)
    expect(lineage.every((id) => knownIds.has(id))).toBe(true)
    expect((decision.properties.impactPath as string[]).length).toBeGreaterThan(1)
    expect((decision.properties.recoveryPath as string[]).length).toBeGreaterThan(1)
    expect(completed.conclusionDecisionId).toBe(decision.id)
  })

  it('rejects a Scenario whose Skill attempts ontology writes', () => {
    const invalid: OntologyScenarioDefinition = {
      ...scenario,
      catalog: {
        ...scenario.catalog,
        skillIds: [...scenario.catalog.skillIds, 'invalid_writing_skill'],
        overlay: {
          ...scenario.catalog.overlay,
          skills: [{
            skillId: 'invalid_writing_skill',
            functionId: 'fn.observation-query',
            ontologyReads: [OntologyObjectType.ASSET],
            ontologyWrites: [OntologyObjectType.DECISION] as never,
            resultMaterializedBy: 'RUNTIME',
          }],
        },
      },
    }
    expect(() => validateScenarioDefinition(invalid)).toThrow(/may not write/)
  })

  it('does not allow a historical cursor to seek past the live head', () => {
    let engine = createDiagnosisEngine(scenario)
    engine = engine.advance().advance().advance()
    const historical = engine.seek(1)

    expect(historical.seek(Number.MAX_SAFE_INTEGER).session.version).toBe(3)
  })

  it('recomputes root-cause support instead of trusting Decision booleans', () => {
    const invalid = structuredClone(scenario)
    const scoreEvent = invalid.events.find((event) =>
      event.mutation.patches?.some(
        (candidatePatch) =>
          candidatePatch.objectId === 'candidate.controller' &&
          candidatePatch.properties.supportScore === 96,
      ),
    )!
    const patch = scoreEvent.mutation.patches?.find(
      (candidatePatch) => candidatePatch.objectId === 'candidate.controller',
    )!
    patch.properties.supportScore = 70

    expect(() => replayEvents(invalid)).toThrow(/support/i)
  })

  it('rejects replans whose changes reference tasks not in the previous plan', () => {
    const invalid = structuredClone(scenario)
    const replan = invalid.events.find((event) =>
      event.mutation.upsertObjects?.some((object) => object.id === 'plan.mechanism.3'),
    )!
    const plan = replan.mutation.upsertObjects?.find(
      (object) => object.id === 'plan.mechanism.3',
    )!
    ;(plan.properties.changes as Array<Record<string, unknown>>).push({
      type: 'SUSPEND',
      taskId: 'task.does-not-exist',
      reason: 'invalid regression fixture',
    })

    expect(() => validateScenarioDefinition(invalid)).toThrow(/task\.does-not-exist/)
  })

  it('rejects confirmation when a minimum evidence category is absent', () => {
    const invalid = structuredClone(scenario)
    const finalCandidatePatch = invalid.events.flatMap((event) => event.mutation.patches ?? [])
      .find((patch) =>
        patch.objectId === 'candidate.controller' &&
        Array.isArray(patch.properties.evidenceIds) &&
        patch.properties.evidenceIds.includes('evidence.business-impact'),
      )!
    finalCandidatePatch.properties.evidenceIds = (
      finalCandidatePatch.properties.evidenceIds as string[]
    ).filter((id) => id !== 'evidence.watchdog')
    expect(() => replayEvents(invalid)).toThrow(/TRIGGER_MECHANISM/)
  })

  it('rejects confirmation when a competitor was not validly checked', () => {
    const invalid = structuredClone(scenario)
    const patch = invalid.events.flatMap((event) => event.mutation.patches ?? [])
      .find((value) => value.objectId === 'candidate.fc' && value.properties.status === 'WEAKENED')!
    patch.properties.status = 'ACTIVE'
    expect(() => replayEvents(invalid)).toThrow(/competitor check missing/)
  })

  it('rejects confirmation with declared or observed unresolved conflicts', () => {
    const declared = structuredClone(scenario)
    objectIn(declared, 'decision.root-cause').properties.unresolvedConflicts = ['conflict.clock']
    expect(() => replayEvents(declared)).toThrow(/unresolved conflicts/)

    const observed = structuredClone(scenario)
    const finalRootPatch = observed.events.flatMap((event) => event.mutation.patches ?? [])
      .find((patch) =>
        patch.objectId === 'candidate.controller' &&
        Array.isArray(patch.properties.missingEvidence) &&
        patch.properties.missingEvidence.length === 0,
      )!
    finalRootPatch.properties.status = 'CONFLICTING'
    expect(() => replayEvents(observed)).toThrow(/unresolved conflicts/)
  })

  it('rejects confirmation when temporal order or a declared path segment is missing', () => {
    const temporal = structuredClone(scenario)
    const fact = objectIn(temporal, 'fact.watchdog-log')
    ;(fact.properties.rawResult as Record<string, unknown>).timestamp =
      '2026-07-30T14:40:17.615+08:00'
    expect(() => replayEvents(temporal)).toThrow(/rawResult|temporal|later/)

    for (const [pathName, linkId] of [
      ['impactPath', 'lnk-impact-block-lun'],
      ['recoveryPath', 'lnk-recovery-lun-business'],
    ] as const) {
      const missingPath = structuredClone(scenario)
      const decisionEvent = objectEvent(missingPath, 'decision.root-cause')
      decisionEvent.mutation.upsertLinks = decisionEvent.mutation.upsertLinks?.filter(
        (link) => link.id !== linkId,
      )
      expect(() => replayEvents(missingPath)).toThrow(new RegExp(pathName))
    }
  })

  it('accepts an explicit tied-candidate PROBABLE_CAUSES protocol', () => {
    const probable = structuredClone(scenario)
    const convergence = probable.events.find((event) =>
      event.mutation.patches?.some((patch) => patch.objectId === 'candidate.fc' && patch.properties.status === 'WEAKENED'),
    )!
    const rootPatch = convergence.mutation.patches!.find((patch) => patch.objectId === 'candidate.controller')!
    const fcPatch = convergence.mutation.patches!.find((patch) => patch.objectId === 'candidate.fc')!
    rootPatch.properties.supportScore = 50
    rootPatch.properties.status = 'LEADING'
    fcPatch.properties.supportScore = 45
    fcPatch.properties.status = 'ACTIVE'
    const event = objectEvent(probable, 'decision.root-cause')
    event.type = EventType.DECISION_RECORDED
    event.title = 'Decision · 多个可能原因'
    delete event.mutation.patches
    event.mutation.upsertLinks = []
    const decision = objectIn(probable, 'decision.root-cause')
    decision.properties = {
      conclusion: ConclusionType.PROBABLE_CAUSES,
      rootCandidateId: null,
      rootObjectId: null,
      probableCandidateIds: ['candidate.controller', 'candidate.fc'],
      missingEvidence: ['区分控制器与 FC 的决定性证据'],
      nextTaskId: 'task.pool-deep',
      lineageObjectIds: ['candidate.controller', 'candidate.fc'],
      impactPath: [],
      recoveryPath: [],
    }
    const completed = replayEvents(probable)
    expect(byType(completed, OntologyObjectType.DECISION)[0].properties.conclusion)
      .toBe(ConclusionType.PROBABLE_CAUSES)
  })

  it.each([TaskStatus.PARTIAL, TaskStatus.FAILED, TaskStatus.DATA_MISSING])(
    'accepts INSUFFICIENT_EVIDENCE for a %s Function result',
    (status) => {
      const definition = structuredClone(monitoringGap)
      const result = definition.events.find((event) => event.type === EventType.FUNCTION_CALL_COMPLETED)!
      for (const patch of result.mutation.patches ?? []) patch.properties.status = status
      expect(replayEvents(definition).conclusionDecisionId).toBe('gap-decision')
    },
  )

  it('rejects INSUFFICIENT_EVIDENCE when no data is missing or blocked', () => {
    const invalid = structuredClone(monitoringGap)
    const result = invalid.events.find((event) => event.type === EventType.FUNCTION_CALL_COMPLETED)!
    for (const patch of result.mutation.patches ?? []) patch.properties.status = TaskStatus.SUCCEEDED
    expect(() => replayEvents(invalid)).toThrow(/requires failed\/partial\/missing data/)
  })

  it('instantiates the normalized symptom into the first Runtime Event', () => {
    const input = {
      objectType: 'BUSINESS',
      symptomCode: 'BUSINESS_LATENCY_INCREASE',
      occurredAt: '2026-08-01T10:20:30.000+08:00',
      businessScope: '数据库业务',
      description: '标准化后的本次真实输入',
    }
    const initialized = createDiagnosisEngine(scenario, input).advance().session
    const scenarioObject = byType(initialized, OntologyObjectType.SCENARIO)[0]
    expect(scenarioObject.properties).toMatchObject({
      symptomCode: input.symptomCode,
      normalizedDescription: input.description,
      occurredAt: input.occurredAt,
      businessScope: input.businessScope,
    })
  })

  it('rejects production events that bypass Task/Function/Skill/Action ordering', () => {
    const mismatchedCall = structuredClone(scenario)
    objectIn(mismatchedCall, 'task.mapping').properties.operationId = 'call.other'
    expect(() => replayEvents(mismatchedCall)).toThrow(/does not target Function Call/)

    const skillWritesCandidate = structuredClone(scenario)
    const result = skillWritesCandidate.events.find(
      (event) => event.type === EventType.FUNCTION_CALL_COMPLETED &&
        event.mutation.patches?.some((patch) => patch.objectId === 'call.mapping'),
    )!
    result.mutation.upsertObjects = [structuredClone(objectIn(scenario, 'candidate.controller'))]
    expect(() => replayEvents(skillWritesCandidate)).toThrow(/raw result\/Observation|object mutation/)

    const skillBypassesResult = structuredClone(scenario)
    const candidateEvent = objectEvent(skillBypassesResult, 'candidate.controller')
    candidateEvent.source = 'FUNCTION'
    expect(() => replayEvents(skillBypassesResult)).toThrow(/raw Function result event|source FUNCTION is not allowed/)

    const unknownAction = structuredClone(scenario)
    objectIn(unknownAction, 'proposal.maintenance').properties.actionId = 'action.unregistered'
    expect(() => replayEvents(unknownAction)).toThrow(/unknown or unsafe Action/)
  })

  it('runs a second minimal Scenario through the same loader/runtime to a different terminal', () => {
    const completed = replayEvents(monitoringGap)
    const decisions = byType(completed, OntologyObjectType.DECISION)
    expect(decisions).toHaveLength(1)
    expect(decisions[0].properties.conclusion).toBe(ConclusionType.INSUFFICIENT_EVIDENCE)
    expect(byType(completed, OntologyObjectType.CANDIDATE)).toHaveLength(0)
  })

  it.each([
    EventType.DIAGNOSIS_INITIALIZED,
    EventType.PLAN_CREATED,
    EventType.FUNCTION_CALL_COMPLETED,
    EventType.FACT_DISCOVERED,
    EventType.EVIDENCE_CREATED,
    EventType.CANDIDATE_UPDATED,
    EventType.PLAN_REPLANNED,
  ])('rejects Decision injection through non-terminal %s', (type) => {
    const invalid = structuredClone(scenario)
    const event = eventOfType(invalid, type)
    const forged = structuredClone(objectIn(invalid, 'decision.root-cause'))
    forged.id = `forged.${type}`
    event.mutation.upsertObjects = [...(event.mutation.upsertObjects ?? []), forged]

    expect(() => validateScenarioDefinition(invalid)).toThrow(/not allowed|Decision|mutation/i)
  })

  it.each([
    EventType.DIAGNOSIS_INITIALIZED,
    EventType.PLAN_CREATED,
    EventType.FUNCTION_CALL_COMPLETED,
    EventType.FACT_DISCOVERED,
    EventType.EVIDENCE_CREATED,
    EventType.CANDIDATE_UPDATED,
    EventType.PLAN_REPLANNED,
  ])('rejects conclusionDecisionId injection through non-terminal %s', (type) => {
    const invalid = structuredClone(scenario)
    eventOfType(invalid, type).mutation.conclusionDecisionId = 'decision.root-cause'
    expect(() => validateScenarioDefinition(invalid)).toThrow(/conclusionDecisionId|mutation/i)
  })

  it.each([
    EventType.DIAGNOSIS_INITIALIZED,
    EventType.PLAN_CREATED,
    EventType.FUNCTION_CALL_COMPLETED,
    EventType.FACT_DISCOVERED,
    EventType.EVIDENCE_CREATED,
    EventType.CANDIDATE_UPDATED,
    EventType.PLAN_REPLANNED,
  ])('rejects terminal phase injection through non-terminal %s', (type) => {
    const invalid = structuredClone(scenario)
    eventOfType(invalid, type).mutation.phase = DiagnosisPhase.DIAGNOSIS_REVIEW
    expect(() => validateScenarioDefinition(invalid)).toThrow(/phase|mutation/i)
  })

  it('rejects extra Function Call and Task patches in FUNCTION_CALL_COMPLETED', () => {
    for (const objectId of ['call.mapping', 'task.mapping']) {
      const invalid = structuredClone(scenario)
      const event = invalid.events.find((candidate) =>
        candidate.type === EventType.FUNCTION_CALL_COMPLETED &&
        candidate.mutation.patches?.some((patch) => patch.objectId === 'call.topology'),
      )!
      event.mutation.patches!.push({
        objectId,
        properties: { status: TaskStatus.SUCCEEDED },
      })
      expect(() => validateScenarioDefinition(invalid)).toThrow(/exactly|only|unique/i)
    }
  })

  it('rejects an Observation attached to a different Function Call result', () => {
    const invalid = structuredClone(scenario)
    const event = eventOfType(invalid, EventType.FUNCTION_CALL_COMPLETED)
    event.mutation.upsertObjects = [structuredClone(objectIn(invalid, 'observation.watchdog-log'))]
    expect(() => validateScenarioDefinition(invalid)).toThrow(/Observation|Function Call/i)
  })

  it.each([
    ['skillId', 'forged_skill'],
    ['functionCallId', 'call.topology'],
    ['observationIds', ['observation.watchdog-log']],
    ['objectIds', ['controller-0b']],
    ['rawResult', { forged: true }],
  ] as const)('rejects forged Fact %s lineage/payload', (property, value) => {
    const invalid = structuredClone(scenario)
    const fact = objectIn(invalid, 'fact.controller-reset-alarm')
    fact.properties[property] = structuredClone(value) as never
    expect(() => validateScenarioDefinition(invalid)).toThrow(/Fact|rawResult|lineage|target|Observation|Skill/i)
  })

  it('rejects Evidence whose candidate property and support Link disagree', () => {
    const invalid = structuredClone(scenario)
    objectIn(invalid, 'evidence.direct-reset').properties.candidateId = 'candidate.fc'
    expect(() => validateScenarioDefinition(invalid)).toThrow(/Evidence|Candidate|SUPPORTS/i)
  })

  it.each([
    ['lnk-task-alarm-call', 'targetId', 'call.topology'],
    ['lnk-fact-reset-produced', 'targetId', 'call.topology'],
    ['lnk-fact-reset-observation', 'targetId', 'observation.watchdog-log'],
    ['lnk-evidence-direct-derived', 'targetId', 'fact.topology'],
    ['lnk-decision-direct', 'targetId', 'evidence.watchdog'],
  ] as const)('rejects broken Fact/Call/Task/Evidence/Decision Link %s', (linkId, field, value) => {
    const invalid = structuredClone(scenario)
    const link = invalid.events.flatMap((event) => event.mutation.upsertLinks ?? [])
      .find((candidate) => candidate.id === linkId)!
    link[field] = value
    expect(() => validateScenarioDefinition(invalid)).toThrow(/lineage|Link|derive|BASED_ON|Function Call/i)
  })

  it('rejects a root Candidate that claims another Candidate Evidence', () => {
    const invalid = structuredClone(scenario)
    const finalRootPatch = invalid.events.flatMap((event) => event.mutation.patches ?? [])
      .find((patch) =>
        patch.objectId === 'candidate.controller' &&
        Array.isArray(patch.properties.evidenceIds) &&
        patch.properties.evidenceIds.includes('evidence.business-impact'),
      )!
    ;(finalRootPatch.properties.evidenceIds as string[]).push('evidence.fc-healthy')
    expect(() => validateScenarioDefinition(invalid)).toThrow(/root Candidate|belongs|Evidence/i)
  })

  it.each([
    ['planId', 'plan.mechanism.3'],
    ['status', TaskStatus.RUNNING],
  ] as const)('rejects Action Task with invalid current Plan/status %s', (property, value) => {
    const invalid = structuredClone(scenario)
    objectIn(invalid, 'task.action-proposal').properties[property] = value
    expect(() => validateScenarioDefinition(invalid)).toThrow(/Action|current Plan|status|APPROVAL_REQUIRED/i)
  })

  it('rejects ACTION_PROPOSED from a non-Planner source', () => {
    const invalid = structuredClone(scenario)
    eventOfType(invalid, EventType.ACTION_PROPOSED).source = 'REASONING'
    expect(() => validateScenarioDefinition(invalid)).toThrow(/source|ACTION_PROPOSED/i)
  })

  it('requires each replan to have exactly one reached trigger Evidence', () => {
    const missing = structuredClone(scenario)
    const second = missing.events.filter((event) => event.type === EventType.PLAN_REPLANNED)[1]
    second.mutation.upsertLinks = second.mutation.upsertLinks?.filter(
      (link) => link.type !== 'BASED_ON',
    )
    const secondPlan = second.mutation.upsertObjects?.find(
      (object) => object.type === OntologyObjectType.PLAN,
    )!
    delete secondPlan.properties.triggerEvidenceId
    expect(() => validateScenarioDefinition(missing)).toThrow(/trigger Evidence/i)

    const future = structuredClone(scenario)
    const first = future.events.find((event) => event.type === EventType.PLAN_REPLANNED)!
    first.mutation.upsertLinks!.find((link) => link.type === 'BASED_ON')!.targetId =
      'evidence.business-impact'
    expect(() => validateScenarioDefinition(future)).toThrow(/unknown object|reached trigger Evidence/i)

    const duplicate = structuredClone(scenario)
    const duplicateSecond = duplicate.events.filter(
      (event) => event.type === EventType.PLAN_REPLANNED,
    )[1]
    duplicateSecond.mutation.upsertLinks!.push({
      id: 'duplicate-trigger',
      type: 'BASED_ON' as never,
      sourceId: 'plan.competitors.4',
      targetId: 'evidence.watchdog',
      properties: {},
      provenance: { source: 'RUNTIME', sourceRef: 'test' },
      scenarioId: duplicate.scenarioId,
    })
    expect(() => validateScenarioDefinition(duplicate)).toThrow(/exactly one trigger Evidence/i)
  })

  it('rejects malformed schema, source, object/link enums and provenance at direct entry', () => {
    const mutations: Array<(definition: OntologyScenarioDefinition) => void> = [
      (definition) => { definition.schemaVersion = '666.0.0' },
      (definition) => { eventOfType(definition, EventType.DIAGNOSIS_INITIALIZED).source = 'MALICIOUS' as never },
      (definition) => { eventOfType(definition, EventType.DIAGNOSIS_INITIALIZED).type = 'EVIL' as never },
      (definition) => { eventOfType(definition, EventType.DIAGNOSIS_INITIALIZED).mutation.phase = 'EVIL' as never },
      (definition) => { objectIn(definition, definition.scenarioId).type = 'EVIL' as never },
      (definition) => { eventOfType(definition, EventType.DIAGNOSIS_INITIALIZED).mutation.upsertLinks![0].type = 'EVIL' as never },
      (definition) => { eventOfType(definition, EventType.DIAGNOSIS_INITIALIZED).mutation.upsertLinks![0].type = 'UNKNOWN' as never },
      (definition) => { objectIn(definition, definition.scenarioId).provenance.source = 'MALICIOUS' as never },
      (definition) => { objectIn(definition, 'candidate.controller').properties.status = 'UNKNOWN' },
      (definition) => { definition.caseId = '' },
    ]
    for (const mutate of mutations) {
      const invalid = structuredClone(scenario)
      mutate(invalid)
      expect(() => validateScenarioDefinition(invalid)).toThrow()
    }
  })

  it('rejects MALICIOUS source and EVIL object/link through direct Runtime calls', () => {
    const engine = createDiagnosisEngine(scenario).advance()
    for (const mutate of [
      (event: typeof scenario.events[number]) => { event.source = 'MALICIOUS' as never },
      (event: typeof scenario.events[number]) => { event.mutation.upsertObjects![0].type = 'EVIL' as never },
      (event: typeof scenario.events[number]) => { event.mutation.upsertLinks![0].type = 'EVIL' as never },
    ]) {
      const event = structuredClone(scenario.events[1])
      event.mutation.upsertObjects = [structuredClone(objectIn(scenario, 'task.mapping'))]
      event.mutation.upsertLinks = [structuredClone(objectEvent(scenario, 'task.mapping').mutation.upsertLinks![0])]
      mutate(event)
      expect(() => applyRuntimeEvent(engine.session, event)).toThrow()
    }
  })

  it('shifts the complete Case timeline by one delta and keeps referenced times monotonic', () => {
    const input = {
      objectType: 'BUSINESS',
      symptomCode: 'BUSINESS_LATENCY_INCREASE',
      occurredAt: '2026-08-01T10:20:30.000+08:00',
      businessScope: '数据库业务',
      description: '整体时间轴实例化',
    }
    const engine = createDiagnosisEngine(scenario, input)
    const originalStart = Date.parse(scenario.events[0].occurredAt)
    const delta = Date.parse(input.occurredAt) - originalStart
    expect(engine.definition.events.map((event) => Date.parse(event.occurredAt)))
      .toEqual(scenario.events.map((event) => Date.parse(event.occurredAt) + delta))

    const originalFact = objectIn(scenario, 'fact.controller-reset-alarm')
    const shiftedFact = objectIn(engine.definition, 'fact.controller-reset-alarm')
    expect(Date.parse(String((shiftedFact.properties.rawResult as Record<string, unknown>).occurredAt)))
      .toBe(Date.parse(String((originalFact.properties.rawResult as Record<string, unknown>).occurredAt)) + delta)
    expect(() => replayEvents(engine.definition)).not.toThrow()
  })

  it('rejects non-monotonic event and Fact-after-Evidence timestamps', () => {
    const events = structuredClone(scenario)
    events.events[1].occurredAt = '2020-01-01T00:00:00.000Z'
    expect(() => validateScenarioDefinition(events)).toThrow(/monotonic/i)

    const live = createDiagnosisEngine(scenario).advance()
    const direct = structuredClone(scenario.events[1])
    direct.occurredAt = '2020-01-01T00:00:00.000Z'
    expect(() => applyRuntimeEvent(live.session, direct)).toThrow(/monotonic/i)

    const factTime = structuredClone(scenario)
    objectIn(factTime, 'fact.controller-reset-alarm').provenance.observedAt =
      '2030-01-01T00:00:00.000Z'
    expect(() => validateScenarioDefinition(factTime)).toThrow(/Fact.*later|temporal/i)
  })
})

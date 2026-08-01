import {
  ConclusionType,
  ActionProposalStatus,
  CandidateStatus,
  FunctionEffect,
  OntologyObjectType,
  PlannerOperationKind,
  TaskStatus,
} from '../../schemas/enums'
import type {
  ActionProposalProperties,
  CandidateProperties,
  DecisionProperties,
  EvidenceProperties,
  FactProperties,
  FunctionCallProperties,
  OntologyObject,
  TaskProperties,
} from '../../schemas/types'

export type CandidateObject = OntologyObject<CandidateProperties> & { type: OntologyObjectType.CANDIDATE }
export type EvidenceObject = OntologyObject<EvidenceProperties> & { type: OntologyObjectType.EVIDENCE }
export type FactObject = OntologyObject<FactProperties> & { type: OntologyObjectType.FACT }
export type TaskObject = OntologyObject<TaskProperties> & { type: OntologyObjectType.TASK }
export type FunctionCallObject = OntologyObject<FunctionCallProperties> & { type: OntologyObjectType.FUNCTION_CALL }
export type ActionProposalObject = OntologyObject<ActionProposalProperties> & { type: OntologyObjectType.ACTION_PROPOSAL }
export type DecisionObject = OntologyObject<DecisionProperties> & { type: OntologyObjectType.DECISION }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function assertCriticalOntologyObject(object: OntologyObject): void {
  const properties = object.properties
  switch (object.type) {
    case OntologyObjectType.SCENARIO:
      if (
        typeof properties.symptomCode !== 'string' ||
        typeof properties.occurredAt !== 'string' ||
        Number.isNaN(Date.parse(properties.occurredAt))
      ) throw new Error(`[scenario] Scenario ${object.id} has invalid symptom/time properties`)
      break
    case OntologyObjectType.OBSERVATION:
      if (
        typeof properties.observationKind !== 'string' ||
        typeof properties.functionCallId !== 'string' ||
        !Array.isArray(properties.objectIds) ||
        typeof properties.observedAt !== 'string' || Number.isNaN(Date.parse(properties.observedAt)) ||
        properties.rawValue === undefined
      ) throw new Error(`[scenario] Observation ${object.id} has invalid Call/target/time properties`)
      break
    case OntologyObjectType.CANDIDATE:
      if (typeof properties.objectId !== 'string' || typeof properties.supportScore !== 'number') {
        throw new Error(`[scenario] Candidate ${object.id} has invalid objectId/supportScore`)
      }
      if (
        properties.supportScore < 0 || properties.supportScore > 100 ||
        !Object.values(CandidateStatus).includes(properties.status as CandidateStatus) ||
        !Array.isArray(properties.evidenceIds) || !Array.isArray(properties.missingEvidence)
      ) throw new Error(`[scenario] Candidate ${object.id} has invalid state`)
      break
    case OntologyObjectType.EVIDENCE:
      if (typeof properties.factId !== 'string' || typeof properties.candidateId !== 'string') {
        throw new Error(`[scenario] Evidence ${object.id} has invalid Fact/Candidate references`)
      }
      if (!['SUPPORTS', 'WEAKENS', 'CONFLICTS', 'NEUTRAL'].includes(String(properties.relation))) {
        throw new Error(`[scenario] Evidence ${object.id} has invalid relation`)
      }
      if (
        typeof properties.category !== 'string' || typeof properties.strength !== 'string' ||
        typeof properties.explanation !== 'string' || typeof properties.scoreDelta !== 'number'
      ) throw new Error(`[scenario] Evidence ${object.id} has invalid evidence attributes`)
      break
    case OntologyObjectType.FACT:
      if (
        typeof properties.skillId !== 'string' || typeof properties.functionCallId !== 'string' ||
        !Array.isArray(properties.objectIds) || !Array.isArray(properties.observationIds) ||
        properties.rawResult === undefined
      ) {
        throw new Error(`[scenario] Fact ${object.id} has invalid Function Call lineage`)
      }
      break
    case OntologyObjectType.PLAN:
      if (
        typeof properties.round !== 'number' || properties.round < 1 ||
        typeof properties.goal !== 'string' || typeof properties.selectionReason !== 'string' ||
        !Array.isArray(properties.expectedEvidence) || !Array.isArray(properties.taskIds) ||
        !Array.isArray(properties.changes) ||
        !(typeof properties.previousPlanId === 'string' || properties.previousPlanId === null)
      ) throw new Error(`[scenario] Plan ${object.id} has invalid plan properties`)
      break
    case OntologyObjectType.TASK:
      if (!Object.values(PlannerOperationKind).includes(properties.operationKind as PlannerOperationKind)) {
        throw new Error(`[scenario] Task ${object.id} has no valid planner operation kind`)
      }
      if (typeof properties.operationId !== 'string' || typeof properties.planId !== 'string') {
        throw new Error(`[scenario] Task ${object.id} has invalid operation/plan reference`)
      }
      if (
        !Array.isArray(properties.targetObjectIds) || !Array.isArray(properties.targetCandidateIds) ||
        !Array.isArray(properties.expectedEvidence)
      ) throw new Error(`[scenario] Task ${object.id} has invalid targets/evidence`)
      if (
        !Object.values(TaskStatus).includes(properties.status as TaskStatus) ||
        typeof properties.priority !== 'number' || properties.priority < 0 || properties.priority > 100
      ) throw new Error(`[scenario] Task ${object.id} has invalid status/priority`)
      break
    case OntologyObjectType.FUNCTION_CALL:
      if (typeof properties.functionId !== 'string' || typeof properties.taskId !== 'string') {
        throw new Error(`[scenario] Function Call ${object.id} has invalid definition/task reference`)
      }
      if (
        properties.effect !== FunctionEffect.READ_ONLY ||
        !Object.values(TaskStatus).includes(properties.status as TaskStatus) ||
        typeof properties.skillId !== 'string' || !Array.isArray(properties.targetObjectIds) ||
        properties.rawResult === undefined
      ) throw new Error(`[scenario] Function Call ${object.id} has invalid effect/status`)
      break
    case OntologyObjectType.ACTION_PROPOSAL:
      if (typeof properties.actionId !== 'string' || typeof properties.taskId !== 'string') {
        throw new Error(`[scenario] Action Proposal ${object.id} has invalid definition/task reference`)
      }
      if (properties.status !== ActionProposalStatus.APPROVAL_REQUIRED) {
        throw new Error(`[scenario] Action Proposal ${object.id} is not approval gated`)
      }
      if (!Array.isArray(properties.targetObjectIds) || typeof properties.rationale !== 'string') {
        throw new Error(`[scenario] Action Proposal ${object.id} has invalid targets/rationale`)
      }
      break
    case OntologyObjectType.DECISION: {
      const conclusion = properties.conclusion
      if (!Object.values(ConclusionType).includes(conclusion as ConclusionType)) {
        throw new Error(`[scenario] Decision ${object.id} has invalid conclusion`)
      }
      if (!Array.isArray(properties.lineageObjectIds)) {
        throw new Error(`[scenario] Decision ${object.id} has no lineage`)
      }
      if (!Array.isArray(properties.impactPath) || !Array.isArray(properties.recoveryPath)) {
        throw new Error(`[scenario] Decision ${object.id} has invalid paths`)
      }
      break
    }
  }
  if (!isRecord(properties)) throw new Error(`[scenario] ${object.id} properties are invalid`)
}

export function objectsOfType<T extends OntologyObjectType>(
  objects: OntologyObject[],
  type: T,
): Array<OntologyObject & { type: T }> {
  return objects.filter((object): object is OntologyObject & { type: T } => object.type === type)
}

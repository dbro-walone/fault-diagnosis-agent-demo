import {
  OntologyObjectType,
  PlannerOperationKind,
} from '../../schemas/enums'
import type { OntologyObject, PlannerOperation } from '../../schemas/types'

/** Parse a data-authored Task into the operation the Planner is proposing. */
export function plannerOperation(task: OntologyObject): PlannerOperation {
  if (task.type !== OntologyObjectType.TASK) {
    throw new Error(`[planner] ${task.id} is not a Task`)
  }
  const kind = task.properties.operationKind as PlannerOperationKind
  if (!Object.values(PlannerOperationKind).includes(kind)) {
    throw new Error(`[planner] Task ${task.id} has invalid operationKind`)
  }
  const objectId = String(task.properties.operationId ?? '')
  if (!objectId) throw new Error(`[planner] Task ${task.id} has no operationId`)
  return { kind, objectId }
}

export function assertOperationTarget(
  operation: PlannerOperation,
  target: OntologyObject,
): void {
  if (
    operation.kind === PlannerOperationKind.FUNCTION_CALL &&
    target.type !== OntologyObjectType.FUNCTION_CALL
  ) {
    throw new Error('[planner] Function Call task must target a FUNCTION_CALL object')
  }
  if (
    operation.kind === PlannerOperationKind.ACTION_PROPOSAL &&
    target.type !== OntologyObjectType.ACTION_PROPOSAL
  ) {
    throw new Error('[planner] Action Proposal task must target an ACTION_PROPOSAL object')
  }
}

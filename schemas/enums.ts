// Centralized enumeration definitions for the fault diagnosis domain.
// All enums are string-based for stable serialization (Runtime events,
// session snapshots, history replay) independent of build-time ordering.

/** Lifecycle state of a single plan task. */
export enum TaskStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  PARTIAL = 'PARTIAL',
  DATA_MISSING = 'DATA_MISSING',
}

/** Lifecycle state of a root-cause candidate hypothesis. */
export enum CandidateStatus {
  ACTIVE = 'ACTIVE',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  DEPLETED = 'DEPLETED',
}

/** Coarse-grained phase the user-facing session is currently in. */
export enum DiagnosisPhase {
  MODEL_OVERVIEW = 'MODEL_OVERVIEW',
  DIAGNOSIS_INPUT = 'DIAGNOSIS_INPUT',
  SESSION_INITIALIZING = 'SESSION_INITIALIZING',
  DIAGNOSING = 'DIAGNOSING',
  DIAGNOSIS_REVIEW = 'DIAGNOSIS_REVIEW',
}

/** Outcome of routing a normalized symptom against known Case profiles. */
export enum RouteStatus {
  MATCHED = 'MATCHED',
  AMBIGUOUS = 'AMBIGUOUS',
  NOT_MATCHED = 'NOT_MATCHED',
  INVALID_INPUT = 'INVALID_INPUT',
}

/** Discriminator for the Runtime event stream (unified event chain). */
export enum EventType {
  PLAN_CREATED = 'PLAN_CREATED',
  PLAN_REPLANNED = 'PLAN_REPLANNED',
  TASK_SUBMITTED = 'TASK_SUBMITTED',
  SKILL_STARTED = 'SKILL_STARTED',
  SKILL_COMPLETED = 'SKILL_COMPLETED',
  SKILL_FAILED = 'SKILL_FAILED',
  FACT_CREATED = 'FACT_CREATED',
  EVIDENCE_CREATED = 'EVIDENCE_CREATED',
  CANDIDATE_UPDATED = 'CANDIDATE_UPDATED',
  CONCLUSION_REACHED = 'CONCLUSION_REACHED',
}

/** Final diagnosis verdict once the confirmation rules resolve. */
export enum ConclusionType {
  ROOT_CAUSE_CONFIRMED = 'ROOT_CAUSE_CONFIRMED',
  PROBABLE_CAUSES = 'PROBABLE_CAUSES',
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
}

/** Direction in which a piece of evidence bears on a candidate. */
export enum EvidenceRelation {
  SUPPORTS = 'SUPPORTS',
  WEAKENS = 'WEAKENS',
  CONFLICTS = 'CONFLICTS',
  NEUTRAL = 'NEUTRAL',
}

// Core semantic objects for the fault diagnosis domain.
//
// Strict separation rule (see project铁律): Fact, Evidence, Candidate and
// Conclusion are distinct concepts and must never collapse into one another.
//   - Fact:       raw + structured data a Skill actually returned.
//   - Evidence:   a diagnostic explanation linking a Fact to a Candidate.
//   - Candidate:  an as-yet-unverified root-cause hypothesis.
//   - Conclusion: the outcome after confirmation rules resolve.
//
// Timestamps are ISO-8601 strings. The frontend must NOT compute support
// scores, candidates, or root causes itself — only Runtime events may.

import {
  CandidateStatus,
  ConclusionType,
  DiagnosisPhase,
  EvidenceRelation,
  EventType,
  TaskStatus,
} from './enums';

/** A root-cause hypothesis awaiting validation. */
export interface Candidate {
  id: string;
  name: string;
  description: string;
  /** Support score in the range 0–100. Not a probability; UI shows no '%'. */
  supportScore: number;
  status: CandidateStatus;
  /** IDs of Evidence records that bear on this candidate. */
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** Structured data a Skill actually returned (a Fact is observed, not inferred). */
export interface Fact {
  id: string;
  taskId: string;
  skillId: string;
  /** Topology/knowledge-graph object IDs this fact pertains to. */
  objectIds: string[];
  rawResult: any;
  structuredData: any;
  timestamp: string;
  source: string;
}

/** A diagnostic explanation linking a Fact to a Candidate. */
export interface Evidence {
  id: string;
  factId: string;
  candidateId: string;
  /** Candidate name at time of evidence creation (for matching before candidate ID is known). */
  candidateName: string;
  relation: EvidenceRelation;
  explanation: string;
  /** Weight of this relation, in the range 0–1. */
  weight: number;
  timestamp: string;
}

/** A single task within a plan, to be executed by a Skill. */
export interface PlanTask {
  id: string;
  skillType: string;
  targetObjectIds: string[];
  reason: string;
  expectedEvidence: string;
  status: TaskStatus;
}

/** A Planner output: the set of tasks for one diagnostic round. */
export interface Plan {
  id: string;
  round: number;
  tasks: PlanTask[];
  goal: string;
  selectionReason: string;
  createdAt: string;
}

/** Description of what changed between two consecutive plans (replan reason). */
export interface ReplanDiff {
  oldPlanId: string;
  newPlanId: string;
  triggerEvidenceId: string;
  changes: string[];
  replannedAt: string;
}

/** One entry in the unified Runtime event stream. */
export interface RuntimeEvent {
  id: string;
  /** Monotonic sequence number for ordering / history replay. */
  seq: number;
  type: EventType;
  timestamp: string;
  payload: any;
}

/** A full, replayable diagnosis session. */
export interface DiagnosisSession {
  id: string;
  caseId: string;
  status: DiagnosisPhase;
  currentRound: number;
  candidates: Candidate[];
  evidence: Evidence[];
  facts: Fact[];
  plans: Plan[];
  events: RuntimeEvent[];
  conclusion: ConclusionType | null;
  /** Null until the confirmation rules resolve a single root cause. */
  rootCause: string | null;
  startedAt: string;
  updatedAt: string;
}

/** Return value of executing a Skill against a task. */
export interface SkillResult {
  skillId: string;
  taskType: string;
  success: boolean;
  data: any;
  error: string | null;
  timestamp: string;
}

/** Output of normalizing a free-text symptom into a structured form. */
export interface NormalizedSymptom {
  objectType: string;
  symptomCode: string;
  occurredAt: string;
  businessScope: string;
  description: string;
}

/** A supported symptom entry within a CaseRouteProfile. */
export interface SupportedSymptom {
  objectType: string;
  symptomCode: string;
  aliases: string[];
}

/** Routing profile describing how a Case matches user symptoms. */
export interface CaseRouteProfile {
  caseId: string;
  supportedSymptoms: SupportedSymptom[];
  supportedScopes: string[];
  requiredInputs: string[];
  priority: number;
}

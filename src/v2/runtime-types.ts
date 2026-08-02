/**
 * Diagnosis Runtime V2 — 统一状态与事件协议类型定义
 *
 * 本文件是 V2 运行时的唯一工程契约类型层（docs/02 §3-§13、
 * schemas/runtime_contract.schema.json）。所有枚举与结构体均与 Runtime Contract
 * 对齐，且严格遵循四层状态隔离（铁律）：
 *
 *   Source State → Ontology State → Diagnosis State → Projection State
 *
 * 关键约束：
 * - 诊断支持分 0-100，不是概率/置信度，不使用百分号；
 * - 禁止出现 `confidence` / `initial_confidence` 字段（V1 遗留）；
 * - Evidence 必须通过 fact_refs 追溯 Fact，禁止复制伪造原始值；
 * - agent_focus 只能由 Runtime 更新；user_selection 属于 Projection Store。
 *
 * 枚举统一使用 `as const` 对象 + 联合类型，既提供运行时字面量，又兼容
 * isolatedModules / bundler 模块解析。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 枚举（核心口径，与 CLAUDE.md / schemas 对齐）
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical Fact 类型（docs/02 §6）。 */
export const FactType = {
  ALARM: 'ALARM',
  LOG: 'LOG',
  LOG_FINGERPRINT: 'LOG_FINGERPRINT',
  KPI_WINDOW: 'KPI_WINDOW',
  TOPOLOGY_RELATION: 'TOPOLOGY_RELATION',
  RESOURCE_STATE: 'RESOURCE_STATE',
  ABSENCE: 'ABSENCE',
  SIMILAR_CASE_REFERENCE: 'SIMILAR_CASE_REFERENCE',
} as const
export type FactType = (typeof FactType)[keyof typeof FactType]

/** 候选根因状态（docs/02 §8、docs/10 §7）。 */
export const CandidateStatus = {
  INITIAL: 'INITIAL',
  ACTIVE: 'ACTIVE',
  LEADING: 'LEADING',
  WEAKENED: 'WEAKENED',
  CONFLICTING: 'CONFLICTING',
  CONFIRMED: 'CONFIRMED',
  NOT_CONFIRMED: 'NOT_CONFIRMED',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
} as const
export type CandidateStatus = (typeof CandidateStatus)[keyof typeof CandidateStatus]

/** 任务状态（docs/08 §7）。 */
export const TaskStatus = {
  PLANNED: 'PLANNED',
  READY: 'READY',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  PARTIAL: 'PARTIAL',
  DATA_MISSING: 'DATA_MISSING',
  CANCELLED: 'CANCELLED',
  SKIPPED: 'SKIPPED',
} as const
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus]

/** 证据作用（docs/02 §7、docs/10 §4）。 */
export const EvidenceEffect = {
  STRONG_SUPPORT: 'STRONG_SUPPORT',
  SUPPORT: 'SUPPORT',
  WEAKEN: 'WEAKEN',
  CONFLICT: 'CONFLICT',
  NEUTRAL: 'NEUTRAL',
} as const
export type EvidenceEffect = (typeof EvidenceEffect)[keyof typeof EvidenceEffect]

/** 运行时模式（docs/02 §1）。 */
export const RuntimeMode = {
  LIVE: 'LIVE',
  PAUSED: 'PAUSED',
  REPLAY: 'REPLAY',
} as const
export type RuntimeMode = (typeof RuntimeMode)[keyof typeof RuntimeMode]

/** 证据质量等级（由 V1 evidence.quality 映射）。 */
export const EvidenceQuality = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
} as const
export type EvidenceQuality = (typeof EvidenceQuality)[keyof typeof EvidenceQuality]

/** 最小证据链条目状态（docs/02 §9）。 */
export const ChainItemStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  SATISFIED: 'SATISFIED',
  CONFLICTING: 'CONFLICTING',
  UNAVAILABLE: 'UNAVAILABLE',
} as const
export type ChainItemStatus = (typeof ChainItemStatus)[keyof typeof ChainItemStatus]

/** 诊断阶段（docs/08 §3）。 */
export const DiagnosisPhase = {
  INPUT_COMPLETION: 'INPUT_COMPLETION',
  SYMPTOM_VALIDATION: 'SYMPTOM_VALIDATION',
  SCOPE_LOCALIZATION: 'SCOPE_LOCALIZATION',
  CANDIDATE_GENERATION: 'CANDIDATE_GENERATION',
  CANDIDATE_EVIDENCE: 'CANDIDATE_EVIDENCE',
  COMPETING_EXPLANATION: 'COMPETING_EXPLANATION',
  CONCLUSION_CHECK: 'CONCLUSION_CHECK',
  SUPPLEMENTARY_PLANNING: 'SUPPLEMENTARY_PLANNING',
} as const
export type DiagnosisPhase = (typeof DiagnosisPhase)[keyof typeof DiagnosisPhase]

/** 终态（docs/01 §7）。 */
export const TerminalStatus = {
  ROOT_CAUSE_CONFIRMED: 'ROOT_CAUSE_CONFIRMED',
  PROBABLE_CAUSES: 'PROBABLE_CAUSES',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
} as const
export type TerminalStatus = (typeof TerminalStatus)[keyof typeof TerminalStatus]

/** Runtime Event 类型（docs/02 §5）。 */
export const EventType = {
  // 会话与输入
  DIAGNOSIS_SESSION_CREATED: 'DIAGNOSIS_SESSION_CREATED',
  USER_QUESTION_REQUESTED: 'USER_QUESTION_REQUESTED',
  USER_QUESTION_ANSWERED: 'USER_QUESTION_ANSWERED',
  SYMPTOM_NORMALIZED: 'SYMPTOM_NORMALIZED',
  RESOURCE_MAPPED: 'RESOURCE_MAPPED',
  DIAGNOSIS_PHASE_CHANGED: 'DIAGNOSIS_PHASE_CHANGED',
  // 计划与执行
  PLAN_CREATED: 'PLAN_CREATED',
  PLAN_REPLANNED: 'PLAN_REPLANNED',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  SKILL_STARTED: 'SKILL_STARTED',
  SKILL_COMPLETED: 'SKILL_COMPLETED',
  SKILL_FAILED: 'SKILL_FAILED',
  // 事实与推理
  FACT_DISCOVERED: 'FACT_DISCOVERED',
  FACT_QUALITY_UPDATED: 'FACT_QUALITY_UPDATED',
  EVIDENCE_CREATED: 'EVIDENCE_CREATED',
  CANDIDATES_GENERATED: 'CANDIDATES_GENERATED',
  CANDIDATE_UPDATED: 'CANDIDATE_UPDATED',
  CONFLICT_DETECTED: 'CONFLICT_DETECTED',
  CONFLICT_RESOLVED: 'CONFLICT_RESOLVED',
  MINIMUM_CHAIN_UPDATED: 'MINIMUM_CHAIN_UPDATED',
  // 终态与控制
  ROOT_CAUSE_CONFIRMED: 'ROOT_CAUSE_CONFIRMED',
  PROBABLE_CAUSES_REPORTED: 'PROBABLE_CAUSES_REPORTED',
  INSUFFICIENT_EVIDENCE_REPORTED: 'INSUFFICIENT_EVIDENCE_REPORTED',
  DIAGNOSIS_PAUSED: 'DIAGNOSIS_PAUSED',
  DIAGNOSIS_RESUMED: 'DIAGNOSIS_RESUMED',
  DIAGNOSIS_COMPLETED: 'DIAGNOSIS_COMPLETED',
} as const
export type EventType = (typeof EventType)[keyof typeof EventType]

// ─────────────────────────────────────────────────────────────────────────────
// 来源 / 质量 / 覆盖
// ─────────────────────────────────────────────────────────────────────────────

/** 查询覆盖度（docs/02 §6、docs/09 §9）。 */
export interface QueryCoverage {
  object_coverage?: 'COMPLETE' | 'PARTIAL' | 'NONE' | null
  time_coverage?: 'COMPLETE' | 'PARTIAL' | 'NONE' | null
  metric_coverage?: 'COMPLETE' | 'PARTIAL' | 'NONE' | null
}

/** Fact 质量与新鲜度（docs/02 §6）。 */
export interface FactQuality {
  level?: EvidenceQuality
  completeness?: 'COMPLETE' | 'PARTIAL' | 'MISSING'
  freshness?: 'LIVE' | 'REPLAY_DATA' | 'STALE'
}

/** Fact 来源：必须可追溯到 SkillExecution 与源引用（docs/02 §6、docs/03 §5）。 */
export interface FactSource {
  execution_id: string
  skill_id: string
  source_refs: string[]
  query_coverage?: QueryCoverage
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Fact / Evidence / Candidate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical Fact —— 带来源、时间、覆盖和质量的诊断观测对象（docs/02 §6）。
 * 不等同于源系统原始行，也不等同于 Evidence。
 */
export interface CanonicalFact {
  fact_id: string
  fact_type: FactType
  object_refs: string[]
  occurred_at?: string
  observed_range?: { start: string | null; end: string | null }
  created_sequence?: number
  source: FactSource
  quality?: FactQuality
  payload: Record<string, unknown>
}

/** Evidence 对单个候选的作用（docs/02 §7）。 */
export interface EvidenceEffectEntry {
  candidate_id: string
  effect: EvidenceEffect
  score_delta: number
  explanation: string
}

/**
 * Evidence —— Fact 对候选的诊断作用（docs/02 §7、docs/10 §3）。
 * 禁止复制伪造原始值；所有原始值必须通过 fact_refs 追溯。
 */
export interface Evidence {
  evidence_id: string
  evidence_type: string
  fact_refs: string[]
  effects: EvidenceEffectEntry[]
  object_refs?: string[]
  time_alignment_ms?: number | null
  quality?: EvidenceQuality
  created_by?: string
  created_sequence?: number
}

/**
 * 候选根因 —— 对象 + 故障模式假设（docs/02 §8、docs/10 §2）。
 * 候选是会话假设，不写回资源运行状态。
 */
export interface Candidate {
  candidate_id: string
  object_id: string
  fault_mode_code: string
  display_name?: string
  diagnosis_support_score: number
  status: CandidateStatus
  supporting_evidence_refs?: string[]
  weakening_evidence_refs?: string[]
  conflicting_evidence_refs?: string[]
  missing_requirement_ids?: string[]
  generated_from?: {
    symptom_refs?: string[]
    ontology_relation_refs?: string[]
    fact_refs?: string[]
  }
}

/**
 * 候选更新 —— 一次得分/状态变化的审计记录（docs/02 §8、docs/10 §11）。
 */
export interface CandidateUpdate {
  update_id?: string
  candidate_id: string
  score_before: number
  score_after: number
  status_before?: CandidateStatus
  status_after?: CandidateStatus
  caused_by_evidence_refs: string[]
  reason: string
  chain_changes?: Array<{
    requirement_id: string
    from: ChainItemStatus
    to: ChainItemStatus
  }>
  sequence?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 最小证据链
// ─────────────────────────────────────────────────────────────────────────────

/** 最小证据链条目（docs/02 §9）。前端不得只使用一个布尔完成值。 */
export interface MinimumEvidenceChainItem {
  requirement_id: string
  label?: string
  required: boolean
  status: ChainItemStatus
  evidence_refs: string[]
}

/** 最小证据链（docs/02 §9、docs/10 §8）。 */
export interface MinimumEvidenceChain {
  template_id?: string
  candidate_id: string
  items: MinimumEvidenceChainItem[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Planner / Skill / 活动投影
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Planner 诊断目标（issue#6 阶段A）。
 * Planner 依据图谱故障知识 + 拓扑上下游资源输出一组优先级目标，
 * 每个目标描述"目标资源 + 目标故障模式 + 验证问题 + 期望发现 + 诊断范围"。
 * round 表示目标所属规划轮次（1 = 初始计划，2+ = 重规划新增）。
 */
export interface PlannerTarget {
  seq: number
  target_resource: string
  target_fault_mode: string
  verify_question: string
  expected_finding: string
  topo_path: string[]
  scope: string
  round?: number
}

/** 重规划定义（planner_plan.json 中声明，由 trigger_task_id 锚定触发任务）。 */
export interface PlannerReplan {
  round: number
  trigger_task_id: string
  reason: string
  original_scope: string
  new_scope: string
  added_targets: string[]
  paused_targets: string[]
}

/** Planner 计划（Case 数据 planner_plan.json）。 */
export interface PlannerPlan {
  plan_id: string
  original_scope: string
  targets: PlannerTarget[]
  replans?: PlannerReplan[]
}

/** 已发生的重规划信息（Snapshot 侧，去掉 trigger_task_id 后供投影展示）。 */
export interface PlannerReplanInfo {
  round: number
  reason: string
  original_scope: string
  new_scope: string
  added_targets: string[]
  paused_targets: string[]
}

/** 计划任务（docs/08 §6）。ui_role 决定 primary/background。 */
export interface PlanTask {
  task_id: string
  action?: string
  skill_id?: string
  skill_code?: string
  stage?: string
  display_name?: string
  goal?: string
  target_candidate_refs?: string[]
  target_object_refs?: string[]
  time_range?: { start: string | null; end: string | null }
  parameters?: Record<string, unknown>
  input?: Record<string, unknown>
  expected_evidence?: Array<{ requirement_id: string; description?: string }>
  selection_reason?: string
  priority?: number
  execution_mode?: 'SEQUENTIAL' | 'PARALLEL'
  ui_role?: 'PRIMARY' | 'BACKGROUND'
  status: TaskStatus
  result_refs?: string[]
  started_at?: string
  ended_at?: string
  error?: string | null
  on_success?: string
  on_failure?: string
}

/** Skill 执行（docs/09 §3）。 */
export interface SkillExecution {
  execution_id: string
  task_id?: string
  skill_id: string
  status: TaskStatus
  target_object_refs?: string[]
  time_range?: { start: string | null; end: string | null }
  parameters?: Record<string, unknown>
  query_coverage_requested?: QueryCoverage
  reason?: string
  started_at?: string
  ended_at?: string
  result_summary?: string | null
  source_refs?: string[]
  actual_coverage?: QueryCoverage
  data_quality?: { completeness?: string; missing_intervals?: unknown[] }
  normalizer_hint?: FactType
  error?: string | null
}

/**
 * 活动投影 —— Runtime 在领域状态之外生成的可显示字段（docs/02 §10）。
 * 并行任务中只有一个 primary_activity。
 */
export interface ActivityProjection {
  goal: string | null
  action_text: string | null
  reason_text: string | null
  expected_result_text: string | null
  result_summary: string | null
  task_id: string | null
  execution_id: string | null
  status: TaskStatus | null
  target_object_refs?: string[]
  expected_evidence?: Array<{ requirement_id: string; description?: string }>
  fact_refs?: string[]
  evidence_refs?: string[]
  candidate_update_refs?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 结论 / 现象 / 焦点
// ─────────────────────────────────────────────────────────────────────────────

/** 诊断结论（docs/01 §6、docs/03 §10）。 */
export interface Conclusion {
  diagnosis_id: string
  status: TerminalStatus | string
  completed_at?: string
  root_cause: {
    candidate_id: string
    object_id: string
    fault_mode_code: string
    diagnosis_support_score?: number
  }
  root_cause_chain?: string[]
  impact_chain?: string[]
  recovery_chain?: string[]
  excluded_candidates?: string[]
  diagnosis_summary?: string
  key_evidence_refs?: string[]
  business_impact?: {
    object_id?: string
    level?: string
    duration_ms?: number
    description?: string
  }
  current_capability_boundary?: string
  repair?: {
    status?: string
    display_mode?: string
    items?: string[]
  }
}

/** 现象标准化投影（docs/02 §3）。 */
export interface SymptomProjection {
  normalized_text: string
  object_refs: string[]
  time_range: { start: string | null; end: string | null }
  normalization_chain?: string[]
  source_symptom_ids?: string[]
}

/** Agent 焦点 —— 只能由 Runtime 更新（docs/02 §3）。 */
export interface AgentFocus {
  source_type: string | null
  source_id: string | null
  object_refs: string[]
  path_refs: string[]
}

/** 诊断态势快照（docs/02 §3）。 */
export interface KnowledgeSnapshot {
  summary: string | null
  leading_candidate_id: string | null
  critical_conflict_count: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Event
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runtime Event Envelope（docs/02 §4）。
 * - sequence 单会话内严格递增；
 * - event_id 幂等，重复事件不得二次应用；
 * - causation_id 指向直接原因事件；
 * - correlation_id 串联一次 Planner/Skill/Reasoning 闭环。
 */
export interface RuntimeEvent {
  schema_version?: string
  event_id: string
  session_id: string
  sequence: number
  occurred_at?: string
  emitted_at?: string
  event_type: EventType
  causation_id?: string | null
  correlation_id?: string | null
  producer?: string
  payload: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// 诊断会话快照（顶层契约对象）
// ─────────────────────────────────────────────────────────────────────────────

/** 会话核心状态（对应 schemas/runtime_contract.schema.json session）。 */
export interface SessionCore {
  session_id: string
  case_id: string | null
  version: number
  last_sequence: number
  mode: RuntimeMode
  phase: string
  terminal_status: string | null
  agent_focus: AgentFocus
}

/**
 * DiagnosisSessionSnapshot —— 不可变递增事件流归并出的可重建会话快照
 * （docs/02 §3）。user_selection / 相机 / 展开组不进入该快照，属于 Projection Store。
 *
 * 顶层结构对齐 Runtime Contract，可被 validate_runtime_contract.py 校验：
 * schema_version / session / facts / evidences / candidates /
 * minimum_evidence_chain / events 为契约字段，其余为运行时扩展。
 */
export interface DiagnosisSessionSnapshot {
  schema_version: '2.0'
  session: SessionCore
  symptom?: SymptomProjection | null
  knowledge_snapshot?: KnowledgeSnapshot | null
  current_activity?: ActivityProjection | null
  background_activity_ids?: string[]
  plans: Array<{ plan_id: string; phase: string; primary_task_id: string | null; tasks: string[] }>
  /** issue#6 阶段A：Planner 当前规划目标列表（含全部轮次，round 标注轮次）。 */
  planner_targets: PlannerTarget[]
  /** 已发生的重规划差异（原范围→新范围、新增目标、暂停目标）。 */
  planner_replans: PlannerReplanInfo[]
  /** 初始诊断范围描述（planner_plan.json original_scope）。 */
  planner_original_scope: string | null
  tasks: PlanTask[]
  skill_executions: SkillExecution[]
  facts: CanonicalFact[]
  evidences: Evidence[]
  candidates: Candidate[]
  candidate_updates: CandidateUpdate[]
  evidence_chains: MinimumEvidenceChain[]
  /** 对齐 Runtime Contract：已确认/领先候选的链（单对象）。 */
  minimum_evidence_chain: MinimumEvidenceChain | null
  conclusion: Conclusion | null
  replay_bookmarks: Array<{ scene_id?: string; sequence: number; title?: string }>
  events: RuntimeEvent[]
}

/** 空白焦点的合法初值。 */
export const EMPTY_AGENT_FOCUS: AgentFocus = {
  source_type: null,
  source_id: null,
  object_refs: [],
  path_refs: [],
}

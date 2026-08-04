/**
 * Projection Store —— Runtime 快照 → 只读 View Model（docs/02 §13、docs/07）。
 *
 * 铁律：
 * - View Model 可包含展示文案、格式化值、颜色 token 与聚合摘要，但不得成为本体事实，
 *   也不得反向写回 Runtime；
 * - user_selection（用户浏览选择）只由用户交互更新，与 agent_focus（Runtime 更新）严格分离；
 * - 诊断支持分不显示百分号。
 */

import {
  CandidateStatus,
  EvidenceEffect,
  EvidenceQuality,
  FactType,
  RuntimeMode,
  TaskStatus,
  type Candidate,
  type CandidateUpdate,
  type CanonicalFact,
  type DiagnosisSessionSnapshot,
  type Evidence,
  type PlannerTarget,
  type RuntimeEvent,
} from './runtime-types'
import {
  activeBindingsOf,
  buildKnowledgePlaneIndex,
  deriveDynamicBindings,
  resourceTypeResolverOf,
  type CrossPlaneBinding,
} from './cross-plane-binding'
import type { InstanceTopologySnapshot } from '../adapters/v1_to_instance_topology'
import { GENERALIZED_FAULT_MODE_PREFIX } from '../adapters/case-knowledge-adapter'

// ─────────────────────────────────────────────────────────────────────────────
// 用户选择（Projection-only，与 agent_focus 分离）
// ─────────────────────────────────────────────────────────────────────────────

export interface UserSelection {
  selected_candidate_id: string | null
  selected_object_ids: string[]
  selected_fact_id: string | null
  selected_evidence_id: string | null
  expanded_groups: string[]
}

export const EMPTY_USER_SELECTION: UserSelection = {
  selected_candidate_id: null,
  selected_object_ids: [],
  selected_fact_id: null,
  selected_evidence_id: null,
  expanded_groups: [],
}

// ─────────────────────────────────────────────────────────────────────────────
// View Model 结构
// ─────────────────────────────────────────────────────────────────────────────

export interface ChainProgressVM {
  satisfied: number
  total: number
  required_missing: number
}

export interface KnowledgeSnapshotVM {
  phase: string
  phase_label: string
  mode_label: string
  symptom_text: string
  summary: string | null
  leading_candidate_id: string | null
  leading_score_label: string
  critical_conflict_count: number
  chain_progress: ChainProgressVM
  terminal_status_label: string | null
}

export interface CandidateItemVM {
  candidate_id: string
  object_id: string
  display_name: string
  fault_mode_code: string
  score: number
  score_label: string
  score_delta: number | null
  status: CandidateStatus
  status_label: string
  support_count: number
  weaken_count: number
  conflict_count: number
  missing_requirement_ids: string[]
  is_leading: boolean
  is_confirmed: boolean
}

export interface CandidateListVM {
  items: CandidateItemVM[]
  leading_id: string | null
  confirmed_id: string | null
}

export interface CurrentActionVM {
  has_activity: boolean
  goal: string | null
  action_text: string | null
  reason_text: string | null
  expected_result_text: string | null
  result_summary: string | null
  task_id: string | null
  execution_id: string | null
  status_label: string | null
  is_primary: boolean
  target_object_refs: string[]
  fact_refs: string[]
  facts: FactSummaryVM[]
  evidence_refs: string[]
  candidate_update_refs: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// issue#6 阶段A — Planner 目标 View Model
// ─────────────────────────────────────────────────────────────────────────────

/** Planner 目标状态（issue#6 阶段A）：pending / active / verified_ok / verified_abnormal / excluded。 */
export type PlannerTargetStatus = 'pending' | 'active' | 'verified_ok' | 'verified_abnormal' | 'excluded'

export interface PlannerTargetVM {
  seq: number
  target_resource: string
  target_fault_mode: string
  verify_question: string
  expected_finding: string
  topo_path: string[]
  scope: string
  round: number
  status: PlannerTargetStatus
  status_label: string
  is_active: boolean
  /** 被重规划暂停的目标（replan.paused_targets 命中）。 */
  is_paused: boolean
  /** issue#7 C2：目标对象实际查到的结果（原证据链内容摘要：命中的告警/日志指纹/性能事实）。 */
  actual_finding: string
  /** 实际发现基调：hit(命中异常) / normal(无命中/正常) / pending(未排查) / excluded(已排除)。 */
  finding_tone: 'hit' | 'normal' | 'pending' | 'excluded'
}

export interface PlannerReplanVM {
  round: number
  reason: string
  original_scope: string
  new_scope: string
  added_targets: string[]
  paused_targets: string[]
}

export interface PlannerTargetsVM {
  targets: PlannerTargetVM[]
  active_seq: number | null
  original_scope: string | null
  replans: PlannerReplanVM[]
  has_replan: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// issue#6 阶段B — 对象观测三标签（告警｜性能｜日志）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 对象某类观测的查询状态（issue#6：不要求机械查询全部数据）。
 * - QUERIED_ABNORMAL / QUERIED_NORMAL：已由 Skill 任务查询并得到异常/正常结果；
 * - NOT_QUERIED：本次诊断未查询该类观测；
 * - DATA_MISSING：任务失败或查询无数据；
 * - PARTIAL：只覆盖了部分范围（查询范围不完整）。
 */
export type ObjectObsStatus =
  | 'QUERIED_ABNORMAL'
  | 'QUERIED_NORMAL'
  | 'NOT_QUERIED'
  | 'DATA_MISSING'
  | 'PARTIAL'

export type ObjectObsKind = 'alarms' | 'perf' | 'logs'

export interface ObjectObsItemVM {
  id: string
  kind: 'alarm' | 'kpi' | 'log' | 'fingerprint'
  title: string
  detail: string
  time: string | null
  abnormal: boolean
}

export interface ObjectObsCategoryVM {
  kind: ObjectObsKind
  status: ObjectObsStatus
  status_label: string
  items: ObjectObsItemVM[]
  /** 完成该对象该类查询的 Skill 任务。 */
  queried_by: string[]
}

export interface ObjectObservationVM {
  object_id: string
  display_name: string
  is_focus: boolean
  alarms: ObjectObsCategoryVM
  perf: ObjectObsCategoryVM
  logs: ObjectObsCategoryVM
}

export interface ObjectObservationPanelVM {
  focus_object_id: string | null
  objects: ObjectObservationVM[]
}

// ─────────────────────────────────────────────────────────────────────────────
// issue#6 阶段C — 逐对象诊断循环 + 图谱原始点亮
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 对象判定标记（画布"判断"态颜色，docs/07 §6 阶段C）：
 * - ABNORMAL：异常（红）——根因/故障链对象或有异常观测；
 * - NORMAL：正常（绿）——已排查且未发现异常（含被排除的候选）；
 * - IMPACTED：受影响（橙）——位于影响链；
 * - CANDIDATE：候选（黄）——作为根因假设正在被验证。
 */
export type ExaminedVerdict = 'NORMAL' | 'ABNORMAL' | 'IMPACTED' | 'CANDIDATE'

/** 指标芯片状态色（正常绿 / 告警黄 / 异常红，画布节点旁小标签）。 */
export type MetricChipTone = 'normal' | 'warning' | 'critical'

/** 已排查节点旁的关键指标芯片：指标名 + 数值(带单位) + 状态色（issue 本轮）。 */
export interface MetricChipVM {
  /** 指标名称（如 时延 / I/O吞吐 / 控制器热复位）。 */
  name: string
  /** 数值（含单位，如 "42ms"、"0 GB/s"、"严重"）。 */
  value: string
  /** 状态色：normal(绿) / warning(黄) / critical(红)。 */
  tone: MetricChipTone
}

export interface ExaminedObjectVM {
  object_id: string
  display_name: string
  /** 判定标记；null = 尚未判断（未被查询、也无候选/影响）。 */
  verdict: ExaminedVerdict | null
  /** 当前正在被 Skill 查询（画布扫描态）。 */
  is_scanning: boolean
  /** 当前焦点对象（activeQuery 或 Planner 当前位置 / agent_focus）。 */
  is_focus: boolean
  /** 已排查对象的关键指标芯片（最多 3 个，随观测查询完成贴上；未排查为空）。 */
  metrics: MetricChipVM[]
}

export interface DiagnosisScanVM {
  /** 当前正在被 Skill 查询的对象（running task target_object_refs 首项）。 */
  active_query_object_id: string | null
  /** 整体焦点对象（activeQuery > Planner active > agent_focus）。 */
  focus_object_id: string | null
  /** 已排查对象及其判定（扫描/聚焦优先，随快照推进增长）。 */
  examined_objects: ExaminedObjectVM[]
  /** 排查路径（PLANNER seq 序，已排查/正在排查的目标资源；画布按此累积高亮，与右侧 PLANNER 一一对应）。 */
  path_object_ids: string[]
  /** 图谱原始点 ids（当前现象 → 故障模式，诊断启动后点亮，随候选收敛）。 */
  graph_entry_anchors: string[]
  /** 图谱关联知识点 ids（机制 → 证据规则 → 案例，随证据/候选更新扩展）。 */
  graph_lit_knowledge_ids: string[]
}

/** 知识图谱节点参考（来自静态 model knowledge 平面，仅供图谱点亮推导）。 */
export interface KnowledgeGraphNodeRef {
  id: string
  /** 图谱分层（ROOT/L1/L2/L3/L4，KnowledgeGraphPackage 3.0.0）。 */
  layer: string
  /** 节点类型（RESOURCE_TYPE/FAULT_SCENARIO/FAULT_MODE/SYMPTOM_CONCEPT/…）。 */
  node_type?: string | null
  /** 语义码（如 LATENCY_INCREASE / CONTROLLER_WARM_RESET）。 */
  code?: string | null
  /** 故障模式码（attributes.fault_mode_code）。 */
  fault_mode_code?: string | null
}

export interface KnowledgeGraphLinkRef {
  source: string
  target: string
  relation?: string
}

export interface FactSummaryVM {
  fact_id: string
  fact_type: FactType
  fact_type_label: string
  object_refs: string[]
  headline: string
}

export interface EvidenceChainItemVM {
  evidence_id: string
  evidence_type: string
  evidence_type_label: string
  effect: EvidenceEffect
  effect_label: string
  score_delta: number
  explanation: string
  quality_label: string
  time_alignment_ms: number | null
  fact_refs: string[]
  facts: FactSummaryVM[]
}

export interface EvidenceChainVM {
  candidate_id: string
  items: EvidenceChainItemVM[]
}

export interface FactDetailRowVM {
  key: string
  label: string
  value: string
}

export interface FactDetailVM {
  fact_id: string
  fact_type: FactType
  fact_type_label: string
  object_refs: string[]
  occurred_at: string | null
  skill_id: string
  execution_id: string
  source_refs: string[]
  quality_label: string | null
  payload_rows: FactDetailRowVM[]
  referenced_by_evidence_ids: string[]
}

export interface TimelineEventVM {
  sequence: number
  event_id: string
  event_type: RuntimeEvent['event_type']
  label: string
  occurred_at: string | null
  summary: string
  related_refs: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 文案映射（状态/作用/类型 → 中文标签）
// ─────────────────────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  INPUT_COMPLETION: '输入补全',
  SYMPTOM_VALIDATION: '现象校验',
  SCOPE_LOCALIZATION: '范围定位',
  CANDIDATE_GENERATION: '候选生成',
  CANDIDATE_EVIDENCE: '候选取证',
  COMPETING_EXPLANATION: '竞争解释',
  CONCLUSION_CHECK: '终态门控',
  SUPPLEMENTARY_PLANNING: '补充规划',
}

const STATUS_LABEL: Record<CandidateStatus, string> = {
  INITIAL: '初始',
  ACTIVE: '活跃',
  LEADING: '领先',
  WEAKENED: '已削弱',
  CONFLICTING: '存在冲突',
  CONFIRMED: '已确认',
  NOT_CONFIRMED: '未确认',
  INSUFFICIENT_EVIDENCE: '证据不足',
}

const EFFECT_LABEL: Record<EvidenceEffect, string> = {
  STRONG_SUPPORT: '强支持',
  SUPPORT: '支持',
  WEAKEN: '削弱',
  CONFLICT: '冲突',
  NEUTRAL: '中性',
}

const QUALITY_LABEL: Record<EvidenceQuality, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
}

const FACT_TYPE_LABEL: Record<FactType, string> = {
  ALARM: '告警',
  LOG: '日志',
  LOG_FINGERPRINT: '日志指纹',
  KPI_WINDOW: 'KPI 窗口',
  TOPOLOGY_RELATION: '拓扑关系',
  RESOURCE_STATE: '资源状态',
  ABSENCE: '缺失(反证)',
  SIMILAR_CASE_REFERENCE: '相似案例',
}

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  PLANNED: '已计划',
  READY: '就绪',
  RUNNING: '执行中',
  SUCCEEDED: '成功',
  FAILED: '失败',
  PARTIAL: '部分覆盖',
  DATA_MISSING: '数据缺失',
  CANCELLED: '已取消',
  SKIPPED: '已跳过',
}

const PLANNER_TARGET_STATUS_LABEL: Record<PlannerTargetStatus, string> = {
  pending: '待验证',
  active: '验证中',
  verified_ok: '已验证',
  verified_abnormal: '命中故障',
  excluded: '已排除',
}

const EVIDENCE_TYPE_LABEL: Record<string, string> = {
  DIRECT_FAULT: '直接故障',
  MECHANISM: '触发机制',
  AFFECTED_PATH: '影响路径',
  IMPACT: '业务影响',
  COUNTER_EVIDENCE: '反证',
  ABSENCE: '缺失反证',
  SIMILAR_CASE: '相似案例',
}

const MODE_LABEL: Record<RuntimeMode, string> = {
  LIVE: '实时',
  PAUSED: '已暂停',
  REPLAY: '回放',
}

// —— issue#6 阶段B — 对象观测三标签 ——

const OBS_STATUS_LABEL: Record<ObjectObsStatus, string> = {
  QUERIED_ABNORMAL: '已查询—异常',
  QUERIED_NORMAL: '已查询—正常',
  NOT_QUERIED: '未查询',
  DATA_MISSING: '数据缺失',
  PARTIAL: '范围不完整',
}

const SEVERITY_LABEL: Record<string, string> = {
  CRITICAL: '严重',
  MAJOR: '主要',
  MINOR: '次要',
  WARNING: '警告',
  INFO: '提示',
  CLEARED: '已清除',
}

/** 任务终态集合（对象观测查询以终态任务为准，运行中的任务视为未完成查询）。 */
const OBS_TERMINAL_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.SUCCEEDED,
  TaskStatus.PARTIAL,
  TaskStatus.DATA_MISSING,
  TaskStatus.FAILED,
  TaskStatus.SKIPPED,
])

/** 观测类别 → 关联 Skill 与 Fact 类型（docs/09 §8 口径：QUERY_ALARM→告警、QUERY_KPI→性能、日志指纹/日志→日志）。 */
const OBS_CATEGORIES: Record<
  ObjectObsKind,
  { label: string; skills: string[]; factTypes: FactType[] }
> = {
  alarms: { label: '告警', skills: ['alarm_query'], factTypes: [FactType.ALARM] },
  perf: {
    label: '性能',
    // link_health_query 亦产出 KPI 事实（如 FC 端口错误计数），并入性能类别。
    skills: ['kpi_query', 'link_health_query'],
    factTypes: [FactType.KPI_WINDOW],
  },
  logs: {
    label: '日志',
    skills: ['log_fingerprint_query', 'log_query'],
    factTypes: [FactType.LOG, FactType.LOG_FINGERPRINT],
  },
}

const OBS_KINDS: ObjectObsKind[] = ['alarms', 'perf', 'logs']

function evidenceTypeLabel(t: string): string {
  return EVIDENCE_TYPE_LABEL[t] ?? t
}

function headlineOf(fact: CanonicalFact): string {
  const p = fact.payload
  switch (fact.fact_type) {
    case FactType.ALARM:
      return `${p['name'] ?? p['alarm_code'] ?? '告警'}（${(p['severity'] as string) ?? ''}）`.trim()
    case FactType.LOG_FINGERPRINT:
      return `${p['name'] ?? '指纹'} · 命中 ${p['hit_count'] ?? 0} 次`
    case FactType.LOG:
      return `${p['component'] ?? ''} ${p['level'] ?? ''}: ${truncate(String(p['message'] ?? ''), 48)}`
    case FactType.KPI_WINDOW: {
      const peak = p['peak_value']
      const unit = p['unit']
      return `${p['metric_name'] ?? '指标'} 峰值 ${peak}${unit ? ' ' + unit : ''}`
    }
    case FactType.TOPOLOGY_RELATION:
      return `${fact.object_refs[0]} → ${fact.object_refs[1]}（${p['relation_type'] ?? ''}）`
    case FactType.RESOURCE_STATE:
      return `${p['name'] ?? fact.object_refs[0]}（${p['resource_type'] ?? ''}）`
    case FactType.ABSENCE:
      return `反证：${p['summary'] ?? '完整覆盖下未发现匹配'}`
    case FactType.SIMILAR_CASE_REFERENCE:
      return `${p['title'] ?? '历史案例'}（相似度 ${formatPercent(p['similarity'])}）`
    default:
      return fact.fact_id
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function formatPercent(v: unknown): string {
  return typeof v === 'number' ? `${Math.round(v * 1000) / 10}%` : '-'
}

// ─────────────────────────────────────────────────────────────────────────────
// ProjectionStore
// ─────────────────────────────────────────────────────────────────────────────

export class ProjectionStore {
  private snapshot: DiagnosisSessionSnapshot | null = null
  private _userSelection: UserSelection = { ...EMPTY_USER_SELECTION }
  /** issue#6 阶段B：Case 全量观测 Fact（含未被 Evidence 引用的原始日志/告警），仅作 items 内容补充。 */
  private observationsFacts: CanonicalFact[] | null = null
  /** issue#6 阶段C：知识图谱节点/连线参考（静态 model knowledge 平面），仅作图谱点亮推导。 */
  private knowledgeNodes: KnowledgeGraphNodeRef[] | null = null
  private knowledgeLinks: KnowledgeGraphLinkRef[] | null = null
  /** 阶段3：Case 静态 CrossPlaneBinding（INSTANCE_OF / CONFORMS_TO / ENTRY_OBJECT_TYPE）。 */
  private staticBindings: CrossPlaneBinding[] | null = null
  /** 阶段3：InstanceTopology 快照（供动态 Binding 的对象资源类型解析）。 */
  private instanceTopology: InstanceTopologySnapshot | null = null

  /**
   * 绑定 Runtime 快照（只读消费，不改写 Runtime）。
   * context.observationsFacts：Case 适配后的全量观测 Fact，供对象观测 items 补充原始内容
   * （原始日志行、未被证据引用的告警等）。未提供时回退快照内已发现 Fact。
   * context.knowledgeNodes/knowledgeLinks：知识图谱参考（来自静态 model），供"图谱原始点 +
   * 关联知识点点亮"推导；未提供时图谱点亮为空但不抛错。
   * context.staticBindings / context.instanceTopology：阶段3 跨平面 Binding 数据。
   */
  bind(
    snapshot: DiagnosisSessionSnapshot,
    context?: {
      observationsFacts?: CanonicalFact[]
      knowledgeNodes?: KnowledgeGraphNodeRef[]
      knowledgeLinks?: KnowledgeGraphLinkRef[]
      staticBindings?: CrossPlaneBinding[]
      instanceTopology?: InstanceTopologySnapshot
    },
  ): void {
    this.snapshot = snapshot
    this.observationsFacts = context?.observationsFacts ?? null
    this.knowledgeNodes = context?.knowledgeNodes ?? null
    this.knowledgeLinks = context?.knowledgeLinks ?? null
    this.staticBindings = context?.staticBindings ?? null
    this.instanceTopology = context?.instanceTopology ?? null
  }

  get userSelection(): UserSelection {
    return this._userSelection
  }

  /** 用户浏览选择 —— 只能由用户交互更新，不进入 Runtime。 */
  setUserSelection(sel: Partial<UserSelection>): void {
    this._userSelection = { ...this._userSelection, ...sel }
  }

  private require(): DiagnosisSessionSnapshot {
    if (!this.snapshot) throw new Error('[projection] store 未绑定快照')
    return this.snapshot
  }

  // —— 诊断态势 ——
  knowledgeSnapshot(): KnowledgeSnapshotVM {
    const s = this.require()
    const chain = s.minimum_evidence_chain
    const items = chain?.items ?? []
    const required = items.filter((i) => i.required)
    return {
      phase: s.session.phase,
      phase_label: PHASE_LABEL[s.session.phase] ?? s.session.phase,
      mode_label: MODE_LABEL[s.session.mode],
      symptom_text: s.symptom?.normalized_text ?? '',
      summary: s.knowledge_snapshot?.summary ?? null,
      leading_candidate_id: s.knowledge_snapshot?.leading_candidate_id ?? null,
      leading_score_label: leadingScoreLabel(s),
      critical_conflict_count: s.knowledge_snapshot?.critical_conflict_count ?? 0,
      chain_progress: {
        satisfied: items.filter((i) => i.status === 'SATISFIED').length,
        total: items.length,
        required_missing: required.filter((i) => i.status !== 'SATISFIED').length,
      },
      terminal_status_label: s.session.terminal_status,
    }
  }

  // —— 当前行动 ——
  currentAction(): CurrentActionVM {
    const s = this.require()
    const act = s.current_activity
    const factById = new Map(s.facts.map((f) => [f.fact_id, f]))
    const factRefs = act?.fact_refs ?? []
    return {
      has_activity: !!act,
      goal: act?.goal ?? null,
      action_text: act?.action_text ?? null,
      reason_text: act?.reason_text ?? null,
      expected_result_text: act?.expected_result_text ?? null,
      result_summary: act?.result_summary ?? null,
      task_id: act?.task_id ?? null,
      execution_id: act?.execution_id ?? null,
      status_label: act?.status ? TASK_STATUS_LABEL[act.status] ?? act.status : null,
      is_primary: true,
      target_object_refs: act?.target_object_refs ?? [],
      fact_refs: factRefs,
      facts: factRefs.map((id) => factById.get(id)).filter(Boolean).map((f) => toFactSummary(f!)),
      evidence_refs: act?.evidence_refs ?? [],
      candidate_update_refs: act?.candidate_update_refs ?? [],
    }
  }

  // —— Planner 目标（issue#6 阶段A + issue#7 C2 实际发现）——
  plannerTargets(): PlannerTargetsVM {
    const s = this.require()
    const paused = new Set<string>()
    for (const r of s.planner_replans) for (const id of r.paused_targets) paused.add(id)
    const allFacts = allObservationFacts(this.snapshot!, this.observationsFacts)
    const targets: PlannerTargetVM[] = s.planner_targets.map((t) => {
      const status = derivePlannerTargetStatus(s, t)
      const finding = plannerTargetFinding(s, t.target_resource, allFacts)
      return {
        seq: t.seq,
        target_resource: t.target_resource,
        target_fault_mode: t.target_fault_mode,
        verify_question: t.verify_question,
        expected_finding: t.expected_finding,
        topo_path: t.topo_path,
        scope: t.scope,
        round: t.round ?? 1,
        status,
        status_label: PLANNER_TARGET_STATUS_LABEL[status],
        is_active: status === 'active',
        is_paused: paused.has(t.target_resource),
        actual_finding: finding.text,
        finding_tone: finding.tone,
      }
    })
    const activeTarget = targets.find((t) => t.is_active)
    return {
      targets,
      active_seq: activeTarget?.seq ?? null,
      original_scope: s.planner_original_scope,
      replans: s.planner_replans,
      has_replan: s.planner_replans.length > 0,
    }
  }

  // —— 对象观测三标签（issue#6 阶段B）——
  /**
   * 按"对象 × 告警/性能/日志"维度聚合各被排查对象的查询状态与结果（docs/07 §2）。
   *
   * 规则（纯函数、确定性，禁止 case_id 特判）：
   * - 某对象某类观测"是否被查询"由已终态的 Skill 任务判定（skill_id 类别映射：
   *   alarm_query→告警、kpi_query/link_health_query→性能、日志指纹/日志→日志）；
   * - items 仅取这些任务产出的、指向该对象的 Fact（快照内已发现 + observations 全量补充）；
   * - 异常与否：告警按 severity、KPI 按峰值是否超阈值、日志按 ERROR/FATAL 级别；
   * - 任务 DATA_MISSING/FAILED → 数据缺失；PARTIAL → 范围不完整；
   *   未查询 → 不强行扫数据（符合"不要求机械查询全部数据"）。
   */
  objectObservationPanel(): ObjectObservationPanelVM {
    const s = this.require()
    const allFacts = allObservationFacts(this.snapshot!, this.observationsFacts)
    const focus = focusObjectId(s)
    const vms: ObjectObservationVM[] = investigatedObjectIds(s).map((objectId) =>
      buildObjectObservation(s, objectId, allFacts, focus === objectId),
    )
    vms.sort((a, b) => {
      if (a.is_focus !== b.is_focus) return a.is_focus ? -1 : 1
      const aq = hasAnyObservationQuery(a)
      const bq = hasAnyObservationQuery(b)
      if (aq !== bq) return aq ? -1 : 1
      return a.display_name.localeCompare(b.display_name, 'zh')
    })
    return { focus_object_id: focus, objects: vms }
  }

  // —— 逐对象诊断循环 + 图谱点亮（issue#6 阶段C）——
  /**
   * 画布逐对象诊断循环 view-model（docs/07 §6 阶段C）：
   * 聚焦（activeQuery/Planner 位置）→ 查询（扫描态）→ 判断（对象判定标记）→ 推进。
   * 判定完全由快照推导（候选/证据/Fact/影响链），不重复读数据；图谱点亮来自
   * 症状锚点 + 活跃候选故障模式沿知识图谱扩展。
   */
  diagnosisScan(): DiagnosisScanVM {
    const s = this.require()
    const activeQuery = activeQueryObjectIdOf(s)
    const focus = focusObjectId(s)
    const allFacts = allObservationFacts(this.snapshot!, this.observationsFacts)

    const examined: ExaminedObjectVM[] = scanExaminedObjectIds(s).map((objectId) => ({
      object_id: objectId,
      display_name: displayNameOf(allFacts, objectId),
      verdict: examinedVerdictFor(s, objectId),
      is_scanning: objectId === activeQuery,
      is_focus: objectId === focus,
      metrics: objectMetricChips(s, objectId, allFacts),
    }))
    examined.sort((a, b) => {
      if (a.is_scanning !== b.is_scanning) return a.is_scanning ? -1 : 1
      if (a.is_focus !== b.is_focus) return a.is_focus ? -1 : 1
      const av = a.verdict ? 0 : 1
      const bv = b.verdict ? 0 : 1
      if (av !== bv) return av - bv
      return a.display_name.localeCompare(b.display_name, 'zh')
    })

    const { graph_entry_anchors, graph_lit_knowledge_ids } = deriveGraphLighting(
      s,
      this.knowledgeNodes ?? [],
      this.knowledgeLinks ?? [],
    )

    return {
      active_query_object_id: activeQuery,
      focus_object_id: focus,
      examined_objects: examined,
      path_object_ids: scanPathObjectIds(s, allFacts),
      graph_entry_anchors,
      graph_lit_knowledge_ids,
    }
  }

  // —— 候选根因 ——
  candidateList(): CandidateListVM {
    const s = this.require()
    const lastDelta = new Map<string, number>()
    for (const u of s.candidate_updates) lastDelta.set(u.candidate_id, u.score_after - u.score_before)
    const leadingId = s.knowledge_snapshot?.leading_candidate_id ?? null
    const confirmed = s.candidates.find((c) => c.status === CandidateStatus.CONFIRMED)
    const items: CandidateItemVM[] = [...s.candidates]
      .sort((a, b) => b.diagnosis_support_score - a.diagnosis_support_score)
      .map((c) => ({
        candidate_id: c.candidate_id,
        object_id: c.object_id,
        display_name: c.display_name ?? c.candidate_id,
        fault_mode_code: c.fault_mode_code,
        score: c.diagnosis_support_score,
        score_label: scoreLabel(c.diagnosis_support_score),
        score_delta: lastDelta.has(c.candidate_id) ? lastDelta.get(c.candidate_id)! : null,
        status: c.status,
        status_label: STATUS_LABEL[c.status],
        support_count: (c.supporting_evidence_refs ?? []).length,
        weaken_count: (c.weakening_evidence_refs ?? []).length,
        conflict_count: (c.conflicting_evidence_refs ?? []).length,
        missing_requirement_ids: missingRequirements(s, c),
        is_leading: c.candidate_id === leadingId,
        is_confirmed: c.status === CandidateStatus.CONFIRMED,
      }))
    return { items, leading_id: leadingId, confirmed_id: confirmed?.candidate_id ?? null }
  }

  // —— 证据链 ——
  evidenceChain(candidateId?: string): EvidenceChainVM {
    const s = this.require()
    const cid = candidateId ?? this._userSelection.selected_candidate_id ?? s.knowledge_snapshot?.leading_candidate_id ?? s.candidates[0]?.candidate_id ?? ''
    const factById = new Map(s.facts.map((f) => [f.fact_id, f]))
    const items: EvidenceChainItemVM[] = s.evidences
      .filter((e) => e.effects.some((eff) => eff.candidate_id === cid))
      .map((e) => {
        const eff = e.effects.find((x) => x.candidate_id === cid)!
        return {
          evidence_id: e.evidence_id,
          evidence_type: e.evidence_type,
          evidence_type_label: evidenceTypeLabel(e.evidence_type),
          effect: eff.effect,
          effect_label: EFFECT_LABEL[eff.effect],
          score_delta: eff.score_delta,
          explanation: eff.explanation,
          quality_label: e.quality ? QUALITY_LABEL[e.quality] : '-',
          time_alignment_ms: e.time_alignment_ms ?? null,
          fact_refs: e.fact_refs,
          facts: e.fact_refs.map((id) => factById.get(id)).filter(Boolean).map((f) => toFactSummary(f!)),
        }
      })
    return { candidate_id: cid, items }
  }

  // —— 事实详情 ——
  factDetail(factId: string): FactDetailVM | null {
    const s = this.require()
    const fact = s.facts.find((f) => f.fact_id === factId)
    if (!fact) return null
    const referencedBy = s.evidences.filter((e) => e.fact_refs.includes(factId)).map((e) => e.evidence_id)
    return {
      fact_id: fact.fact_id,
      fact_type: fact.fact_type,
      fact_type_label: FACT_TYPE_LABEL[fact.fact_type],
      object_refs: fact.object_refs,
      occurred_at: fact.occurred_at ?? null,
      skill_id: fact.source.skill_id,
      execution_id: fact.source.execution_id,
      source_refs: fact.source.source_refs,
      quality_label: fact.quality?.level ? QUALITY_LABEL[fact.quality.level] : null,
      payload_rows: payloadRows(fact),
      referenced_by_evidence_ids: referencedBy,
    }
  }

  // —— 时间线 ——
  timeline(): TimelineEventVM[] {
    const s = this.require()
    return s.events.map((e) => ({
      sequence: e.sequence,
      event_id: e.event_id,
      event_type: e.event_type,
      label: EVENT_LABEL[e.event_type] ?? e.event_type,
      occurred_at: e.occurred_at ?? null,
      summary: summarizeEvent(e),
      related_refs: relatedRefs(e),
    }))
  }

  // —— 活动逻辑路径（F2：画布红线链路） ——
  /** 当前快照的活动逻辑路径（根因起点 → 证据/事实对象 → 影响链），供画布渲染红线。 */
  activePath(): string[] {
    return activeDiagnosisPath(this.require())
  }

  // —— 阶段3：跨平面 Binding ——
  /**
   * 当前 ACTIVE CrossPlaneBinding（docs/19 §6.2：前端只绘制 ACTIVE）。
   * = 静态 Binding（恒 ACTIVE）+ 由快照派生的动态 Binding（候选/证据/根因）。
   * 回放时快照为当时状态，动态 Binding 随之恢复，不泄露未来。
   * 未提供静态 Binding / InstanceTopology 时回退空集（不抛错）。
   */
  activeBindings(): CrossPlaneBinding[] {
    const s = this.require()
    const staticPart = this.staticBindings ?? []
    const index = buildKnowledgePlaneIndex()
    const resourceTypeOf = this.instanceTopology
      ? resourceTypeResolverOf(this.instanceTopology)
      : () => null
    const dynamicPart = deriveDynamicBindings(s, resourceTypeOf, index)
    return activeBindingsOf([...staticPart, ...dynamicPart])
  }
}

/**
 * 把当前快照翻译为画布上的"活动逻辑路径"（docs/07 §4 F2 联动）。
 *
 * 取当时已形成的根因候选对象、活跃 Evidence 引用的 Fact 对象、根因链与影响链对象，
 * 按"根因起点 → 证据 hop → 影响路径"顺序去重串成一条路径。快照不变化则结果确定，
 * 供 flat / layered 双画布绘制同一红色逻辑链（#ef4444）。
 */
export function activeDiagnosisPath(snapshot: DiagnosisSessionSnapshot): string[] {
  const c = snapshot.conclusion
  const root = c?.root_cause
  const leadId = snapshot.knowledge_snapshot?.leading_candidate_id ?? null
  const rootCand = root
    ? snapshot.candidates.find((x) => x.candidate_id === root.candidate_id)
    : snapshot.candidates.find((x) => x.candidate_id === leadId)
  const startId = root?.object_id ?? rootCand?.object_id ?? null
  const candidateId = root?.candidate_id ?? leadId ?? rootCand?.candidate_id ?? null

  // 证据 hop：作用于根因/领先候选的 Evidence → 其引用的 Fact → 对象。
  const factById = new Map(snapshot.facts.map((f) => [f.fact_id, f]))
  const hopIds: string[] = []
  if (candidateId) {
    for (const ev of snapshot.evidences) {
      if (!ev.effects.some((eff) => eff.candidate_id === candidateId)) continue
      for (const fid of ev.fact_refs) {
        const fact = factById.get(fid)
        if (!fact) continue
        for (const oid of fact.object_refs ?? []) {
          if (oid && oid !== startId && !hopIds.includes(oid)) hopIds.push(oid)
        }
      }
    }
  }

  const path: string[] = []
  const push = (id: string | null | undefined) => {
    if (id && !path.includes(id)) path.push(id)
  }
  push(startId)
  for (const id of c?.root_cause_chain ?? []) push(id)
  for (const id of hopIds) push(id)
  for (const id of c?.impact_chain ?? []) push(id)
  return path
}

/**
 * 推导 Planner 目标的当前状态（issue#6 阶段A，纯函数、确定性）。
 *
 * 规则（按优先级）：
 *  1. 当前行动正验证该目标资源 → active；
 *  2. 目标资源存在候选：CONFIRMED → verified_abnormal；WEAKENED → excluded；
 *     仍未裁决的候选 → pending（不得标记为已验证）；
 *  3. 非假设目标（无候选）：已由完成任务产出覆盖该资源的 Fact → verified_ok；
 *  4. 非假设目标：后续目标（seq 更大）已完成假设裁决（排除/命中故障）→ 本 hop 视为已通过
 *     → verified_ok；
 *  5. 否则 pending。
 */
function derivePlannerTargetStatus(s: DiagnosisSessionSnapshot, t: PlannerTarget): PlannerTargetStatus {
  // 1. 当前正在验证的目标资源：最近一个 RUNNING 任务（含 PRIMARY/BACKGROUND）的
  //    target_object_refs。让"当前位置高亮"随诊断推进逐个目标移动（不依赖
  //    current_activity —— 它只展示主活动，任务全并行时会长期停留在首任务）。
  const runningTask = [...s.tasks].reverse().find((tsk) => tsk.status === TaskStatus.RUNNING)
  const objs = new Set<string>()
  if (runningTask) {
    for (const o of runningTask.target_object_refs ?? []) objs.add(o)
  }
  if (objs.has(t.target_resource)) return 'active'

  // 2. 候选状态裁决。
  const cands = s.candidates.filter((c) => c.object_id === t.target_resource)
  if (cands.some((c) => c.status === CandidateStatus.CONFIRMED)) return 'verified_abnormal'
  if (cands.some((c) => c.status === CandidateStatus.WEAKENED)) return 'excluded'
  if (cands.length > 0) return 'pending'

  // 3. 非假设目标：已完成任务的产出覆盖该资源 → 已验证（非故障本体）。
  const terminalTasks: TaskStatus[] = [
    TaskStatus.SUCCEEDED,
    TaskStatus.DATA_MISSING,
    TaskStatus.FAILED,
    TaskStatus.SKIPPED,
  ]
  const doneTaskIds = new Set(
    s.tasks.filter((tsk) => terminalTasks.includes(tsk.status)).map((tsk) => tsk.task_id),
  )
  const covered = s.facts.some(
    (f) =>
      (f.object_refs ?? []).includes(t.target_resource) &&
      doneTaskIds.has(f.source.execution_id.replace(/^exec-/, '')),
  )
  if (covered) return 'verified_ok'

  // 4. 路径推进：后续目标已完成假设裁决（排除/命中故障）→ 本 hop 已通过。
  const laterResolved = s.planner_targets.some((o) => {
    if (o.seq <= t.seq) return false
    const st = derivePlannerTargetStatus(s, o)
    return st === 'verified_abnormal' || st === 'excluded'
  })
  if (laterResolved) return 'verified_ok'

  return 'pending'
}

// ─────────────────────────────────────────────────────────────────────────────
// issue#7 C2 — 目标对象「实际发现」
// ─────────────────────────────────────────────────────────────────────────────

export interface PlannerTargetFinding {
  text: string
  tone: 'hit' | 'normal' | 'pending' | 'excluded'
}

/**
 * 目标对象实际查到的结果（原证据链内容摘要，docs/07 §4）。
 * 优先级：已排除候选（反证）→ 命中异常（观测异常 / 命中的告警 / 日志指纹 / 性能事实）
 * → 已查询但无命中 → 未排查。纯函数、确定性、禁止 case_id 特判。
 */
function plannerTargetFinding(
  s: DiagnosisSessionSnapshot,
  objectId: string,
  allFacts: CanonicalFact[],
): PlannerTargetFinding {
  // 1. 候选被反证削弱 → 已排除。
  const weakened = s.candidates.some(
    (c) => c.object_id === objectId && c.status === CandidateStatus.WEAKENED,
  )
  if (weakened) return { text: '已排除（候选被反证削弱）', tone: 'excluded' }

  // 2. 观测三类命中异常（告警/性能/日志）→ 命中最优先。
  const obs = buildObjectObservation(s, objectId, allFacts, false)
  const hits: string[] = []
  for (const kind of OBS_KINDS) {
    const cat = obs[kind]
    const abnormal = cat.items.filter((i) => i.abnormal)
    if (abnormal.length > 0) {
      for (const item of abnormal.slice(0, 2)) {
        const tag = OBS_CATEGORIES[kind].label
        if (!hits.some((h) => h.includes(item.title))) hits.push(`${tag} ${item.title}`)
      }
    } else if (cat.status === 'QUERIED_ABNORMAL') {
      hits.push(`${OBS_CATEGORIES[kind].label} 存在异常`)
    }
  }

  // 3. 直接命中的事实（证据链内容：告警/日志指纹/性能事实，与对象观测互补）。
  const objectFacts = allFacts.filter((f) => (f.object_refs ?? []).includes(objectId))
  for (const f of objectFacts) {
    const label = headlineOf(f)
    const tag =
      f.fact_type === FactType.ALARM
        ? '告警'
        : f.fact_type === FactType.LOG_FINGERPRINT || f.fact_type === FactType.LOG
          ? '日志'
          : f.fact_type === FactType.KPI_WINDOW
            ? '性能'
            : null
    if (!tag) continue
    if (!hits.some((h) => h.includes(label))) hits.push(`${tag} ${label}`)
  }

  if (hits.length > 0) return { text: hits.slice(0, 3).join(' · '), tone: 'hit' }

  // 4. 已查询但无命中（含数据缺失/范围不完整 → 视为"已核查，未发现异常"）。
  const anyQueried = OBS_KINDS.some((kind) => obs[kind].status !== 'NOT_QUERIED')
  if (anyQueried) return { text: '无命中/正常', tone: 'normal' }

  // 5. 未排查。
  return { text: '待排查', tone: 'pending' }
}

// ─────────────────────────────────────────────────────────────────────────────
// issue#6 阶段B — 对象观测三标签辅助
// ─────────────────────────────────────────────────────────────────────────────

/** 合并快照内已发现 Fact 与 observations 全量 Fact（快照优先，保发现顺序）。 */
function allObservationFacts(snapshot: DiagnosisSessionSnapshot, observations: CanonicalFact[] | null): CanonicalFact[] {
  const byId = new Map<string, CanonicalFact>()
  for (const f of snapshot.facts) byId.set(f.fact_id, f)
  for (const f of observations ?? []) if (!byId.has(f.fact_id)) byId.set(f.fact_id, f)
  return [...byId.values()]
}

/** 被排查对象集合：Planner 目标 ∪ 任务目标对象 ∪ 候选对象（随快照推进增长）。 */
function investigatedObjectIds(s: DiagnosisSessionSnapshot): string[] {
  const ids = new Set<string>()
  const push = (v: unknown) => {
    if (typeof v === 'string' && v) ids.add(v)
    else if (Array.isArray(v)) v.forEach(push)
  }
  for (const t of s.tasks) push(t.target_object_refs)
  for (const t of s.planner_targets) push(t.target_resource)
  for (const c of s.candidates) push(c.object_id)
  return [...ids]
}

/**
 * 当前焦点对象：Planner 当前位置（active 目标资源）> agent_focus > 当前行动目标。
 * 与 PlannerTargetRow 的"当前位置"共用 derivePlannerTargetStatus，保证面板跟随诊断推进。
 */
function focusObjectId(s: DiagnosisSessionSnapshot): string | null {
  const active = s.planner_targets.find((t) => derivePlannerTargetStatus(s, t) === 'active')
  if (active) return active.target_resource
  const focusObj = s.session.agent_focus?.object_refs?.[0]
  if (focusObj) return focusObj
  return s.current_activity?.target_object_refs?.[0] ?? null
}

function buildObjectObservation(
  s: DiagnosisSessionSnapshot,
  objectId: string,
  allFacts: CanonicalFact[],
  isFocus: boolean,
): ObjectObservationVM {
  return {
    object_id: objectId,
    display_name: displayNameOf(allFacts, objectId),
    is_focus: isFocus,
    alarms: buildObservationCategory(s, objectId, 'alarms', allFacts),
    perf: buildObservationCategory(s, objectId, 'perf', allFacts),
    logs: buildObservationCategory(s, objectId, 'logs', allFacts),
  }
}

function buildObservationCategory(
  s: DiagnosisSessionSnapshot,
  objectId: string,
  kind: ObjectObsKind,
  allFacts: CanonicalFact[],
): ObjectObsCategoryVM {
  const cat = OBS_CATEGORIES[kind]
  const terminalTasks = s.tasks.filter(
    (t) =>
      cat.skills.includes(t.skill_id ?? '') &&
      (t.target_object_refs ?? []).includes(objectId) &&
      OBS_TERMINAL_TASK_STATUSES.has(t.status),
  )
  if (terminalTasks.length === 0) {
    return { kind, status: 'NOT_QUERIED', status_label: OBS_STATUS_LABEL.NOT_QUERIED, items: [], queried_by: [] }
  }

  const execIds = new Set(terminalTasks.map((t) => `exec-${t.task_id}`))
  const produced = allFacts.filter(
    (f) =>
      execIds.has(f.source.execution_id) &&
      (f.object_refs ?? []).includes(objectId) &&
      cat.factTypes.includes(f.fact_type),
  )
  const items = buildObservationItems(kind, produced, allFacts)

  let status: ObjectObsStatus
  if (terminalTasks.some((t) => t.status === TaskStatus.DATA_MISSING || t.status === TaskStatus.FAILED)) {
    status = 'DATA_MISSING'
  } else if (terminalTasks.some((t) => t.status === TaskStatus.PARTIAL)) {
    status = 'PARTIAL'
  } else {
    status = items.some((i) => i.abnormal) ? 'QUERIED_ABNORMAL' : 'QUERIED_NORMAL'
  }
  return {
    kind,
    status,
    status_label: OBS_STATUS_LABEL[status],
    items,
    queried_by: terminalTasks.map((t) => t.task_id),
  }
}

function buildObservationItems(kind: ObjectObsKind, produced: CanonicalFact[], allFacts: CanonicalFact[]): ObjectObsItemVM[] {
  switch (kind) {
    case 'alarms':
      return produced.map((f) => {
        const p = f.payload
        return {
          id: f.fact_id,
          kind: 'alarm',
          title: String(p['name'] ?? p['alarm_code'] ?? '告警'),
          detail: severityLabelOf(String(p['severity'] ?? '')),
          time: (p['occurred_at'] as string) ?? f.occurred_at ?? null,
          abnormal: isAbnormalSeverity(String(p['severity'] ?? '')),
        }
      })
    case 'perf':
      return produced.map((f) => {
        const p = f.payload
        const unit = p['unit'] ? ` ${String(p['unit'])}` : ''
        return {
          id: f.fact_id,
          kind: 'kpi',
          title: String(p['metric_name'] ?? '指标'),
          detail: `峰值 ${p['peak_value'] ?? '-'}${unit} · 基线 ${p['baseline'] ?? '-'}${unit}`,
          time: (p['peak_at'] as string) ?? null,
          abnormal: kpiAbnormal(p),
        }
      })
    case 'logs':
      return buildLogItems(produced, allFacts)
  }
}

/** 日志条目：指纹摘要 + 其匹配的原始日志样例（时间/级别/消息，去重限流）。 */
function buildLogItems(produced: CanonicalFact[], allFacts: CanonicalFact[]): ObjectObsItemVM[] {
  const items: ObjectObsItemVM[] = []
  const fingerprintFacts = produced.filter((f) => f.fact_type === FactType.LOG_FINGERPRINT)
  const rawLogFacts = produced.filter((f) => f.fact_type === FactType.LOG)
  let sampleCount = 0
  for (const f of fingerprintFacts) {
    const p = f.payload
    const codes = Array.isArray(p['fault_mode_codes']) ? (p['fault_mode_codes'] as string[]).join('、') : ''
    items.push({
      id: f.fact_id,
      kind: 'fingerprint',
      title: String(p['name'] ?? '日志指纹'),
      detail: `命中 ${p['hit_count'] ?? 0} 次${codes ? ` · ${codes}` : ''}`,
      time: f.observed_range?.start ?? null,
      abnormal: matchedLogsHaveAbnormal(f, allFacts),
    })
    // 展开指纹匹配的原始日志样例（同消息去重，最多 4 条，避免 7 条同内容刷屏）。
    const matchedIds = Array.isArray(p['matched_log_ids']) ? (p['matched_log_ids'] as string[]) : []
    const matched = allFacts.filter(
      (fact) =>
        fact.fact_type === FactType.LOG && fact.source.source_refs.some((r) => matchedIds.includes(r)),
    )
    const seen = new Set<string>()
    for (const lg of matched) {
      if (sampleCount >= 4) break
      const level = String(lg.payload['level'] ?? '')
      const msg = String(lg.payload['message'] ?? '')
      const key = `${level}|${lg.payload['component'] ?? ''}|${msg}`
      if (seen.has(key)) continue
      seen.add(key)
      sampleCount++
      items.push({
        id: lg.fact_id,
        kind: 'log',
        title: truncate(msg, 42),
        detail: `${level} · ${lg.payload['component'] ?? ''}`,
        time: lg.occurred_at ?? null,
        abnormal: isAbnormalLogLevel(level),
      })
    }
  }
  for (const lg of rawLogFacts) {
    items.push({
      id: lg.fact_id,
      kind: 'log',
      title: truncate(String(lg.payload['message'] ?? ''), 42),
      detail: `${lg.payload['level'] ?? ''} · ${lg.payload['component'] ?? ''}`,
      time: lg.occurred_at ?? null,
      abnormal: isAbnormalLogLevel(String(lg.payload['level'] ?? '')),
    })
  }
  return items
}

function displayNameOf(allFacts: CanonicalFact[], objectId: string): string {
  for (const f of allFacts) {
    if (f.fact_type === FactType.RESOURCE_STATE && (f.object_refs ?? []).includes(objectId)) {
      const n = f.payload['name']
      if (typeof n === 'string' && n) return n
    }
  }
  return objectId
}

function hasAnyObservationQuery(vm: ObjectObservationVM): boolean {
  return OBS_KINDS.some((k) => vm[k].status !== 'NOT_QUERIED')
}

function severityLabelOf(severity: string): string {
  return SEVERITY_LABEL[severity.toUpperCase()] ?? severity
}

function isAbnormalSeverity(severity: string): boolean {
  const s = severity.toUpperCase()
  return s === 'CRITICAL' || s === 'MAJOR'
}

function isAbnormalLogLevel(level: string): boolean {
  const s = level.toUpperCase()
  return s === 'ERROR' || s === 'FATAL' || s === 'CRITICAL' || s === 'SEVERE'
}

/** KPI 峰值是否超阈值（warning/critical 高低向），无阈值或未超 → 正常。 */
function kpiAbnormal(p: Record<string, unknown>): boolean {
  const peak = typeof p['peak_value'] === 'number' ? p['peak_value'] : NaN
  if (!Number.isFinite(peak)) return false
  const thresholds = (p['thresholds'] ?? {}) as Record<string, unknown>
  const hit = (key: string, high: boolean) => {
    const v = thresholds[key]
    if (typeof v !== 'number') return false
    return high ? peak >= v : peak <= v
  }
  if (hit('critical_high', true) || hit('critical_low', false) || hit('critical', true)) return true
  if (hit('warning_high', true) || hit('warning_low', false) || hit('warning', true)) return true
  return false
}

/** 指纹匹配的原始日志中是否存在 ERROR/FATAL 级（决定指纹条目异常与否）。 */
function matchedLogsHaveAbnormal(f: CanonicalFact, allFacts: CanonicalFact[]): boolean {
  const matchedIds = new Set(
    Array.isArray(f.payload['matched_log_ids']) ? (f.payload['matched_log_ids'] as string[]) : [],
  )
  return allFacts.some(
    (fact) =>
      fact.fact_type === FactType.LOG &&
      fact.source.source_refs.some((r) => matchedIds.has(r)) &&
      isAbnormalLogLevel(String(fact.payload['level'] ?? '')),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// issue#6 阶段C — 逐对象诊断循环 + 图谱点亮辅助
// ─────────────────────────────────────────────────────────────────────────────

/** 当前正在被 Skill 查询的对象（最近 RUNNING 任务 target_object_refs 首项）。 */
function activeQueryObjectIdOf(s: DiagnosisSessionSnapshot): string | null {
  const running = [...s.tasks].reverse().find((t) => t.status === TaskStatus.RUNNING)
  return running?.target_object_refs?.[0] ?? null
}

/** 画布循环的被排查对象集合：被排查对象 ∪ 结论根因链/影响链对象。 */
function scanExaminedObjectIds(s: DiagnosisSessionSnapshot): string[] {
  const ids = new Set(investigatedObjectIds(s))
  for (const id of s.conclusion?.root_cause_chain ?? []) ids.add(id)
  for (const id of s.conclusion?.impact_chain ?? []) ids.add(id)
  return [...ids]
}

/**
 * 排查路径（画布"已走过"累积高亮 + 右侧 PLANNER 一一对应）。
 * 只取 PLANNER 目标（按 seq 序）；某目标"已走过"当且仅当满足其一（两类信号均单调
 * 累积，路径不回退；当前正在扫描的目标由画布扫描/聚焦视觉单独高亮，不占路径）：
 *  - 该对象已由终态 Skill 任务产出 Fact（实际查询过；用全量观测 Fact 判覆盖，
 *    避免"未被证据引用的观测"如 LUN 时延在快照中缺席导致路径抖动）；
 *  - Planner 判定非 pending（已覆盖/已验证/命中故障/已排除，含路径推进间接验证）。
 */
function scanPathObjectIds(s: DiagnosisSessionSnapshot, allFacts: CanonicalFact[]): string[] {
  const path: string[] = []
  for (const t of [...s.planner_targets].sort((a, b) => a.seq - b.seq)) {
    const id = t.target_resource
    const walked =
      objectHasTerminalTaskFacts(s, id, allFacts) ||
      derivePlannerTargetStatus(s, t) !== 'pending'
    if (walked && !path.includes(id)) path.push(id)
  }
  return path
}

/** 对象是否已由终态 Skill 任务产出指向它的 Fact（用全量观测 Fact，含未被证据引用的观测）。 */
function objectHasTerminalTaskFacts(
  s: DiagnosisSessionSnapshot,
  objectId: string,
  allFacts: CanonicalFact[],
): boolean {
  const terminalTaskIds = new Set(
    s.tasks
      .filter((t) => OBS_TERMINAL_TASK_STATUSES.has(t.status))
      .map((t) => t.task_id),
  )
  return allFacts.some(
    (f) =>
      (f.object_refs ?? []).includes(objectId) &&
      terminalTaskIds.has(f.source.execution_id.replace(/^exec-/, '')),
  )
}

const METRIC_TONE_RANK: Record<MetricChipTone, number> = { critical: 0, warning: 1, normal: 2 }

/**
 * 对象关键指标芯片（画布节点旁小标签，issue 本轮）：
 * - 数据源：该对象由已终态 Skill 任务产出的性能 KPI 与告警 Fact（随快照推进增长，
 *   不泄露未来）；
 * - 优先级：异常/超阈值（critical→红）> 告警阈值（warning→黄）> 正常（绿），取最多 3 个；
 * - 内容带指标名 + 数值（含单位），否则数值无法理解含义。
 */
function objectMetricChips(
  s: DiagnosisSessionSnapshot,
  objectId: string,
  allFacts: CanonicalFact[],
): MetricChipVM[] {
  const displayName = displayNameOf(allFacts, objectId)
  const chips: MetricChipVM[] = []
  // 性能 KPI：指标名 + 峰值（带单位），按阈值分级着色。
  for (const f of objectProducedFacts(s, objectId, allFacts, [FactType.KPI_WINDOW])) {
    const p = f.payload
    const unit = p['unit'] ? ` ${String(p['unit'])}` : ''
    const peak = typeof p['peak_value'] === 'number' ? p['peak_value'] : '-'
    chips.push({
      name: compactMetricName(String(p['metric_name'] ?? '指标'), displayName),
      value: `${peak}${unit}`,
      tone: kpiTone(p),
    })
  }
  // 告警：告警名 + 严重级别（CRITICAL/MAJOR→红、WARNING→黄、其余→绿）。
  for (const f of objectProducedFacts(s, objectId, allFacts, [FactType.ALARM])) {
    const p = f.payload
    const severity = String(p['severity'] ?? '')
    chips.push({
      name: compactMetricName(String(p['name'] ?? p['alarm_code'] ?? '告警'), displayName),
      value: severityLabelOf(severity),
      tone: alarmTone(severity),
    })
  }
  return chips
    .sort((a, b) => METRIC_TONE_RANK[a.tone] - METRIC_TONE_RANK[b.tone])
    .slice(0, 3)
}

/** 对象由终态 Skill 任务产出的指定类型 Fact（与对象观测口径一致）。 */
function objectProducedFacts(
  s: DiagnosisSessionSnapshot,
  objectId: string,
  allFacts: CanonicalFact[],
  factTypes: FactType[],
): CanonicalFact[] {
  const terminalTasks = s.tasks.filter(
    (t) =>
      (t.target_object_refs ?? []).includes(objectId) &&
      OBS_TERMINAL_TASK_STATUSES.has(t.status),
  )
  const execIds = new Set(terminalTasks.map((t) => `exec-${t.task_id}`))
  return allFacts.filter(
    (f) =>
      execIds.has(f.source.execution_id) &&
      (f.object_refs ?? []).includes(objectId) &&
      factTypes.includes(f.fact_type),
  )
}

/** KPI 峰值分级：超 critical 阈值→红、超 warning 阈值→黄、否则→绿。 */
function kpiTone(p: Record<string, unknown>): MetricChipTone {
  const peak = typeof p['peak_value'] === 'number' ? p['peak_value'] : NaN
  if (!Number.isFinite(peak)) return 'normal'
  const thresholds = (p['thresholds'] ?? {}) as Record<string, unknown>
  const hit = (key: string, high: boolean): boolean => {
    const v = thresholds[key]
    if (typeof v !== 'number') return false
    return high ? peak >= v : peak <= v
  }
  if (hit('critical_high', true) || hit('critical_low', false) || hit('critical', true)) return 'critical'
  if (hit('warning_high', true) || hit('warning_low', false) || hit('warning', true)) return 'warning'
  return 'normal'
}

/** 告警严重级别分级：CRITICAL/MAJOR→红、WARNING→黄、其余→绿。 */
function alarmTone(severity: string): MetricChipTone {
  const s = severity.toUpperCase()
  if (s === 'CRITICAL' || s === 'MAJOR') return 'critical'
  if (s === 'WARNING') return 'warning'
  return 'normal'
}

/** 指标名紧凑化：去掉对象显示名前缀（如 "Controller-0A I/O吞吐" → "I/O吞吐"）。 */
function compactMetricName(full: string, displayName: string): string {
  if (!full) return '指标'
  const strip = (prefix: string): string | null =>
    full.startsWith(prefix) ? full.slice(prefix.length).replace(/^[\s\-—:：]+/, '') : null
  const stripped = strip(displayName) ?? strip(displayName.replace(/\s+/g, ''))
  return stripped && stripped.length > 0 ? stripped : full
}

/** 活跃根因假设候选状态（未决/正在验证；已排除/证据不足不算活跃）。 */
const ACTIVE_HYPOTHESIS_STATUSES: ReadonlySet<CandidateStatus> = new Set([
  CandidateStatus.INITIAL,
  CandidateStatus.ACTIVE,
  CandidateStatus.LEADING,
  CandidateStatus.CONFLICTING,
  CandidateStatus.CONFIRMED,
])

/**
 * 对象判定（优先级：根因 > 故障链 > 活跃假设候选 > 受影响 > 异常观测 > 排除候选 > 已排查正常）。
 * 纯函数、确定性，禁止 case_id 特判。
 */
function examinedVerdictFor(s: DiagnosisSessionSnapshot, objectId: string): ExaminedVerdict | null {
  const c = s.conclusion
  if (c?.root_cause?.object_id === objectId) return 'ABNORMAL'
  if ((c?.root_cause_chain ?? []).includes(objectId)) return 'ABNORMAL'

  const cands = s.candidates.filter((x) => x.object_id === objectId)
  if (cands.some((x) => ACTIVE_HYPOTHESIS_STATUSES.has(x.status))) return 'CANDIDATE'
  if ((c?.impact_chain ?? []).includes(objectId)) return 'IMPACTED'
  if (objectHasAbnormalFacts(s, objectId)) return 'ABNORMAL'
  if (
    cands.some(
      (x) =>
        x.status === CandidateStatus.WEAKENED ||
        x.status === CandidateStatus.NOT_CONFIRMED ||
        x.status === CandidateStatus.INSUFFICIENT_EVIDENCE,
    )
  ) {
    return 'NORMAL'
  }

  const target = s.planner_targets.find((t) => t.target_resource === objectId)
  if (target) {
    const st = derivePlannerTargetStatus(s, target)
    if (st === 'verified_abnormal') return 'ABNORMAL'
    if (st === 'verified_ok' || st === 'excluded') return 'NORMAL'
  }

  if (objectExaminedNormal(s, objectId)) return 'NORMAL'
  return null
}

/** 对象是否已由终态任务产出的 Fact 覆盖（视为"已排查"）。 */
function objectExaminedNormal(s: DiagnosisSessionSnapshot, objectId: string): boolean {
  const terminal: TaskStatus[] = [
    TaskStatus.SUCCEEDED,
    TaskStatus.PARTIAL,
    TaskStatus.DATA_MISSING,
    TaskStatus.FAILED,
    TaskStatus.SKIPPED,
  ]
  const terminalTaskIds = new Set(
    s.tasks.filter((t) => terminal.includes(t.status)).map((t) => t.task_id),
  )
  return s.facts.some(
    (f) =>
      (f.object_refs ?? []).includes(objectId) &&
      terminalTaskIds.has(f.source.execution_id.replace(/^exec-/, '')),
  )
}

/** 对象是否存在异常观测 Fact（告警严重 / KPI 超阈值 / 日志 ERROR+ / 指纹命中异常日志）。 */
function objectHasAbnormalFacts(s: DiagnosisSessionSnapshot, objectId: string): boolean {
  return s.facts.some((f) => {
    if (!(f.object_refs ?? []).includes(objectId)) return false
    switch (f.fact_type) {
      case FactType.ALARM:
        return isAbnormalSeverity(String(f.payload['severity'] ?? ''))
      case FactType.KPI_WINDOW:
        return kpiAbnormal(f.payload)
      case FactType.LOG:
        return isAbnormalLogLevel(String(f.payload['level'] ?? ''))
      case FactType.LOG_FINGERPRINT:
        return matchedLogsHaveAbnormal(f, s.facts)
      default:
        return false
    }
  })
}

/** 图谱 token 停用词（id 前缀 / 通用词，避免误匹配）。 */
const GRAPH_STOP_TOKENS = new Set(['sym', 'ot', 'fm', 'mech', 'er', 'case', 'id', 'kg', 'xm', 'of', 'to', 'by'])

function graphTokens(value: string): Set<string> {
  return new Set(
    String(value ?? '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !GRAPH_STOP_TOKENS.has(t)),
  )
}

/** 图谱节点语义码候选（code / fault_mode_code）。 */
function graphNodeCodes(n: KnowledgeGraphNodeRef): string[] {
  return [n.code, n.fault_mode_code].filter((v): v is string => !!v)
}

/**
 * 两个字符串是否共享 ≥minHits 个有效 token（图谱节点与症状/故障模式的宽松匹配）。
 * 症状匹配取 1（症状 id 语义特异，如 sym-lun-latency-high ↔ sym-latency-increase 共享 latency）；
 * 故障模式匹配取 2（避免 CONTROLLER 与 CONTROLLER_OVERLOAD 因仅共享 controller 而误判）。
 */
function graphTokenOverlap(a: string, b: string, minHits = 2): boolean {
  const ta = graphTokens(a)
  let hits = 0
  for (const t of ta) if (graphTokens(b).has(t)) hits++
  return hits >= minHits
}

/**
 * 图谱点亮推导：图谱原始点（现象锚点 + 活跃候选故障模式）+ 关联知识点扩展。
 * - 症状锚点：症状 source_symptom_ids / normalized_text / normalization_chain 与
 *   图谱 SYMPTOM 节点 id/code 的 token 匹配（如 sym-lun-latency-high ↔ sym-latency-increase）；
 * - 故障模式锚点：活跃假设候选的 fault_mode_code 与 FAULT_MODE 节点 code 匹配
 *   （精确或 token 重叠），候选被排除后其故障模式从锚点收敛；
 * - 关联知识点：从故障模式锚点沿图谱出边 BFS 扩展（机制 → 证据规则），并点亮
 *   与症状锚点直连的 CASE 节点（如 CASE_MATCH → 历史案例）。
 */
function deriveGraphLighting(
  s: DiagnosisSessionSnapshot,
  kgNodes: KnowledgeGraphNodeRef[],
  kgLinks: KnowledgeGraphLinkRef[],
): { graph_entry_anchors: string[]; graph_lit_knowledge_ids: string[] } {
  if (kgNodes.length === 0) return { graph_entry_anchors: [], graph_lit_knowledge_ids: [] }

  const symptomRefs = [
    s.symptom?.normalized_text ?? '',
    ...(s.symptom?.source_symptom_ids ?? []),
    ...(s.symptom?.normalization_chain ?? []),
  ].filter(Boolean)

  const symptomAnchors = new Set<string>()
  for (const n of kgNodes) {
    if (n.node_type !== 'SYMPTOM_CONCEPT') continue
    const nodeText = [n.id, n.code].filter(Boolean).join(' ')
    if (symptomRefs.some((ref) => graphTokenOverlap(ref, nodeText, 1))) symptomAnchors.add(n.id)
  }

  const activeFaultCodes = new Set(
    s.candidates
      .filter((c) => ACTIVE_HYPOTHESIS_STATUSES.has(c.status) && c.fault_mode_code)
      .map((c) => c.fault_mode_code),
  )
  const faultModeAnchors = new Set<string>()
  for (const n of kgNodes) {
    if (n.node_type !== 'FAULT_MODE') continue
    const codes = graphNodeCodes(n)
    const matched = [...activeFaultCodes].some(
      (code) => codes.some((c) => c === code) || graphTokenOverlap(code, codes.join(' ')),
    )
    if (matched) faultModeAnchors.add(n.id)
  }

  // 阶段4：首轮泛化候选（SCENE_<SCENARIO_CODE>）点亮 FAULT_SCENARIO 场景节点。
  // 精确 FaultMode 未释放前，图谱入口锚点为场景级（docs/19 §10.4）；候选细化后才点亮
  // 对应 FAULT_MODE 节点。
  const activeSceneCodes = new Set(
    s.candidates
      .filter(
        (c) =>
          ACTIVE_HYPOTHESIS_STATUSES.has(c.status) &&
          c.fault_mode_code.startsWith(GENERALIZED_FAULT_MODE_PREFIX),
      )
      .map((c) => c.fault_mode_code.slice(GENERALIZED_FAULT_MODE_PREFIX.length)),
  )
  const scenarioAnchors = new Set<string>()
  for (const n of kgNodes) {
    if (n.node_type !== 'FAULT_SCENARIO') continue
    const codes = graphNodeCodes(n)
    if ([...activeSceneCodes].some((code) => codes.some((c) => c === code))) {
      scenarioAnchors.add(n.id)
    }
  }

  const graphEntryAnchors = [...symptomAnchors, ...scenarioAnchors, ...faultModeAnchors]

  // 关联知识点：从故障模式锚点沿图谱出边 BFS（≤3 跳），点亮机制/证据规则。
  const lit = new Set(graphEntryAnchors)
  // 机理：EXPLAINS_MODE 反向（机理 → 故障模式）点亮解释当前模式的机理
  //（如 watchdog 机理 → 热复位模式；知识强度只是先验，不是本次诊断支持分）。
  for (const l of kgLinks) {
    if (l.relation === 'EXPLAINS_MODE' && faultModeAnchors.has(l.target)) lit.add(l.source)
  }
  const adj = new Map<string, string[]>()
  for (const l of kgLinks) {
    const arr = adj.get(l.source) ?? []
    arr.push(l.target)
    adj.set(l.source, arr)
  }
  const queue = [...faultModeAnchors]
  const depthByNode = new Map<string, number>(queue.map((id) => [id, 0]))
  while (queue.length) {
    const id = queue.shift()!
    const depth = depthByNode.get(id) ?? 0
    if (depth >= 3) continue
    for (const next of adj.get(id) ?? []) {
      if (lit.has(next)) continue
      lit.add(next)
      depthByNode.set(next, depth + 1)
      queue.push(next)
    }
  }

  // 历史案例：由症状锚点直连的 HISTORICAL_CASE 节点（如 sym-latency-increase → case-warm-reset-001）。
  const byId = new Map(kgNodes.map((n) => [n.id, n]))
  for (const symId of symptomAnchors) {
    for (const l of kgLinks) {
      if (l.source !== symId) continue
      const target = byId.get(l.target)
      if (target && target.node_type === 'HISTORICAL_CASE') lit.add(target.id)
    }
  }

  return { graph_entry_anchors: graphEntryAnchors, graph_lit_knowledge_ids: [...lit] }
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部辅助
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_LABEL: Record<string, string> = {
  DIAGNOSIS_SESSION_CREATED: '诊断会话创建',
  SYMPTOM_NORMALIZED: '现象标准化',
  RESOURCE_MAPPED: '资源映射',
  DIAGNOSIS_PHASE_CHANGED: '阶段切换',
  PLAN_CREATED: '计划生成',
  PLAN_REPLANNED: '重规划',
  TASK_STATUS_CHANGED: '任务状态变更',
  SKILL_STARTED: 'Skill 启动',
  SKILL_COMPLETED: 'Skill 完成',
  SKILL_FAILED: 'Skill 失败',
  FACT_DISCOVERED: '事实发现',
  FACT_QUALITY_UPDATED: '事实质量更新',
  EVIDENCE_CREATED: '证据创建',
  CANDIDATES_GENERATED: '候选生成',
  CANDIDATE_UPDATED: '候选更新',
  CONFLICT_DETECTED: '冲突检出',
  CONFLICT_RESOLVED: '冲突消解',
  MINIMUM_CHAIN_UPDATED: '证据链更新',
  ROOT_CAUSE_CONFIRMED: '根因确认',
  PROBABLE_CAUSES_REPORTED: '多个可能原因',
  INSUFFICIENT_EVIDENCE_REPORTED: '证据不足',
  DIAGNOSIS_PAUSED: '诊断暂停',
  DIAGNOSIS_RESUMED: '诊断恢复',
  DIAGNOSIS_COMPLETED: '诊断完成',
}

function scoreLabel(score: number): string {
  return `${Math.round(score)}` // 不带百分号
}

function leadingScoreLabel(s: DiagnosisSessionSnapshot): string {
  const leadId = s.knowledge_snapshot?.leading_candidate_id
  const lead = s.candidates.find((c) => c.candidate_id === leadId)
  return lead ? scoreLabel(lead.diagnosis_support_score) : '-'
}

function missingRequirements(s: DiagnosisSessionSnapshot, c: Candidate): string[] {
  const chain = s.evidence_chains.find((ch) => ch.candidate_id === c.candidate_id)
  if (!chain) return []
  return chain.items.filter((i) => i.required && i.status !== 'SATISFIED').map((i) => i.requirement_id)
}

function toFactSummary(f: CanonicalFact): FactSummaryVM {
  return {
    fact_id: f.fact_id,
    fact_type: f.fact_type,
    fact_type_label: FACT_TYPE_LABEL[f.fact_type],
    object_refs: f.object_refs,
    headline: headlineOf(f),
  }
}

function payloadRows(fact: CanonicalFact): FactDetailRowVM[] {
  const rows: FactDetailRowVM[] = []
  const push = (key: string, label: string, value: unknown) => {
    if (value === undefined || value === null) return
    rows.push({ key, label, value: formatValue(value) })
  }
  const p = fact.payload
  switch (fact.fact_type) {
    case FactType.ALARM:
      push('alarm_code', '告警码', p['alarm_code'])
      push('name', '告警名称', p['name'])
      push('severity', '严重级别', p['severity'])
      push('occurred_at', '发生时间', p['occurred_at'])
      push('cleared_at', '清除时间', p['cleared_at'])
      push('reason', '原因', (p['raw_fields'] as Record<string, unknown>)?.['reason'])
      break
    case FactType.LOG_FINGERPRINT:
      push('name', '指纹名称', p['name'])
      push('template', '模板', p['template'])
      push('hit_count', '命中次数', p['hit_count'])
      push('matched_log_ids', '匹配日志', p['matched_log_ids'])
      push('fault_mode_codes', '故障模式', p['fault_mode_codes'])
      break
    case FactType.LOG:
      push('level', '级别', p['level'])
      push('component', '组件', p['component'])
      push('message', '内容', p['message'])
      push('fingerprint_id', '指纹', p['fingerprint_id'])
      break
    case FactType.KPI_WINDOW:
      push('metric_name', '指标', p['metric_name'])
      push('unit', '单位', p['unit'])
      push('baseline', '基线', p['baseline'])
      push('peak_value', '峰值', p['peak_value'])
      push('peak_at', '峰值时间', p['peak_at'])
      push('thresholds', '阈值', p['thresholds'])
      push('samples', '采样点数', Array.isArray(p['samples']) ? (p['samples'] as unknown[]).length : 0)
      break
    case FactType.TOPOLOGY_RELATION:
      push('relation_type', '关系类型', p['relation_type'])
      push('path_group', '路径组', p['path_group'])
      push('redundancy_group', '冗余组', p['redundancy_group'])
      push('state', '状态', p['state'])
      break
    case FactType.RESOURCE_STATE:
      push('resource_type', '资源类型', p['resource_type'])
      push('name', '名称', p['name'])
      push('zone', '区域', p['zone'])
      push('attributes', '属性', p['attributes'])
      break
    case FactType.ABSENCE:
      push('summary', '摘要', p['summary'])
      push('detail', '详情', p['detail'])
      push('queried_source_ref', '查询引用', p['queried_source_ref'])
      break
    case FactType.SIMILAR_CASE_REFERENCE:
      push('title', '案例标题', p['title'])
      push('similarity', '相似度', formatPercent(p['similarity']))
      push('matched_features', '匹配特征', p['matched_features'])
      push('resolution_summary', '处置摘要', p['resolution_summary'])
      break
    default:
      break
  }
  return rows
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.length > 6 ? `[${value.slice(0, 6).join(', ')}, …共 ${value.length} 项]` : `[${value.join(', ')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.map(([k, v]) => `${k}=${formatValue(v)}`).join(', ')
  }
  return String(value)
}

function summarizeEvent(e: RuntimeEvent): string {
  const p = e.payload
  switch (e.event_type) {
    case 'CANDIDATES_GENERATED':
      return `生成候选 ${refList(p['candidate_refs'])}`
    case 'FACT_DISCOVERED':
      return `发现事实 ${refList(p['fact_refs'])}`
    case 'EVIDENCE_CREATED':
      return `创建证据 ${String(p['evidence_ref'] ?? '')}`
    case 'CANDIDATE_UPDATED':
      return `${String(p['candidate_id'] ?? '')} 支持分 ${p['score_before']}→${p['score_after']}`
    case 'ROOT_CAUSE_CONFIRMED':
      return `确认根因 ${String(p['candidate_ref'] ?? '')}`
    case 'SKILL_STARTED':
      return `启动 ${String(p['skill_id'] ?? '')}（${String(p['task_id'] ?? '')}）`
    case 'SKILL_COMPLETED':
      return `完成 ${String(p['execution_id'] ?? '')}`
    case 'TASK_STATUS_CHANGED':
      return `${String(p['task_id'] ?? '')} → ${String(p['status'] ?? '')}`
    case 'DIAGNOSIS_PHASE_CHANGED':
      return `进入 ${String(p['phase'] ?? '')}`
    default:
      return ''
  }
}

function relatedRefs(e: RuntimeEvent): string[] {
  const p = e.payload
  const refs: unknown[] = [
    p['candidate_ref'], p['candidate_refs'], p['fact_refs'], p['evidence_ref'],
    p['task_id'], p['execution_id'],
  ]
  const out: string[] = []
  for (const r of refs) {
    if (typeof r === 'string') out.push(r)
    else if (Array.isArray(r)) out.push(...r.filter((x): x is string => typeof x === 'string'))
  }
  return out
}

function refList(v: unknown): string {
  if (!Array.isArray(v)) return ''
  return v.filter((x): x is string => typeof x === 'string').join(', ')
}

export type {
  Candidate,
  CandidateUpdate,
  CanonicalFact,
  Evidence,
}

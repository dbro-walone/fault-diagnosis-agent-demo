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
  type RuntimeEvent,
} from './runtime-types'

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

  /** 绑定 Runtime 快照（只读消费，不改写 Runtime）。 */
  bind(snapshot: DiagnosisSessionSnapshot): void {
    this.snapshot = snapshot
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

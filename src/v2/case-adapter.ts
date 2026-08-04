/**
 * Case Adapter —— Case V1.0 数据包 → Runtime V2 转换边界（docs/02 §12、docs/11）。
 *
 * 职责：
 * 1. 通过 import.meta.glob 自动发现并加载三类 Case 的 V1.0 数据包
 *    （resources/topology/observations/diagnosis/knowledge/playback）；
 * 2. 将 observations 原始观测标准化为 V2 Canonical Facts；
 * 3. 提供 V1→V2 字段映射（confidence→score、status、stance→effect、
 *    source_ref→source.source_refs、skill_code→skill_id）。
 *
 * 铁律：
 * - 不修改 Case 原文件（只读）；
 * - 不根据 case_id 特判字段含义（三类 Case 共用同一映射）；
 * - 不在 Fact/Evidence 中复制伪造原始值，保留 source_refs 追溯。
 */

import {
  convertV1ToInstanceTopology,
  type InstanceTopologySnapshot,
} from '../adapters/v1_to_instance_topology'
import {
  CandidateStatus,
  EvidenceEffect,
  EvidenceQuality,
  FactType,
  TaskStatus,
  TerminalStatus,
  type CanonicalFact,
  type Candidate,
  type Conclusion,
  type Evidence,
  type EvidenceEffectEntry,
  type PlanTask,
  type PlannerPlan,
  type PlannerReplan,
  type PlannerTarget,
  type SkillExecution,
  type SymptomProjection,
} from './runtime-types'

// ─────────────────────────────────────────────────────────────────────────────
// V1 原始数据结构（Case 数据包 V1.0）
// ─────────────────────────────────────────────────────────────────────────────

interface V1CaseMeta {
  case_id: string
  name: string
  description: string
  fault_domain?: string
  fault_mode_code?: string
  severity?: string
  scenario_tags?: string[]
  data_mode?: string
  time_origin?: string
  observation_window?: { start: string | null; end: string | null }
  trigger?: { type?: string; object_id?: string; symptom_id?: string }
  expected_duration_ms?: number
  supported_capabilities?: string[]
}

interface V1Manifest {
  schema_name?: string
  schema_version?: string
  case_id: string
  case_version?: string
  data_mode?: string
  locale?: string
  timezone?: string
  files?: string[]
}

interface V1Resource {
  resource_id: string
  resource_type: string
  name: string
  parent_id?: string | null
  device_id?: string | null
  zone?: string
  location?: string
  attributes?: Record<string, unknown>
  display?: Record<string, unknown>
}

interface V1Edge {
  edge_id: string
  source_id: string
  target_id: string
  relation_type: string
  direction?: string
  path_group?: string | null
  redundancy_group?: string | null
  state?: string | null
  valid_from?: string | null
  valid_to?: string | null
}

interface V1Symptom {
  symptom_id: string
  source?: string
  raw_description: string
  normalized_type?: string
  object_id?: string
  detected_at?: string
  value?: number | null
  unit?: string | null
  baseline?: number | null
}

interface V1Alarm {
  alarm_id: string
  alarm_code?: string
  name?: string
  object_id: string
  severity?: string
  occurred_at: string
  cleared_at?: string | null
  status?: string
  raw_fields?: Record<string, unknown>
}

interface V1KpiPoint {
  timestamp: string
  value: number
  quality?: string
}
interface V1KpiSeries {
  series_id: string
  object_id: string
  indicator_id?: string
  name?: string
  unit?: string
  sample_interval_ms?: number
  baseline?: { value: number; method?: string }
  thresholds?: Record<string, number>
  points: V1KpiPoint[]
  annotations?: Array<{ timestamp: string; type: string; label?: string }>
}

interface V1Log {
  log_id: string
  timestamp: string
  object_id: string
  level?: string
  component?: string
  message: string
  fingerprint_id?: string
}

interface V1Fingerprint {
  fingerprint_id: string
  name?: string
  template?: string
  fault_mode_codes?: string[]
  window?: { start: string; end: string }
  hit_count?: number
  matched_log_ids?: string[]
}

interface V1Task {
  task_id: string
  stage?: string
  skill_code?: string
  display_name?: string
  input?: Record<string, unknown>
  started_at?: string
  ended_at?: string
  status: string
  result_refs?: string[]
  error?: string | null
}

interface V1Evidence {
  evidence_id: string
  evidence_type: string
  source_ref: string
  task_id?: string
  candidate_id: string
  stance: string
  strength: number
  summary: string
  detail?: string
  time_alignment_ms?: number | null
  quality?: string
}

interface V1Candidate {
  candidate_id: string
  fault_mode_code: string
  object_id: string
  display_name?: string
  initial_confidence: number
  generation_basis?: string[]
  status: string
}

interface V1TracePoint {
  sequence: number
  stage: string
  confidence: number
  evidence_refs: string[]
  reason: string
}

interface V1SimilarCase {
  similar_case_id: string
  title?: string
  similarity?: number
  historical_root_cause?: { fault_mode_code?: string; object_type?: string }
  matched_features?: string[]
  resolution_summary?: string
}

interface V1StoryboardScene {
  scene_id: string
  sequence: number
  stage_code?: string
  title?: string
  start_offset_ms?: number
  duration_ms?: number
}

/** V1 planner_plan.json —— Planner 优先级诊断目标（issue#6 阶段A）。 */
interface V1PlannerPlan {
  plan_id?: string
  original_scope?: string
  targets?: PlannerTarget[]
  replans?: PlannerReplan[]
}

interface RawCasePackage {
  caseMeta: V1CaseMeta
  manifest: V1Manifest
  resources: V1Resource[]
  edges: V1Edge[]
  symptoms: V1Symptom[]
  alarms: V1Alarm[]
  kpis: V1KpiSeries[]
  logs: V1Log[]
  fingerprints: V1Fingerprint[]
  tasks: V1Task[]
  evidences: V1Evidence[]
  candidates: V1Candidate[]
  conclusion: Record<string, unknown>
  traces: Array<{ candidate_id: string; trace: V1TracePoint[] }>
  normalizationChain?: string[]
  similarCases: V1SimilarCase[]
  storyboard: V1StoryboardScene[]
  plannerPlan: PlannerPlan | null
}

// ─────────────────────────────────────────────────────────────────────────────
// V1→V2 映射（纯函数，三类 Case 共用，禁止 case_id 特判）
// ─────────────────────────────────────────────────────────────────────────────

/** 演示级 Skill 白名单（docs/09 §8）。skill_code → skill_id。 */
export function skillCodeToSkillId(code: string | undefined): string {
  switch ((code ?? '').trim().toUpperCase()) {
    case 'BUSINESS_MAPPING':
      return 'business_mapping'
    case 'QUERY_TOPOLOGY':
      return 'topology_query'
    case 'QUERY_ALARM':
      return 'alarm_query'
    case 'MATCH_LOG_FINGERPRINT':
    case 'QUERY_LOG_FINGERPRINT':
      return 'log_fingerprint_query'
    case 'QUERY_KPI':
      return 'kpi_query'
    case 'CHECK_PORT_HEALTH':
    case 'LINK_HEALTH_QUERY':
      return 'link_health_query'
    case 'SEARCH_SIMILAR_CASE':
      return 'similar_case_query'
    default:
      return (code ?? 'unknown_skill').toLowerCase()
  }
}

/** V1 confidence(0..1) → V2 诊断支持分(0..100)，四舍五入并钳制。 */
export function confidenceToScore(confidence: number | undefined): number {
  const raw = Math.round((confidence ?? 0) * 100)
  return Math.max(0, Math.min(100, raw))
}

/** V1 candidate.status → V2 CandidateStatus（docs/02 §12、docs/10 §7）。 */
export function mapCandidateStatus(status: string | undefined): CandidateStatus {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'confirmed':
      return CandidateStatus.CONFIRMED
    case 'leading':
      return CandidateStatus.LEADING
    case 'active':
      return CandidateStatus.ACTIVE
    case 'excluded':
      // 不使用 EXCLUDED 作为默认状态；逻辑否定映射为 WEAKENED（docs/10 §7）。
      return CandidateStatus.WEAKENED
    case 'conflicting':
      return CandidateStatus.CONFLICTING
    case 'not_confirmed':
      return CandidateStatus.NOT_CONFIRMED
    case 'insufficient':
    case 'insufficient_evidence':
      return CandidateStatus.INSUFFICIENT_EVIDENCE
    case 'initial':
      return CandidateStatus.INITIAL
    default:
      return CandidateStatus.ACTIVE
  }
}

/** V1 task.status(lowercase) → V2 TaskStatus（docs/08 §7、docs/09 §5）。 */
export function mapTaskStatus(status: string | undefined): TaskStatus {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'succeeded':
    case 'success':
      return TaskStatus.SUCCEEDED
    case 'running':
      return TaskStatus.RUNNING
    case 'ready':
      return TaskStatus.READY
    case 'planned':
      return TaskStatus.PLANNED
    case 'failed':
      return TaskStatus.FAILED
    case 'partial':
      return TaskStatus.PARTIAL
    case 'data_missing':
    case 'empty':
      return TaskStatus.DATA_MISSING
    case 'cancelled':
    case 'canceled':
      return TaskStatus.CANCELLED
    case 'skipped':
      return TaskStatus.SKIPPED
    default:
      return TaskStatus.SUCCEEDED
  }
}

/** V1 conclusion.status → V2 TerminalStatus（docs/01 §7）。 */
export function mapTerminalStatus(status: string | undefined): TerminalStatus {
  const s = (status ?? '').trim().toLowerCase()
  if (s.includes('probable')) return TerminalStatus.PROBABLE_CAUSES
  if (s.includes('insufficient')) return TerminalStatus.INSUFFICIENT_EVIDENCE
  // confirmed / 默认
  return TerminalStatus.ROOT_CAUSE_CONFIRMED
}

/** 默认作用分（docs/10 §4）。 */
const DEFAULT_DELTA: Record<EvidenceEffect, number> = {
  [EvidenceEffect.STRONG_SUPPORT]: 30,
  [EvidenceEffect.SUPPORT]: 15,
  [EvidenceEffect.WEAKEN]: -15,
  [EvidenceEffect.CONFLICT]: -10,
  [EvidenceEffect.NEUTRAL]: 0,
}

/** strength ≥ 0.80 视为决定性强支持（docs/10 §4 STRONG_SUPPORT 阈值）。 */
const STRONG_SUPPORT_THRESHOLD = 0.8

/**
 * V1 stance+strength → V2 EvidenceEffect（docs/02 §12）。
 * - support + 高强度 → STRONG_SUPPORT；support → SUPPORT；
 * - contradict → 默认 WEAKEN（除非存在明确矛盾）；
 * - neutral → NEUTRAL。
 */
export function mapStanceToEffect(
  stance: string | undefined,
  strength: number | undefined,
): EvidenceEffect {
  const s = (stance ?? '').trim().toLowerCase()
  const str = strength ?? 0
  if (s === 'support') {
    return str >= STRONG_SUPPORT_THRESHOLD
      ? EvidenceEffect.STRONG_SUPPORT
      : EvidenceEffect.SUPPORT
  }
  if (s === 'contradict' || s === 'contradicts' || s === 'conflict') {
    return EvidenceEffect.WEAKEN
  }
  return EvidenceEffect.NEUTRAL
}

/** V1 evidence.quality(lowercase) → V2 EvidenceQuality。 */
export function mapEvidenceQuality(quality: string | undefined): EvidenceQuality {
  switch ((quality ?? '').trim().toLowerCase()) {
    case 'high':
      return EvidenceQuality.HIGH
    case 'medium':
      return EvidenceQuality.MEDIUM
    case 'low':
      return EvidenceQuality.LOW
    default:
      return EvidenceQuality.MEDIUM
  }
}

/** V1 evidence_type → V2 语义化 evidence_type 标签（自由字符串）。 */
function mapEvidenceType(v1Type: string, effect: EvidenceEffect): string {
  const t = (v1Type ?? '').trim().toLowerCase()
  if (t === 'alarm') return 'DIRECT_FAULT'
  if (t === 'log_fingerprint' || t === 'log') return 'MECHANISM'
  if (t === 'topology') return 'AFFECTED_PATH'
  if (t === 'similar_case') return 'SIMILAR_CASE'
  if (t === 'alarm_absence' || t === 'absence') return 'ABSENCE'
  if (t === 'kpi') return effect === EvidenceEffect.WEAKEN || effect === EvidenceEffect.CONFLICT
    ? 'COUNTER_EVIDENCE'
    : 'IMPACT'
  return (v1Type ?? 'EVIDENCE').toUpperCase()
}

/** 汇出的转换器集合，供 Runtime 复用。 */
export const converters = {
  confidenceToScore,
  mapCandidateStatus,
  mapTaskStatus,
  mapTerminalStatus,
  mapStanceToEffect,
  mapEvidenceQuality,
  skillCodeToSkillId,
  defaultDelta: (e: EvidenceEffect) => DEFAULT_DELTA[e],
}

// ─────────────────────────────────────────────────────────────────────────────
// AdaptedCase —— 适配后的 V2 案例模型
// ─────────────────────────────────────────────────────────────────────────────

export interface TraceScorePoint {
  sequence: number
  stage: string
  score: number
  evidence_refs: string[]
  reason: string
}

export interface AdaptedCase {
  caseId: string
  caseMeta: V1CaseMeta
  manifest: V1Manifest
  symptom: SymptomProjection
  /** 全量观测转出的 Fact（含未被证据引用的资源/拓扑 Fact，供投影层使用）。 */
  facts: CanonicalFact[]
  factBySourceRef: Map<string, CanonicalFact>
  /** 被任意 Evidence 引用的 fact_id 集合（即进入诊断态的 Fact）。 */
  referencedFactIds: Set<string>
  /** 按发现顺序（任务 result_refs）排列的被引用 Fact。 */
  referencedFacts: CanonicalFact[]
  executions: SkillExecution[]
  tasks: PlanTask[]
  evidences: Evidence[]
  candidates: Candidate[]
  conclusion: Conclusion | null
  traceByCandidate: Map<string, TraceScorePoint[]>
  storyboard: V1StoryboardScene[]
  /** issue#6 阶段A：Planner 优先级诊断目标计划（planner_plan.json）。 */
  plannerPlan: PlannerPlan | null
  /** 资源/拓扑原始数据，供 Projection Store 构建图谱。 */
  resources: V1Resource[]
  edges: V1Edge[]
  /** InstanceTopology Contract 1.0 规范快照（docs/19 §5）——由同一 V1 转换器编译。 */
  instanceTopology: InstanceTopologySnapshot
}

// ─────────────────────────────────────────────────────────────────────────────
// 模块发现（import.meta.glob）
// ─────────────────────────────────────────────────────────────────────────────

const caseMetaModules = import.meta.glob<{ default: V1CaseMeta }>('../../cases/*/case.json', { eager: true })
const manifestModules = import.meta.glob<{ default: V1Manifest }>('../../cases/*/manifest.json', { eager: true })
const resourceModules = import.meta.glob<{ default: { resources: V1Resource[] } }>('../../cases/*/resources.json', { eager: true })
const topologyModules = import.meta.glob<{ default: { edges: V1Edge[] } }>('../../cases/*/topology.json', { eager: true })
const symptomModules = import.meta.glob<{ default: { symptoms: V1Symptom[]; normalization_chain?: string[] } }>(
  '../../cases/*/observations/symptoms.json',
  { eager: true },
)
const alarmModules = import.meta.glob<{ default: { alarms: V1Alarm[] } }>('../../cases/*/observations/alarms.json', { eager: true })
const kpiModules = import.meta.glob<{ default: { series: V1KpiSeries[] } }>('../../cases/*/observations/kpis.json', { eager: true })
const logModules = import.meta.glob<{ default: { logs: V1Log[] } }>('../../cases/*/observations/logs.json', { eager: true })
const fpModules = import.meta.glob<{ default: { fingerprints: V1Fingerprint[] } }>(
  '../../cases/*/observations/log_fingerprints.json',
  { eager: true },
)
const taskModules = import.meta.glob<{ default: { tasks: V1Task[] } }>('../../cases/*/diagnosis/tasks.json', { eager: true })
const evidenceModules = import.meta.glob<{ default: { evidence: V1Evidence[] } }>('../../cases/*/diagnosis/evidence.json', { eager: true })
const candidateModules = import.meta.glob<{ default: { candidates: V1Candidate[] } }>('../../cases/*/diagnosis/candidates.json', { eager: true })
const conclusionModules = import.meta.glob<{ default: Record<string, unknown> }>('../../cases/*/diagnosis/conclusion.json', { eager: true })
const traceModules = import.meta.glob<{ default: { traces: Array<{ candidate_id: string; trace: V1TracePoint[] }> } }>(
  '../../cases/*/diagnosis/confidence_trace.json',
  { eager: true },
)
const similarModules = import.meta.glob<{ default: { similar_cases: V1SimilarCase[] } }>(
  '../../cases/*/knowledge/similar_cases.json',
  { eager: true },
)
const storyboardModules = import.meta.glob<{ default: { scenes: V1StoryboardScene[] } }>('../../cases/*/playback/storyboard.json', { eager: true })
const plannerPlanModules = import.meta.glob<{ default: V1PlannerPlan }>('../../cases/*/diagnosis/planner_plan.json', { eager: true })

const PACKAGE_CACHE = new Map<string, RawCasePackage>()

function caseDirOf(path: string): string {
  // .../cases/<case_id>/... → <case_id>
  const match = path.match(/cases\/([^/]+)\//)
  return match ? match[1] : ''
}

function loadRawPackage(caseId: string): RawCasePackage {
  const cached = PACKAGE_CACHE.get(caseId)
  if (cached) return cached

  const find = <T>(modules: Record<string, { default: T }>): T | undefined => {
    for (const [path, mod] of Object.entries(modules)) {
      if (caseDirOf(path) === caseId) return mod.default
    }
    return undefined
  }

  const caseMeta = find(caseMetaModules)
  if (!caseMeta || caseMeta.case_id !== caseId) {
    throw new Error(`[case-adapter] case not found or id mismatch: ${caseId}`)
  }

  const pkg: RawCasePackage = {
    caseMeta,
    manifest: find(manifestModules) ?? { case_id: caseId },
    resources: find(resourceModules)?.resources ?? [],
    edges: find(topologyModules)?.edges ?? [],
    symptoms: find(symptomModules)?.symptoms ?? [],
    alarms: find(alarmModules)?.alarms ?? [],
    kpis: find(kpiModules)?.series ?? [],
    logs: find(logModules)?.logs ?? [],
    fingerprints: find(fpModules)?.fingerprints ?? [],
    tasks: find(taskModules)?.tasks ?? [],
    evidences: find(evidenceModules)?.evidence ?? [],
    candidates: find(candidateModules)?.candidates ?? [],
    conclusion: find(conclusionModules) ?? {},
    traces: find(traceModules)?.traces ?? [],
    normalizationChain: find(symptomModules)?.normalization_chain,
    similarCases: find(similarModules)?.similar_cases ?? [],
    storyboard: find(storyboardModules)?.scenes ?? [],
    plannerPlan: normalizePlannerPlan(find(plannerPlanModules)),
  }
  PACKAGE_CACHE.set(caseId, pkg)
  return pkg
}

/** 规整 V1 planner_plan.json → V2 PlannerPlan（缺失时返回 null）。 */
function normalizePlannerPlan(raw: V1PlannerPlan | undefined): PlannerPlan | null {
  if (!raw) return null
  return {
    plan_id: raw.plan_id ?? 'plan-unknown',
    original_scope: raw.original_scope ?? '',
    targets: raw.targets ?? [],
    replans: raw.replans ?? [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fact 构建
// ─────────────────────────────────────────────────────────────────────────────

interface Attribution {
  executionId: string
  skillId: string
}

/** 由 tasks.result_refs 反推每个 source_ref 的 execution_id / skill_id 归属。 */
function buildAttribution(tasks: V1Task[]): Map<string, Attribution> {
  const map = new Map<string, Attribution>()
  for (const task of tasks) {
    const exec = `exec-${task.task_id}`
    const skillId = skillCodeToSkillId(task.skill_code)
    for (const ref of task.result_refs ?? []) {
      if (!map.has(ref)) map.set(ref, { executionId: exec, skillId })
    }
  }
  return map
}

function kpiPeak(series: V1KpiSeries): { peakValue: number; peakAt: string; observed: { start: string | null; end: string | null } } {
  const pts = series.points
  if (!pts.length) return { peakValue: 0, peakAt: '', observed: { start: null, end: null } }
  const baseline = series.baseline?.value ?? 0
  let peak = pts[0]
  for (const p of pts) {
    if (Math.abs(p.value - baseline) > Math.abs(peak.value - baseline)) peak = p
  }
  return {
    peakValue: peak.value,
    peakAt: peak.timestamp,
    observed: { start: pts[0].timestamp, end: pts[pts.length - 1].timestamp },
  }
}

function buildFacts(pkg: RawCasePackage): {
  facts: CanonicalFact[]
  bySourceRef: Map<string, CanonicalFact>
} {
  const attribution = buildAttribution(pkg.tasks)
  const facts: CanonicalFact[] = []
  const bySourceRef = new Map<string, CanonicalFact>()

  const attrOf = (ref: string, fallbackSkill: string): Attribution =>
    attribution.get(ref) ?? { executionId: `exec-source-${ref}`, skillId: fallbackSkill }

  // —— ALARM ——
  for (const a of pkg.alarms) {
    const attr = attrOf(a.alarm_id, 'alarm_query')
    const fact: CanonicalFact = {
      fact_id: `fact-${a.alarm_id}`,
      fact_type: FactType.ALARM,
      object_refs: [a.object_id],
      occurred_at: a.occurred_at,
      source: { execution_id: attr.executionId, skill_id: attr.skillId, source_refs: [a.alarm_id] },
      payload: {
        alarm_code: a.alarm_code,
        name: a.name,
        severity: (a.severity ?? '').toUpperCase(),
        occurred_at: a.occurred_at,
        cleared_at: a.cleared_at,
        status: a.status,
        raw_fields: a.raw_fields ?? {},
      },
    }
    facts.push(fact)
    bySourceRef.set(a.alarm_id, fact)
  }

  // —— LOG_FINGERPRINT ——
  const logById = new Map(pkg.logs.map((l) => [l.log_id, l]))
  for (const fp of pkg.fingerprints) {
    const attr = attrOf(fp.fingerprint_id, 'log_fingerprint_query')
    const matchedLogs = (fp.matched_log_ids ?? []).map((id) => logById.get(id)).filter(Boolean) as V1Log[]
    const objectRefs = Array.from(new Set(matchedLogs.map((l) => l.object_id)))
    const fact: CanonicalFact = {
      fact_id: `fact-${fp.fingerprint_id}`,
      fact_type: FactType.LOG_FINGERPRINT,
      object_refs: objectRefs.length ? objectRefs : ['unknown-object'],
      occurred_at: fp.window?.start,
      observed_range: { start: fp.window?.start ?? null, end: fp.window?.end ?? null },
      source: { execution_id: attr.executionId, skill_id: attr.skillId, source_refs: [fp.fingerprint_id] },
      payload: {
        name: fp.name,
        template: fp.template,
        fault_mode_codes: fp.fault_mode_codes ?? [],
        hit_count: fp.hit_count ?? 0,
        matched_log_ids: fp.matched_log_ids ?? [],
      },
    }
    facts.push(fact)
    bySourceRef.set(fp.fingerprint_id, fact)
  }

  // —— LOG（原始日志行，供下钻；通常不被 Evidence 直接引用）——
  for (const lg of pkg.logs) {
    const attr = attrOf(lg.log_id, 'log_fingerprint_query')
    const fact: CanonicalFact = {
      fact_id: `fact-${lg.log_id}`,
      fact_type: FactType.LOG,
      object_refs: [lg.object_id],
      occurred_at: lg.timestamp,
      source: { execution_id: attr.executionId, skill_id: attr.skillId, source_refs: [lg.log_id] },
      payload: {
        level: lg.level,
        component: lg.component,
        message: lg.message,
        fingerprint_id: lg.fingerprint_id,
      },
    }
    facts.push(fact)
    bySourceRef.set(lg.log_id, fact)
  }

  // —— KPI_WINDOW ——
  for (const s of pkg.kpis) {
    const attr = attrOf(s.series_id, 'kpi_query')
    const peak = kpiPeak(s)
    const fact: CanonicalFact = {
      fact_id: `fact-${s.series_id}`,
      fact_type: FactType.KPI_WINDOW,
      object_refs: [s.object_id],
      occurred_at: peak.peakAt || peak.observed.start || undefined,
      observed_range: peak.observed,
      source: {
        execution_id: attr.executionId,
        skill_id: attr.skillId,
        source_refs: [s.series_id],
        query_coverage: { object_coverage: 'COMPLETE', time_coverage: 'COMPLETE', metric_coverage: 'COMPLETE' },
      },
      quality: { level: EvidenceQuality.HIGH, completeness: 'COMPLETE', freshness: 'REPLAY_DATA' },
      payload: {
        metric_name: s.name,
        indicator_id: s.indicator_id,
        unit: s.unit,
        baseline: s.baseline?.value,
        thresholds: s.thresholds ?? {},
        peak_value: peak.peakValue,
        peak_at: peak.peakAt,
        samples: s.points,
      },
    }
    facts.push(fact)
    bySourceRef.set(s.series_id, fact)
  }

  // —— TOPOLOGY_RELATION ——
  for (const e of pkg.edges) {
    const attr = attrOf(e.edge_id, 'topology_query')
    const fact: CanonicalFact = {
      fact_id: `fact-${e.edge_id}`,
      fact_type: FactType.TOPOLOGY_RELATION,
      object_refs: [e.source_id, e.target_id],
      occurred_at: e.valid_from ?? undefined,
      observed_range: { start: e.valid_from ?? null, end: e.valid_to ?? null },
      source: { execution_id: attr.executionId, skill_id: attr.skillId, source_refs: [e.edge_id] },
      payload: {
        relation_type: e.relation_type,
        direction: e.direction,
        path_group: e.path_group,
        redundancy_group: e.redundancy_group,
        state: e.state,
      },
    }
    facts.push(fact)
    bySourceRef.set(e.edge_id, fact)
  }

  // —— RESOURCE_STATE ——
  for (const r of pkg.resources) {
    const attr = attrOf(r.resource_id, 'topology_query')
    const fact: CanonicalFact = {
      fact_id: `fact-${r.resource_id}`,
      fact_type: FactType.RESOURCE_STATE,
      object_refs: [r.resource_id],
      source: { execution_id: attr.executionId, skill_id: attr.skillId, source_refs: [r.resource_id] },
      payload: {
        resource_type: r.resource_type,
        name: r.name,
        parent_id: r.parent_id,
        device_id: r.device_id,
        zone: r.zone,
        location: r.location,
        attributes: r.attributes ?? {},
      },
    }
    facts.push(fact)
    bySourceRef.set(r.resource_id, fact)
  }

  // —— SIMILAR_CASE_REFERENCE ——
  const candidateByObjectLookup = pkg.candidates
  for (const sc of pkg.similarCases) {
    const attr = attrOf(sc.similar_case_id, 'similar_case_query')
    // 相似案例的 object_refs：取该案例根因对象类型在当前实例中的代表性对象。
    // 退化到案例 trigger 对象，保证 minItems>=1。
    const fallbackObject = pkg.caseMeta.trigger?.object_id
      ?? candidateByObjectLookup[0]?.object_id
      ?? 'unknown-object'
    const fact: CanonicalFact = {
      fact_id: `fact-${sc.similar_case_id}`,
      fact_type: FactType.SIMILAR_CASE_REFERENCE,
      object_refs: [fallbackObject],
      source: { execution_id: attr.executionId, skill_id: attr.skillId, source_refs: [sc.similar_case_id] },
      payload: {
        title: sc.title,
        similarity: sc.similarity,
        historical_root_cause: sc.historical_root_cause ?? {},
        matched_features: sc.matched_features ?? [],
        resolution_summary: sc.resolution_summary,
      },
    }
    facts.push(fact)
    bySourceRef.set(sc.similar_case_id, fact)
  }

  return { facts, bySourceRef }
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence / Candidate / Conclusion / Trace 构建
// ─────────────────────────────────────────────────────────────────────────────

function buildCandidates(pkg: RawCasePackage): Candidate[] {
  return pkg.candidates.map((c) => ({
    candidate_id: c.candidate_id,
    object_id: c.object_id,
    fault_mode_code: c.fault_mode_code,
    display_name: c.display_name,
    diagnosis_support_score: confidenceToScore(c.initial_confidence),
    status: CandidateStatus.ACTIVE, // 生成阶段统一 ACTIVE；终态由事件推进
    generated_from: {
      symptom_refs: (c.generation_basis ?? []).filter((b) => b.startsWith('sym-')),
      ontology_relation_refs: (c.generation_basis ?? []).filter((b) => b.startsWith('pattern-') || b.startsWith('rel-')),
    },
  }))
}

function buildEvidences(
  pkg: RawCasePackage,
  facts: CanonicalFact[],
  bySourceRef: Map<string, CanonicalFact>,
  candidateById: Map<string, Candidate>,
): Evidence[] {
  const taskById = new Map(pkg.tasks.map((t) => [t.task_id, t]))
  return pkg.evidences.map((ev) => {
    const effect = mapStanceToEffect(ev.stance, ev.strength)
    const delta = DEFAULT_DELTA[effect]
    const entry: EvidenceEffectEntry = {
      candidate_id: ev.candidate_id,
      effect,
      score_delta: delta,
      explanation: ev.summary,
    }

    // 解析 fact_refs：优先按 source_ref 命中既有 Fact；否则合成 ABSENCE Fact。
    let fact = bySourceRef.get(ev.source_ref)
    if (!fact) {
      const cand = candidateById.get(ev.candidate_id)
      const task = ev.task_id ? taskById.get(ev.task_id) : undefined
      const attrSkill = skillCodeToSkillId(task?.skill_code)
      const attrExec = task ? `exec-${task.task_id}` : `exec-${ev.source_ref}`
      fact = {
        fact_id: `fact-absence-${ev.evidence_id}`,
        fact_type: FactType.ABSENCE,
        object_refs: [cand?.object_id ?? pkg.caseMeta.trigger?.object_id ?? 'unknown-object'],
        source: { execution_id: attrExec, skill_id: attrSkill, source_refs: [ev.source_ref] },
        quality: { level: mapEvidenceQuality(ev.quality), completeness: 'COMPLETE', freshness: 'REPLAY_DATA' },
        payload: {
          absence: true,
          queried_source_ref: ev.source_ref,
          summary: ev.summary,
          detail: ev.detail ?? null,
          evidence_type: ev.evidence_type,
        },
      }
      facts.push(fact)
      bySourceRef.set(ev.source_ref, fact)
    }

    const evidence: Evidence = {
      evidence_id: ev.evidence_id,
      evidence_type: mapEvidenceType(ev.evidence_type, effect),
      fact_refs: [fact.fact_id],
      effects: [entry],
      object_refs: fact.object_refs,
      time_alignment_ms: ev.time_alignment_ms ?? null,
      quality: mapEvidenceQuality(ev.quality),
      created_by: 'reasoning-engine',
    }
    return evidence
  })
}

function buildConclusion(pkg: RawCasePackage): Conclusion | null {
  const c = pkg.conclusion
  const root = c['root_cause'] as { candidate_id: string; object_id: string; fault_mode_code: string; confidence?: number } | undefined
  if (!root) return null
  return {
    diagnosis_id: String(c['diagnosis_id'] ?? `diag-${pkg.caseMeta.case_id}`),
    status: mapTerminalStatus(String(c['status'] ?? 'confirmed')),
    completed_at: c['completed_at'] as string | undefined,
    root_cause: {
      candidate_id: root.candidate_id,
      object_id: root.object_id,
      fault_mode_code: root.fault_mode_code,
      diagnosis_support_score: confidenceToScore(root.confidence),
    },
    root_cause_chain: c['root_cause_chain'] as string[] | undefined,
    impact_chain: c['impact_chain'] as string[] | undefined,
    recovery_chain: c['recovery_chain'] as string[] | undefined,
    excluded_candidates: c['excluded_candidates'] as string[] | undefined,
    diagnosis_summary: c['diagnosis_summary'] as string | undefined,
    key_evidence_refs: c['key_evidence_refs'] as string[] | undefined,
    business_impact: c['business_impact'] as Conclusion['business_impact'],
    current_capability_boundary: c['current_capability_boundary'] as string | undefined,
    repair: c['repair'] as Conclusion['repair'],
  }
}

function buildTrace(pkg: RawCasePackage): Map<string, TraceScorePoint[]> {
  const out = new Map<string, TraceScorePoint[]>()
  // V1 confidence_trace.json：{ traces: [{ candidate_id, trace: [...] }] }。
  // candidate_id 直接来自数据，无需按 case_id 特判。
  for (const entry of pkg.traces) {
    if (!entry?.candidate_id || !Array.isArray(entry.trace)) continue
    out.set(
      entry.candidate_id,
      entry.trace.map((p) => ({
        sequence: p.sequence,
        stage: p.stage,
        score: confidenceToScore(p.confidence),
        evidence_refs: p.evidence_refs,
        reason: p.reason,
      })),
    )
  }
  return out
}

function buildSymptom(pkg: RawCasePackage): SymptomProjection {
  const kpiSymptom = pkg.symptoms.find((s) => s.source === 'kpi') ?? pkg.symptoms[0]
  const win = pkg.caseMeta.observation_window ?? { start: null, end: null }
  return {
    normalized_text: kpiSymptom?.raw_description ?? pkg.caseMeta.description,
    object_refs: Array.from(
      new Set(pkg.symptoms.map((s) => s.object_id).filter((x): x is string => !!x)),
    ),
    time_range: { start: win.start ?? null, end: win.end ?? null },
    normalization_chain: pkg.normalizationChain,
    source_symptom_ids: pkg.symptoms.map((s) => s.symptom_id),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 公共入口
// ─────────────────────────────────────────────────────────────────────────────

const ADAPTED_CACHE = new Map<string, AdaptedCase>()

export function loadAdaptedCase(caseId: string): AdaptedCase {
  const cached = ADAPTED_CACHE.get(caseId)
  if (cached) return cached

  const pkg = loadRawPackage(caseId)
  const { facts, bySourceRef } = buildFacts(pkg)
  const candidates = buildCandidates(pkg)
  const candidateById = new Map(candidates.map((c) => [c.candidate_id, c]))
  const evidences = buildEvidences(pkg, facts, bySourceRef, candidateById)

  // 被引用的 Fact 集合（进入诊断态）
  const referencedFactIds = new Set<string>()
  for (const ev of evidences) for (const r of ev.fact_refs) referencedFactIds.add(r)

  // 按任务发现顺序排列被引用 Fact
  const referencedFacts: CanonicalFact[] = []
  const seen = new Set<string>()
  for (const task of pkg.tasks) {
    for (const ref of task.result_refs ?? []) {
      const fact = bySourceRef.get(ref)
      if (fact && referencedFactIds.has(fact.fact_id) && !seen.has(fact.fact_id)) {
        referencedFacts.push(fact)
        seen.add(fact.fact_id)
      }
    }
  }
  // 兜底：未被任务 result_refs 覆盖的被引用 Fact（如合成的 ABSENCE）
  for (const fact of facts) {
    if (referencedFactIds.has(fact.fact_id) && !seen.has(fact.fact_id)) {
      referencedFacts.push(fact)
      seen.add(fact.fact_id)
    }
  }

  const seriesToObject = new Map(pkg.kpis.map((k) => [k.series_id, k.object_id]))
  const executions: SkillExecution[] = pkg.tasks.map((t) => ({
    execution_id: `exec-${t.task_id}`,
    task_id: t.task_id,
    skill_id: skillCodeToSkillId(t.skill_code),
    status: mapTaskStatus(t.status),
    target_object_refs: readObjectIds(t.input, seriesToObject),
    started_at: t.started_at,
    ended_at: t.ended_at,
    source_refs: t.result_refs ?? [],
    result_summary: t.display_name,
    error: t.error ?? null,
  }))

  const tasks: PlanTask[] = pkg.tasks.map((t, i) => ({
    task_id: t.task_id,
    skill_code: t.skill_code,
    skill_id: skillCodeToSkillId(t.skill_code),
    action: (t.skill_code ?? '').toUpperCase(),
    stage: t.stage,
    display_name: t.display_name,
    goal: t.display_name,
    target_object_refs: readObjectIds(t.input, seriesToObject),
    input: t.input,
    selection_reason: undefined,
    priority: 100 - i,
    execution_mode: 'PARALLEL',
    ui_role: i === 0 ? 'PRIMARY' : 'BACKGROUND',
    status: mapTaskStatus(t.status),
    result_refs: t.result_refs ?? [],
    started_at: t.started_at,
    ended_at: t.ended_at,
    error: t.error ?? null,
  }))

  const conclusion = buildConclusion(pkg)
  const traceByCandidate = buildTrace(pkg)
  const symptom = buildSymptom(pkg)

  const adapted: AdaptedCase = {
    caseId,
    caseMeta: pkg.caseMeta,
    manifest: pkg.manifest,
    symptom,
    facts,
    factBySourceRef: bySourceRef,
    referencedFactIds,
    referencedFacts,
    executions,
    tasks,
    evidences,
    candidates,
    conclusion,
    traceByCandidate,
    storyboard: pkg.storyboard,
    plannerPlan: pkg.plannerPlan,
    resources: pkg.resources,
    edges: pkg.edges,
    instanceTopology: convertV1ToInstanceTopology(caseId, pkg.resources, pkg.edges),
  }
  ADAPTED_CACHE.set(caseId, adapted)
  return adapted
}

/**
 * 从任务 input 提取目标对象 id（target_object_refs）。
 * series_ids 是 KPI 查询的观测序列标识，不代表 CMDB 对象；此处按 KPI series
 * 反查 object_id，使 target_object_refs 反映真实资源（issue#6 阶段A：Planner
 * 目标状态"当前验证中"需要 target_object_refs 指向资源而非序列标识）。
 */
function readObjectIds(input: Record<string, unknown> | undefined, seriesToObject?: Map<string, string>): string[] {
  if (!input) return []
  const ids = new Set<string>()
  const push = (v: unknown) => {
    if (typeof v === 'string') ids.add(v)
    else if (Array.isArray(v)) v.forEach(push)
  }
  for (const key of ['object_ids', 'object_id', 'start_object_id', 'start_object_ids']) {
    push(input[key])
  }
  const series = input['series_ids']
  if (seriesToObject && Array.isArray(series)) {
    for (const s of series) {
      if (typeof s !== 'string') continue
      ids.add(seriesToObject.get(s) ?? s)
    }
  } else {
    push(series)
  }
  return [...ids]
}

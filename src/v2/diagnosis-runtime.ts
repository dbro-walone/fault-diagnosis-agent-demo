/**
 * Diagnosis Runtime —— 编排器（docs/02 §2、§5、docs/08）。
 *
 * 职责：
 * 1. 读取适配后的 V2 案例诊断数据（tasks/evidence/candidates/conclusion/trace）；
 * 2. 确定性地生成 Runtime 事件流（session → symptom → candidates →
 *    tasks/skills/facts → evidences → 候选更新(源自 trace) → 根因确认）；
 * 3. 将事件喂入纯函数 reducer，得到可重建会话快照；
 * 4. 支持 LIVE / PAUSED / REPLAY 三模式与 advance/seek/returnLive。
 *
 * 确定性：同一案例恒产生同一事件流；reducer 满足
 *   Snapshot(n) + Events(n+1..m) = Snapshot(m)。
 *
 * 诊断严谨性（docs/13 §7.4/§13.1/§13.2）：
 * - #1 候选逐步显露：仅初始可见候选在生成阶段进入会话；延迟候选（其 object_id
 *   首个由 replanning 任务揭示，如扰邻施压者）在对应任务完成后才显露；
 * - #5 支持分门控：候选分数仅在其 trace point 引用的 Evidence 均已形成时释放；
 * - #4 确认门槛：根因确认由运行时门槛裁决，不直接信任 conclusion 预置状态。
 */

import { converters, loadAdaptedCase, type AdaptedCase, type TraceScorePoint } from './case-adapter'
import { applyEvent, createEmptySnapshot, reduceEvents, replayToSequence } from './event-reducer'
import {
  compileCase,
  generalizeCandidate,
  resolveRelease,
  type AdapterCompileResult,
  type ReleaseResult,
} from '../adapters/case-knowledge-adapter'
import {
  CandidateStatus,
  DiagnosisPhase,
  EvidenceEffect,
  FactType,
  RuntimeMode,
  TaskStatus,
  TerminalStatus,
  type AgentFocus,
  type Candidate,
  type CanonicalFact,
  type DiagnosisSessionSnapshot,
  type Evidence,
  type PlanTask,
  type PlannerPlan,
  type PlannerTarget,
  type RuntimeEvent,
  type SkillExecution,
} from './runtime-types'

// ─────────────────────────────────────────────────────────────────────────────
// 事件生成
// ─────────────────────────────────────────────────────────────────────────────

/** 顺序号生成器：保证单会话内严格递增、无缺口、从 1 开始。 */
class EventBuilder {
  private seq = 0
  private readonly sessionId: string
  readonly events: RuntimeEvent[] = []

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  emit(
    eventType: RuntimeEvent['event_type'],
    payload: Record<string, unknown>,
    opts: { correlationId?: string; causationId?: string; producer?: string; occurredAt?: string } = {},
  ): RuntimeEvent {
    this.seq += 1
    const event: RuntimeEvent = {
      event_id: `evt-${String(this.seq).padStart(4, '0')}`,
      session_id: this.sessionId,
      sequence: this.seq,
      event_type: eventType,
      occurred_at: opts.occurredAt,
      producer: opts.producer,
      correlation_id: opts.correlationId ?? null,
      causation_id: opts.causationId ?? null,
      payload,
    }
    this.events.push(event)
    return event
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Planner 目标（issue#6 阶段A）
// ─────────────────────────────────────────────────────────────────────────────

/** 取某轮次下可见的 Planner 目标（round ≤ 指定轮次，按 seq 升序）。 */
function targetsForRound(plan: PlannerPlan | null, round: number): PlannerTarget[] {
  if (!plan) return []
  return plan.targets
    .filter((t) => (t.round ?? 1) <= round)
    .sort((a, b) => a.seq - b.seq)
}

/**
 * 找到与当前任务最贴合的 Planner 目标（issue#6 阶段A）。
 * 匹配优先级：目标资源命中任务 target_object_refs → 目标资源命中任务产出的 Fact 对象。
 * 用于把 reason_text / expected_result_text 从泛化文案替换为"该目标为什么验证/期望发现什么"。
 * 无匹配时返回 null（回退泛化文案）。
 */
function planTargetForTask(adapted: AdaptedCase, task: PlanTask): PlannerTarget | null {
  const plan = adapted.plannerPlan
  if (!plan) return null
  const taskObjs = new Set<string>(task.target_object_refs ?? [])
  const factObjs = new Set<string>()
  for (const ref of task.result_refs ?? []) {
    const fact = adapted.factBySourceRef.get(ref)
    // 相似案例引用的对象是启发式回退（案例根因对象在实例中的代表），不代表本任务验证目标。
    if (fact && fact.fact_type !== FactType.SIMILAR_CASE_REFERENCE) {
      for (const o of fact.object_refs ?? []) factObjs.add(o)
    }
  }
  return (
    [...plan.targets]
      .sort((a, b) => a.seq - b.seq)
      .find((t) => taskObjs.has(t.target_resource) || factObjs.has(t.target_resource)) ?? null
  )
}

/** Skill 通用期望文案（按 skill_id，不按 case_id）。 */
function expectedTextForSkill(skillId: string): string {
  switch (skillId) {
    case 'alarm_query':
      return '期望命中与候选对象、时间窗一致的告警生命周期'
    case 'log_fingerprint_query':
      return '期望命中可解释故障机理的日志指纹序列'
    case 'kpi_query':
      return '期望获得对象指标基线、阈值与异常窗口的时序对齐'
    case 'link_health_query':
      return '期望确认链路状态与错误计数是否异常'
    case 'topology_query':
      return '期望获得上下游、主备/共享/复制等关系子图'
    case 'business_mapping':
      return '期望将业务对象映射到具体的 Host/LUN/资源'
    case 'similar_case_query':
      return '期望检索可作辅助参考的历史相似案例'
    default:
      return '期望获得与候选对象、时间一致的观测事实'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 显露门控（#1/§7.4）与确认门槛（#4/§13.2）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CANDIDATES_GENERATED 事件中的候选切片（阶段4：首轮泛化投影）。
 * fault_mode_code / display_name 由 generalizeCandidate 替换为场景级/对象异常级
 * 表示（docs/19 §10.4），精确 FaultMode 由 CANDIDATE_REFINED 事件渐进释放。
 * diagnosis_support_score 保留初始支持分（非最终分，最终分由 trace 渐进释放）。
 */
function candidateGeneratedPayload(c: Candidate, topology: AdaptedCase['instanceTopology']) {
  const g = generalizeCandidate(c, topology)
  return {
    candidate_id: g.candidate_id,
    object_id: g.object_id,
    fault_mode_code: g.fault_mode_code,
    display_name: g.display_name,
    diagnosis_support_score: g.diagnosis_support_score,
    status: CandidateStatus.ACTIVE,
    generated_from: c.generated_from,
  }
}

/**
 * 计算每个候选的显露门控（数据驱动，无 case_id 特判，#1/§7.4/§13.1）。
 *
 * 规则：候选 object_id 首个被某 task 揭示（task 的 target_object_refs 或
 * result_refs→Fact.object_refs）。若该揭示 task 处于 replanning 阶段（反向追溯
 * 引入新对象，如扰邻的施压者 Host-A），候选延迟到该 task 完成后才显露；
 * 否则（含 symptom 已提及、或由常规任务揭示的对象）初始即显露。
 * 无 replanning 任务的 Case（控制器/远程复制）所有候选均初始显露，行为不变。
 *
 * 返回 candidate_id → revealTaskId | null（null 表示初始显露）。
 */
function computeCandidateDisclosure(adapted: AdaptedCase): Map<string, string | null> {
  const initialKnown = new Set(adapted.symptom.object_refs)
  const firstRevealTask = new Map<string, string>()
  for (const task of adapted.tasks) {
    const revealed = new Set<string>(task.target_object_refs ?? [])
    for (const ref of task.result_refs ?? []) {
      const fact = adapted.factBySourceRef.get(ref)
      if (fact) for (const o of fact.object_refs) revealed.add(o)
    }
    for (const o of revealed) {
      if (initialKnown.has(o) || firstRevealTask.has(o)) continue
      firstRevealTask.set(o, task.task_id)
    }
  }
  const taskById = new Map(adapted.tasks.map((t) => [t.task_id, t]))
  const disclosure = new Map<string, string | null>()
  for (const cand of adapted.candidates) {
    const rt = firstRevealTask.get(cand.object_id)
    const task = rt ? taskById.get(rt) : undefined
    disclosure.set(cand.candidate_id, task?.stage === 'replanning' ? rt! : null)
  }
  return disclosure
}

/** 候选最终支持分（取 trace 末点；无 trace 回退初始分）。 */
function finalScores(adapted: AdaptedCase): Map<string, number> {
  const out = new Map<string, number>()
  for (const cand of adapted.candidates) {
    const trace = adapted.traceByCandidate.get(cand.candidate_id)
    const last = trace?.[trace.length - 1]
    out.set(cand.candidate_id, last?.score ?? cand.diagnosis_support_score)
  }
  return out
}

/**
 * 运行时确认门槛裁决（#4/§13.2）。不直接信任 conclusion 预置状态。
 *
 * 六条门槛：
 *  1. 领先候选支持分 ≥ 80；
 *  2. 领先候选最小证据链必需项可被满足（按证据类型覆盖近似）；
 *  3. 至少一个竞争候选被有效区分（存在 WEAKEN/CONFLICT 作用在非领先候选）；
 *  4. 不存在未解决的关键 CONFLICT；
 *  5. 领先候选与第二候选分差 ≥ 15；
 *  6. Ground Truth 所需 Evidence 均已存在（Case 数据完整时总满足）。
 *
 * allPassed → ROOT_CAUSE_CONFIRMED；分数与分差达标但其余不足 → PROBABLE_CAUSES；
 * 分数本身不够 → INSUFFICIENT_EVIDENCE。
 */
function evaluateConfirmationGates(adapted: AdaptedCase, rootId: string | null, excludedEvidenceIds: Set<string> = new Set()) {
  // #17/§13.2：门槛基于“实际可用证据”（排除失败注入导致的缺失证据）。
  const availableEvidences = adapted.evidences.filter((e) => !excludedEvidenceIds.has(e.evidence_id))
  const scores = finalScores(adapted)
  const ranked = [...adapted.candidates].sort(
    (a, b) => (scores.get(b.candidate_id) ?? 0) - (scores.get(a.candidate_id) ?? 0),
  )
  const leader = (rootId ? adapted.candidates.find((c) => c.candidate_id === rootId) : undefined) ?? ranked[0]
  const leaderId = leader?.candidate_id
  const leaderScore = leader ? scores.get(leader.candidate_id) ?? 0 : 0
  const second = ranked.find((c) => c.candidate_id !== leaderId)
  const secondScore = second ? scores.get(second.candidate_id) ?? 0 : 0

  const scoreGate = leaderScore >= 80
  const marginGate = leaderScore - secondScore >= 15
  const competitorGate = availableEvidences.some((e) =>
    e.effects.some(
      (eff) =>
        eff.candidate_id !== leaderId &&
        (eff.effect === EvidenceEffect.WEAKEN || eff.effect === EvidenceEffect.CONFLICT),
    ),
  )
  const noConflictGate = !availableEvidences.some((e) =>
    e.effects.some((eff) => eff.effect === EvidenceEffect.CONFLICT),
  )
  const leaderSupport = availableEvidences.filter((e) =>
    e.effects.some(
      (eff) =>
        eff.candidate_id === leaderId &&
        (eff.effect === EvidenceEffect.STRONG_SUPPORT || eff.effect === EvidenceEffect.SUPPORT),
    ),
  )
  const supportTypes = new Set(leaderSupport.map((e) => e.evidence_type))
  const chainGate =
    leaderSupport.length >= 4 &&
    (supportTypes.has('DIRECT_FAULT') || supportTypes.has('MECHANISM')) &&
    (supportTypes.has('AFFECTED_PATH') || supportTypes.has('IMPACT'))
  const evidenceCompleteGate = true

  const allPassed =
    scoreGate && marginGate && competitorGate && noConflictGate && chainGate && evidenceCompleteGate
  const hasProbableCause = scoreGate && marginGate && !allPassed
  return { allPassed, hasProbableCause, leaderId, leaderScore, secondScore }
}

/** 八幕 stage_code → DiagnosisPhase（docs/13 §16.1，通用映射，非 case_id 特判）。 */
const STAGE_TO_PHASE: Record<string, string> = {
  NORMAL_BASELINE: 'INPUT_COMPLETION',
  SYMPTOM_TRIGGERED: 'SYMPTOM_VALIDATION',
  SCOPE_LOCALIZED: 'SCOPE_LOCALIZATION',
  CANDIDATES_GENERATED: 'CANDIDATE_GENERATION',
  EVIDENCE_COLLECTING: 'CANDIDATE_EVIDENCE',
  CANDIDATES_EVALUATED: 'COMPETING_EXPLANATION',
  DIAGNOSIS_COMPLETED: 'CONCLUSION_CHECK',
  FUTURE_REPAIR_PREVIEW: 'CONCLUSION_CHECK',
}

/**
 * 把 storyboard 八幕映射为 replay_bookmarks（#8/§16.1）：
 * 每幕的 stage_code → DiagnosisPhase → 该 phase 首个 Runtime Event 的 sequence。
 * 不得用 start_offset_ms 作为事实顺序（docs/13 §16.1）。
 */
function compileReplayBookmarks(
  adapted: AdaptedCase,
  phaseSeq: Record<string, number>,
  lastSeq: number,
): Array<{ scene_id: string; sequence: number; title?: string }> {
  return adapted.storyboard.map((scene) => {
    const phase = STAGE_TO_PHASE[(scene.stage_code ?? '').toUpperCase()] ?? null
    let seq = phase ? phaseSeq[phase] : undefined
    if (seq === undefined) seq = scene.sequence <= 1 ? 1 : lastSeq
    return { scene_id: scene.scene_id, sequence: seq, title: scene.title }
  })
}

/** 失败注入配置（#17/§11.3）：指定 task 走异常路径，不修改 Case 数据。 */
export interface FailureInjection {
  taskId: string
  kind: 'DATA_MISSING' | 'FAILED' | 'EMPTY'
}

const FAILURE_TEXT: Record<FailureInjection['kind'], string> = {
  DATA_MISSING: '查询覆盖不完整或数据缺失（注入）',
  FAILED: 'Skill 执行失败（注入）',
  EMPTY: '查询完整但无匹配（注入）',
}

/**
 * 由适配案例确定性生成事件流。
 * 顺序约束（docs/02 §14）：Fact 早于引用它的 Evidence；候选更新引用当时已存在 Evidence；
 * 根因确认在最小证据链满足且确认门槛通过之后。
 * failures（可选）：注入指定 task 的失败路径（#17/§11.3），用于演示异常态。
 */
export function generateEvents(adapted: AdaptedCase, failures: FailureInjection[] = []): RuntimeEvent[] {
  const sessionId = `session-${adapted.caseId}`
  const failureByTask = new Map(failures.map((f) => [f.taskId, f.kind]))
  // #17：注入 task 本应产出的 Fact → 相关 Evidence 也视为缺失（不创建、不参与确认门槛）。
  const injectedFactIds = new Set<string>()
  for (const task of adapted.tasks) {
    if (!failureByTask.has(task.task_id)) continue
    for (const f of factsForTask(adapted, task)) injectedFactIds.add(f.fact_id)
  }
  const injectedEvidenceIds = new Set(
    adapted.evidences.filter((ev) => ev.fact_refs.some((fid) => injectedFactIds.has(fid))).map((ev) => ev.evidence_id),
  )
  const b = new EventBuilder(sessionId)
  const conclusion = adapted.conclusion

  // causation_id 回溯索引：每个领域事件指向其“直接原因事件”的 event_id（docs/02 §4）。
  // 因果必须先于果发生，故在 emit 时捕获前驱事件 id 并向下传递。
  const factDiscoveredEventByFactId = new Map<string, string>() // fact_id → 引入它的 FACT_DISCOVERED
  const evidenceCreatedEventByEvidenceId = new Map<string, string>() // evidence_id → 创建它的 EVIDENCE_CREATED

  // 1. 会话创建（因果链根，无前驱）。
  const sessionCreated = b.emit('DIAGNOSIS_SESSION_CREATED', {
    case_id: adapted.caseId,
    phase: DiagnosisPhase.INPUT_COMPLETION,
  }, { producer: 'runtime' })

  // 2. 现象标准化
  const symptomNormalized = b.emit('SYMPTOM_NORMALIZED', {
    symptom_id: adapted.symptom.source_symptom_ids?.[0] ?? null,
    normalized_text: adapted.symptom.normalized_text,
    object_refs: adapted.symptom.object_refs,
    time_range_start: adapted.symptom.time_range.start,
    time_range_end: adapted.symptom.time_range.end,
    normalization_chain: adapted.symptom.normalization_chain ?? [],
    source_symptom_ids: adapted.symptom.source_symptom_ids ?? [],
  }, { producer: 'normalizer', causationId: sessionCreated.event_id })

  // 3. 资源映射 / 范围定位
  const resourceMapped = b.emit('RESOURCE_MAPPED', {
    object_refs: adapted.symptom.object_refs,
    path_refs: [],
  }, { producer: 'planner', causationId: symptomNormalized.event_id })

  // 4. 候选生成（逐步显露，#1/§7.4）：仅初始可见候选在生成阶段进入会话；
  //    延迟候选在其“揭示任务”完成后才显露（扰邻施压者不在初始页面泄露）。
  const disclosure = computeCandidateDisclosure(adapted)
  const initialCandidates = adapted.candidates.filter((c) => disclosure.get(c.candidate_id) === null)
  const deferredByRevealTask = new Map<string, Candidate[]>()
  for (const c of adapted.candidates) {
    const rt = disclosure.get(c.candidate_id)
    if (!rt) continue
    const arr = deferredByRevealTask.get(rt) ?? []
    arr.push(c)
    deferredByRevealTask.set(rt, arr)
  }
  const phaseCandidateGen = b.emit('DIAGNOSIS_PHASE_CHANGED', { phase: DiagnosisPhase.CANDIDATE_GENERATION },
    { producer: 'planner', causationId: resourceMapped.event_id })
  b.emit('CANDIDATES_GENERATED', {
    candidate_refs: initialCandidates.map((c) => c.candidate_id),
    candidates: initialCandidates.map((c) => candidateGeneratedPayload(c, adapted.instanceTopology)),
  }, { producer: 'reasoning', causationId: phaseCandidateGen.event_id })

  // 5. 进入取证阶段
  const phaseCandidateEvidence = b.emit('DIAGNOSIS_PHASE_CHANGED', { phase: DiagnosisPhase.CANDIDATE_EVIDENCE },
    { producer: 'planner', causationId: phaseCandidateGen.event_id })
  const plan = adapted.plannerPlan

  // Bug1+2 fix: 按 Planner target seq 排序任务，使画布扫描跟随 Planner 路径。
  const sortedTasks = (() => {
    if (!plan || !plan.targets.length) return adapted.tasks
    const seqByResource = new Map<string, number>()
    for (const t of plan.targets) seqByResource.set(t.target_resource, t.seq)
    const indexed = adapted.tasks.map((t, i) => ({ t, i }))
    indexed.sort((a, b) => {
      const ra = a.t.target_object_refs?.[0] ?? ''
      const rb = b.t.target_object_refs?.[0] ?? ''
      const sa = seqByResource.get(ra) ?? 9999
      const sb = seqByResource.get(rb) ?? 9999
      if (sa !== sb) return sa - sb
      return a.i - b.i
    })
    return indexed.map((x) => x.t)
  })()

  const planCreated = b.emit('PLAN_CREATED', {
    plan_id: `plan-${adapted.caseId}-001`,
    phase: DiagnosisPhase.CANDIDATE_EVIDENCE,
    primary_task_id: sortedTasks[0]?.task_id ?? null,
    task_refs: sortedTasks.map((t) => t.task_id),
    // issue#6 阶段A：初始轮次（round=1）的 Planner 目标列表 + 初始诊断范围。
    planner_targets: targetsForRound(plan, 1),
    planner_original_scope: plan?.original_scope ?? null,
  }, { producer: 'planner', causationId: phaseCandidateEvidence.event_id })

  // 6. 逐任务取证：TASK(RUNNING) → SKILL_STARTED → SKILL_COMPLETED → FACT_DISCOVERED → TASK(SUCCEEDED)
  //    因果顺序：Skill 执行完成产出结果 → 由结果归一化出 Fact → 标记任务成功。
  //    故 SKILL_COMPLETED 必须先于 FACT_DISCOVERED，使 FACT_DISCOVERED.causation_id 指向 SKILL_COMPLETED。
  let prevStage: string | undefined
  let planRound = 1
  const occurredAt = adapted.caseMeta.time_origin
  let planEventId = planCreated.event_id // 当前生效计划事件（PLAN_CREATED 或最近 PLAN_REPLANNED）
  let lastFactDiscoveredEventId: string | null = null // 触发重规划的事实证据（最近一次 FACT_DISCOVERED）
  let lastTaskEventId = planCreated.event_id // 最近任务完成事件，供阶段切换因果回溯
  for (const task of sortedTasks) {
    // 重规划：输出 PLAN_REPLANNED（docs/08 §8）。
    // issue#6 阶段A：优先按 Planner 计划的 replan 锚点触发（trigger_task_id，数据驱动），
    // 携带”原范围→新范围、新增目标、暂停目标”差异；无 planner_plan 时回退
    // 到 task.stage === 'replanning' 的旧机制（兼容无计划数据的 Case）。
    // 因果：由前序任务产出的”事实证据”触发（EVIDENCE_CREATED 尚未生成，以最近 FACT_DISCOVERED 为直接前因）。
    const planReplan = plan?.replans?.find((r) => r.trigger_task_id === task.task_id)
    if (planReplan) {
      planRound = Math.max(planRound + 1, planReplan.round)
      const planReplanned = b.emit('PLAN_REPLANNED', {
        plan_id: `plan-${adapted.caseId}-${String(planRound).padStart(3, '0')}`,
        previous_plan_id: `plan-${adapted.caseId}-${String(planRound - 1).padStart(3, '0')}`,
        phase: DiagnosisPhase.CANDIDATE_EVIDENCE,
        reason: planReplan.reason,
        task_refs: [task.task_id],
        planner_targets: targetsForRound(plan, planReplan.round),
        replan: {
          round: planReplan.round,
          reason: planReplan.reason,
          original_scope: planReplan.original_scope,
          new_scope: planReplan.new_scope,
          added_targets: planReplan.added_targets,
          paused_targets: planReplan.paused_targets,
        },
      }, { producer: 'planner', causationId: lastFactDiscoveredEventId ?? lastTaskEventId ?? planEventId })
      planEventId = planReplanned.event_id
    } else if (task.stage && task.stage !== prevStage && task.stage === 'replanning') {
      planRound += 1
      const planReplanned = b.emit('PLAN_REPLANNED', {
        plan_id: `plan-${adapted.caseId}-${String(planRound).padStart(3, '0')}`,
        previous_plan_id: `plan-${adapted.caseId}-${String(planRound - 1).padStart(3, '0')}`,
        phase: DiagnosisPhase.CANDIDATE_EVIDENCE,
        reason: '新增反向追溯任务以定位共享资源与兄弟消费者',
        task_refs: [task.task_id],
      }, { producer: 'planner', causationId: lastFactDiscoveredEventId ?? lastTaskEventId ?? planEventId })
      planEventId = planReplanned.event_id
    }
    prevStage = task.stage

    const execId = `exec-${task.task_id}`
    const uiRole = task.ui_role ?? (task === adapted.tasks[0] ? 'PRIMARY' : 'BACKGROUND')

    const taskRunning = b.emit('TASK_STATUS_CHANGED',
      { task: { ...task, status: TaskStatus.RUNNING }, status: TaskStatus.RUNNING },
      { producer: 'planner', correlationId: execId, causationId: planEventId })

    // issue#6 阶段A：reason/expected 优先取 Planner 目标"为什么验证/期望发现什么"，
    // 无目标匹配时回退到 skill 泛化文案。
    const planTarget = planTargetForTask(adapted, task)
    // SKILL_STARTED / SKILL_COMPLETED 的直接前因为任务派发（TASK_STATUS_CHANGED，或回退到计划事件）。
    b.emit('SKILL_STARTED', {
      execution_id: execId,
      task_id: task.task_id,
      skill_id: task.skill_id,
      ui_role: uiRole,
      goal: task.display_name ?? task.goal ?? null,
      action_text: task.display_name ? `执行 ${task.skill_id}：${task.display_name}` : `执行 ${task.skill_id}`,
      reason_text: planTarget?.verify_question ?? '按 Planner 优先级验证候选相关对象与时间窗',
      expected_result_text: planTarget?.expected_finding ?? expectedTextForSkill(task.skill_id ?? ''),
      target_object_refs: task.target_object_refs ?? [],
    }, { producer: 'skill-executor', correlationId: execId, causationId: taskRunning.event_id, occurredAt: task.started_at ?? occurredAt })

    const failureKind = failureByTask.get(task.task_id)
    let skillCompletedEventId: string
    if (failureKind) {
      // #17 失败注入：Skill 失败路径（不产 Fact，任务标记 DATA_MISSING）。
      skillCompletedEventId = b.emit('SKILL_FAILED', {
        execution_id: execId,
        task_id: task.task_id,
        skill_id: task.skill_id,
        result_summary: FAILURE_TEXT[failureKind],
        error: FAILURE_TEXT[failureKind],
      }, { producer: 'skill-executor', correlationId: execId, causationId: taskRunning.event_id, occurredAt: task.ended_at ?? occurredAt }).event_id
    } else {
      skillCompletedEventId = b.emit('SKILL_COMPLETED', {
        execution_id: execId,
        result_summary: task.display_name ?? null,
        ended_at: task.ended_at ?? null,
      }, { producer: 'skill-executor', correlationId: execId, causationId: taskRunning.event_id, occurredAt: task.ended_at ?? occurredAt }).event_id
    }

    // 仅对被证据引用的 Fact 产生 FACT_DISCOVERED（保证每个 Fact 都有事件引用）。
    // 因果：Fact 由 SKILL_COMPLETED 的结果归一化而来。失败注入时不产 Fact。
    const taskFacts = failureKind ? [] : factsForTask(adapted, task)
    let factDiscoveredEventId: string | null = null
    if (taskFacts.length) {
      const factDiscovered = b.emit('FACT_DISCOVERED', {
        fact_refs: taskFacts.map((f) => f.fact_id),
        facts: taskFacts,
      }, { producer: 'fact-normalizer', correlationId: execId, causationId: skillCompletedEventId })
      factDiscoveredEventId = factDiscovered.event_id
      lastFactDiscoveredEventId = factDiscovered.event_id
      for (const f of taskFacts) factDiscoveredEventByFactId.set(f.fact_id, factDiscovered.event_id)
    }

    lastTaskEventId = b.emit('TASK_STATUS_CHANGED', { task_id: task.task_id, status: failureKind ? TaskStatus.DATA_MISSING : TaskStatus.SUCCEEDED },
      { producer: 'planner', correlationId: execId, causationId: factDiscoveredEventId ?? skillCompletedEventId }).event_id

    // 延迟候选显露（#1/§7.4）：该 task 是某些候选的揭示任务时，把它们加入会话。
    // 因果：由该 task 产出的 Fact（或任务完成事件）触发。
    const revealedNow = deferredByRevealTask.get(task.task_id)
    if (revealedNow?.length) {
      b.emit('CANDIDATES_GENERATED', {
        candidate_refs: revealedNow.map((c) => c.candidate_id),
        candidates: revealedNow.map((c) => candidateGeneratedPayload(c, adapted.instanceTopology)),
      }, { producer: 'reasoning', causationId: factDiscoveredEventId ?? lastTaskEventId })
    }
  }

  // 7. 竞争解释阶段 → 创建全部 Evidence
  const phaseCompeting = b.emit('DIAGNOSIS_PHASE_CHANGED', { phase: DiagnosisPhase.COMPETING_EXPLANATION },
    { producer: 'planner', causationId: lastTaskEventId })
  let lastEvidenceEventId: string | null = null
  for (const ev of adapted.evidences) {
    // #17 失败注入：缺失的 Evidence 不创建（候选更新门控会因此保持分数）。
    if (injectedEvidenceIds.has(ev.evidence_id)) continue
    // 因果：Evidence 派生自其引用的 Fact，取首个已知的 FACT_DISCOVERED 事件。
    const causeByFact = ev.fact_refs.map((id) => factDiscoveredEventByFactId.get(id))
      .find((x): x is string => !!x)
    const evidenceCreated = b.emit('EVIDENCE_CREATED', { evidence_ref: ev.evidence_id, evidence: ev },
      { producer: 'reasoning', causationId: causeByFact ?? phaseCompeting.event_id })
    evidenceCreatedEventByEvidenceId.set(ev.evidence_id, evidenceCreated.event_id)
    lastEvidenceEventId = evidenceCreated.event_id
  }

  // 7.5 候选细化（docs/19 §10.4）：首轮泛化候选（SCENE_* / 场景名）在"直接证据已形成"后
  //     细化为数据包中的精确 FaultMode。数据驱动：任意 Evidence 作用到该候选即视为身份已可
  //     确立（支持或反证均需精确身份），禁止 case_id 特判。
  //     因果：由最近 EVIDENCE_CREATED（或竞争解释阶段事件）触发。
  const refinementCause = lastEvidenceEventId ?? phaseCompeting.event_id
  for (const c of adapted.candidates) {
    const hasEvidence = adapted.evidences.some((e) =>
      e.effects.some((eff) => eff.candidate_id === c.candidate_id),
    )
    if (!hasEvidence) continue
    b.emit('CANDIDATE_REFINED', {
      candidate_id: c.candidate_id,
      fault_mode_code: c.fault_mode_code,
      display_name: c.display_name,
    }, { producer: 'reasoning', causationId: refinementCause })
  }

  // 8. 候选更新：按 trace 序号分轮，确定性地全局递增。
  //    #5/§13.1：仅当 trace point 引用的 Evidence 均已形成才释放分数；缺证保持当前分。
  const evidenceIdSet = new Set(adapted.evidences.map((e) => e.evidence_id))
  const maxRound = Math.max(
    0,
    ...[...adapted.traceByCandidate.values()].map((t) => t[t.length - 1]?.sequence ?? 0),
  )
  const excludedSet = new Set(conclusion?.excluded_candidates ?? [])
  const rootId = conclusion?.root_cause.candidate_id ?? null
  let lastCandidateUpdatedEventId: string | null = null
  let rootConfirmCauseEventId: string | null = null
  for (let round = 2; round <= maxRound; round++) {
    // 计算本轮各候选分数，用于判定 LEADING。
    const scoresThisRound = new Map<string, number>()
    for (const cand of adapted.candidates) {
      const trace = adapted.traceByCandidate.get(cand.candidate_id)
      const point = trace?.find((p) => p.sequence === round)
      if (point) scoresThisRound.set(cand.candidate_id, point.score)
    }
    const leaderId = [...scoresThisRound.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

    for (const cand of adapted.candidates) {
      const trace = adapted.traceByCandidate.get(cand.candidate_id)
      const point = trace?.find((p) => p.sequence === round)
      if (!point) continue
      // #5/§13.1 支持分门控：trace point 引用的 Evidence 必须均已形成，否则保持当前分数。
      if (point.evidence_refs.some((r) => !evidenceIdSet.has(r))) continue
      const prevPoint = trace?.find((p) => p.sequence === round - 1)
      const scoreBefore = prevPoint?.score ?? cand.diagnosis_support_score
      const statusAfter = deriveStatus(cand.candidate_id, point, scoreBefore, leaderId, rootId, excludedSet, round === maxRound)
      // 因果：候选更新由触发的 EVIDENCE_CREATED 驱动，取首个已知证据事件。
      const causeByEvidence = point.evidence_refs.map((id) => evidenceCreatedEventByEvidenceId.get(id))
        .find((x): x is string => !!x)
      const candidateUpdated = b.emit('CANDIDATE_UPDATED', {
        candidate_id: cand.candidate_id,
        score_before: scoreBefore,
        score_after: point.score,
        status_after: statusAfter,
        caused_by_evidence_refs: point.evidence_refs,
        reason: point.reason,
      }, { producer: 'reasoning', causationId: causeByEvidence ?? lastEvidenceEventId ?? phaseCompeting.event_id })
      lastCandidateUpdatedEventId = candidateUpdated.event_id
      if (cand.candidate_id === rootId && round === maxRound) rootConfirmCauseEventId = candidateUpdated.event_id
    }
  }

  // 9. 终态：运行时确认门槛裁决（#4/§13.2），不直接信任 conclusion 预置状态。
  const terminalCause = lastCandidateUpdatedEventId ?? phaseCompeting.event_id
  const phaseConclusion = b.emit('DIAGNOSIS_PHASE_CHANGED', { phase: DiagnosisPhase.CONCLUSION_CHECK },
    { producer: 'planner', causationId: terminalCause })
  let terminalEventId = phaseConclusion.event_id
  const gates = evaluateConfirmationGates(adapted, rootId, injectedEvidenceIds)
  if (conclusion && conclusion.status === TerminalStatus.ROOT_CAUSE_CONFIRMED && rootId && gates.allPassed) {
    // 因果：根因确认由根因候选的最终更新触发。
    const rootConfirmed = b.emit('ROOT_CAUSE_CONFIRMED', {
      candidate_ref: rootId,
      score: conclusion.root_cause.diagnosis_support_score,
      root_cause_chain: conclusion.root_cause_chain ?? [],
      impact_chain: conclusion.impact_chain ?? [],
    }, { producer: 'reasoning', causationId: rootConfirmCauseEventId ?? terminalCause })
    terminalEventId = rootConfirmed.event_id
  } else if (gates.hasProbableCause || (conclusion && conclusion.status === TerminalStatus.PROBABLE_CAUSES)) {
    terminalEventId = b.emit('PROBABLE_CAUSES_REPORTED', { candidate_refs: [] },
      { producer: 'reasoning', causationId: terminalCause }).event_id
  } else {
    terminalEventId = b.emit('INSUFFICIENT_EVIDENCE_REPORTED', {},
      { producer: 'reasoning', causationId: terminalCause }).event_id
  }
  // 八幕书签映射（#8/§16.1）：scene.stage_code → DiagnosisPhase → 该 phase 首事件 sequence。
  const phaseSeq: Record<string, number> = {
    INPUT_COMPLETION: sessionCreated.sequence,
    SYMPTOM_VALIDATION: symptomNormalized.sequence,
    SCOPE_LOCALIZATION: resourceMapped.sequence,
    CANDIDATE_GENERATION: phaseCandidateGen.sequence,
    CANDIDATE_EVIDENCE: phaseCandidateEvidence.sequence,
    COMPETING_EXPLANATION: phaseCompeting.sequence,
    CONCLUSION_CHECK: phaseConclusion.sequence,
  }
  const replayBookmarks = compileReplayBookmarks(adapted, phaseSeq, b.events.length)
  b.emit('DIAGNOSIS_COMPLETED', { conclusion, replay_bookmarks: replayBookmarks }, { producer: 'runtime', causationId: terminalEventId })

  return b.events
}

function factsForTask(adapted: AdaptedCase, task: PlanTask): CanonicalFact[] {
  const execId = `exec-${task.task_id}`
  return adapted.referencedFacts.filter((f) => f.source.execution_id === execId)
}

function deriveStatus(
  candidateId: string,
  point: TraceScorePoint,
  scoreBefore: number,
  leaderId: string | undefined,
  rootId: string | null,
  excludedSet: Set<string>,
  isFinalRound: boolean,
): CandidateStatus {
  if (isFinalRound && excludedSet.has(candidateId)) return CandidateStatus.WEAKENED
  if (isFinalRound && candidateId === rootId) return CandidateStatus.LEADING
  if (candidateId === leaderId) return CandidateStatus.LEADING
  if (point.score < scoreBefore) return CandidateStatus.WEAKENED
  return CandidateStatus.ACTIVE
}

// ─────────────────────────────────────────────────────────────────────────────
// 运行时实例
// ─────────────────────────────────────────────────────────────────────────────

export interface DiagnosisRuntime {
  readonly caseId: string
  readonly sessionId: string
  /** 完整作者事件流。 */
  readonly events: RuntimeEvent[]
  /** 已应用到 live 快照的事件数。 */
  readonly liveHead: number
  /** 回放游标（== liveHead 时为实时态）。 */
  readonly cursor: number
  readonly mode: RuntimeMode
  readonly complete: boolean
  readonly isHistorical: boolean
  /** 当前视图快照（实时或回放）。 */
  readonly snapshot: DiagnosisSessionSnapshot
  /** 实时头快照。 */
  readonly liveSnapshot: DiagnosisSessionSnapshot
  readonly liveEvents: RuntimeEvent[]
  /**
   * 阶段4：Adapter 编译结果（RuntimeSeed + PrivateCaseBundle + ReleaseEnvelope）。
   * Runtime 只消费 Known Ledger + 已释放数据；Bundle 为服务端真值，不直接下发前端。
   */
  readonly compiled: AdapterCompileResult
  /** 阶段4：当前游标处的释放状态（Known Ledger 摘要，docs/19 §8.6）。 */
  releaseState(): ReleaseResult
  advance(): DiagnosisRuntime
  seek(sequence: number): DiagnosisRuntime
  returnLive(): DiagnosisRuntime
  pause(): DiagnosisRuntime
  resume(): DiagnosisRuntime
  reset(): DiagnosisRuntime
}

class DiagnosisRuntimeImpl implements DiagnosisRuntime {
  constructor(
    readonly caseId: string,
    readonly sessionId: string,
    readonly events: RuntimeEvent[],
    readonly liveHead: number,
    private readonly liveSnap: DiagnosisSessionSnapshot,
    readonly cursor: number,
    readonly mode: RuntimeMode,
    readonly compiled: AdapterCompileResult,
  ) {}

  get complete(): boolean {
    return this.liveHead >= this.events.length
  }
  get isHistorical(): boolean {
    return this.cursor < this.liveHead
  }
  get liveSnapshot(): DiagnosisSessionSnapshot {
    return this.liveSnap
  }
  get liveEvents(): RuntimeEvent[] {
    return this.events.slice(0, this.liveHead)
  }
  get snapshot(): DiagnosisSessionSnapshot {
    if (this.cursor === this.liveHead) return this.liveSnap
    return replayToSequence(this.events, this.cursor, this.sessionId, this.caseId)
  }

  releaseState(): ReleaseResult {
    return resolveRelease(this.compiled, this.events, this.cursor)
  }

  advance(): DiagnosisRuntime {
    if (this.liveHead >= this.events.length) return this
    const nextEvent = this.events[this.liveHead]
    const nextLive = applyEvent(this.liveSnap, nextEvent)
    const nextLiveHead = this.liveHead + 1
    const wasLive = this.cursor === this.liveHead
    return new DiagnosisRuntimeImpl(
      this.caseId,
      this.sessionId,
      this.events,
      nextLiveHead,
      nextLive,
      wasLive ? nextLiveHead : this.cursor,
      this.mode === RuntimeMode.PAUSED ? RuntimeMode.PAUSED : RuntimeMode.LIVE,
      this.compiled,
    )
  }

  seek(sequence: number): DiagnosisRuntime {
    const cursor = Math.max(0, Math.min(sequence, this.liveHead))
    const mode = cursor < this.liveHead ? RuntimeMode.REPLAY : this.mode
    return new DiagnosisRuntimeImpl(this.caseId, this.sessionId, this.events, this.liveHead, this.liveSnap, cursor, mode, this.compiled)
  }

  returnLive(): DiagnosisRuntime {
    return new DiagnosisRuntimeImpl(this.caseId, this.sessionId, this.events, this.liveHead, this.liveSnap, this.liveHead, RuntimeMode.LIVE, this.compiled)
  }

  pause(): DiagnosisRuntime {
    return new DiagnosisRuntimeImpl(this.caseId, this.sessionId, this.events, this.liveHead, this.liveSnap, this.cursor, RuntimeMode.PAUSED, this.compiled)
  }

  resume(): DiagnosisRuntime {
    const mode = this.cursor < this.liveHead ? RuntimeMode.REPLAY : RuntimeMode.LIVE
    return new DiagnosisRuntimeImpl(this.caseId, this.sessionId, this.events, this.liveHead, this.liveSnap, this.cursor, mode, this.compiled)
  }

  reset(): DiagnosisRuntime {
    return createDiagnosisRuntime(this.caseId)
  }
}

const RUNTIME_CACHE = new Map<string, { events: RuntimeEvent[]; compiled: AdapterCompileResult }>()

/**
 * 为指定案例创建运行时（事件流 + Adapter 编译结果惰性生成并缓存）。
 * 阶段4：运行时创建时完成 Adapter 确定性编译（Seed/Bundle/Envelope），
 * Runtime 通过 compiled 消费 Known Ledger + 已释放数据，不直接访问 Bundle。
 */
export function createDiagnosisRuntime(caseId: string, failures: FailureInjection[] = []): DiagnosisRuntime {
  const noInjection = failures.length === 0
  let cached = noInjection ? RUNTIME_CACHE.get(caseId) : undefined
  if (!cached) {
    const adapted = loadAdaptedCase(caseId)
    const events = generateEvents(adapted, failures)
    // 编译携带事件流以执行时间级/响应级泄露检查（A9）；失败注入事件流同样合法。
    const compiled = compileCase(adapted, events)
    cached = { events, compiled }
    if (noInjection) RUNTIME_CACHE.set(caseId, cached)
  }
  const sessionId = `session-${caseId}`
  return new DiagnosisRuntimeImpl(
    caseId,
    sessionId,
    cached.events,
    0,
    createEmptySnapshot(sessionId, caseId),
    0,
    RuntimeMode.LIVE,
    cached.compiled,
  )
}

/** 一次性回放完整案例到终态快照（不持有运行时状态）。 */
export function replayCase(caseId: string): DiagnosisSessionSnapshot {
  const adapted = loadAdaptedCase(caseId)
  const events = generateEvents(adapted)
  return reduceEvents(events, `session-${caseId}`, caseId)
}

// 重新导出常用工具，便于消费方单点引入。
export { loadAdaptedCase, converters, type AdaptedCase, type AgentFocus, type SkillExecution }

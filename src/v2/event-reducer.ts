/**
 * Event Reducer —— 纯函数归并器（docs/02 §14、§15）。
 *
 * 契约：
 *   Snapshot(n) + Events(n+1...m) = Snapshot(m)
 *
 * 性质：
 * - 确定性：同一事件流重复归并结果一致；
 * - 幂等：重复 event_id 忽略，晚到（sequence ≤ last_sequence）事件不覆盖状态；
 * - 不可变：每次 applyEvent 返回新快照，不修改输入；
 * - 自包含：事件 payload 携带完整对象，reducer 不依赖外部查找，故回放可任意重建。
 *
 * 推理语义（docs/10）：候选分数以 CANDIDATE_UPDATED 事件为准（源自 V1 trace），
 * 最小证据链按证据类型通用推导（三类 Case 共用，禁止 case_id 特判）。
 */

import {
  CandidateStatus,
  ChainItemStatus,
  EMPTY_AGENT_FOCUS,
  EvidenceEffect,
  RuntimeMode,
  TerminalStatus,
  type AgentFocus,
  type Candidate,
  type CandidateUpdate,
  type CanonicalFact,
  type DiagnosisSessionSnapshot,
  type Evidence,
  type MinimumEvidenceChain,
  type MinimumEvidenceChainItem,
  type RuntimeEvent,
} from './runtime-types'

// ─────────────────────────────────────────────────────────────────────────────
// 快照构造
// ─────────────────────────────────────────────────────────────────────────────

export function createEmptySnapshot(
  sessionId: string,
  caseId: string | null,
): DiagnosisSessionSnapshot {
  return {
    schema_version: '2.0',
    session: {
      session_id: sessionId,
      case_id: caseId,
      version: 0,
      last_sequence: 0,
      mode: RuntimeMode.LIVE,
      phase: '',
      terminal_status: null,
      agent_focus: { ...EMPTY_AGENT_FOCUS },
    },
    symptom: null,
    knowledge_snapshot: null,
    current_activity: null,
    background_activity_ids: [],
    plans: [],
    planner_targets: [],
    planner_replans: [],
    planner_original_scope: null,
    tasks: [],
    skill_executions: [],
    facts: [],
    evidences: [],
    candidates: [],
    candidate_updates: [],
    evidence_chains: [],
    minimum_evidence_chain: null,
    conclusion: null,
    replay_bookmarks: [],
    events: [],
  }
}

/** 从空快照归并完整事件流。 */
export function reduceEvents(
  events: RuntimeEvent[],
  sessionId: string,
  caseId: string | null,
): DiagnosisSessionSnapshot {
  return events.reduce(
    (snapshot, event) => applyEvent(snapshot, event),
    createEmptySnapshot(sessionId, caseId),
  )
}

/** 回放到指定 sequence（仅归并 sequence ≤ throughSequence 的事件，docs/02 §14）。 */
export function replayToSequence(
  events: RuntimeEvent[],
  throughSequence: number,
  sessionId: string,
  caseId: string | null,
): DiagnosisSessionSnapshot {
  const filtered = events.filter((e) => e.sequence <= throughSequence)
  return reduceEvents(filtered, sessionId, caseId)
}

// ─────────────────────────────────────────────────────────────────────────────
// applyEvent —— 单事件归并（纯函数）
// ─────────────────────────────────────────────────────────────────────────────

export function applyEvent(
  prev: DiagnosisSessionSnapshot,
  event: RuntimeEvent,
): DiagnosisSessionSnapshot {
  // 幂等：重复 event_id 忽略（docs/02 §15）。
  if (prev.events.some((e) => e.event_id === event.event_id)) return prev
  // 乱序：晚到事件（sequence ≤ 已归并序号）不得覆盖状态（docs/02 §15）。
  if (event.sequence <= prev.session.last_sequence) return prev

  const next: DiagnosisSessionSnapshot = {
    ...prev,
    session: { ...prev.session },
    events: [...prev.events, event],
  }
  next.session.last_sequence = event.sequence
  next.session.version = prev.session.version + 1

  const payload = event.payload ?? {}

  switch (event.event_type) {
    case 'DIAGNOSIS_SESSION_CREATED':
      handleSessionCreated(next, payload)
      break
    case 'SYMPTOM_NORMALIZED':
      handleSymptomNormalized(next, payload)
      break
    case 'RESOURCE_MAPPED':
      handleResourceMapped(next, payload)
      break
    case 'DIAGNOSIS_PHASE_CHANGED':
      if (typeof payload['phase'] === 'string') next.session.phase = payload['phase']
      break
    case 'PLAN_CREATED':
    case 'PLAN_REPLANNED':
      handlePlan(next, payload)
      break
    case 'TASK_STATUS_CHANGED':
      handleTaskStatus(next, payload)
      break
    case 'SKILL_STARTED':
      handleSkillStarted(next, payload)
      break
    case 'SKILL_COMPLETED':
    case 'SKILL_FAILED':
      handleSkillCompleted(next, payload, event.event_type === 'SKILL_FAILED')
      break
    case 'FACT_DISCOVERED':
      handleFactDiscovered(next, payload, event.sequence)
      break
    case 'FACT_QUALITY_UPDATED':
      handleFactQualityUpdated(next, payload)
      break
    case 'EVIDENCE_CREATED':
      handleEvidenceCreated(next, payload, event.sequence)
      break
    case 'CANDIDATES_GENERATED':
      handleCandidatesGenerated(next, payload)
      break
    case 'CANDIDATE_REFINED':
      handleCandidateRefined(next, payload)
      break
    case 'CANDIDATE_UPDATED':
      handleCandidateUpdated(next, payload, event.sequence)
      break
    case 'CONFLICT_DETECTED':
    case 'CONFLICT_RESOLVED':
      handleConflict(next, payload, event.event_type === 'CONFLICT_DETECTED')
      break
    case 'MINIMUM_CHAIN_UPDATED':
      handleChainUpdated(next, payload)
      break
    case 'ROOT_CAUSE_CONFIRMED':
      handleRootCauseConfirmed(next, payload)
      break
    case 'PROBABLE_CAUSES_REPORTED':
      next.session.terminal_status = TerminalStatus.PROBABLE_CAUSES
      break
    case 'INSUFFICIENT_EVIDENCE_REPORTED':
      next.session.terminal_status = TerminalStatus.INSUFFICIENT_EVIDENCE
      break
    case 'DIAGNOSIS_PAUSED':
      next.session.mode = RuntimeMode.PAUSED
      break
    case 'DIAGNOSIS_RESUMED':
      next.session.mode = RuntimeMode.LIVE
      break
    case 'DIAGNOSIS_COMPLETED':
      handleDiagnosisCompleted(next, payload)
      break
    default:
      // 未知事件类型：仅记录到事件流，不改变状态（前向兼容）。
      break
  }

  return next
}

// ─────────────────────────────────────────────────────────────────────────────
// 事件处理器
// ─────────────────────────────────────────────────────────────────────────────

function handleSessionCreated(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  if (typeof p['case_id'] === 'string') s.session.case_id = p['case_id']
  if (typeof p['phase'] === 'string') s.session.phase = p['phase']
  else if (!s.session.phase) s.session.phase = 'INPUT_COMPLETION'
}

function handleSymptomNormalized(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  s.symptom = {
    normalized_text: stringOr(p['normalized_text'], ''),
    object_refs: stringArray(p['object_refs']),
    time_range: {
      start: (p['time_range_start'] as string | null) ?? null,
      end: (p['time_range_end'] as string | null) ?? null,
    },
    normalization_chain: stringArray(p['normalization_chain']),
    source_symptom_ids: stringArray(p['source_symptom_ids']),
  }
  s.session.phase = 'SYMPTOM_VALIDATION'
  const objs = s.symptom.object_refs
  if (objs.length) {
    s.session.agent_focus = {
      source_type: 'symptom',
      source_id: (p['symptom_id'] as string) ?? null,
      object_refs: objs,
      path_refs: [],
    }
  }
}

function handleResourceMapped(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  s.session.phase = 'SCOPE_LOCALIZATION'
  const objs = stringArray(p['object_refs']).concat(stringArray(p['mapped_object_refs']))
  const unique = Array.from(new Set(objs))
  if (unique.length) {
    s.session.agent_focus = {
      source_type: 'scope',
      source_id: null,
      object_refs: unique,
      path_refs: stringArray(p['path_refs']),
    }
  }
}

function handlePlan(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  const planId = stringOr(p['plan_id'], `plan-${s.session.last_sequence}`)
  const others = s.plans.filter((pl) => pl.plan_id !== planId)
  s.plans = [
    ...others,
    {
      plan_id: planId,
      phase: stringOr(p['phase'], s.session.phase),
      primary_task_id: (p['primary_task_id'] as string) ?? null,
      tasks: stringArray(p['task_refs']),
    },
  ]
  // issue#6 阶段A：Planner 目标列表随 PLAN 事件下发（重规划时更新为最新轮次目标）。
  if (Array.isArray(p['planner_targets'])) {
    s.planner_targets = p['planner_targets'] as DiagnosisSessionSnapshot['planner_targets']
  }
  if (typeof p['planner_original_scope'] === 'string') {
    s.planner_original_scope = p['planner_original_scope']
  }
  const replan = p['replan']
  if (replan && typeof replan === 'object') {
    s.planner_replans = [...s.planner_replans, replan as DiagnosisSessionSnapshot['planner_replans'][number]]
  }
}

function handleTaskStatus(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  const task = p['task'] as DiagnosisSessionSnapshot['tasks'][number] | undefined
  const taskId = (p['task_id'] as string) ?? task?.task_id
  if (!taskId) return
  const status = (p['status'] as string) ?? task?.status
  if (task) {
    s.tasks = upsertById(s.tasks, task, 'task_id')
  }
  if (status) {
    s.tasks = s.tasks.map((t) =>
      t.task_id === taskId ? { ...t, status: status as DiagnosisSessionSnapshot['tasks'][number]['status'] } : t,
    )
  }
  refreshActivity(s)
}

function handleSkillStarted(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  const exec = p['execution'] as DiagnosisSessionSnapshot['skill_executions'][number] | undefined
  const executionId = (p['execution_id'] as string) ?? exec?.execution_id
  if (exec) {
    s.skill_executions = upsertById(s.skill_executions, exec, 'execution_id')
  } else if (executionId) {
    s.skill_executions = upsertById(
      s.skill_executions,
      {
        execution_id: executionId,
        task_id: (p['task_id'] as string) ?? undefined,
        skill_id: (p['skill_id'] as string) ?? '',
        status: 'RUNNING',
      },
      'execution_id',
    )
  }
  // 设置当前主活动（docs/02 §10）。后台任务不抢占唯一的 primary_activity。
  if (p['ui_role'] !== 'BACKGROUND') {
    s.current_activity = {
      goal: (p['goal'] as string) ?? null,
      action_text: (p['action_text'] as string) ?? null,
      reason_text: (p['reason_text'] as string) ?? null,
      expected_result_text: (p['expected_result_text'] as string) ?? null,
      result_summary: null,
      task_id: (p['task_id'] as string) ?? null,
      execution_id: executionId ?? null,
      status: 'RUNNING',
      target_object_refs: stringArray(p['target_object_refs']),
      expected_evidence: (p['expected_evidence'] as ActivityProjHint[]) ?? undefined,
    }
  } else if (s.current_activity && executionId) {
    s.background_activity_ids = Array.from(
      new Set([...(s.background_activity_ids ?? []), executionId]),
    )
  }
}

function handleSkillCompleted(
  s: DiagnosisSessionSnapshot,
  p: Record<string, unknown>,
  failed: boolean,
): void {
  const executionId = p['execution_id'] as string | undefined
  if (executionId) {
    s.skill_executions = s.skill_executions.map((e) =>
      e.execution_id === executionId
        ? {
            ...e,
            status: failed ? 'FAILED' : 'SUCCEEDED',
            result_summary: (p['result_summary'] as string) ?? e.result_summary,
            ended_at: (p['ended_at'] as string) ?? e.ended_at,
          }
        : e,
    )
  }
  // 更新当前活动的结果摘要。
  if (s.current_activity && (!executionId || s.current_activity.execution_id === executionId)) {
    s.current_activity = {
      ...s.current_activity,
      result_summary: (p['result_summary'] as string) ?? s.current_activity.result_summary,
      status: failed ? 'FAILED' : 'SUCCEEDED',
    }
  }
}

function handleFactDiscovered(
  s: DiagnosisSessionSnapshot,
  p: Record<string, unknown>,
  sequence: number,
): void {
  const incoming = (p['facts'] as CanonicalFact[] | undefined) ?? []
  const actExecId = s.current_activity?.execution_id ?? null
  const producedForActivity: string[] = []
  for (const fact of incoming) {
    if (!fact || s.facts.some((f) => f.fact_id === fact.fact_id)) continue
    s.facts = [...s.facts, { ...fact, created_sequence: fact.created_sequence ?? sequence }]
    // 回填当前主活动（Skill 执行）产出的 fact_refs，使 L1 当前行动可经 fact_id
    // 链接 L2（证据链事实预览）→ L3（事实原始详情）。后台任务的产出不计入主活动。
    if (actExecId && fact.source?.execution_id === actExecId) producedForActivity.push(fact.fact_id)
  }
  if (producedForActivity.length && s.current_activity) {
    s.current_activity = {
      ...s.current_activity,
      fact_refs: Array.from(new Set([...(s.current_activity.fact_refs ?? []), ...producedForActivity])),
    }
  }
}

function handleFactQualityUpdated(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  const factId = p['fact_id'] as string | undefined
  if (!factId) return
  s.facts = s.facts.map((f) =>
    f.fact_id === factId ? { ...f, quality: { ...(f.quality ?? {}), ...(p['quality'] as object) } } : f,
  )
}

function handleEvidenceCreated(
  s: DiagnosisSessionSnapshot,
  p: Record<string, unknown>,
  sequence: number,
): void {
  const evidence = p['evidence'] as Evidence | undefined
  if (!evidence || s.evidences.some((e) => e.evidence_id === evidence.evidence_id)) return
  const stamped: Evidence = { ...evidence, created_sequence: evidence.created_sequence ?? sequence }
  s.evidences = [...s.evidences, stamped]
  // 维护候选的证据引用桶。
  for (const eff of stamped.effects) {
    s.candidates = s.candidates.map((c) => {
      if (c.candidate_id !== eff.candidate_id) return c
      return bucketEvidence(c, eff.effect, stamped.evidence_id)
    })
  }
  // #20/07§8：Evidence 引用当前活动产出的 Fact 时，回填 current_activity.evidence_refs。
  if (s.current_activity?.execution_id) {
    const producedHere = stamped.fact_refs.some(
      (fid) => s.facts.find((f) => f.fact_id === fid)?.source.execution_id === s.current_activity!.execution_id,
    )
    if (producedHere) {
      s.current_activity = {
        ...s.current_activity,
        evidence_refs: Array.from(new Set([...(s.current_activity.evidence_refs ?? []), stamped.evidence_id])),
      }
    }
  }
  // 证据变化后重算受影响候选的链。
  recomputeChainsFor(s, new Set(stamped.effects.map((e) => e.candidate_id)))
}

function handleCandidatesGenerated(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  const incoming = (p['candidates'] as Candidate[] | undefined) ?? []
  // 合并：保留已存在的（避免覆盖终态），新增未存在的。
  const byId = new Map(s.candidates.map((c) => [c.candidate_id, c]))
  for (const c of incoming) {
    if (!byId.has(c.candidate_id)) byId.set(c.candidate_id, c)
  }
  s.candidates = [...byId.values()]
  s.session.phase = 'CANDIDATE_GENERATION'
  recomputeKnowledgeAndFocus(s)
  recomputeChainsFor(s, new Set(incoming.map((c) => c.candidate_id)))
}

/**
 * CANDIDATE_REFINED —— 首轮泛化候选细化为精确 FaultMode（docs/19 §10.4）。
 * 泛化候选（SCENE_* / 场景名）在对应直接证据形成后，由事件细化为
 * 数据包中的精确 fault_mode_code / display_name。只替换身份字段，
 * 不改变分数与证据桶。
 */
function handleCandidateRefined(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  const candidateId = p['candidate_id'] as string | undefined
  if (!candidateId) return
  const faultModeCode = p['fault_mode_code'] as string | undefined
  const displayName = p['display_name'] as string | undefined
  s.candidates = s.candidates.map((c) => {
    if (c.candidate_id !== candidateId) return c
    return {
      ...c,
      fault_mode_code: faultModeCode ?? c.fault_mode_code,
      display_name: displayName ?? c.display_name,
    }
  })
  recomputeKnowledgeAndFocus(s)
  recomputeChainsFor(s, new Set([candidateId]))
}

function handleCandidateUpdated(
  s: DiagnosisSessionSnapshot,
  p: Record<string, unknown>,
  sequence: number,
): void {
  const candidateId = p['candidate_id'] as string | undefined
  if (!candidateId) return
  const scoreBefore = numberOr(p['score_before'], 0)
  const scoreAfter = numberOr(p['score_after'], scoreBefore)
  const statusAfter = p['status_after'] as CandidateStatus | undefined

  let statusBefore: CandidateStatus | undefined
  s.candidates = s.candidates.map((c) => {
    if (c.candidate_id !== candidateId) return c
    statusBefore = c.status
    return {
      ...c,
      diagnosis_support_score: clampScore(scoreAfter),
      status: statusAfter ?? c.status,
    }
  })

  const update: CandidateUpdate = {
    update_id: (p['update_id'] as string) ?? `cu-${candidateId}-${sequence}`,
    candidate_id: candidateId,
    score_before: scoreBefore,
    score_after: clampScore(scoreAfter),
    status_before: statusBefore,
    status_after: statusAfter,
    caused_by_evidence_refs: stringArray(p['caused_by_evidence_refs']),
    reason: stringOr(p['reason'], ''),
    chain_changes: (p['chain_changes'] as CandidateUpdate['chain_changes']) ?? undefined,
    sequence,
  }
  s.candidate_updates = [...s.candidate_updates, update]
  // #20/07§8：候选更新由当前活动证据驱动时，回填 current_activity.candidate_update_refs。
  if (s.current_activity?.evidence_refs?.length && update.caused_by_evidence_refs.length) {
    const drivenByActivity = update.caused_by_evidence_refs.some((eid) =>
      s.current_activity!.evidence_refs!.includes(eid),
    )
    if (drivenByActivity) {
      s.current_activity = {
        ...s.current_activity,
        candidate_update_refs: Array.from(
          new Set([...(s.current_activity.candidate_update_refs ?? []), update.update_id ?? `cu-${candidateId}`]),
        ),
      }
    }
  }
  recomputeKnowledgeAndFocus(s)
  recomputeChainsFor(s, new Set([candidateId]))
}

function handleConflict(s: DiagnosisSessionSnapshot, p: Record<string, unknown>, detected: boolean): void {
  const ks = s.knowledge_snapshot ?? { summary: null, leading_candidate_id: null, critical_conflict_count: 0 }
  const delta = detected ? 1 : -1
  s.knowledge_snapshot = {
    ...ks,
    critical_conflict_count: Math.max(0, ks.critical_conflict_count + delta),
    summary: (p['summary'] as string) ?? ks.summary,
  }
}

function handleChainUpdated(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  const candidateId = p['candidate_ref'] as string | undefined
  const items = p['items'] as MinimumEvidenceChainItem[] | undefined
  if (!candidateId) return
  if (items) {
    s.evidence_chains = upsertById(
      s.evidence_chains,
      { candidate_id: candidateId, items },
      'candidate_id',
    )
  }
  publishMinimumChain(s)
}

function handleRootCauseConfirmed(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  const candidateId = p['candidate_ref'] as string | undefined
  const score = p['score'] !== undefined ? numberOr(p['score'], 0) : undefined
  if (candidateId) {
    s.candidates = s.candidates.map((c) =>
      c.candidate_id === candidateId
        ? { ...c, status: CandidateStatus.CONFIRMED, diagnosis_support_score: score ?? c.diagnosis_support_score }
        : c,
    )
    // 强制该候选最小证据链所有必需项 SATISFIED（docs/02 §14：根因确认时链必须已满足）。
    recomputeChainsFor(s, new Set([candidateId]), { forceSatisfied: true })
  }
  s.session.terminal_status = TerminalStatus.ROOT_CAUSE_CONFIRMED
  s.session.phase = 'CONCLUSION_CHECK'
  // 焦点切换到根因链对象。
  const rootChain = stringArray(p['root_cause_chain'])
  const focusObjs = rootChain.length
    ? rootChain
    : (s.candidates.find((c) => c.candidate_id === candidateId)?.object_id
      ? [s.candidates.find((c) => c.candidate_id === candidateId)!.object_id]
      : [])
  s.session.agent_focus = {
    source_type: 'root_cause',
    source_id: candidateId ?? null,
    object_refs: focusObjs,
    path_refs: stringArray(p['impact_chain']),
  }
  publishMinimumChain(s)
}

function handleDiagnosisCompleted(s: DiagnosisSessionSnapshot, p: Record<string, unknown>): void {
  if (!s.session.terminal_status) s.session.terminal_status = TerminalStatus.ROOT_CAUSE_CONFIRMED
  if (p['conclusion']) s.conclusion = p['conclusion'] as DiagnosisSessionSnapshot['conclusion']
  // 八幕书签（#8/§16.1）：随终态事件下发，回放按幕定位到 Event sequence。
  const bookmarks = p['replay_bookmarks']
  if (Array.isArray(bookmarks)) {
    s.replay_bookmarks = bookmarks as DiagnosisSessionSnapshot['replay_bookmarks']
  }
  // 诊断完成：清空当前活动。
  s.current_activity = null
}

// ─────────────────────────────────────────────────────────────────────────────
// 派生计算（leading / focus / chain）
// ─────────────────────────────────────────────────────────────────────────────

function refreshActivity(s: DiagnosisSessionSnapshot): void {
  // 当存在主任务 RUNNING 时，从任务+执行回填 current_activity 的 status。
  if (!s.current_activity) return
  const tid = s.current_activity.task_id
  if (!tid) return
  const task = s.tasks.find((t) => t.task_id === tid)
  if (task) s.current_activity.status = task.status
}

function recomputeKnowledgeAndFocus(s: DiagnosisSessionSnapshot): void {
  const confirmed = s.candidates.find((c) => c.status === CandidateStatus.CONFIRMED)
  const eligible = s.candidates.filter(
    (c) => c.status !== CandidateStatus.NOT_CONFIRMED && c.status !== CandidateStatus.INSUFFICIENT_EVIDENCE,
  )
  const ranked = [...eligible].sort((a, b) => b.diagnosis_support_score - a.diagnosis_support_score)
  const leading = confirmed ?? ranked[0]
  const conflictCount = s.knowledge_snapshot?.critical_conflict_count ?? 0
  s.knowledge_snapshot = {
    summary: leading ? `领先候选：${leading.display_name ?? leading.candidate_id}（支持分 ${leading.diagnosis_support_score}）` : null,
    leading_candidate_id: leading?.candidate_id ?? null,
    critical_conflict_count: conflictCount,
  }
  // 焦点跟随领先候选对象（仅 Runtime 更新 agent_focus）。
  if (leading) {
    s.session.agent_focus = {
      source_type: 'candidate',
      source_id: leading.candidate_id,
      object_refs: [leading.object_id],
      path_refs: s.session.agent_focus.path_refs,
    }
  }
}

/** 通用最小证据链模板（docs/10 §8），按证据类型匹配，三类 Case 共用。 */
interface ChainRequirement {
  requirement_id: string
  label: string
  required: boolean
  matches: (evidence: Evidence, effect: EvidenceEffect) => boolean
}

const CHAIN_REQUIREMENTS: ChainRequirement[] = [
  {
    requirement_id: 'direct_fault',
    label: '直接故障/关键机制',
    required: true,
    matches: (e) => e.evidence_type === 'DIRECT_FAULT' || e.evidence_type === 'MECHANISM',
  },
  {
    requirement_id: 'affected_path',
    label: '对象位于影响路径',
    required: true,
    matches: (e) => e.evidence_type === 'AFFECTED_PATH',
  },
  {
    requirement_id: 'time_alignment',
    label: '时间一致性',
    required: true,
    matches: (e) => e.time_alignment_ms != null,
  },
  {
    requirement_id: 'impact',
    label: '主要业务影响可解释',
    required: true,
    matches: (e) => e.evidence_type === 'IMPACT',
  },
  {
    requirement_id: 'competitor_check',
    label: '关键竞争候选检查',
    required: true,
    matches: (_e, effect) => effect === EvidenceEffect.WEAKEN || effect === EvidenceEffect.CONFLICT,
  },
  {
    requirement_id: 'similar_case',
    label: '相似案例辅助参考',
    required: false,
    matches: (e) => e.evidence_type === 'SIMILAR_CASE',
  },
]

/** 证据 → 其作用到的候选 + effect。 */
function evidenceEffectPairs(e: Evidence): Array<{ candidateId: string; effect: EvidenceEffect }> {
  return e.effects.map((eff) => ({ candidateId: eff.candidate_id, effect: eff.effect }))
}

function recomputeChainsFor(
  s: DiagnosisSessionSnapshot,
  candidateIds: Set<string>,
  opts: { forceSatisfied?: boolean } = {},
): void {
  if (!candidateIds.size) return
  // 会话级反证（用于 competitor_check）：任意 WEAKEN/CONFLICT 证据。
  const sessionCounterEvidences = s.evidences.filter((e) =>
    e.effects.some((eff) => eff.effect === EvidenceEffect.WEAKEN || eff.effect === EvidenceEffect.CONFLICT),
  )

  for (const candidateId of candidateIds) {
    const candidate = s.candidates.find((c) => c.candidate_id === candidateId)
    if (!candidate) continue

    const supportEvidences = s.evidences.filter((e) =>
      e.effects.some((eff) => eff.candidate_id === candidateId &&
        (eff.effect === EvidenceEffect.STRONG_SUPPORT || eff.effect === EvidenceEffect.SUPPORT)),
    )
    const supportRefs = supportEvidences.map((e) => e.evidence_id)

    const items: MinimumEvidenceChainItem[] = CHAIN_REQUIREMENTS.map((req) => {
      const pool = req.requirement_id === 'competitor_check' ? sessionCounterEvidences : supportEvidences
      let refs: string[]
      if (req.requirement_id === 'competitor_check') {
        refs = pool.map((e) => e.evidence_id)
      } else {
        refs = pool
          .filter((e) => {
            const eff = e.effects.find((x) => x.candidate_id === candidateId)?.effect
            return eff ? req.matches(e, eff) : false
          })
          .map((e) => e.evidence_id)
      }
      let status: ChainItemStatus
      if (refs.length) status = ChainItemStatus.SATISFIED
      else if (req.required && opts.forceSatisfied) {
        // 确认时回填：用全部支持证据满足必需项。
        refs = supportRefs
        status = supportRefs.length ? ChainItemStatus.SATISFIED : ChainItemStatus.UNAVAILABLE
      } else if (supportEvidences.length) status = ChainItemStatus.IN_PROGRESS
      else status = ChainItemStatus.PENDING

      return {
        requirement_id: req.requirement_id,
        label: req.label,
        required: req.required,
        status,
        evidence_refs: refs,
      }
    })

    s.evidence_chains = upsertById(
      s.evidence_chains,
      { candidate_id: candidateId, items },
      'candidate_id',
    )
  }
  publishMinimumChain(s)
}

/** 选定 minimum_evidence_chain：已确认候选 > 领先候选 > 首个。 */
function publishMinimumChain(s: DiagnosisSessionSnapshot): void {
  const pick =
    s.candidates.find((c) => c.status === CandidateStatus.CONFIRMED)?.candidate_id ??
    s.knowledge_snapshot?.leading_candidate_id ??
    s.candidates[0]?.candidate_id
  s.minimum_evidence_chain = pick ? s.evidence_chains.find((c) => c.candidate_id === pick) ?? null : null
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────────────────────

function bucketEvidence(c: Candidate, effect: EvidenceEffect, evidenceId: string): Candidate {
  const support = c.supporting_evidence_refs ?? []
  const weaken = c.weakening_evidence_refs ?? []
  const conflict = c.conflicting_evidence_refs ?? []
  return {
    ...c,
    supporting_evidence_refs:
      effect === EvidenceEffect.STRONG_SUPPORT || effect === EvidenceEffect.SUPPORT
        ? support.includes(evidenceId) ? support : [...support, evidenceId]
        : support,
    weakening_evidence_refs:
      effect === EvidenceEffect.WEAKEN
        ? weaken.includes(evidenceId) ? weaken : [...weaken, evidenceId]
        : weaken,
    conflicting_evidence_refs:
      effect === EvidenceEffect.CONFLICT
        ? conflict.includes(evidenceId) ? conflict : [...conflict, evidenceId]
        : conflict,
  }
}

function upsertById<T>(arr: T[], item: T, idKey: keyof T): T[] {
  const id = item[idKey]
  const idx = arr.findIndex((x) => x[idKey] === id)
  if (idx === -1) return [...arr, item]
  const copy = arr.slice()
  copy[idx] = { ...copy[idx], ...item }
  return copy
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}
function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

// 仅用于类型提示（ActivityProjection.expected_evidence 形状）。
interface ActivityProjHint {
  requirement_id: string
  description?: string
}

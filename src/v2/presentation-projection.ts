/**
 * Presentation Projection 协议层 —— 纯函数实现（P0，Issue #12「诊断过程展示优化」）。
 *
 * 职责：把"不可变递增事件流归并出的诊断快照 + 适配案例"投影为前端相机可消费的
 * 一屏一主体展示协议（phase / subject / focus_signature / 上下文 / 路由 / 技能 /
 * 事实 / 候选变化 / 决策解释 / 终态摘要）。
 *
 * 铁律：
 * - 纯函数、零副作用、不依赖 DOM/React；
 * - 不修改 Runtime Event Contract，不修改 projection-store.ts（只读取其 planner VM）；
 * - 确定性：相同 snapshot 恒产生相同输出（focus_signature 保证同主体不重复 Travel）；
 * - 最近事件一律从 snapshot.events 末条取，禁止外部独立传入 lastEvent（防未来泄漏/错配）；
 * - 返回的数组字段一律浅拷贝，调用方不得反向污染 snapshot。
 */

import {
  TaskStatus,
  type DiagnosisSessionSnapshot,
  type PlannerTarget,
  type RuntimeEvent,
} from './runtime-types'
import type { AdaptedCase } from './case-adapter'
import { ProjectionStore } from './projection-store'
import {
  CameraPhase,
  type DiagnosisPresentationVM,
  type PresentationSubject,
  type TerminalType,
} from './presentation-types'

// ─────────────────────────────────────────────────────────────────────────────
// 入口函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 投影入口：快照 + 适配案例 → 一屏一主体的展示 View Model。
 * 最近事件从 snapshot.events 末条推导（"本轮新增事实 / 候选变化摘要"，
 * 回放时每个事件一帧）。
 */
export function presentationProjection(
  snapshot: DiagnosisSessionSnapshot,
  adapted: AdaptedCase,
): DiagnosisPresentationVM {
  // 最近事件：只能来自快照事件流末条（与快照状态严格一致，杜绝未来泄漏/错配）。
  const lastEvent = snapshot.events[snapshot.events.length - 1]

  // 一屏一主体：终态 > 路径 > 节点 > null。
  const subject = deriveSubject(snapshot, adapted)
  const focusSignature = computeFocusSignature(subject)

  // Planner 目标 VM（复用 projection-store 的确定性推导，与 UI 保持同一口径）。
  const plannerStore = new ProjectionStore()
  plannerStore.bind(snapshot)
  const plannerVm = plannerStore.plannerTargets()
  const activeTargetVm = plannerVm.targets.find((t) => t.is_active) ?? null
  const activeTarget = activeTargetVm
    ? snapshot.planner_targets.find((t) => t.target_resource === activeTargetVm.target_resource) ?? null
    : null

  const act = snapshot.current_activity

  return {
    phase: lastEvent ? mapEventToPhase(lastEvent.event_type, snapshot) : CameraPhase.ORIENT,
    subject,
    focus_signature: focusSignature,
    // 上下文对象：主体的一跳拓扑邻居（保持可见的关联节点）。
    context_object_ids: subject ? oneHopNeighbors(adapted, subject.primary_id).slice() : [],
    // 下一调查路径预览：下一个 pending Planner 目标的 topo_path。
    route_object_ids: nextPendingPath(snapshot, plannerVm).slice(),
    // 当前执行中的 Skill（仅 RUNNING 主活动）。
    active_skills: currentActiveSkills(snapshot).slice(),
    // 本轮新增事实（FACT_DISCOVERED 事件）。
    new_fact_refs:
      lastEvent?.event_type === 'FACT_DISCOVERED' ? stringArray(lastEvent.payload['fact_refs']).slice() : [],
    // 候选变化摘要（最近 CANDIDATE_UPDATED 事件 + 当前活动引用的更新）。
    candidate_deltas: deriveCandidateDeltas(snapshot, lastEvent).slice(),
    // 当前决策解释：当前活动理由 > Planner 目标"为什么验证"。
    reason: act?.reason_text ?? activeTarget?.verify_question ?? null,
    // 预期证据：当前活动期望结果 > Planner 目标期望发现（浅拷贝防污染）。
    expected_evidence: deriveExpectedEvidence(act, activeTarget).slice(),
    terminal_summary: deriveTerminalSummary(snapshot, adapted),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// computeFocusSignature —— 主体唯一签名（变化才触发 Travel）
// ─────────────────────────────────────────────────────────────────────────────

/** 主体唯一签名。同主体恒同签名；主体变化签名必变。null → 'NONE'。 */
export function computeFocusSignature(subject: PresentationSubject | null): string {
  if (!subject) return 'NONE'
  switch (subject.kind) {
    case 'node':
      return `NODE:${subject.primary_id}`
    case 'path':
      return `PATH:${subject.node_ids.join('>')}`
    case 'relation_group':
      return `GROUP:${subject.member_ids.join('+')}|${subject.relation}`
    case 'terminal':
      return `TERMINAL:${subject.primary_id}|${subject.terminal_type}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// mapEventToPhase —— 事件 → 镜头阶段
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 事件 → 镜头阶段（27 种事件全覆盖，穷尽检查）。
 * snapshot 为该事件应用后的快照（snapshot.events 末条即本事件），用于解析
 * DIAGNOSIS_PHASE_CHANGED 的目标阶段、TASK_STATUS_CHANGED 的状态、以及
 * ROOT_CAUSE_CONFIRMED 是否为终态（terminal_status 非 null）。
 * 交互/控制/推理中间产物类事件显式映射到 CONTEXT（安全默认），不再静默回退 ORIENT。
 */
export function mapEventToPhase(eventType: RuntimeEvent['event_type'], snapshot: DiagnosisSessionSnapshot): CameraPhase {
  const lastEvent = snapshot.events[snapshot.events.length - 1]
  const p = lastEvent?.payload ?? {}

  switch (eventType) {
    // 会话开始/现象进入：全景定位。
    case 'DIAGNOSIS_SESSION_CREATED':
    case 'SYMPTOM_NORMALIZED':
      return CameraPhase.ORIENT

    // 用户问答/控制/推理中间产物：维持多实体上下文展示（安全默认）。
    case 'USER_QUESTION_REQUESTED':
    case 'USER_QUESTION_ANSWERED':
    case 'FACT_QUALITY_UPDATED':
    case 'CONFLICT_DETECTED':
    case 'CONFLICT_RESOLVED':
    case 'MINIMUM_CHAIN_UPDATED':
    case 'DIAGNOSIS_PAUSED':
    case 'DIAGNOSIS_RESUMED':
      return CameraPhase.CONTEXT

    // 从业务对象移动到验证目标资源。
    case 'RESOURCE_MAPPED':
    case 'PLAN_CREATED':
      return CameraPhase.TRAVEL

    // 阶段切换：按目标阶段分流。
    case 'DIAGNOSIS_PHASE_CHANGED': {
      const phase = p['phase'] ?? snapshot.session.phase
      if (phase === 'CANDIDATE_GENERATION' || phase === 'COMPETING_EXPLANATION') return CameraPhase.CONTEXT
      if (phase === 'CONCLUSION_CHECK') return CameraPhase.ROUTE
      // CANDIDATE_EVIDENCE 及其它阶段：进入取证，镜头沿路径移动。
      return CameraPhase.TRAVEL
    }

    // 候选/证据/竞争解释：展示多实体上下文。
    case 'CANDIDATES_GENERATED':
    case 'CANDIDATE_REFINED':
    case 'CANDIDATE_UPDATED':
    case 'EVIDENCE_CREATED':
      return CameraPhase.CONTEXT

    // 重规划：切换调查范围/路径。
    case 'PLAN_REPLANNED':
      return CameraPhase.ROUTE

    // 任务派发：RUNNING 聚焦到目标对象；成功/数据缺失回到结果展示。
    case 'TASK_STATUS_CHANGED': {
      const status = p['status'] ?? (p['task'] as { status?: string } | undefined)?.status
      return status === TaskStatus.RUNNING ? CameraPhase.FOCUS : CameraPhase.RESULT
    }

    // Skill 取证：聚焦对象执行检查。
    case 'SKILL_STARTED':
      return CameraPhase.INSPECT

    // 取证产出/结果回放。
    case 'SKILL_COMPLETED':
    case 'SKILL_FAILED':
    case 'FACT_DISCOVERED':
      return CameraPhase.RESULT

    // 根因确认：进入结论门控（非终态）→ ROUTE；终态（terminal_status 已置）→ COMPLETE。
    case 'ROOT_CAUSE_CONFIRMED':
      return snapshot.session.terminal_status != null ? CameraPhase.COMPLETE : CameraPhase.ROUTE

    // 终态与完成。
    case 'PROBABLE_CAUSES_REPORTED':
    case 'INSUFFICIENT_EVIDENCE_REPORTED':
    case 'DIAGNOSIS_COMPLETED':
      return CameraPhase.COMPLETE

    default:
      // 穷尽检查：覆盖全部 27 种事件后此处不可达（eventType 收窄为 never）。
      return eventType
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveSubject —— 一屏一主体（终态 > 路径 > 节点 > null）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 当前镜头语义主体推导。优先级：
 * 1. 终态：session.terminal_status 非 null 即终态（conclusion 要到 DIAGNOSIS_COMPLETED
 *    才写入，故以 terminal_status 为准；链从终态事件 payload 或 agent_focus 派生）。
 *    按终态类型差异化：ROOT_CAUSE_CONFIRMED / INSUFFICIENT_EVIDENCE → TerminalSubject；
 *    PROBABLE_CAUSES → RelationGroupSubject（fit 全部候选对象，供候选组构图）；
 * 2. 路径：Planner 有 active 目标且 topo_path.length > 1 → PathSubject；
 * 3. 节点：focusObjectId（active 目标 > agent_focus > 当前活动目标）→ NodeSubject；
 * 4. 无 → null。
 */
export function deriveSubject(snapshot: DiagnosisSessionSnapshot, adapted: AdaptedCase): PresentationSubject | null {
  // 1. 终态：按终态类型差异化。
  const terminal = terminalChainInfo(snapshot)
  if (terminal) {
    // PROBABLE_CAUSES：候选关系组 —— 一屏 fit 全部候选对象（primary 取已确认焦点，
    // 否则取最高支持分候选，供相机构图偏向主节点）。
    if (terminal.terminal_type === 'PROBABLE_CAUSES') {
      const memberIds = candidateObjectIds(snapshot)
      if (memberIds.length > 1) {
        const primaryId =
          terminal.primary_id && memberIds.includes(terminal.primary_id)
            ? terminal.primary_id
            : memberIds[0]
        return {
          kind: 'relation_group',
          member_ids: memberIds,
          primary_id: primaryId,
          relation: 'shared_resource',
          label: displayName(adapted, primaryId),
        }
      }
    }
    // ROOT_CAUSE_CONFIRMED / INSUFFICIENT_EVIDENCE（及无候选的 PROBABLE）：TerminalSubject。
    if (terminal.primary_id) {
      return {
        kind: 'terminal',
        node_ids: dedupe([...terminal.root_chain, ...terminal.impact_chain]),
        primary_id: terminal.primary_id,
        label: displayName(adapted, terminal.primary_id),
        terminal_type: terminal.terminal_type,
      }
    }
  }

  // 2. 路径：active Planner 目标且路径长度 > 1。
  const activeTarget = activePlannerTargetOf(snapshot)
  if (activeTarget && activeTarget.topo_path.length > 1) {
    return {
      kind: 'path',
      node_ids: activeTarget.topo_path.slice(),
      primary_id: activeTarget.target_resource,
      label: displayName(adapted, activeTarget.target_resource),
    }
  }

  // 3. 节点。
  const focusId = focusObjectId(snapshot)
  if (focusId) {
    return {
      kind: 'node',
      primary_id: focusId,
      label: displayName(adapted, focusId),
      resource_type: resourceTypeOf(adapted, focusId),
    }
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部辅助
// ─────────────────────────────────────────────────────────────────────────────

/** 终态链信息：terminal_status 非 null 即终态。链优先取终态事件 payload（ROOT_CAUSE_CONFIRMED
 * 携带 root_cause_chain/impact_chain，DIAGNOSIS_COMPLETED 携带 conclusion），
 * 无链终态（PROBABLE_CAUSES_REPORTED / INSUFFICIENT_EVIDENCE_REPORTED）回退 agent_focus。 */
function terminalChainInfo(snapshot: DiagnosisSessionSnapshot): {
  terminal_type: TerminalType
  root_chain: string[]
  impact_chain: string[]
  primary_id: string | null
} | null {
  const status = snapshot.session.terminal_status
  if (!status) return null

  const lastEvent = snapshot.events[snapshot.events.length - 1]
  const payload = lastEvent?.payload ?? {}
  const conclusion = snapshot.conclusion

  let rootChain: string[] = []
  let impactChain: string[] = []
  let primaryId: string | null = null

  if (lastEvent?.event_type === 'DIAGNOSIS_COMPLETED' && conclusion?.root_cause) {
    rootChain = conclusion.root_cause_chain ?? []
    impactChain = conclusion.impact_chain ?? []
    primaryId = conclusion.root_cause.object_id
  } else if (lastEvent?.event_type === 'ROOT_CAUSE_CONFIRMED') {
    rootChain = stringArray(payload['root_cause_chain'])
    impactChain = stringArray(payload['impact_chain'])
  }

  // 无链终态帧（PROBABLE/INSUFFICIENT 或终态事件后其它事件）：回退 agent_focus。
  if (!rootChain.length && !impactChain.length) {
    rootChain = snapshot.session.agent_focus.object_refs?.slice() ?? []
    impactChain = snapshot.session.agent_focus.path_refs?.slice() ?? []
  }
  primaryId = primaryId ?? rootChain[0] ?? null

  return {
    terminal_type: normalizeTerminalType(status),
    root_chain: rootChain,
    impact_chain: impactChain,
    primary_id: primaryId,
  }
}

/** 当前被验证的 Planner 目标（最近 RUNNING 任务的目标资源命中）。 */
function activePlannerTargetOf(s: DiagnosisSessionSnapshot): PlannerTarget | null {
  const runningTask = [...s.tasks].reverse().find((t) => t.status === TaskStatus.RUNNING)
  if (!runningTask) return null
  const objs = new Set<string>(runningTask.target_object_refs ?? [])
  return (
    [...s.planner_targets]
      .sort((a, b) => a.seq - b.seq)
      .find((t) => objs.has(t.target_resource)) ?? null
  )
}

/** 按 Planner seq 顺序取下一个尚未裁决的目标。 */
function nextPendingPlannerTarget(s: DiagnosisSessionSnapshot): PlannerTarget | null {
  const terminalStatuses = new Set(['SUCCEEDED', 'DATA_MISSING', 'FAILED', 'SKIPPED'])
  return (
    [...s.planner_targets]
      .sort((a, b) => a.seq - b.seq)
      .find((t) => {
        const hasTerminalTask = s.tasks.some(
          (tsk) =>
            (tsk.target_object_refs ?? []).includes(t.target_resource) &&
            terminalStatuses.has(tsk.status),
        )
        if (hasTerminalTask) return false
        const cands = s.candidates.filter((c) => c.object_id === t.target_resource)
        if (cands.some((c) => c.status === 'CONFIRMED' || c.status === 'WEAKENED')) return false
        return true
      }) ?? null
  )
}

/** 候选对象 ids（按支持分降序去重）——PROBABLE_CAUSES 关系组主体成员。 */
function candidateObjectIds(snapshot: DiagnosisSessionSnapshot): string[] {
  return dedupe(
    [...snapshot.candidates]
      .sort((a, b) => b.diagnosis_support_score - a.diagnosis_support_score)
      .map((c) => c.object_id)
      .filter((x): x is string => typeof x === 'string' && x.length > 0),
  )
}

/** 当前焦点对象：active/pending Planner 目标 > agent_focus > 当前活动目标。 */
function focusObjectId(s: DiagnosisSessionSnapshot): string | null {
  const active = activePlannerTargetOf(s)
  if (active) return active.target_resource
  // 诊断中：取第一个 pending 目标，保持 Planner 的逐层扫描顺序。
  if (s.planner_targets.length > 0 && !s.session.terminal_status) {
    const nextPending = nextPendingPlannerTarget(s)
    if (nextPending) return nextPending.target_resource
  }
  // PLAN_CREATED 前空白期：不回退 agent_focus / candidate，画布保持无焦点。
  if (s.planner_targets.length === 0 && !s.session.terminal_status) {
    return null
  }
  const focusObj = s.session.agent_focus?.object_refs?.[0]
  if (focusObj) return focusObj
  return s.current_activity?.target_object_refs?.[0] ?? null
}

/** 主体的一跳拓扑邻居（从 InstanceTopology 规范快照的 relations 提取，去重）。 */
function oneHopNeighbors(adapted: AdaptedCase, id: string): string[] {
  const out = new Set<string>()
  for (const rel of adapted.instanceTopology.relations) {
    if (rel.source_ref === id && rel.target_ref && rel.target_ref !== id) out.add(rel.target_ref)
    if (rel.target_ref === id && rel.source_ref && rel.source_ref !== id) out.add(rel.source_ref)
  }
  return [...out]
}

/** 下一个 pending Planner 目标的 topo_path（当前 active 之后；无 active 取首个 pending）。 */
function nextPendingPath(
  snapshot: DiagnosisSessionSnapshot,
  plannerVm: ReturnType<ProjectionStore['plannerTargets']>,
): string[] {
  const pending = plannerVm.targets.filter((t) => t.status === 'pending')
  if (!pending.length) return []
  const active = plannerVm.targets.find((t) => t.is_active)
  const pick = (active ? pending.find((p) => p.seq > active.seq) : undefined) ?? pending[0]
  const target = snapshot.planner_targets.find((t) => t.target_resource === pick.target_resource)
  return target?.topo_path ?? []
}

/** 当前执行中的 Skill（仅 RUNNING 主活动，execution_id → skill_id）。 */
function currentActiveSkills(
  snapshot: DiagnosisSessionSnapshot,
): DiagnosisPresentationVM['active_skills'] {
  const act = snapshot.current_activity
  if (!act || act.status !== TaskStatus.RUNNING) return []
  const exec = snapshot.skill_executions.find((e) => e.execution_id === act.execution_id)
  return [
    {
      skill_id: exec?.skill_id ?? '',
      action_text: act.action_text ?? '',
      reason_text: act.reason_text ?? null,
      expected_result_text: act.expected_result_text ?? null,
    },
  ]
}

/**
 * 候选变化摘要：最近 CANDIDATE_UPDATED 事件（score_before/after 直接来自事件 payload），
 * 并补充当前活动引用的候选更新（current_activity.candidate_update_refs → snapshot 内 update）。
 */
function deriveCandidateDeltas(
  snapshot: DiagnosisSessionSnapshot,
  lastEvent?: RuntimeEvent,
): DiagnosisPresentationVM['candidate_deltas'] {
  const deltas: DiagnosisPresentationVM['candidate_deltas'] = []
  const push = (d: DiagnosisPresentationVM['candidate_deltas'][number]) => {
    if (!deltas.some((x) => x.candidate_id === d.candidate_id)) deltas.push(d)
  }

  if (lastEvent?.event_type === 'CANDIDATE_UPDATED') {
    const p = lastEvent.payload
    const candidateId = typeof p['candidate_id'] === 'string' ? p['candidate_id'] : null
    if (candidateId) {
      push({
        candidate_id: candidateId,
        score_before: numberOr(p['score_before'], 0),
        score_after: numberOr(p['score_after'], 0),
        status_after: typeof p['status_after'] === 'string' ? p['status_after'] : '',
        reason: typeof p['reason'] === 'string' ? p['reason'] : null,
      })
    }
  }

  const updateRefs = snapshot.current_activity?.candidate_update_refs ?? []
  if (updateRefs.length) {
    const byId = new Map<string, DiagnosisSessionSnapshot['candidate_updates'][number]>()
    for (const u of snapshot.candidate_updates) {
      if (u.update_id) byId.set(u.update_id, u)
      byId.set(`${u.candidate_id}:${u.sequence}`, u)
    }
    for (const ref of updateRefs) {
      const u = byId.get(ref)
      if (!u) continue
      push({
        candidate_id: u.candidate_id,
        score_before: u.score_before,
        score_after: u.score_after,
        status_after: u.status_after ?? '',
        reason: u.reason ?? null,
      })
    }
  }

  return deltas
}

/** 预期证据：当前活动期望结果 > Planner 目标期望发现（元素浅拷贝防反向污染）。 */
function deriveExpectedEvidence(
  act: DiagnosisSessionSnapshot['current_activity'],
  activeTarget: PlannerTarget | null,
): DiagnosisPresentationVM['expected_evidence'] {
  if (act?.expected_evidence && act.expected_evidence.length) {
    return act.expected_evidence.map((e) => ({ requirement_id: e.requirement_id, description: e.description }))
  }
  if (activeTarget) {
    return [{ requirement_id: activeTarget.target_resource, description: activeTarget.expected_finding }]
  }
  return []
}

/** 终态摘要：terminal_status 非 null 即终态（链从终态事件 payload 或 agent_focus 派生）。 */
function deriveTerminalSummary(
  snapshot: DiagnosisSessionSnapshot,
  adapted: AdaptedCase,
): DiagnosisPresentationVM['terminal_summary'] {
  const terminal = terminalChainInfo(snapshot)
  if (!terminal) return null
  return {
    terminal_type: terminal.terminal_type,
    root_cause_label: terminal.primary_id ? displayName(adapted, terminal.primary_id) : null,
    chain_node_ids: terminal.root_chain.slice(),
    impact_node_ids: terminal.impact_chain.slice(),
  }
}

/** 实例对象显示名（优先 resources 的 name，回退 id）。 */
function displayName(adapted: AdaptedCase, id: string): string {
  const r = adapted.resources.find((x) => x.resource_id === id)
  return r?.name ?? id
}

/** 实例对象本体类型码（从 InstanceTopology 规范快照解析）。 */
function resourceTypeOf(adapted: AdaptedCase, id: string): string {
  const r = adapted.instanceTopology.resources.find((x) => x.resource_id === id)
  return r?.resource_type_code ?? ''
}

/** 归一化终态类型（PROBABLE/INSUFFICIENT 按前缀，默认 ROOT_CAUSE_CONFIRMED）。 */
function normalizeTerminalType(status: string | undefined): TerminalType {
  const s = (status ?? '').toUpperCase()
  if (s.includes('PROBABLE')) return 'PROBABLE_CAUSES'
  if (s.includes('INSUFFICIENT')) return 'INSUFFICIENT_EVIDENCE'
  return 'ROOT_CAUSE_CONFIRMED'
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr))
}

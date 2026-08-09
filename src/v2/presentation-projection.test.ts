import { describe, expect, it } from 'vitest'
import { loadAdaptedCase } from './case-adapter'
import { createDiagnosisRuntime } from './diagnosis-runtime'
import { createEmptySnapshot } from './event-reducer'
import {
  computeFocusSignature,
  deriveSubject,
  mapEventToPhase,
  presentationProjection,
} from './presentation-projection'
import {
  CameraPhase,
  type DiagnosisPresentationVM,
  type PresentationSubject,
} from './presentation-types'
import {
  CandidateStatus,
  TaskStatus,
  TerminalStatus,
  type DiagnosisSessionSnapshot,
  type RuntimeEvent,
  type SessionCore,
} from './runtime-types'

/**
 * P0 —— Presentation Projection 协议层（Issue #12「诊断过程展示优化」）。
 *
 * 覆盖：
 * - mapEventToPhase：27 种事件逐事件独立期望映射（穷尽表，非自证式）+ 状态依赖分支专项；
 * - 三 Case 全量回放：phase 合法且确定型事件匹配独立期望、subject 签名格式、primary_id
 *   可解析、确定性（相同 snapshot 两次调用结果相同）；
 * - 三 Case 全量：八个镜头阶段均至少出现一次；
 * - controller_warm_reset_001 / noisy_neighbor / remote_replication：终态在终态事件帧即展示
 *   （terminal_status 非 null，conclusion 尚未写入）；TerminalSubject + terminal_summary；
 * - 三 Case 全量：focus_signature 稳定性（同主体不重复 Travel）+ 不同主体签名必不同（无碰撞）；
 * - 三 Case 全量：0 悬空引用（subject 涉及 ID 均在 instanceTopology 可解析）；
 * - 三 Case 全量：返回数组为浅拷贝，调用方修改 VM 不反向污染 snapshot。
 */

const ALL_CASES = [
  'controller_warm_reset_001',
  'noisy_neighbor_io_contention_001',
  'remote_replication_lag_001',
]

// ─────────────────────────────────────────────────────────────────────────────
// 独立期望表（Bug 4）：每种事件在"规范 payload"下的期望阶段。
// 期望值均为字面常量，不引用 mapEventToPhase 自身；Record 类型要求 27 键齐全（穷尽）。
// 状态依赖型事件（DIAGNOSIS_PHASE_CHANGED / TASK_STATUS_CHANGED）在规范 payload 下
// 得到确定期望，其分支路径由专项测试覆盖；ROOT_CAUSE_CONFIRMED 按 reducer 契约
// 携带 terminal_status（终态快照）。
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_PHASE_EXPECT: Record<
  RuntimeEvent['event_type'],
  { payload?: Record<string, unknown>; session?: Partial<SessionCore>; expected: CameraPhase }
> = {
  DIAGNOSIS_SESSION_CREATED: { expected: CameraPhase.ORIENT },
  USER_QUESTION_REQUESTED: { expected: CameraPhase.CONTEXT },
  USER_QUESTION_ANSWERED: { expected: CameraPhase.CONTEXT },
  SYMPTOM_NORMALIZED: { expected: CameraPhase.ORIENT },
  RESOURCE_MAPPED: { expected: CameraPhase.TRAVEL },
  DIAGNOSIS_PHASE_CHANGED: { payload: { phase: 'CANDIDATE_EVIDENCE' }, expected: CameraPhase.TRAVEL },
  PLAN_CREATED: { expected: CameraPhase.TRAVEL },
  PLAN_REPLANNED: { expected: CameraPhase.ROUTE },
  TASK_STATUS_CHANGED: { payload: { status: TaskStatus.SUCCEEDED }, expected: CameraPhase.RESULT },
  SKILL_STARTED: { expected: CameraPhase.INSPECT },
  SKILL_COMPLETED: { expected: CameraPhase.RESULT },
  SKILL_FAILED: { expected: CameraPhase.RESULT },
  FACT_DISCOVERED: { expected: CameraPhase.RESULT },
  FACT_QUALITY_UPDATED: { expected: CameraPhase.CONTEXT },
  EVIDENCE_CREATED: { expected: CameraPhase.CONTEXT },
  CANDIDATES_GENERATED: { expected: CameraPhase.CONTEXT },
  CANDIDATE_REFINED: { expected: CameraPhase.CONTEXT },
  CANDIDATE_UPDATED: { expected: CameraPhase.CONTEXT },
  CONFLICT_DETECTED: { expected: CameraPhase.CONTEXT },
  CONFLICT_RESOLVED: { expected: CameraPhase.CONTEXT },
  MINIMUM_CHAIN_UPDATED: { expected: CameraPhase.CONTEXT },
  ROOT_CAUSE_CONFIRMED: {
    session: { terminal_status: TerminalStatus.ROOT_CAUSE_CONFIRMED },
    expected: CameraPhase.COMPLETE,
  },
  PROBABLE_CAUSES_REPORTED: { expected: CameraPhase.COMPLETE },
  INSUFFICIENT_EVIDENCE_REPORTED: { expected: CameraPhase.COMPLETE },
  DIAGNOSIS_PAUSED: { expected: CameraPhase.CONTEXT },
  DIAGNOSIS_RESUMED: { expected: CameraPhase.CONTEXT },
  DIAGNOSIS_COMPLETED: { expected: CameraPhase.COMPLETE },
}

/** 确定型事件 → 期望阶段（映射不依赖快照状态）。状态依赖型不在此表，由专项测试覆盖。 */
const DETERMINISTIC_PHASE_EXPECT: Partial<Record<RuntimeEvent['event_type'], CameraPhase>> = {
  DIAGNOSIS_SESSION_CREATED: CameraPhase.ORIENT,
  USER_QUESTION_REQUESTED: CameraPhase.CONTEXT,
  USER_QUESTION_ANSWERED: CameraPhase.CONTEXT,
  SYMPTOM_NORMALIZED: CameraPhase.ORIENT,
  RESOURCE_MAPPED: CameraPhase.TRAVEL,
  PLAN_CREATED: CameraPhase.TRAVEL,
  PLAN_REPLANNED: CameraPhase.ROUTE,
  SKILL_STARTED: CameraPhase.INSPECT,
  SKILL_COMPLETED: CameraPhase.RESULT,
  SKILL_FAILED: CameraPhase.RESULT,
  FACT_DISCOVERED: CameraPhase.RESULT,
  FACT_QUALITY_UPDATED: CameraPhase.CONTEXT,
  EVIDENCE_CREATED: CameraPhase.CONTEXT,
  CANDIDATES_GENERATED: CameraPhase.CONTEXT,
  CANDIDATE_REFINED: CameraPhase.CONTEXT,
  CANDIDATE_UPDATED: CameraPhase.CONTEXT,
  CONFLICT_DETECTED: CameraPhase.CONTEXT,
  CONFLICT_RESOLVED: CameraPhase.CONTEXT,
  MINIMUM_CHAIN_UPDATED: CameraPhase.CONTEXT,
  ROOT_CAUSE_CONFIRMED: CameraPhase.COMPLETE,
  PROBABLE_CAUSES_REPORTED: CameraPhase.COMPLETE,
  INSUFFICIENT_EVIDENCE_REPORTED: CameraPhase.COMPLETE,
  DIAGNOSIS_PAUSED: CameraPhase.CONTEXT,
  DIAGNOSIS_RESUMED: CameraPhase.CONTEXT,
  DIAGNOSIS_COMPLETED: CameraPhase.COMPLETE,
}

// ─────────────────────────────────────────────────────────────────────────────
// 测试辅助
// ─────────────────────────────────────────────────────────────────────────────

/** 逐步推进运行时到终态，对每个事件回调投影。 */
function forEachFrame(
  caseId: string,
  fn: (vm: DiagnosisPresentationVM, lastEventType: RuntimeEvent['event_type'], snapshot: DiagnosisSessionSnapshot) => void,
): void {
  const adapted = loadAdaptedCase(caseId)
  let rt = createDiagnosisRuntime(caseId)
  let guard = 0
  while (!rt.complete && guard++ < 2000) {
    rt = rt.advance()
    const lastEvent = rt.snapshot.events[rt.snapshot.events.length - 1]
    const vm = presentationProjection(rt.snapshot, adapted)
    fn(vm, lastEvent.event_type, rt.snapshot)
  }
  expect(rt.complete, `${caseId} 回放应推进到终态`).toBe(true)
}

/** 构造"末条事件为目标事件"的最小快照（供逐事件期望断言，不经 reducer）。 */
function snapshotWithLastEvent(
  eventType: RuntimeEvent['event_type'],
  payload: Record<string, unknown> = {},
  sessionPatch: Partial<SessionCore> = {},
): DiagnosisSessionSnapshot {
  const snap = createEmptySnapshot('session-test', 'case-test')
  snap.session = { ...snap.session, ...sessionPatch }
  snap.events = [
    {
      event_id: `evt-${eventType}`,
      session_id: 'session-test',
      sequence: 1,
      event_type: eventType,
      payload,
    },
  ]
  return snap
}

/** subject 涉及的实例 ID 集合（供悬空引用校验）。 */
function collectSubjectIds(s: PresentationSubject): string[] {
  switch (s.kind) {
    case 'node':
      return [s.primary_id]
    case 'path':
      return [s.primary_id, ...s.node_ids]
    case 'relation_group':
      return [s.primary_id, ...s.member_ids]
    case 'terminal':
      return [s.primary_id, ...s.node_ids]
  }
}

/** subject 的语义键（用于跨帧稳定性比较）。 */
function subjectKeyOf(s: PresentationSubject): string {
  switch (s.kind) {
    case 'node':
      return `node:${s.primary_id}`
    case 'path':
      return `path:${s.node_ids.join('>')}`
    case 'relation_group':
      return `group:${s.member_ids.join('+')}`
    case 'terminal':
      return `terminal:${s.primary_id}`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 测试
// ─────────────────────────────────────────────────────────────────────────────

describe('Presentation Projection', () => {
  it('computeFocusSignature 格式：NODE/PATH/GROUP/TERMINAL/null', () => {
    expect(
      computeFocusSignature({ kind: 'node', primary_id: 'controller-0a', label: '控制器A', resource_type: 'CONTROLLER' }),
    ).toBe('NODE:controller-0a')
    expect(
      computeFocusSignature({ kind: 'path', node_ids: ['host-b', 'lun-b', 'fc-port-0a'], primary_id: 'fc-port-0a', label: '' }),
    ).toBe('PATH:host-b>lun-b>fc-port-0a')
    expect(
      computeFocusSignature({
        kind: 'relation_group',
        member_ids: ['controller-0a', 'controller-0b'],
        primary_id: 'controller-0a',
        relation: 'peer',
        label: '',
      }),
    ).toBe('GROUP:controller-0a+controller-0b|peer')
    expect(
      computeFocusSignature({ kind: 'terminal', node_ids: ['controller-0a'], primary_id: 'controller-0a', label: '', terminal_type: 'ROOT_CAUSE_CONFIRMED' }),
    ).toBe('TERMINAL:controller-0a|ROOT_CAUSE_CONFIRMED')
    expect(computeFocusSignature(null)).toBe('NONE')
  })

  it('computeFocusSignature：不同主体签名必不同（无碰撞）', () => {
    const subjects: PresentationSubject[] = [
      { kind: 'node', primary_id: 'a', label: '', resource_type: 'X' },
      { kind: 'node', primary_id: 'b', label: '', resource_type: 'X' },
      { kind: 'path', node_ids: ['a', 'b'], primary_id: 'b', label: '' },
      { kind: 'path', node_ids: ['a', 'c'], primary_id: 'c', label: '' },
      { kind: 'relation_group', member_ids: ['a', 'b'], primary_id: 'a', relation: 'peer', label: '' },
      { kind: 'relation_group', member_ids: ['a', 'c'], primary_id: 'a', relation: 'peer', label: '' },
      { kind: 'terminal', node_ids: ['a'], primary_id: 'a', label: '', terminal_type: 'ROOT_CAUSE_CONFIRMED' },
      { kind: 'terminal', node_ids: ['a'], primary_id: 'a', label: '', terminal_type: 'PROBABLE_CAUSES' },
      { kind: 'terminal', node_ids: ['b'], primary_id: 'b', label: '', terminal_type: 'ROOT_CAUSE_CONFIRMED' },
    ]
    const sigs = subjects.map((s) => computeFocusSignature(s))
    expect(new Set(sigs).size).toBe(sigs.length)
  })

  it('computeFocusSignature：kind、terminal_type、relation 均参与签名，避免语义碰撞', () => {
    const node = computeFocusSignature({ kind: 'node', primary_id: 'a', label: '', resource_type: 'X' })
    const path = computeFocusSignature({ kind: 'path', node_ids: ['a'], primary_id: 'a', label: '' })
    expect(path).not.toBe(node)

    const confirmed = computeFocusSignature({
      kind: 'terminal', node_ids: ['a'], primary_id: 'a', label: '', terminal_type: 'ROOT_CAUSE_CONFIRMED',
    })
    const insufficient = computeFocusSignature({
      kind: 'terminal', node_ids: ['a'], primary_id: 'a', label: '', terminal_type: 'INSUFFICIENT_EVIDENCE',
    })
    expect(confirmed).not.toBe(insufficient)

    const peers = computeFocusSignature({
      kind: 'relation_group', member_ids: ['a', 'b'], primary_id: 'a', relation: 'peer', label: '',
    })
    const shared = computeFocusSignature({
      kind: 'relation_group', member_ids: ['a', 'b'], primary_id: 'a', relation: 'shared_resource', label: '',
    })
    expect(peers).not.toBe(shared)
  })

  it('deriveSubject：Planner active target 的多节点 topo_path 派生 PathSubject', () => {
    const adapted = loadAdaptedCase('remote_replication_lag_001')
    const target = adapted.plannerPlan?.targets.find((item) => item.topo_path.length > 1)
    expect(target).toBeDefined()
    const snapshot = createEmptySnapshot('session-path', 'remote_replication_lag_001')
    snapshot.planner_targets = [{ ...target!, topo_path: target!.topo_path.slice() }]
    snapshot.tasks = [{
      task_id: 'task-path',
      display_name: '验证路径',
      status: TaskStatus.RUNNING,
      target_object_refs: [target!.target_resource],
    }]

    const subject = deriveSubject(snapshot, adapted)
    expect(subject?.kind).toBe('path')
    if (subject?.kind === 'path') expect(subject.node_ids).toEqual(target!.topo_path)
  })

  it('deriveSubject：终态按 ROOT_CAUSE_CONFIRMED / PROBABLE_CAUSES 差异化派生主体', () => {
    const adapted = loadAdaptedCase('remote_replication_lag_001')
    const resourceIds = adapted.instanceTopology.resources.slice(0, 2).map((resource) => resource.resource_id)
    expect(resourceIds).toHaveLength(2)

    const confirmed = createEmptySnapshot('session-confirmed', 'remote_replication_lag_001')
    confirmed.session.terminal_status = TerminalStatus.ROOT_CAUSE_CONFIRMED
    confirmed.session.agent_focus = {
      source_type: 'root_cause', source_id: 'candidate-a', object_refs: [resourceIds[0]], path_refs: [],
    }
    const confirmedSubject = deriveSubject(confirmed, adapted)
    expect(confirmedSubject?.kind).toBe('terminal')
    if (confirmedSubject?.kind === 'terminal') {
      expect(confirmedSubject.terminal_type).toBe('ROOT_CAUSE_CONFIRMED')
    }

    const probable = createEmptySnapshot('session-probable', 'remote_replication_lag_001')
    probable.session.terminal_status = TerminalStatus.PROBABLE_CAUSES
    probable.candidates = resourceIds.map((objectId, index) => ({
      candidate_id: `candidate-${index}`,
      object_id: objectId,
      fault_mode_code: `FAULT_${index}`,
      diagnosis_support_score: 90 - index,
      status: CandidateStatus.ACTIVE,
    }))
    const probableSubject = deriveSubject(probable, adapted)
    expect(probableSubject?.kind).toBe('relation_group')
    if (probableSubject?.kind === 'relation_group') {
      expect(probableSubject.member_ids).toEqual(resourceIds)
    }
  })

  it('mapEventToPhase：27 种事件逐事件独立期望映射（穷尽表）', () => {
    const types = Object.keys(EVENT_PHASE_EXPECT) as RuntimeEvent['event_type'][]
    expect(types.length).toBe(27)
    for (const eventType of types) {
      const { payload, session, expected } = EVENT_PHASE_EXPECT[eventType]
      const snapshot = snapshotWithLastEvent(eventType, payload ?? {}, session ?? {})
      expect(mapEventToPhase(eventType, snapshot), eventType).toBe(expected)
    }
  })

  it('mapEventToPhase：DIAGNOSIS_PHASE_CHANGED 按目标阶段分流', () => {
    expect(
      mapEventToPhase('DIAGNOSIS_PHASE_CHANGED', snapshotWithLastEvent('DIAGNOSIS_PHASE_CHANGED', { phase: 'CANDIDATE_GENERATION' })),
    ).toBe(CameraPhase.CONTEXT)
    expect(
      mapEventToPhase('DIAGNOSIS_PHASE_CHANGED', snapshotWithLastEvent('DIAGNOSIS_PHASE_CHANGED', { phase: 'COMPETING_EXPLANATION' })),
    ).toBe(CameraPhase.CONTEXT)
    expect(
      mapEventToPhase('DIAGNOSIS_PHASE_CHANGED', snapshotWithLastEvent('DIAGNOSIS_PHASE_CHANGED', { phase: 'CONCLUSION_CHECK' })),
    ).toBe(CameraPhase.ROUTE)
    expect(
      mapEventToPhase('DIAGNOSIS_PHASE_CHANGED', snapshotWithLastEvent('DIAGNOSIS_PHASE_CHANGED', { phase: 'CANDIDATE_EVIDENCE' })),
    ).toBe(CameraPhase.TRAVEL)
  })

  it('mapEventToPhase：TASK_STATUS_CHANGED 按任务状态分流', () => {
    expect(
      mapEventToPhase('TASK_STATUS_CHANGED', snapshotWithLastEvent('TASK_STATUS_CHANGED', { status: TaskStatus.RUNNING })),
    ).toBe(CameraPhase.FOCUS)
    expect(
      mapEventToPhase('TASK_STATUS_CHANGED', snapshotWithLastEvent('TASK_STATUS_CHANGED', { status: TaskStatus.SUCCEEDED })),
    ).toBe(CameraPhase.RESULT)
  })

  it('三 Case 全量回放：phase 合法且确定型事件匹配独立期望、subject 可解析', () => {
    for (const caseId of ALL_CASES) {
      const adapted = loadAdaptedCase(caseId)
      const resourceIds = new Set(adapted.instanceTopology.resources.map((r) => r.resource_id))
      forEachFrame(caseId, (vm, lastEventType) => {
        // phase 合法性 + 确定型事件独立期望（状态依赖型由专项测试覆盖）。
        expect(Object.values(CameraPhase), lastEventType).toContain(vm.phase)
        const expected = DETERMINISTIC_PHASE_EXPECT[lastEventType]
        if (expected !== undefined) expect(vm.phase, lastEventType).toBe(expected)
        // 主体签名格式。
        if (vm.subject) {
          expect(vm.focus_signature).toMatch(/^(NODE|PATH|GROUP|TERMINAL):/)
          expect(resourceIds.has(vm.subject.primary_id)).toBe(true)
        } else {
          expect(vm.focus_signature).toBe('NONE')
        }
      })
    }
  })

  it('三 Case 全量：八个镜头阶段均至少出现一次', () => {
    for (const caseId of ALL_CASES) {
      const seen = new Set<CameraPhase>()
      forEachFrame(caseId, (vm) => seen.add(vm.phase))
      expect(seen, caseId).toEqual(new Set(Object.values(CameraPhase)))
    }
  })

  it('noisy_neighbor_io_contention_001：PLAN_REPLANNED → ROUTE', () => {
    const adapted = loadAdaptedCase('noisy_neighbor_io_contention_001')
    let rt = createDiagnosisRuntime('noisy_neighbor_io_contention_001')
    let replanCount = 0
    let guard = 0
    while (!rt.complete && guard++ < 2000) {
      rt = rt.advance()
      const lastEvent = rt.snapshot.events[rt.snapshot.events.length - 1]
      if (lastEvent.event_type !== 'PLAN_REPLANNED') continue
      replanCount += 1
      const vm = presentationProjection(rt.snapshot, adapted)
      expect(vm.phase).toBe(CameraPhase.ROUTE)
    }
    expect(replanCount).toBeGreaterThan(0)
  })

  it('remote_replication_lag_001：终态在 ROOT_CAUSE_CONFIRMED 帧即展示（conclusion 尚未写入）', () => {
    const adapted = loadAdaptedCase('remote_replication_lag_001')
    let rt = createDiagnosisRuntime('remote_replication_lag_001')
    let hit = 0
    let guard = 0
    while (!rt.complete && guard++ < 2000) {
      rt = rt.advance()
      const lastEvent = rt.snapshot.events[rt.snapshot.events.length - 1]
      if (lastEvent.event_type !== 'ROOT_CAUSE_CONFIRMED') continue
      hit += 1
      // 终态判定以 terminal_status 为准，conclusion 要等 DIAGNOSIS_COMPLETED 才写入。
      expect(rt.snapshot.session.terminal_status).toBe(TerminalStatus.ROOT_CAUSE_CONFIRMED)
      expect(rt.snapshot.conclusion).toBeNull()
      const vm = presentationProjection(rt.snapshot, adapted)
      expect(vm.phase).toBe(CameraPhase.COMPLETE)
      expect(vm.subject?.kind).toBe('terminal')
      expect(vm.focus_signature).toBe('TERMINAL:wan-path-01|ROOT_CAUSE_CONFIRMED')
      expect(vm.terminal_summary?.terminal_type).toBe('ROOT_CAUSE_CONFIRMED')
      expect(vm.terminal_summary?.chain_node_ids).toEqual(['wan-path-01', 'replication-session-rs01'])
      expect(vm.terminal_summary?.impact_node_ids).toEqual(['replication-session-rs01', 'lun-dr', 'storage-b'])
    }
    expect(hit).toBe(1)
  })

  it('remote_replication_lag_001：终态展示 TerminalSubject + terminal_summary（DIAGNOSIS_COMPLETED 帧）', () => {
    const adapted = loadAdaptedCase('remote_replication_lag_001')
    let rt = createDiagnosisRuntime('remote_replication_lag_001')
    let guard = 0
    while (!rt.complete && guard++ < 2000) rt = rt.advance()
    const lastEvent = rt.snapshot.events[rt.snapshot.events.length - 1]
    expect(lastEvent.event_type).toBe('DIAGNOSIS_COMPLETED')
    const vm = presentationProjection(rt.snapshot, adapted)
    expect(vm.phase).toBe(CameraPhase.COMPLETE)
    expect(vm.subject?.kind).toBe('terminal')
    expect(vm.focus_signature).toBe('TERMINAL:wan-path-01|ROOT_CAUSE_CONFIRMED')
    expect(vm.terminal_summary).not.toBeNull()
    expect(vm.terminal_summary!.terminal_type).toBe('ROOT_CAUSE_CONFIRMED')
    expect(vm.terminal_summary!.chain_node_ids).toEqual(['wan-path-01', 'replication-session-rs01'])
    expect(vm.terminal_summary!.impact_node_ids).toEqual(['replication-session-rs01', 'lun-dr', 'storage-b'])
  })

  it('三 Case 全量：focus_signature 稳定性（同主体不重复 Travel）', () => {
    for (const caseId of ALL_CASES) {
      let prevKey: string | null = null
      let prevSig: string | null = null
      forEachFrame(caseId, (vm) => {
        const key = vm.subject ? subjectKeyOf(vm.subject) : 'NONE'
        if (prevKey === key) {
          // 主体未变 → 签名不变（不触发重复 Travel）。
          expect(vm.focus_signature).toBe(prevSig)
        }
        prevKey = key
        prevSig = vm.focus_signature
      })
    }
  })

  it('三 Case 全量：0 悬空引用（subject 涉及 ID 均在 instanceTopology 可解析）', () => {
    for (const caseId of ALL_CASES) {
      const adapted = loadAdaptedCase(caseId)
      const resourceIds = new Set(adapted.instanceTopology.resources.map((r) => r.resource_id))
      forEachFrame(caseId, (vm) => {
        if (!vm.subject) return
        for (const id of collectSubjectIds(vm.subject)) {
          expect(resourceIds.has(id), `${caseId}: 悬空引用 ${id}`).toBe(true)
        }
      })
    }
  })

  it('三 Case 全量：确定性 —— 相同 snapshot 两次调用结果完全相同', () => {
    for (const caseId of ALL_CASES) {
      const adapted = loadAdaptedCase(caseId)
      let rt = createDiagnosisRuntime(caseId)
      let guard = 0
      while (!rt.complete && guard++ < 2000) {
        rt = rt.advance()
        const a = presentationProjection(rt.snapshot, adapted)
        const b = presentationProjection(rt.snapshot, adapted)
        expect(a).toEqual(b)
      }
    }
  })

  it('三 Case 全量：终态帧 terminal_summary 存在且 terminal_type 正确', () => {
    for (const caseId of ALL_CASES) {
      const adapted = loadAdaptedCase(caseId)
      let rt = createDiagnosisRuntime(caseId)
      let guard = 0
      while (!rt.complete && guard++ < 2000) rt = rt.advance()
      const vm = presentationProjection(rt.snapshot, adapted)
      expect(vm.terminal_summary, `${caseId} 终态应有 terminal_summary`).not.toBeNull()
      expect(vm.terminal_summary!.terminal_type).toMatch(/^(ROOT_CAUSE_CONFIRMED|PROBABLE_CAUSES|INSUFFICIENT_EVIDENCE)$/)
      // 根因链与影响链全部可解析。
      const resourceIds = new Set(adapted.instanceTopology.resources.map((r) => r.resource_id))
      for (const id of [...vm.terminal_summary!.chain_node_ids, ...vm.terminal_summary!.impact_node_ids]) {
        expect(resourceIds.has(id), `${caseId}: 终态链悬空 ${id}`).toBe(true)
      }
    }
  })

  it('三 Case 全量：返回数组为浅拷贝 —— 调用方修改 VM 不反向污染 snapshot', () => {
    for (const caseId of ALL_CASES) {
      const adapted = loadAdaptedCase(caseId)
      let rt = createDiagnosisRuntime(caseId)
      let guard = 0
      while (!rt.complete && guard++ < 2000) rt = rt.advance()
      const snapshotBefore = structuredClone(rt.snapshot)
      const vm = presentationProjection(rt.snapshot, adapted)
      // 修改 VM 顶层数组与 subject/terminal_summary 数组。
      vm.context_object_ids.length = 0
      vm.route_object_ids.length = 0
      vm.new_fact_refs.length = 0
      vm.candidate_deltas.length = 0
      vm.active_skills.length = 0
      vm.expected_evidence.length = 0
      if (vm.subject?.kind === 'path') vm.subject.node_ids.length = 0
      if (vm.terminal_summary) {
        vm.terminal_summary.chain_node_ids.length = 0
        vm.terminal_summary.impact_node_ids.length = 0
      }
      // 快照不受影响。
      expect(rt.snapshot, caseId).toEqual(snapshotBefore)
    }
  })
})

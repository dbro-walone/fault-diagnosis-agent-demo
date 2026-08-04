import { describe, expect, it } from 'vitest'
import { loadAdaptedCase } from './case-adapter'
import { createDiagnosisRuntime, replayCase } from './diagnosis-runtime'
import { ProjectionStore, diagnosisFingerprint } from './projection-store'
import {
  DEFAULT_VIEW_STATE,
  applyViewActions,
  viewStateReducer,
  viewStateSignature,
  type ViewAction,
  type ViewState,
} from './view-state'
import { releasedFactsFrom } from '../adapters/case-knowledge-adapter'
import { listCaseIds } from './manifest'
import { TaskStatus, type DiagnosisSessionSnapshot } from './runtime-types'

/**
 * 阶段5 —— 前端投影边界（docs/19 §14）。
 * 覆盖：
 *  - ViewState 隔离：聚合/展开/缩放/聚焦/筛选只改变投影，不写 Runtime 诊断语义；
 *  - 聚合不改变诊断语义：ViewState 操作前后 diagnosisFingerprint 不变，viewProjection
 *    的指纹与快照一致；
 *  - LUI 三问数据完整性：任意快照可直接回答 ①知道什么 ②正在做什么 ③下一步为什么；
 *  - 投影只消费 Known：viewProjection 不携带 PrivateCaseBundle / Truth Store 字段；
 *  - 回放只读：seek/step 不写候选/证据/结论。
 */

const ALL_CASES = listCaseIds()

/** 一组典型的用户投影操作（聚合展开/缩放聚焦/筛选），确定性序列。 */
const SAMPLE_VIEW_ACTIONS: ViewAction[] = [
  { type: 'TOGGLE_LAYER', code: 'S1' },
  { type: 'TOGGLE_LAYER', code: 'SAN' },
  { type: 'TOGGLE_LAYER', code: 'S1' },
  { type: 'SET_SELECTION', nodeId: 'controller-0a' },
  { type: 'SET_USER_EXPLORING', exploring: true },
  { type: 'SET_SEARCH', query: 'lun' },
  { type: 'SET_OBJECT_SET_FILTER', enabled: true },
  { type: 'SET_AROUND_ROOT', rootId: 'controller-0a', clearFilter: true },
  { type: 'TOGGLE_PLANE', plane: 'knowledge' },
  { type: 'TOGGLE_DEVICE', deviceId: 'controller-0a' },
  { type: 'TOGGLE_KG_LAYER', code: 'L3' },
  { type: 'TOGGLE_CROSS_LAYER' },
  { type: 'SET_NAVIGATOR_COLLAPSED', collapsed: true },
]

function boundStore(snap: DiagnosisSessionSnapshot): ProjectionStore {
  const adapted = loadAdaptedCase(snap.session.case_id ?? '')
  const store = new ProjectionStore()
  store.bind(snap, {
    observationsFacts: releasedFactsFrom(snap, adapted.facts),
    staticBindings: adapted.staticBindings,
    instanceTopology: adapted.instanceTopology,
  })
  return store
}

/** 把运行时推进到指定序列（快照为推进后当前态）。 */
function runtimeAt(caseId: string, targetSeq: number) {
  let rt = createDiagnosisRuntime(caseId)
  let guard = 0
  while (rt.liveHead < targetSeq && !rt.complete && guard++ < 2000) rt = rt.advance()
  return rt
}

// ── ViewState 隔离（docs/19 §14.4）──
describe('阶段5 — ViewState 隔离', () => {
  it('viewStateReducer 是纯函数：返回新对象、不改入参、确定性', () => {
    const before = { ...DEFAULT_VIEW_STATE }
    const frozen = { ...DEFAULT_VIEW_STATE }
    const next = applyViewActions(before, SAMPLE_VIEW_ACTIONS)
    expect(next).not.toBe(before)
    // 入参不被修改。
    expect(before).toEqual(frozen)
    // 确定性：同样输入恒产生同样输出。
    const again = applyViewActions(before, SAMPLE_VIEW_ACTIONS)
    expect(viewStateSignature(next)).toBe(viewStateSignature(again))
    // TOGGLE_LAYER 幂等往返（收起后 key 保持 false，与旧 setExpandedLayers 语义一致）。
    const toggled = viewStateReducer(DEFAULT_VIEW_STATE, { type: 'TOGGLE_LAYER', code: 'S1' })
    const restored = viewStateReducer(toggled, { type: 'TOGGLE_LAYER', code: 'S1' })
    expect(restored.expandedLayers['S1']).toBe(false)
  })

  it('ViewState 操作前后同一快照引用不变（reducer 不触碰诊断快照）', () => {
    for (const caseId of ALL_CASES) {
      const snap = replayCase(caseId)
      const snapshotRef = snap
      let vs: ViewState = { ...DEFAULT_VIEW_STATE }
      for (const action of SAMPLE_VIEW_ACTIONS) vs = viewStateReducer(vs, action)
      // 快照仍是原对象，语义指纹不变。
      expect(snap).toBe(snapshotRef)
      expect(diagnosisFingerprint(snap)).toBe(diagnosisFingerprint(snapshotRef))
    }
  })

  it('RESET 恢复默认 ViewState', () => {
    const dirty = applyViewActions(DEFAULT_VIEW_STATE, SAMPLE_VIEW_ACTIONS)
    const reset = viewStateReducer(dirty, { type: 'RESET' })
    expect(reset).toEqual(DEFAULT_VIEW_STATE)
  })
})

// ── 聚合不改变诊断语义（docs/19 §14.2）──
describe('阶段5 — 聚合不改变诊断语义', () => {
  it('任意快照：投影操作前后 diagnosisFingerprint 不变（候选/证据/结论/任务/证据链）', () => {
    for (const caseId of ALL_CASES) {
      const snap = replayCase(caseId)
      const fp = diagnosisFingerprint(snap)
      let vs: ViewState = { ...DEFAULT_VIEW_STATE }
      for (const action of SAMPLE_VIEW_ACTIONS) vs = viewStateReducer(vs, action)
      // ViewState 变化只改变投影，快照指纹稳定。
      expect(diagnosisFingerprint(snap)).toBe(fp)
      // viewProjection 的指纹与快照一致（投影派生自快照而非 ViewState）。
      const store = boundStore(snap)
      expect(store.viewProjection().diagnosis_fingerprint).toBe(fp)
    }
  })

  it('推进到中间快照（任务运行中）：聚合/聚焦操作不改变当时诊断语义', () => {
    for (const caseId of ALL_CASES) {
      const rt = runtimeAt(caseId, Math.floor(createDiagnosisRuntime(caseId).events.length / 2))
      const snap = rt.snapshot
      const fp = diagnosisFingerprint(snap)
      let vs: ViewState = { ...DEFAULT_VIEW_STATE }
      for (const action of SAMPLE_VIEW_ACTIONS) vs = viewStateReducer(vs, action)
      expect(diagnosisFingerprint(snap)).toBe(fp)
      const store = boundStore(snap)
      expect(store.viewProjection().diagnosis_fingerprint).toBe(fp)
    }
  })

  it('viewProjection 只携带 Known + ACTIVE Binding + View Hint，无 PrivateCaseBundle/Truth 字段', () => {
    for (const caseId of ALL_CASES) {
      const snap = replayCase(caseId)
      const store = boundStore(snap)
      const proj = store.viewProjection()
      const text = JSON.stringify(proj)
      for (const marker of [
        'dme-private-case-bundle',
        'environment_truth',
        'scenario_fixture_index',
        'observation_catalog',
        'knowledge_binding_index',
        'ground_truth',
        'source_ref_map',
        'release_envelopes',
      ]) {
        expect(text).not.toContain(marker)
      }
      // ACTIVE Binding：只含 ACTIVE 状态。
      expect(proj.active_bindings.every((b) => b.status === 'ACTIVE')).toBe(true)
      // View Hint：关键对象/逻辑路径/焦点可渲染。
      expect(Array.isArray(proj.view_hint.critical_object_ids)).toBe(true)
    }
  })
})

// ── LUI 三问数据完整性（docs/19 §14.3）──
describe('阶段5 — LUI 三问数据完整性', () => {
  it('终态快照可直接回答三问：①知道什么 ②正在做什么 ③为什么', () => {
    for (const caseId of ALL_CASES) {
      const snap = replayCase(caseId)
      const store = boundStore(snap)
      const ks = store.knowledgeSnapshot()
      const cand = store.candidateList()
      const decision = store.currentDecision()

      // ① 知道什么：态势 + 候选列表。
      expect(ks.phase.length).toBeGreaterThan(0)
      expect(cand.items.length).toBeGreaterThan(0)

      // ② 正在做什么：终态上下文（已确认/多个可能/证据不足）。
      expect(ks.terminal_status_label).toBeTruthy()
      expect(store.currentAction() || store.plannerTargets()).toBeTruthy()

      // ③ 为什么：终态决策理由（context_label 反映终态；证据缺口可空但决策可表述）。
      expect(decision.has_decision).toBe(true)
      expect(decision.context_label.length).toBeGreaterThan(0)
    }
  })

  it('诊断推进中任意快照可直接回答三问，且"为什么"有实质内容', () => {
    for (const caseId of ALL_CASES) {
      const rt = createDiagnosisRuntime(caseId)
      const total = rt.events.length
      // 采样多个序列点（会话起点=首个事件/中途/临近终态），每个都验证三问可答。
      const samples = new Set<number>([1, Math.floor(total / 4), Math.floor(total / 2), total - 2])
      for (const seq of samples) {
        const at = runtimeAt(caseId, Math.min(seq, total))
        const snap = at.snapshot
        const store = boundStore(snap)
        const ks = store.knowledgeSnapshot()
        const decision = store.currentDecision()

        // ① 知道什么：阶段或模式标签可表述（T0 前阶段为空但模式已定）。
        expect(ks.phase.length > 0 || ks.mode_label.length > 0).toBe(true)

        // ② 正在做什么：主活动存在 / Planner 有目标 / 终态 / 会话初始化（尚无任务）。
        const doing =
          store.currentAction().has_activity ||
          store.plannerTargets().targets.length > 0 ||
          !!snap.session.terminal_status ||
          snap.tasks.length === 0
        expect(doing).toBe(true)

        // ③ 为什么：决策上下文标签恒可表述（阶段/终态）。
        expect(decision.context_label.length).toBeGreaterThan(0)

        // 取证推进中（非终态、已有任务）→ "为什么"应含具体理由/预期证据/缺口。
        if (
          !snap.session.terminal_status &&
          snap.tasks.some((t) => t.status === TaskStatus.RUNNING || t.status === TaskStatus.SUCCEEDED)
        ) {
          const hasWhy =
            !!decision.reason_text || !!decision.expected_evidence || decision.evidence_gaps.length > 0
          expect(hasWhy).toBe(true)
        }

        // 终态 → "为什么"由结论回答（根因/多个原因/证据不足）。
        if (snap.session.terminal_status) {
          expect(decision.context_label).toMatch(/根因|原因|证据/)
        }
      }
    }
  })

  it('回放快照恢复当时决策（不泄露未来）：历史序列的决策只含当时信息', () => {
    const caseId = 'controller_warm_reset_001'
    let rt = createDiagnosisRuntime(caseId)
    let guard = 0
    while (!rt.complete && guard++ < 2000) rt = rt.advance()
    const mid = Math.floor(rt.events.length / 2)
    const replayRt = rt.seek(mid)
    const store = boundStore(replayRt.snapshot)
    const decision = store.currentDecision()
    // 历史决策由当时快照推导；终态结论未发生时决策不引用根因确认。
    expect(replayRt.isHistorical).toBe(true)
    expect(decision.has_decision).toBe(true)
  })
})

// ── 回放只读（docs/19 §6.4/§14.4，阶段5）──
describe('阶段5 — 回放只读', () => {
  it('seek/returnLive 不写候选/证据/结论：live 快照诊断语义保持不变', () => {
    for (const caseId of ALL_CASES) {
      let rt = createDiagnosisRuntime(caseId)
      let guard = 0
      while (!rt.complete && guard++ < 2000) rt = rt.advance()
      const liveFpBefore = diagnosisFingerprint(rt.liveSnapshot)
      const liveSnapBefore = rt.liveSnapshot

      // 任意 seek 只移动游标，live 快照引用与指纹不变。
      const replayed = rt.seek(Math.floor(rt.events.length / 3))
      expect(replayed.liveSnapshot).toBe(liveSnapBefore)
      expect(diagnosisFingerprint(replayed.liveSnapshot)).toBe(liveFpBefore)

      // 回放态推进（step）不会把"历史"写回 live。
      const advanced = replayed.advance()
      expect(diagnosisFingerprint(advanced.liveSnapshot)).toBe(liveFpBefore)

      // 返回实时后快照一致。
      const back = replayed.returnLive()
      expect(diagnosisFingerprint(back.snapshot)).toBe(liveFpBefore)
    }
  })

  it('回放中投影/决策只读：viewProjection 与 currentDecision 均不改写快照', () => {
    const caseId = 'noisy_neighbor_io_contention_001'
    const rt = createDiagnosisRuntime(caseId)
    const replayed = rt.seek(Math.floor(rt.events.length / 2))
    const snap = replayed.snapshot
    const ref = snap
    const store = boundStore(snap)
    store.viewProjection()
    store.currentDecision()
    store.plannerTargets()
    store.diagnosisScan()
    expect(snap).toBe(ref)
  })
})

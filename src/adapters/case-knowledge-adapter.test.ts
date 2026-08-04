/**
 * CaseKnowledgeAdapter Contract 1.0 —— 阶段4 真值隔离单元测试（docs/19 §7/§8/§10.4/§17.2）。
 *
 * 覆盖：
 * - 三套子图分离（§7.1）：Truth（服务端完整真值）↔ Known（当前已知）↔ View（前端投影）；
 * - 六个数据分区（§8.4）：PUBLIC_INPUT / INITIAL_CONTEXT / DISCOVERABLE / REPLAY_FIXTURE /
 *   GROUND_TRUTH / PRESENTATION_HINT；
 * - RuntimeSeed / PrivateCaseBundle 物理隔离（§8.2）：Seed 不含 Ground Truth / 结论 / 观测；
 * - ReleaseEnvelope 渐进释放（§8.6）：FACT 由 Skill 完成事件触发、Evidence 由 EVIDENCE_CREATED
 *   触发、候选细化由 CANDIDATE_REFINED 触发、结论仅终态释放；
 * - 首轮候选无精确答案（§10.4），细化后精确 FaultMode 出现在终态；
 * - 泄露校验器（CKA-LEAK-*）捕获 Seed 泄露与首轮精确答案。
 */
import { describe, expect, it } from 'vitest'

import {
  DataPartition,
  GENERALIZED_FAULT_MODE_PREFIX,
  compileCase,
  generalizeCandidate,
  isGeneralizedCandidate,
  resolveRelease,
  validateLeakIsolation,
  type AdapterCompileResult,
  type ReleaseEnvelope,
  type RuntimeSeed,
} from './case-knowledge-adapter'
import { loadAdaptedCase } from '../v2/case-adapter'
import { generateEvents, replayCase } from '../v2/diagnosis-runtime'
import { replayToSequence } from '../v2/event-reducer'
import { listCaseIds } from '../v2/manifest'
import type { Candidate, RuntimeEvent } from '../v2/runtime-types'

const CONTROLLER = 'controller_warm_reset_001'

function compiledFor(caseId: string, withEvents = true): { compiled: AdapterCompileResult; events: RuntimeEvent[] } {
  const adapted = loadAdaptedCase(caseId)
  const events = generateEvents(adapted)
  const compiled = compileCase(adapted, withEvents ? events : undefined)
  return { compiled, events }
}

// ─────────────────────────────────────────────────────────────────────────────
// §7.1 三套子图分离
// ─────────────────────────────────────────────────────────────────────────────

describe('三套子图分离（§7.1）', () => {
  const { compiled } = compiledFor(CONTROLLER)

  it('Truth 子图包含完整真值（观测/候选/证据/绑定），Known 初始为空', () => {
    expect(compiled.truthGraph.facts.length).toBeGreaterThan(0)
    expect(compiled.truthGraph.evidences.length).toBeGreaterThan(0)
    expect(compiled.truthGraph.candidates.length).toBeGreaterThan(0)
    expect(compiled.truthGraph.ground_truth.fault_mode_code).toBe('CONTROLLER_WARM_RESET')
    // Known 子图初始化必须为空：Agent 尚未获得任何元素（§7.1）。
    expect(compiled.knownGraph.facts).toEqual([])
    expect(compiled.knownGraph.candidates).toEqual([])
    expect(compiled.knownGraph.conclusion).toBe(false)
    // Truth ≠ Known：完整真值不得在初始化时进入 Known。
    expect(compiled.knownGraph.facts.length).not.toBe(compiled.truthGraph.facts.length)
  })

  it('View 子图只含投影（入口对象 + 候选泛化），不含真值详情', () => {
    expect(compiled.viewGraph.initial_focus_object_ids.length).toBeGreaterThan(0)
    const g = compiled.viewGraph.candidate_generalizations
    for (const [cid, meta] of Object.entries(g)) {
      expect(meta.scene_code.startsWith(GENERALIZED_FAULT_MODE_PREFIX)).toBe(true)
      expect(compiled.truthGraph.candidates).toContain(cid)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §8.4 六个数据分区
// ─────────────────────────────────────────────────────────────────────────────

describe('六个数据分区（§8.4）', () => {
  const { compiled } = compiledFor(CONTROLLER)

  it('分区覆盖全部六类，且主要数据分区正确', () => {
    const counts = compiled.compile.deterministic_summary.partitions
    for (const p of Object.values(DataPartition)) {
      expect(counts[p]).toBeGreaterThanOrEqual(0)
    }
    // conclusion 恒为 GROUND_TRUTH；storyboard 恒为 PRESENTATION_HINT。
    expect(compiled.partitionIndex.conclusion).toBe(DataPartition.GROUND_TRUTH)
    expect(compiled.partitionIndex.storyboard).toBe(DataPartition.PRESENTATION_HINT)
    // 候选 fixture 分区：精确码候选属于 GROUND_TRUTH 细化；泛化后属于 REPLAY_FIXTURE。
    const rootCand = Object.values(compiled.partitionIndex.candidates)[0]
    expect(Object.values(compiled.partitionIndex.candidates).length).toBeGreaterThan(0)
    expect(rootCand).toBeDefined()
    // 事实按 FactType 分区：告警/KPI 等属于 DISCOVERABLE。
    expect(compiled.partitionIndex.facts['fact-alm-0a-78421']).toBe(DataPartition.DISCOVERABLE)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §8.2 RuntimeSeed / PrivateCaseBundle 物理隔离
// ─────────────────────────────────────────────────────────────────────────────

describe('RuntimeSeed / PrivateCaseBundle 物理隔离（§8.2）', () => {
  const { compiled } = compiledFor(CONTROLLER)
  const seed = compiled.runtimeSeed
  const bundle = compiled.privateBundle

  it('Seed 只含公开输入与安全上下文，不含 Ground Truth / 结论 / 观测 / 候选', () => {
    expect(seed.schema_name).toBe('dme-diagnosis-runtime-seed')
    expect(seed.initial_visible_context.facts).toEqual([])
    expect(seed.initial_visible_context.known_topology_subgraph.resources).toEqual([])
    expect(seed.initial_visible_context.known_knowledge_subgraph.nodes).toEqual([])
    expect(seed.exposure_ledger).toEqual([])
    const text = JSON.stringify(seed)
    expect(text).not.toContain('CONTROLLER_WARM_RESET')
    expect(text).not.toContain('96')
    expect(text).not.toContain('scenario_fixture_index')
    expect(text).not.toContain('environment_truth')
    expect(text).not.toContain('"conclusion"')
  })

  it('Seed 与 Bundle 通过不同结构隔离（Bundle 含完整真值）', () => {
    expect(bundle.schema_name).toBe('dme-private-case-bundle')
    expect(bundle.observation_catalog.facts.length).toBeGreaterThan(0)
    expect(bundle.scenario_fixture_index.candidate_fixtures.length).toBe(4)
    expect(bundle.scenario_fixture_index.conclusion_fixture?.root_cause.fault_mode_code).toBe('CONTROLLER_WARM_RESET')
    expect(bundle.ground_truth.final_scores['cand-controller-warm-reset']).toBe(96)
    // Seed 是公开子集，Bundle 是真值全集：两者字段集合不相交。
    const seedKeys = new Set(Object.keys(seed))
    const bundleKeys = new Set(Object.keys(bundle))
    expect(seedKeys.has('scenario_fixture_index')).toBe(false)
    expect(bundleKeys.has('public_input')).toBe(false)
  })

  it('T0/T1 快照干净：无候选、无事实、无结论、无精确答案（Gate 5）', () => {
    const snap = replayCase(CONTROLLER)
    const events = snap.events
    const t0 = replayToSequence(events, 0, 's', CONTROLLER)
    expect(t0.candidates).toEqual([])
    expect(t0.facts).toEqual([])
    expect(t0.evidences).toEqual([])
    expect(t0.conclusion).toBeNull()

    const t1Seq = events.find((e) => e.event_type === 'DIAGNOSIS_PHASE_CHANGED')?.sequence ?? 1
    const t1 = replayToSequence(events, Math.max(0, t1Seq - 1), 's', CONTROLLER)
    expect(t1.conclusion).toBeNull()
    expect(t1.candidates).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §10.4 首轮候选场景级泛化 + 渐进细化
// ─────────────────────────────────────────────────────────────────────────────

describe('首轮候选泛化与渐进细化（§10.4）', () => {
  const adapted = loadAdaptedCase(CONTROLLER)

  it('generalizeCandidate 将精确 FaultMode 替换为场景级表示，不泄露答案', () => {
    const root = adapted.candidates.find((c) => c.candidate_id === 'cand-controller-warm-reset')!
    const generalized = generalizeCandidate(root, adapted.instanceTopology)
    expect(isGeneralizedCandidate(generalized)).toBe(true)
    expect(generalized.fault_mode_code).toBe('SCENE_CONTROLLER_ANOMALY')
    expect(generalized.fault_mode_code).not.toBe('CONTROLLER_WARM_RESET')
    expect(generalized.display_name).not.toContain('热复位')
    expect(generalized.display_name).toContain('控制器异常')
    // 分数保留初始支持分（42），不泄露最终 96 分。
    expect(generalized.diagnosis_support_score).toBe(42)
  })

  it('事件流：首轮 CANDIDATES_GENERATED 为泛化候选，CANDIDATE_REFINED 后为精确候选', () => {
    const events = generateEvents(adapted)
    const gen = events.find((e) => e.event_type === 'CANDIDATES_GENERATED')!
    const genCands = gen.payload['candidates'] as Candidate[]
    for (const c of genCands) {
      expect(isGeneralizedCandidate(c)).toBe(true)
      expect(c.fault_mode_code).not.toContain('WARM_RESET')
    }
    // 细化事件在证据形成后发生，携带精确答案。
    const refinedEvents = events.filter((e) => e.event_type === 'CANDIDATE_REFINED')
    expect(refinedEvents.length).toBe(4)
    const rootRefined = refinedEvents.find((e) => e.payload['candidate_id'] === 'cand-controller-warm-reset')!
    expect(rootRefined.payload['fault_mode_code']).toBe('CONTROLLER_WARM_RESET')
    expect(rootRefined.payload['display_name']).toBe('Controller-0A 热复位')
    // 细化事件必须发生在证据创建之后。
    const firstEvidenceSeq = events.find((e) => e.event_type === 'EVIDENCE_CREATED')!.sequence
    expect(refinedEvents.every((e) => e.sequence > firstEvidenceSeq)).toBe(true)
  })

  it('终态快照候选细化并确认根因；根因确认后才出现结论', () => {
    const snap = replayCase(CONTROLLER)
    const root = snap.candidates.find((c) => c.candidate_id === 'cand-controller-warm-reset')!
    expect(root.fault_mode_code).toBe('CONTROLLER_WARM_RESET')
    expect(root.display_name).toBe('Controller-0A 热复位')
    expect(root.status).toBe('CONFIRMED')
    expect(root.diagnosis_support_score).toBe(96)
    expect(snap.conclusion?.root_cause.fault_mode_code).toBe('CONTROLLER_WARM_RESET')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §8.6 ReleaseEnvelope 渐进释放（事件驱动）
// ─────────────────────────────────────────────────────────────────────────────

describe('ReleaseEnvelope 渐进释放（§8.6）', () => {
  const { compiled, events } = compiledFor(CONTROLLER)

  function firedAt(seq: number) {
    return resolveRelease(compiled, events, seq)
  }

  it('T0：无任何事实/证据/结论释放；T1 之前仅公开/初始上下文', () => {
    const r0 = firedAt(0)
    expect(r0.releasedFactIds).toEqual([])
    expect(r0.releasedEvidenceIds).toEqual([])
    expect(r0.conclusionReleased).toBe(false)
  })

  it('DISCOVERABLE 事实由其 Skill 完成事件释放（事件驱动，非时间/幕次）', () => {
    // 告警查询 Skill 完成序列处释放 fact-alm-0a-78421（SKILL_COMPLETED 早于 TASK SUCCEEDED）。
    const alarmSkillSeq = events.find(
      (e) => e.event_type === 'SKILL_COMPLETED' && e.correlation_id === 'exec-task-query-controller-alarm',
    )!.sequence
    const before = firedAt(alarmSkillSeq - 1)
    const after = firedAt(alarmSkillSeq)
    expect(before.releasedFactIds).not.toContain('fact-alm-0a-78421')
    expect(after.releasedFactIds).toContain('fact-alm-0a-78421')
  })

  it('候选细化仅在对应 CANDIDATE_REFINED 事件后释放', () => {
    const refineSeq = events.find((e) => e.event_type === 'CANDIDATE_REFINED' && e.payload['candidate_id'] === 'cand-controller-warm-reset')!.sequence
    const before = firedAt(refineSeq - 1)
    const after = firedAt(refineSeq)
    expect(before.refinedCandidateIds).not.toContain('cand-controller-warm-reset')
    expect(after.refinedCandidateIds).toContain('cand-controller-warm-reset')
  })

  it('结论（Ground Truth）仅在终态事件后释放，固定幕次/定时器不触发', () => {
    const firstTerminalSeq = events.find((e) =>
      ['ROOT_CAUSE_CONFIRMED', 'PROBABLE_CAUSES_REPORTED', 'INSUFFICIENT_EVIDENCE_REPORTED'].includes(e.event_type),
    )!.sequence
    expect(firedAt(firstTerminalSeq - 1).conclusionReleased).toBe(false)
    expect(firedAt(firstTerminalSeq).conclusionReleased).toBe(true)
    // 全部信封由 Runtime Event 驱动。
    for (const env of compiled.releaseEnvelopes) {
      expect(env.release_on.event_type).not.toBe('STORYBOARD_ACT')
      expect(env.release_on.event_type).not.toBe('TIMER')
    }
  })

  it('证据在来源事实已释放后由 EVIDENCE_CREATED 释放', () => {
    const evSeq = events.find((e) => e.event_type === 'EVIDENCE_CREATED' && e.payload['evidence_ref'] === 'ev-controller-reset-alarm')!.sequence
    const r = firedAt(evSeq)
    expect(r.releasedEvidenceIds).toContain('ev-controller-reset-alarm')
    // 该证据引用的告警事实必须已释放。
    expect(r.releasedFactIds).toContain('fact-alm-0a-78421')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §8.3 编译流水线 + 确定性
// ─────────────────────────────────────────────────────────────────────────────

describe('编译流水线（§8.3 A0~A10）', () => {
  it('流水线包含全部 10 个阶段，输出不可变且确定性', () => {
    const a = compiledFor(CONTROLLER).compiled
    const b = compiledFor(CONTROLLER).compiled
    expect(a.compile.pipeline_steps).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'])
    expect(JSON.stringify(a.runtimeSeed)).toBe(JSON.stringify(b.runtimeSeed))
    expect(a.privateBundle.bundle_id).toBe(b.privateBundle.bundle_id)
    expect(a.compile.deterministic_summary.seed_id).toBe(`seed-${CONTROLLER}`)
  })

  it('全部 5 个 Case 编译通过且泄露报告无 ERROR', () => {
    for (const caseId of listCaseIds()) {
      const { compiled } = compiledFor(caseId)
      expect(compiled.leakReport.valid, `${caseId} leak report`).toBe(true)
      expect(compiled.leakReport.issues.filter((i) => i.severity === 'ERROR')).toEqual([])
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §17.2 泄露校验器（CKA-LEAK-*）
// ─────────────────────────────────────────────────────────────────────────────

describe('泄露校验器（CKA-LEAK-*）', () => {
  it('捕获 Seed 携带 Ground Truth（CKA-LEAK-SEED-GROUND-TRUTH）', () => {
    const { compiled } = compiledFor(CONTROLLER)
    const leakingSeed: RuntimeSeed = {
      ...compiled.runtimeSeed,
      initial_visible_context: {
        facts: [
          {
            fact_id: 'fact-alm-0a-78421',
            fact_type: 'ALARM',
            object_refs: ['controller-0a'],
            source: { execution_id: 'exec-x', skill_id: 'alarm_query', source_refs: [] },
            payload: { alarm_code: 'CONTROLLER_WARM_RESET' },
          },
        ],
        known_topology_subgraph: { resources: [], relations: [], states: [] },
        known_knowledge_subgraph: { nodes: [], edges: [] },
        active_binding_refs: [],
      },
      planner_seed: compiled.runtimeSeed.planner_seed,
      public_case_metadata: compiled.runtimeSeed.public_case_metadata,
      public_input: compiled.runtimeSeed.public_input,
      exposure_ledger: [],
      schema_name: 'dme-diagnosis-runtime-seed',
      schema_version: '1.0.0',
      seed_id: 'seed-leak',
    }
    const report = validateLeakIsolation(
      leakingSeed,
      compiled.privateBundle,
      compiled.generalizedCandidates,
      compiled.releaseEnvelopes,
      loadAdaptedCase(CONTROLLER),
    )
    expect(report.issues.some((i) => i.code === 'CKA-LEAK-SEED-FACTS')).toBe(true)
  })

  it('捕获首轮候选携带精确答案（CKA-LEAK-FIRST-ROUND-ANSWER）', () => {
    const { compiled } = compiledFor(CONTROLLER)
    const adapted = loadAdaptedCase(CONTROLLER)
    const leakingCandidates = adapted.candidates // 未泛化的精确候选
    const report = validateLeakIsolation(
      compiled.runtimeSeed,
      compiled.privateBundle,
      leakingCandidates,
      compiled.releaseEnvelopes,
      adapted,
    )
    expect(report.issues.some((i) => i.code === 'CKA-LEAK-FIRST-ROUND-ANSWER')).toBe(true)
    expect(report.valid).toBe(false)
  })

  it('捕获固定幕次触发的 ReleaseEnvelope（CKA-LEAK-RELEASE-TIMING）', () => {
    const { compiled } = compiledFor(CONTROLLER)
    const badEnvelope: ReleaseEnvelope = {
      envelope_id: 'release-bad-act',
      payload_kind: 'FACT',
      payload_refs: ['x'],
      partition: DataPartition.DISCOVERABLE,
      release_on: { event_type: 'STORYBOARD_ACT' },
      audit: { source_ref: 'playback/storyboard.json' },
    }
    const report = validateLeakIsolation(
      compiled.runtimeSeed,
      compiled.privateBundle,
      compiled.generalizedCandidates,
      [...compiled.releaseEnvelopes, badEnvelope],
      loadAdaptedCase(CONTROLLER),
    )
    expect(report.issues.some((i) => i.code === 'CKA-LEAK-RELEASE-TIMING')).toBe(true)
  })

  it('捕获事件流 CANDIDATES_GENERATED 载荷含精确答案（CKA-LEAK-EVENT-PRECISE-CANDIDATE）', () => {
    const { compiled } = compiledFor(CONTROLLER)
    const adapted = loadAdaptedCase(CONTROLLER)
    const preciseGenEvent: RuntimeEvent = {
      event_id: 'evt-leak-gen',
      session_id: 's',
      sequence: 9999,
      event_type: 'CANDIDATES_GENERATED',
      payload: { candidate_refs: ['cand-controller-warm-reset'], candidates: adapted.candidates },
    }
    const report = validateLeakIsolation(
      compiled.runtimeSeed,
      compiled.privateBundle,
      compiled.generalizedCandidates,
      compiled.releaseEnvelopes,
      adapted,
      [preciseGenEvent],
    )
    expect(report.issues.some((i) => i.code === 'CKA-LEAK-EVENT-PRECISE-CANDIDATE')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'

import {
  confidenceToScore,
  mapCandidateStatus,
  mapStanceToEffect,
  mapTaskStatus,
  mapTerminalStatus,
  skillCodeToSkillId,
} from './case-adapter'
import { createDiagnosisRuntime, generateEvents, replayCase } from './diagnosis-runtime'
import { loadAdaptedCase } from './case-adapter'
import {
  applyEvent,
  createEmptySnapshot,
  reduceEvents,
  replayToSequence,
} from './event-reducer'
import { CandidateStatus, EvidenceEffect, TerminalStatus } from './runtime-types'
import { listCaseIds } from './manifest'
import { routeToCase } from '../lib/v2-case-router'

const CONTROLLER = 'controller_warm_reset_001'

// ── 适配器转换器（V1→V2 映射，docs/02 §12）──
describe('case-adapter converters', () => {
  it('confidence(0..1) → 诊断支持分(0..100)', () => {
    expect(confidenceToScore(0.96)).toBe(96)
    expect(confidenceToScore(0.42)).toBe(42)
    expect(confidenceToScore(0.5)).toBe(50)
    expect(confidenceToScore(1.5)).toBe(100)
    expect(confidenceToScore(-0.2)).toBe(0)
  })

  it('candidate status: confirmed→CONFIRMED, excluded→WEAKENED', () => {
    expect(mapCandidateStatus('confirmed')).toBe(CandidateStatus.CONFIRMED)
    expect(mapCandidateStatus('excluded')).toBe(CandidateStatus.WEAKENED)
    expect(mapCandidateStatus('active')).toBe(CandidateStatus.ACTIVE)
  })

  it('stance+strength → effect', () => {
    expect(mapStanceToEffect('support', 0.93)).toBe(EvidenceEffect.STRONG_SUPPORT)
    expect(mapStanceToEffect('support', 0.68)).toBe(EvidenceEffect.SUPPORT)
    expect(mapStanceToEffect('contradict', 0.91)).toBe(EvidenceEffect.WEAKEN)
    expect(mapStanceToEffect('neutral', 0.1)).toBe(EvidenceEffect.NEUTRAL)
  })

  it('task/terminal status & skill id 映射', () => {
    expect(mapTaskStatus('succeeded')).toBe('SUCCEEDED')
    expect(mapTaskStatus('success')).toBe('SUCCEEDED')
    expect(mapTerminalStatus('confirmed')).toBe(TerminalStatus.ROOT_CAUSE_CONFIRMED)
    expect(skillCodeToSkillId('QUERY_KPI')).toBe('kpi_query')
    expect(skillCodeToSkillId('CHECK_PORT_HEALTH')).toBe('link_health_query')
  })
})

// ── Reducer：纯函数 / 确定性 / 幂等 / 回放 ──
describe('event-reducer', () => {
  const events = generateEvents(loadAdaptedCase(CONTROLLER))

  it('确定性：同一事件流重复归并结果一致', () => {
    const a = reduceEvents(events, 's', CONTROLLER)
    const b = reduceEvents(events, 's', CONTROLLER)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('幂等：重复 event_id 不二次应用', () => {
    const snap = reduceEvents(events, 's', CONTROLLER)
    const before = JSON.stringify(snap)
    const dup = applyEvent(snap, events[0]) // 同一事件再喂一次
    expect(JSON.stringify(dup)).toBe(before)
  })

  it('乱序：晚到事件（更低 sequence）不覆盖状态', () => {
    const snap = reduceEvents(events, 's', CONTROLLER)
    const before = JSON.stringify(snap)
    const late = applyEvent(snap, { ...events[0], event_id: 'evt-late' })
    expect(JSON.stringify(late)).toBe(before)
  })

  it('回放契约：Snapshot(n)+Events = Snapshot(m)，replayToSequence 与截断归并等价', () => {
    const half = Math.floor(events.length / 2)
    const viaReplay = replayToSequence(events, half, 's', CONTROLLER)
    const viaSlice = reduceEvents(events.slice(0, half), 's', CONTROLLER)
    expect(viaReplay.session.last_sequence).toBe(half)
    expect(JSON.stringify(viaReplay)).toBe(JSON.stringify(viaSlice))
    // 回放快照不得包含更晚创建的 Fact/Evidence
    expect(viaReplay.facts.every((f) => (f.created_sequence ?? 0) <= half)).toBe(true)
  })

  it('空快照结构合法', () => {
    const empty = createEmptySnapshot('s', CONTROLLER)
    expect(empty.schema_version).toBe('2.0')
    expect(empty.facts).toEqual([])
    expect(empty.session.version).toBe(0)
  })
})

// ── Runtime：LIVE / PAUSED / REPLAY ──
describe('diagnosis-runtime modes', () => {
  it('advance 推进 liveHead 直至 complete', () => {
    let rt = createDiagnosisRuntime(CONTROLLER)
    const total = rt.events.length
    let steps = 0
    while (!rt.complete && steps < total + 5) {
      rt = rt.advance()
      steps++
    }
    expect(rt.complete).toBe(true)
    expect(rt.liveHead).toBe(total)
    expect(rt.snapshot.session.last_sequence).toBe(total)
  })

  it('seek 进入回放、returnLive 恢复、回放不泄露未来事实', () => {
    let rt = createDiagnosisRuntime(CONTROLLER)
    // 先推进到实时头
    while (!rt.complete) rt = rt.advance()
    const totalFacts = rt.snapshot.facts.length

    const midSeq = Math.floor(rt.events.length / 2)
    const replayed = rt.seek(midSeq)
    expect(replayed.isHistorical).toBe(true)
    expect(replayed.snapshot.facts.length).toBeLessThan(totalFacts)
    expect(replayed.snapshot.session.last_sequence).toBe(midSeq)

    const live = replayed.returnLive()
    expect(live.isHistorical).toBe(false)
    expect(live.snapshot.facts.length).toBe(totalFacts)
  })

  it('cursor 在实时态随 advance 前移，在回放态保持', () => {
    let rt = createDiagnosisRuntime(CONTROLLER).advance().advance()
    expect(rt.cursor).toBe(rt.liveHead) // 实时态
    const seeked = rt.seek(1)
    const advanced = seeked.advance()
    expect(advanced.cursor).toBe(1) // 回放态不前移
    expect(advanced.liveHead).toBe(seeked.liveHead + 1)
  })
})

// ── 三 Case 一致性：事件流结构一致、终态确认 ──
describe('three-case parity', () => {
  for (const caseId of listCaseIds()) {
    it(`${caseId} 生成事件、确认根因、链完整`, () => {
      const snap = replayCase(caseId)
      expect(snap.events.length).toBeGreaterThan(10)
      expect(snap.candidates.find((c) => c.status === CandidateStatus.CONFIRMED)).toBeTruthy()
      expect(snap.minimum_evidence_chain?.items.filter((i) => i.required).every((i) => i.status === 'SATISFIED')).toBe(true)
      // #8 八幕书签：每 Case 8 幕，sequence 落在事件流范围内（docs/13 §16.1）。
      expect(snap.replay_bookmarks.length).toBe(8)
      expect(snap.replay_bookmarks.every((b) => b.sequence >= 1 && b.sequence <= snap.events.length)).toBe(true)
    })
  }
})

// ── #1 真值逐步显露：扰邻初始不泄露施压者（docs/13 §7.4/§21.5）──
describe('#1 candidate disclosure (noisy neighbor)', () => {
  it('扰邻首批候选不含施压者 cand-noisy-neighbor-a，延迟到 replanning 后显露', () => {
    const snap = replayCase('noisy_neighbor_io_contention_001')
    const gens = snap.events.filter((e) => e.event_type === 'CANDIDATES_GENERATED')
    expect(gens.length).toBe(2)
    expect(gens[0].payload.candidate_refs as string[]).not.toContain('cand-noisy-neighbor-a')
    expect(gens[1].payload.candidate_refs as string[]).toContain('cand-noisy-neighbor-a')
    expect(snap.candidates.length).toBe(5)
  })

  it('控制器/远程复制无 replanning，候选单批全量显露', () => {
    for (const cid of ['controller_warm_reset_001', 'remote_replication_lag_001']) {
      const gens = replayCase(cid).events.filter((e) => e.event_type === 'CANDIDATES_GENERATED')
      expect(gens.length).toBe(1)
    }
  })
})

// ── #2/#9 路由：基线唯一命中，弱输入必须追问（docs/13 §9.4/§9.5）──
describe('#2/#9 case router', () => {
  it('三基线语句唯一命中对应 Case', () => {
    const cases: Record<string, string> = {
      '数据库LUN时延突然升高，块业务变慢': 'controller_warm_reset_001',
      'Host-B交易业务变慢，怀疑被邻居Host-A的IO突增扰邻': 'noisy_neighbor_io_contention_001',
      '远程复制RPO超标，怀疑复制网络丢包': 'remote_replication_lag_001',
    }
    for (const [text, expectId] of Object.entries(cases)) {
      const r = routeToCase(text, '')
      expect(r.status).toBe('UNIQUE_MATCH')
      expect(r.caseId).toBe(expectId)
    }
  })

  it('弱输入"业务变慢"不唯一命中（必须追问，不得猜测 Controller）', () => {
    const r = routeToCase('业务变慢', '')
    expect(r.status).not.toBe('UNIQUE_MATCH')
    expect(r.error_code).toBeTruthy()
  })
})

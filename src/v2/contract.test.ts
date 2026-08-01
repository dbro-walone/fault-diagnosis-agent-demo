import { describe, expect, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { listCaseIds } from './manifest'
import { replayCase } from './diagnosis-runtime'
import type { DiagnosisSessionSnapshot } from './runtime-types'

/**
 * 三类 Case 共用同一运行时，禁止 case_id 特判。这里对全部发现的 Case
 * 逐个校验 Runtime Contract 不变量（对齐 validate_runtime_contract.py）。
 */
describe('V2 runtime contract — all discovered cases', () => {
  const caseIds = listCaseIds()
  expect(caseIds.length).toBeGreaterThanOrEqual(3)

  for (const caseId of caseIds) {
    describe(caseId, () => {
      const snap = replayCase(caseId)

      it('schema_version 为 2.0', () => {
        expect(snap.schema_version).toBe('2.0')
      })

      it('事件序列从 1 开始、无缺口、last_sequence 对齐', () => {
        const seqs = snap.events.map((e) => e.sequence)
        expect(seqs).toHaveLength(snap.events.length)
        expect(Math.min(...seqs)).toBe(1)
        expect(new Set(seqs).size).toBe(seqs.length) // 无重复
        const sorted = [...seqs].sort((a, b) => a - b)
        expect(sorted).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1))
        expect(snap.session.last_sequence).toBe(Math.max(...seqs))
      })

      it('event_id 幂等且与 session 一致', () => {
        const ids = snap.events.map((e) => e.event_id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const e of snap.events) expect(e.session_id).toBe(snap.session.session_id)
      })

      it('不含 V1 遗留 confidence / initial_confidence 字段', () => {
        const offenders: string[] = []
        walkKeys(snap, '', new Set(['confidence', 'initial_confidence']), offenders)
        expect(offenders).toEqual([])
      })

      it('每个 Fact 结构合法且 object_refs/source_refs 非空', () => {
        expect(snap.facts.length).toBeGreaterThan(0)
        for (const f of snap.facts) {
          expect(f.object_refs.length).toBeGreaterThanOrEqual(1)
          expect(f.source.source_refs.length).toBeGreaterThanOrEqual(1)
          expect(f.source.execution_id).toBeTruthy()
          expect(f.source.skill_id).toBeTruthy()
          expect(f.payload).toBeTypeOf('object')
        }
      })

      it('每个 Evidence 引用已知 Fact 且 effect 合法', () => {
        const factIds = new Set(snap.facts.map((f) => f.fact_id))
        const candIds = new Set(snap.candidates.map((c) => c.candidate_id))
        const validEffects = new Set(['STRONG_SUPPORT', 'SUPPORT', 'WEAKEN', 'CONFLICT', 'NEUTRAL'])
        expect(snap.evidences.length).toBeGreaterThan(0)
        for (const ev of snap.evidences) {
          expect(ev.fact_refs.length).toBeGreaterThanOrEqual(1)
          for (const r of ev.fact_refs) expect(factIds.has(r)).toBe(true)
          expect(ev.effects.length).toBeGreaterThanOrEqual(1)
          for (const eff of ev.effects) {
            expect(candIds.has(eff.candidate_id)).toBe(true)
            expect(validEffects.has(eff.effect)).toBe(true)
            expect(typeof eff.score_delta).toBe('number')
            expect(eff.explanation.length).toBeGreaterThan(0)
          }
        }
      })

      it('Fact 先于引用它的 Evidence 创建（时序血缘）', () => {
        const factCreated = new Map(snap.facts.map((f) => [f.fact_id, f.created_sequence ?? Infinity]))
        for (const ev of snap.evidences) {
          const created = ev.created_sequence ?? Infinity
          for (const r of ev.fact_refs) {
            expect(factCreated.get(r) ?? Infinity).toBeLessThanOrEqual(created)
          }
        }
      })

      it('候选分数 0..100、状态合法、根因唯一', () => {
        const validStatus = new Set([
          'INITIAL', 'ACTIVE', 'LEADING', 'WEAKENED', 'CONFLICTING',
          'CONFIRMED', 'NOT_CONFIRMED', 'INSUFFICIENT_EVIDENCE',
        ])
        for (const c of snap.candidates) {
          expect(c.diagnosis_support_score).toBeGreaterThanOrEqual(0)
          expect(c.diagnosis_support_score).toBeLessThanOrEqual(100)
          expect(validStatus.has(c.status)).toBe(true)
          expect(c.object_id).toBeTruthy()
          expect(c.fault_mode_code).toBeTruthy()
        }
        const confirmed = snap.candidates.filter((c) => c.status === 'CONFIRMED')
        expect(confirmed.length).toBe(1)
      })

      it('每个 fact_id 与 evidence_id 都被某事件 payload 引用', () => {
        const text = JSON.stringify(snap.events)
        for (const f of snap.facts) expect(text).toContain(f.fact_id)
        for (const ev of snap.evidences) expect(text).toContain(ev.evidence_id)
      })

      it('确认候选与最小证据链一致、必需项全部满足、分数≥80', () => {
        const confirmed = snap.candidates.find((c) => c.status === 'CONFIRMED')!
        expect(snap.minimum_evidence_chain).not.toBeNull()
        const chain = snap.minimum_evidence_chain!
        expect(chain.candidate_id).toBe(confirmed.candidate_id)
        for (const item of chain.items) {
          if (item.required) expect(item.status).toBe('SATISFIED')
        }
        expect(confirmed.diagnosis_support_score).toBeGreaterThanOrEqual(80)
      })

      it('存在 ROOT_CAUSE_CONFIRMED 事件且引用已确认候选', () => {
        const root = snap.events.find((e) => e.event_type === 'ROOT_CAUSE_CONFIRMED')
        expect(root).toBeTruthy()
        const ref = root!.payload['candidate_ref']
        expect(snap.candidates.find((c) => c.candidate_id === ref)?.status).toBe('CONFIRMED')
      })

      it('agent_focus 与 user_selection 分离（快照不含 user_selection）', () => {
        expect(snap.session.agent_focus).toBeTypeOf('object')
        expect((snap as unknown as Record<string, unknown>)['user_selection']).toBeUndefined()
      })

      // 顺带把生成的终态快照落盘，供 validate_runtime_contract.py 独立复核。
      it('落盘终态快照到 schemas/generated/', () => {
        const dir = resolve(__dirname, '../../schemas/generated')
        mkdirSync(dir, { recursive: true })
        writeFileSync(
          resolve(dir, `${caseId}.fixture.json`),
          JSON.stringify(serializeForContract(snap), null, 2),
          'utf-8',
        )
      })
    })
  }
})

// ── helpers ──

function walkKeys(value: unknown, path: string, banned: Set<string>, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkKeys(v, `${path}[${i}]`, banned, out))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (banned.has(k)) out.push(`${path}.${k}`)
      walkKeys(v, `${path}.${k}`, banned, out)
    }
  }
}

/** 序列化为 Runtime Contract 顶层结构（供 python 校验器消费）。 */
function serializeForContract(snap: DiagnosisSessionSnapshot): unknown {
  return {
    schema_version: snap.schema_version,
    session: snap.session,
    facts: snap.facts,
    evidences: snap.evidences,
    candidates: snap.candidates,
    minimum_evidence_chain: snap.minimum_evidence_chain,
    events: snap.events,
  }
}

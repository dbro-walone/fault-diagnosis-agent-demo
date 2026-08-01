#!/usr/bin/env node
/**
 * V2 Runtime 端到端校验脚本。
 *
 * 使用 Vite 的 ssrLoadModule 加载 V2 运行时（支持 import.meta.glob），
 * 对三类 Case 各自归并出终态快照，断言 Runtime Contract 不变量，并将
 * 终态快照落盘到 schemas/generated/，供 validate_runtime_contract.py 独立复核。
 *
 * 运行：node tools/v2-verify.mjs
 */
import { createServer } from 'vite'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const vite = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
  optimizeDeps: { disabled: true },
})

let failures = 0
let totalChecks = 0
const ok = (cond, msg) => {
  totalChecks++
  if (!cond) {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}

try {
  const v2 = await vite.ssrLoadModule('/src/v2/index.ts')
  const caseIds = v2.listCaseIds()
  console.log(`Discovered ${caseIds.length} cases: ${caseIds.join(', ')}\n`)

  for (const caseId of caseIds) {
    console.log(`▸ ${caseId}`)
    const snap = v2.replayCase(caseId)
    const facts = snap.facts
    const evidences = snap.evidences
    const candidates = snap.candidates
    const events = snap.events
    const chain = snap.minimum_evidence_chain

    ok(snap.schema_version === '2.0', 'schema_version == 2.0')

    const seqs = events.map((e) => e.sequence)
    ok(seqs.length > 0 && Math.min(...seqs) === 1, 'event sequences start at 1')
    ok(new Set(seqs).size === seqs.length, 'no duplicate event sequence')
    const sorted = [...seqs].sort((a, b) => a - b)
    ok(JSON.stringify(sorted) === JSON.stringify(Array.from({ length: seqs.length }, (_, i) => i + 1)), 'event sequences gap-free')
    ok(snap.session.last_sequence === Math.max(...seqs), 'last_sequence == max event sequence')
    ok(events.every((e) => e.session_id === snap.session.session_id), 'all events share session_id')

    // 禁止 V1 遗留字段
    const banned = new Set(['confidence', 'initial_confidence'])
    const offenders = []
    ;(function walk(v, p) {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`))
      else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) {
        if (banned.has(k)) offenders.push(`${p}.${k}`)
        walk(val, `${p}.${k}`)
      }
    })(snap, '')
    ok(offenders.length === 0, `no legacy confidence fields (${offenders.slice(0, 3).join(', ')})`)

    const factIds = new Set(facts.map((f) => f.fact_id))
    const candIds = new Set(candidates.map((c) => c.candidate_id))
    const validEffects = new Set(['STRONG_SUPPORT', 'SUPPORT', 'WEAKEN', 'CONFLICT', 'NEUTRAL'])
    ok(facts.length > 0, 'has facts')
    ok(facts.every((f) => f.object_refs.length >= 1 && f.source.source_refs.length >= 1 && f.source.execution_id && f.source.skill_id), 'all facts well-formed')
    ok(evidences.length > 0, 'has evidences')
    ok(evidences.every((ev) => ev.fact_refs.every((r) => factIds.has(r)) && ev.effects.every((eff) => candIds.has(eff.candidate_id) && validEffects.has(eff.effect) && typeof eff.score_delta === 'number' && eff.explanation)), 'all evidences reference known facts/candidates')

    // 时序血缘：Fact 早于引用它的 Evidence
    const factCreated = new Map(facts.map((f) => [f.fact_id, f.created_sequence ?? Infinity]))
    ok(evidences.every((ev) => ev.fact_refs.every((r) => (factCreated.get(r) ?? Infinity) <= (ev.created_sequence ?? Infinity))), 'fact created before referencing evidence')

    // 候选分数/状态
    const validStatus = new Set(['INITIAL', 'ACTIVE', 'LEADING', 'WEAKENED', 'CONFLICTING', 'CONFIRMED', 'NOT_CONFIRMED', 'INSUFFICIENT_EVIDENCE'])
    ok(candidates.every((c) => c.diagnosis_support_score >= 0 && c.diagnosis_support_score <= 100 && validStatus.has(c.status) && c.object_id && c.fault_mode_code), 'candidates well-formed')

    const confirmed = candidates.filter((c) => c.status === 'CONFIRMED')
    ok(confirmed.length === 1, `exactly one confirmed candidate (got ${confirmed.length})`)

    // 每个 fact/evidence id 必须出现在某事件 payload
    const text = JSON.stringify(events)
    ok(facts.every((f) => text.includes(f.fact_id)), 'every fact referenced by an event')
    ok(evidences.every((ev) => text.includes(ev.evidence_id)), 'every evidence referenced by an event')

    // 确认候选与最小证据链
    ok(chain && chain.candidate_id === confirmed[0].candidate_id, 'chain matches confirmed candidate')
    ok(chain.items.filter((i) => i.required).every((i) => i.status === 'SATISFIED'), 'all required chain items satisfied')
    ok(confirmed[0].diagnosis_support_score >= 80, `confirmed score >= 80 (got ${confirmed[0].diagnosis_support_score})`)

    const rootEvent = events.find((e) => e.event_type === 'ROOT_CAUSE_CONFIRMED')
    ok(rootEvent && candidates.find((c) => c.candidate_id === rootEvent.payload.candidate_ref)?.status === 'CONFIRMED', 'ROOT_CAUSE_CONFIRMED event references confirmed candidate')

    // agent_focus 与 user_selection 分离
    ok(typeof snap.session.agent_focus === 'object' && snap.user_selection === undefined, 'agent_focus present, user_selection absent from snapshot')

    // 落盘供 python 校验器复核
    const dir = resolve(root, 'schemas/generated')
    mkdirSync(dir, { recursive: true })
    const fixture = {
      schema_version: snap.schema_version,
      session: snap.session,
      facts,
      evidences,
      candidates,
      minimum_evidence_chain: chain,
      events,
    }
    writeFileSync(resolve(dir, `${caseId}.fixture.json`), JSON.stringify(fixture, null, 2), 'utf-8')

    console.log(`    events=${events.length} facts=${facts.length} evidences=${evidences.length} ` +
      `confirmed=${confirmed[0].candidate_id}(${confirmed[0].diagnosis_support_score}) ` +
      `chain=${chain.items.filter((i) => i.status === 'SATISFIED').length}/${chain.items.length}`)
  }

  console.log(`\n${totalChecks - failures}/${totalChecks} checks passed`)
  if (failures) {
    console.log('V2 VERIFY: FAILED')
    process.exitCode = 1
  } else {
    console.log('V2 VERIFY: PASSED')
  }
} catch (err) {
  console.error('V2 VERIFY: ERROR')
  console.error(err)
  process.exitCode = 1
} finally {
  await vite.close()
}

#!/usr/bin/env node
/**
 * ProjectionStore + DiagnosisRuntime 冒烟测试：确保编排器（advance/seek）
 * 与各 View Model 在真实 Case 上可端到端运行、数据合理。
 */
import { createServer } from 'vite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { disabled: true } })

let failures = 0
const ok = (cond, msg) => { if (!cond) { failures++; console.log('  ✗', msg) } }

try {
  const v2 = await vite.ssrLoadModule('/src/v2/index.ts')
  for (const caseId of v2.listCaseIds()) {
    console.log(`▸ ${caseId}`)
    // 1) Runtime: advance 到完成
    let rt = v2.createDiagnosisRuntime(caseId)
    ok(rt.mode === 'LIVE' && rt.liveHead === 0, 'initial LIVE/liveHead=0')
    let guard = 0
    while (!rt.complete && guard++ < 500) rt = rt.advance()
    ok(rt.complete, 'advances to complete')
    ok(rt.liveHead === rt.events.length, 'liveHead == events.length')

    // 2) ProjectionStore 绑定终态快照
    const store = new v2.ProjectionStore()
    store.bind(rt.snapshot)
    const ks = store.knowledgeSnapshot()
    const act = store.currentAction()
    const cand = store.candidateList()
    ok(ks.terminal_status_label === 'ROOT_CAUSE_CONFIRMED', `terminal confirmed (got ${ks.terminal_status_label})`)
    ok(cand.items.length >= 3, `>=3 candidates (got ${cand.items.length})`)
    ok(cand.items[0].score >= cand.items.at(-1).score, 'candidates sorted desc by score')
    ok(cand.confirmed_id !== null, 'has confirmed candidate')
    ok(ks.chain_progress.required_missing === 0, 'no required chain gaps at terminal')
    ok(act.has_activity === false, 'no current activity at terminal (completed)')

    // 3) 证据链 / 事实详情 / 时间线
    const chain = store.evidenceChain(cand.confirmed_id)
    ok(chain.items.length > 0, 'confirmed candidate has evidence')
    ok(chain.items.every((i) => i.facts.length >= 1), 'every evidence traces to >=1 fact')
    const firstFactId = chain.items[0].facts[0].fact_id
    const fd = store.factDetail(firstFactId)
    ok(fd !== null && fd.payload_rows.length > 0, 'fact detail has payload rows')
    ok(fd.referenced_by_evidence_ids.includes(chain.items[0].evidence_id), 'fact back-references evidence')
    const tl = store.timeline()
    ok(tl.length === rt.events.length, 'timeline length == events')
    ok(tl[0].sequence === 1 && tl.at(-1).sequence === rt.events.length, 'timeline ordered')

    // 4) user_selection 与 agent_focus 分离 + seek 回放
    store.setUserSelection({ selected_candidate_id: cand.items[1].candidate_id })
    ok(store.userSelection.selected_candidate_id === cand.items[1].candidate_id, 'user_selection settable')
    ok(rt.snapshot.session.agent_focus.source_id === cand.confirmed_id, 'agent_focus tracks confirmed (runtime-only)')

    const mid = Math.floor(rt.events.length / 2)
    const replayed = rt.seek(mid)
    ok(replayed.isHistorical && replayed.snapshot.facts.length < rt.snapshot.facts.length, 'seek replays past, hides future facts')
    ok(replayed.returnLive().isHistorical === false, 'returnLive exits replay')

    console.log(`    leading=${ks.leading_candidate_id}(${ks.leading_score_label}) candidates=${cand.items.length} timeline=${tl.length}`)
  }
  console.log(`\n${failures ? failures + ' SMOKE FAILURES' : 'SMOKE: PASSED'}`)
  process.exitCode = failures ? 1 : 0
} catch (err) {
  console.error('SMOKE ERROR', err); process.exitCode = 1
} finally { await vite.close() }

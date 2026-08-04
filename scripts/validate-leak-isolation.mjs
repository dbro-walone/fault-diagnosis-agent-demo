// 真值隔离校验（docs/19 §7/§8/§17.2 Gate 5）——CaseKnowledgeAdapter 阶段4。
// 用 Vite SSR 加载 TS 校验器（src/adapters/case-knowledge-adapter.ts），与单元测试共用同一套口径。
//
// 用法：node scripts/validate-leak-isolation.mjs
// 校验内容（CKA-LEAK-*）：
//   - RuntimeSeed 不含 Ground Truth / 结论 / 观测 / Bundle 字段（§8.2 物理隔离）；
//   - T0 SESSION_CREATED / T1 INITIAL_CONTEXT_READY 干净（§8.5，前端响应不含未来答案）；
//   - 首轮候选无精确 FaultMode / 最终分（§10.4，场景级/对象异常级投影）；
//   - ReleaseEnvelope 由 Runtime Event 触发，固定幕次/定时器禁止（§8.6）；
//   - CANDIDATES_GENERATED 事件载荷无精确答案；终态事件前响应不含结论（§15/§21.19）。
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

let failures = 0
const print = (msg) => console.log(msg)
try {
  const v2 = await server.ssrLoadModule('/src/v2/index.ts')
  const { listCases, loadAdaptedCase, compileCase, replayCase, resolveRelease, validateLeakIsolation, GENERALIZED_FAULT_MODE_PREFIX } = v2

  const cases = listCases()
  print(`\n真值隔离校验 · ${cases.length} 个 Case（CKA-LEAK-*）`)

  for (const entry of cases) {
    const tag = `[${entry.caseId}]`
    try {
      const adapted = loadAdaptedCase(entry.caseId)
      const events = replayCase(entry.caseId).events
      const compiled = compileCase(adapted, events)

      // —— 1. 编译期泄露报告（A9：Seed/Bundle/首轮候选/信封触发源）——
      const errors = compiled.leakReport.issues.filter((i) => i.severity === 'ERROR')
      const warnings = compiled.leakReport.issues.filter((i) => i.severity === 'WARN')

      // —— 2. Seed 不含 Ground Truth（§8.2/§8.5）——
      const seedText = JSON.stringify(compiled.runtimeSeed)
      const seedClean =
        compiled.runtimeSeed.initial_visible_context.facts.length === 0 &&
        compiled.runtimeSeed.initial_visible_context.known_topology_subgraph.resources.length === 0 &&
        compiled.runtimeSeed.initial_visible_context.known_knowledge_subgraph.nodes.length === 0 &&
        !/CONTROLLER_WARM_RESET|FC_LINK_FLAP|SAN_LINK_FAULT|POOL_BOTTLENECK/.test(seedText) &&
        !seedText.includes('scenario_fixture_index') &&
        !seedText.includes('environment_truth')

      // —— 3. 首轮候选无精确答案（§10.4）——
      const firstRoundClean = compiled.generalizedCandidates.every(
        (c) => c.fault_mode_code.startsWith(GENERALIZED_FAULT_MODE_PREFIX),
      )

      // —— 4. T0/T1 快照干净（§8.5 Gate 5）——
      const t1Seq = events.find((e) => e.event_type === 'DIAGNOSIS_PHASE_CHANGED')?.sequence ?? 1
      const { replayToSequence } = await server.ssrLoadModule('/src/v2/event-reducer.ts')
      const t0Snap = replayToSequence(events, 0, `session-${entry.caseId}`, entry.caseId)
      const t1Snap = replayToSequence(events, Math.max(0, t1Seq - 1), `session-${entry.caseId}`, entry.caseId)
      const t0Clean =
        t0Snap.candidates.length === 0 && t0Snap.facts.length === 0 && t0Snap.evidences.length === 0 && !t0Snap.conclusion
      const t1Clean =
        !t1Snap.conclusion && t1Snap.candidates.every((c) => c.fault_mode_code.startsWith(GENERALIZED_FAULT_MODE_PREFIX))

      // —— 5. 渐进释放：事件流 CANDIDATES_GENERATED 无精确答案；终态前无结论 ——
      const genEvents = events.filter((e) => e.event_type === 'CANDIDATES_GENERATED')
      const genClean = genEvents.every((e) => {
        const cands = e.payload['candidates'] ?? []
        return cands.every((c) => c.fault_mode_code?.startsWith(GENERALIZED_FAULT_MODE_PREFIX))
      })
      const diagCompletedSeq = events.find((e) => e.event_type === 'DIAGNOSIS_COMPLETED')?.sequence ?? events.length
      const preTerminal = replayToSequence(events, Math.max(0, diagCompletedSeq - 1), `session-${entry.caseId}`, entry.caseId)
      const conclusionGated = !preTerminal.conclusion

      // —— 6. ReleaseEnvelope 事件驱动（§8.6/§13.4）——
      const envelopeClean = compiled.releaseEnvelopes.every(
        (env) => env.release_on.event_type !== 'STORYBOARD_ACT' && env.release_on.event_type !== 'TIMER',
      )

      // —— 7. 释放时序：结论（Ground Truth）在首个终态事件前不得释放（resolveRelease 语义）——
      const firstTerminalSeq =
        events.find((e) =>
          ['ROOT_CAUSE_CONFIRMED', 'PROBABLE_CAUSES_REPORTED', 'INSUFFICIENT_EVIDENCE_REPORTED'].includes(e.event_type),
        )?.sequence ?? events.length
      const releaseTerminal = resolveRelease(compiled, events, events.length)
      const releaseEarly = resolveRelease(compiled, events, Math.max(0, firstTerminalSeq - 1))
      const releaseGated = !releaseEarly.conclusionReleased && releaseTerminal.conclusionReleased

      const ok =
        errors.length === 0 && seedClean && firstRoundClean && t0Clean && t1Clean && genClean && conclusionGated && envelopeClean && releaseGated
      if (!ok) failures += 1

      print(
        `${tag} ${ok ? 'OK' : 'FAIL'} · seed=${seedClean ? 'clean' : 'LEAK'} ` +
          `t0=${t0Clean ? 'clean' : 'LEAK'} t1=${t1Clean ? 'clean' : 'LEAK'} ` +
          `firstRound=${firstRoundClean ? 'scene' : 'LEAK'} genEvent=${genClean ? 'scene' : 'LEAK'} ` +
          `conclusionGated=${conclusionGated ? 'yes' : 'LEAK'} envelope=${envelopeClean ? 'event' : 'LEAK'} ` +
          `release=${releaseGated ? 'progressive' : 'LEAK'} · errors=${errors.length} warns=${warnings.length}`,
      )
      for (const issue of compiled.leakReport.issues) {
        print(`  [${issue.code} ${issue.severity}] ${issue.message}`)
      }
      if (errors.length) {
        for (const err of errors) print(`  ✘ [${err.code}] ${err.message}`)
      }
    } catch (error) {
      failures += 1
      print(`${tag} FAIL · threw: ${error?.message ?? error}`)
    }
  }

  // —— 8. 跨 Case 汇总 ——
  print('')
  const allEvents = []
  for (const entry of cases) {
    const adapted = loadAdaptedCase(entry.caseId)
    const events = replayCase(entry.caseId).events
    allEvents.push({ caseId: entry.caseId, events })
  }
  const controller = allEvents.find((x) => x.caseId === 'controller_warm_reset_001')
  if (controller) {
    const { replayToSequence: r2 } = await server.ssrLoadModule('/src/v2/event-reducer.ts')
    const gen = controller.events.find((e) => e.event_type === 'CANDIDATES_GENERATED')
    const names = (gen?.payload['candidates'] ?? []).map((c) => c.display_name)
    print(`控制器首轮候选（§10.4 场景级，不得含"热复位/96"）：${names.join(' / ')}`)
    const leaks = names.filter((n) => /热复位|抖动|96/.test(String(n)))
    if (leaks.length) {
      failures += 1
      print(`  ✘ 首轮候选泄露精确答案信号词：${leaks.join(', ')}`)
    } else {
      print('  ✓ 首轮候选无精确答案信号词')
    }
  }
} finally {
  await server.close()
}

console.log(`\n${failures === 0 ? '✓ LEAK ISOLATION VALID' : `✘ ${failures} 项泄露校验失败`}`)
process.exit(failures === 0 ? 0 : 1)

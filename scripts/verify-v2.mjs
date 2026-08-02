// Runtime verification of the V2 layer for ALL three cases, without vitest.
// Uses Vite's SSR module loader (resolves import.meta.glob exactly like the app).
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

let failures = 0
try {
  const v2 = await server.ssrLoadModule('/src/v2/index.ts')
  const { listCases, createDiagnosisRuntime, loadAdaptedCase, replayCase, ProjectionStore } = v2

  // issue#6 阶段C：知识图谱参考（静态 model knowledge 平面 + 知识内部跨层映射）。
  const modelMod = await server.ssrLoadModule('/src/lib/model-loader.ts')
  const model = modelMod.loadModelData()
  const kgNodeIdSet = new Set(model.nodes.filter((n) => n.plane === 'knowledge').map((n) => n.id))
  const kgNodeRefs = model.nodes
    .filter((n) => n.plane === 'knowledge')
    .map((n) => ({
      id: n.id,
      layer: n.group,
      code: typeof n.object.properties.code === 'string' ? n.object.properties.code : null,
      fault_mode_code:
        n.object.properties.attributes?.['fault_mode_code'] ?? null,
    }))
  const kgLinkRefs = model.links
    .filter((l) => {
      if (l.category === 'knowledge') return true
      if (l.category === 'cross') {
        return kgNodeIdSet.has(l.source) && kgNodeIdSet.has(l.target)
      }
      return false
    })
    .map((l) => ({ source: l.source, target: l.target, relation: l.relation }))

  const cases = listCases()
  console.log(`\nDiscovered ${cases.length} cases via V2 manifest.`)
  if (cases.length < 3) {
    console.error(`✘ expected at least 3 cases, got ${cases.length}`)
    failures += 1
  }

  for (const entry of cases) {
    const tag = `[${entry.caseId}]`
    try {
      // 1. Full replay → terminal snapshot.
      const snap = replayCase(entry.caseId)
      const confirmed = snap.candidates.find((c) => c.status === 'CONFIRMED')

      // 2. Stepping runtime live → must reach the same event count deterministically.
      let rt = createDiagnosisRuntime(entry.caseId)
      let guard = 0
      while (!rt.complete && guard++ < 1000) rt = rt.advance()
      const liveSnap = rt.liveSnapshot

      // 3. ProjectionStore VMs must compute without throwing (the LUI data source).
      const store = new ProjectionStore()
      store.bind(liveSnap)
      const ks = store.knowledgeSnapshot()
      const cl = store.candidateList()
      const act = store.currentAction()
      const planner = store.plannerTargets()
      const tl = store.timeline()
      const chainCandId = cl.leading_id ?? cl.items[0]?.candidate_id ?? ''
      const ec = store.evidenceChain(chainCandId)
      const firstFact = liveSnap.facts[0]
      const fd = firstFact ? store.factDetail(firstFact.fact_id) : null
      // REPLAY seek/returnLive round-trip.
      const mid = Math.floor(rt.events.length / 2)
      const replayed = rt.seek(mid)
      const back = replayed.returnLive()

      // issue#6 阶段A：Planner 目标 VM 必须可计算；controller 必须有 5 个目标且发生重规划。
      const plannerOk =
        Array.isArray(planner.targets) &&
        typeof planner.has_replan === 'boolean' &&
        (entry.caseId !== 'controller_warm_reset_001' || (planner.targets.length === 5 && planner.has_replan))

      // issue#6 阶段B：对象观测三标签 VM 必须可计算；焦点对象存在、三类标签状态合法。
      const obsStore = new ProjectionStore()
      obsStore.bind(liveSnap, { observationsFacts: loadAdaptedCase(entry.caseId).facts })
      const obs = obsStore.objectObservationPanel()
      const obsStatusOk = new Set([
        'QUERIED_ABNORMAL', 'QUERIED_NORMAL', 'NOT_QUERIED', 'DATA_MISSING', 'PARTIAL',
      ])
      const obsOk =
        Array.isArray(obs.objects) &&
        obs.objects.every((o) =>
          ['alarms', 'perf', 'logs'].every((k) => obsStatusOk.has(o[k].status) && Array.isArray(o[k].items)),
        ) &&
        (obs.focus_object_id == null || obs.objects.some((o) => o.object_id === obs.focus_object_id))

      // issue#6 阶段C：诊断循环 VM 必须可计算；对象判定合法、图谱点亮为数组。
      const scanStore = new ProjectionStore()
      scanStore.bind(liveSnap, {
        observationsFacts: loadAdaptedCase(entry.caseId).facts,
        knowledgeNodes: kgNodeRefs,
        knowledgeLinks: kgLinkRefs,
      })
      const scan = scanStore.diagnosisScan()
      const verdictSet = new Set(['NORMAL', 'ABNORMAL', 'IMPACTED', 'CANDIDATE'])
      const scanOk =
        Array.isArray(scan.examined_objects) &&
        Array.isArray(scan.graph_entry_anchors) &&
        Array.isArray(scan.graph_lit_knowledge_ids) &&
        scan.examined_objects.every(
          (o) => o.verdict === null || verdictSet.has(o.verdict),
        )

      const ok =
        snap.events.length > 0 &&
        liveSnap.events.length === snap.events.length &&
        tl.length === snap.events.length &&
        cl.items.length > 0 &&
        typeof ks.leading_score_label === 'string' &&
        back.cursor === rt.liveHead &&
        plannerOk &&
        obsOk &&
        scanOk

      const status = ok ? 'OK' : 'FAIL'
      if (!ok) failures += 1
      const focusObs = obs.objects.find((o) => o.object_id === obs.focus_object_id)
      console.log(
        `${tag} ${status} · events=${snap.events.length} facts=${snap.facts.length} ` +
          `evidences=${snap.evidences.length} candidates=${snap.candidates.length} ` +
          `confirmed=${confirmed?.candidate_id ?? 'none'}(${confirmed?.diagnosis_support_score ?? '-'}) ` +
          `leading="${cl.items[0]?.display_name ?? '-'}"(${ks.leading_score_label}) ` +
          `chain=${ks.chain_progress.satisfied}/${ks.chain_progress.total} ` +
          `evidenceChainItems=${ec.items.length} factDetail=${fd ? 'yes' : 'no'} ` +
          `plannerTargets=${planner.targets.length} replan=${planner.has_replan ? 'yes' : 'no'} ` +
          `obsObjects=${obs.objects.length} obsFocus=${obs.focus_object_id ?? 'none'}` +
          (focusObs
            ? `(告警:${focusObs.alarms.status_label}|性能:${focusObs.perf.status_label}|日志:${focusObs.logs.status_label})`
            : '') +
          ` scanQuery=${scan.active_query_object_id ?? 'none'} scanVerdicts=${scan.examined_objects.filter((o) => o.verdict).length}/${scan.examined_objects.length} kgAnchors=${scan.graph_entry_anchors.length} kgLit=${scan.graph_lit_knowledge_ids.length}`,
      )
      if (!ok) {
        console.log(`   events(replay)=${snap.events.length} live=${liveSnap.events.length} timeline=${tl.length}`)
      }
    } catch (error) {
      failures += 1
      console.log(`${tag} FAIL · threw: ${error?.message ?? error}`)
    }
  }
  // 4. Symptom → case routing (V2 manifest auto-discovery).
  const router = await server.ssrLoadModule('/src/lib/v2-case-router.ts')
  const probes = [
    { text: '数据库LUN时延突然升高，块业务变慢', expect: 'controller_warm_reset_001' },
    { text: 'Host-B交易业务变慢，怀疑被邻居Host-A的IO突增扰邻', expect: 'noisy_neighbor_io_contention_001' },
    { text: '远程复制RPO超标，怀疑复制网络丢包', expect: 'remote_replication_lag_001' },
  ]
  for (const p of probes) {
    const r = router.routeToCase(p.text, '')
    const ok = r.caseId === p.expect
    if (!ok) failures += 1
    console.log(`[route] ${ok ? 'OK' : 'FAIL'} · "${p.text.slice(0, 18)}…" → ${r.caseId} (confident=${r.confident})`)
  }
} finally {
  await server.close()
}

console.log(`\n${failures === 0 ? '✓ ALL CASES VERIFIED' : `✘ ${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)

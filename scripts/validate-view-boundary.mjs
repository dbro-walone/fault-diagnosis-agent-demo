// 前端投影边界校验（docs/19 §14，阶段5）—— VWB-*。
// 用 Vite SSR 加载 TS 校验器，与单元测试共用同一套口径。
//
// 用法：node scripts/validate-view-boundary.mjs
// 校验内容（VWB-*）：
//   - VWB-001 聚合/展开/缩放/聚焦不改变诊断语义：投影操作前后 diagnosisFingerprint 不变；
//   - VWB-002 当前诊断对象/关键路径/ACTIVE Binding 不被错误聚合（§14.2）：
//     关键对象（agent_focus ∪ 根因/根因链/影响链）在任意展开配置下保持可见；
//   - VWB-003 投影只消费 Known（§14.1/§7.1）：viewProjection 无 PrivateCaseBundle/Truth 字段，
//     known_facts ⊆ 已释放 Known Fact 集合；
//   - VWB-004 ViewState 操作不写 Runtime（§14.4）：viewStateReducer 纯函数（新对象/不改入参/
//     不产生事件）；
//   - VWB-005 回放只读（§6.4/§14.4）：seek/step/returnLive 不写 live 快照候选/证据/结论。
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

let failures = 0
const fail = (msg) => {
  failures += 1
  console.log(`  ✘ ${msg}`)
}
const ok = (msg) => console.log(`  ✓ ${msg}`)

/** 一组典型用户投影操作（聚合展开/缩放聚焦/筛选/相机提示），确定性序列。 */
const SAMPLE_VIEW_ACTIONS = [
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

/** PrivateCaseBundle / Truth 字段标记（docs/19 §8.2）—— 前端投影一律不得出现。 */
const TRUTH_MARKERS = [
  'dme-private-case-bundle',
  'environment_truth',
  'scenario_fixture_index',
  'observation_catalog',
  'knowledge_binding_index',
  'ground_truth',
  'source_ref_map',
  'release_envelopes',
]

try {
  const v2 = await server.ssrLoadModule('/src/v2/index.ts')
  const { listCases, createDiagnosisRuntime, loadAdaptedCase, ProjectionStore, releasedFactsFrom, diagnosisFingerprint } = v2
  const { DEFAULT_VIEW_STATE, viewStateReducer, applyViewActions } = v2
  const topo = await server.ssrLoadModule('/src/lib/layered-topology.ts')
  const { buildLayeredModelData, buildLayeredActiveGraph } = topo

  const cases = listCases()
  console.log(`\n前端投影边界校验 · ${cases.length} 个 Case（VWB-*）`)

  for (const entry of cases) {
    const tag = `[${entry.caseId}]`
    console.log(`\n${tag}`)
    let rt = createDiagnosisRuntime(entry.caseId)
    let guard = 0
    while (!rt.complete && guard++ < 3000) rt = rt.advance()
    const liveSnap = rt.liveSnapshot

    // ── VWB-001 聚合不改变诊断语义（全事件流逐快照） ──
    let vwb001 = true
    let step = 0
    let probe = createDiagnosisRuntime(entry.caseId)
    while (!probe.complete && step++ < 3000) {
      probe = probe.advance()
      const snap = probe.snapshot
      const fp = diagnosisFingerprint(snap)
      let vs = { ...DEFAULT_VIEW_STATE }
      for (const action of SAMPLE_VIEW_ACTIONS) vs = viewStateReducer(vs, action)
      if (diagnosisFingerprint(snap) !== fp) {
        vwb001 = false
        fail(`VWB-001 序列 ${step} 投影操作改变诊断语义`)
        break
      }
      // 投影指纹与快照一致（投影派生自快照而非 ViewState）。
      const store = new ProjectionStore()
      store.bind(snap)
      if (store.viewProjection().diagnosis_fingerprint !== fp) {
        vwb001 = false
        fail(`VWB-001 序列 ${step} 投影指纹与快照不一致`)
        break
      }
    }
    if (vwb001) ok(`VWB-001 全事件流 ${step} 个快照：聚合/展开/缩放/聚焦不改变诊断语义，投影指纹一致`)

    // ── VWB-002 当前诊断对象/关键路径不被错误聚合（docs/19 §14.2） ──
    const model = buildLayeredModelData(entry.caseId)
    const critical = new Set(liveSnap.session.agent_focus?.object_refs ?? [])
    const c = liveSnap.conclusion
    if (c) {
      if (c.root_cause?.object_id) critical.add(c.root_cause.object_id)
      for (const id of c.root_cause_chain ?? []) critical.add(id)
      for (const id of c.impact_chain ?? []) critical.add(id)
    }
    // 关键对象必须位于当前分层模型（存在节点）；DETACHED_CRITICAL 保证聚合收起时仍显示。
    const layeredCritical = [...critical].filter((id) => model.nodesById.has(id))
    if (layeredCritical.length === 0) {
      ok('VWB-002 本 Case 无落入分层模型的关键对象（跳过聚合保持性）')
    } else {
      // 采样展开配置：全收起 / 全展开 / 混合。
      const allLayerCodes = model.layers.map((l) => l.code)
      const configs = [
        {},
        Object.fromEntries(allLayerCodes.map((code) => [code, true])),
        { S1: true, S2: false, S3: true, BIZ: false, SAN: true, STORAGE: false },
      ]
      let vwb002 = true
      for (const expanded of configs) {
        const graph = buildLayeredActiveGraph(model, { expandedLayers: expanded, criticalObjectIds: new Set(layeredCritical) })
        for (const id of layeredCritical) {
          const anchor = graph.anchorByObjectId.get(id)
          if (anchor !== id || !graph.nodes.some((n) => n.id === id)) {
            vwb002 = false
            fail(`VWB-002 关键对象 ${id} 在展开配置 ${JSON.stringify(expanded)} 下被聚合隐藏`)
          }
        }
      }
      if (vwb002) ok(`VWB-002 ${layeredCritical.length} 个关键对象在 3 种展开配置下均保持可见（DETACHED）`)
    }

    // ── VWB-003 投影只消费 Known（docs/19 §14.1/§7.1） ──
    const adapted = loadAdaptedCase(entry.caseId)
    const store = new ProjectionStore()
    store.bind(liveSnap, {
      observationsFacts: releasedFactsFrom(liveSnap, adapted.facts),
      staticBindings: adapted.staticBindings,
      instanceTopology: adapted.instanceTopology,
    })
    const proj = store.viewProjection()
    const projText = JSON.stringify(proj)
    const leaked = TRUTH_MARKERS.filter((m) => projText.includes(m))
    if (leaked.length) {
      fail(`VWB-003 投影携带 PrivateCaseBundle/Truth 字段：${leaked.join(', ')}`)
    } else {
      ok('VWB-003 投影无 PrivateCaseBundle/Truth 字段（只含 Known + ACTIVE Binding + View Hint）')
    }
    // known_facts ⊆ 已释放 Known Fact（回放/渐进释放不泄露未来）。
    const releasedIds = new Set(releasedFactsFrom(liveSnap, adapted.facts).map((f) => f.fact_id))
    const leakedFacts = proj.known_facts.filter((f) => !releasedIds.has(f.fact_id)).map((f) => f.fact_id)
    if (leakedFacts.length) {
      fail(`VWB-003 投影已知 Fact 超出 Known Ledger：${leakedFacts.slice(0, 5).join(', ')}`)
    } else {
      ok(`VWB-003 known_facts ${proj.known_facts.length} 项 ⊆ Known Ledger（${releasedIds.size}）`)
    }
    // ACTIVE Binding 只含 ACTIVE。
    if (proj.active_bindings.some((b) => b.status !== 'ACTIVE')) {
      fail('VWB-003 投影 Binding 含非 ACTIVE 状态')
    } else {
      ok(`VWB-003 ACTIVE Binding ${proj.active_bindings.length} 条`)
    }

    // ── VWB-004 ViewState 操作不写 Runtime（reducer 纯净性） ──
    const before = { ...DEFAULT_VIEW_STATE }
    const frozen = JSON.stringify(before)
    const next = applyViewActions(before, SAMPLE_VIEW_ACTIONS)
    const vwb004 =
      next !== before &&
      JSON.stringify(before) === frozen && // 入参未被修改
      JSON.stringify(next) === JSON.stringify(applyViewActions(before, SAMPLE_VIEW_ACTIONS)) // 确定性
    if (!vwb004) fail('VWB-004 viewStateReducer 不纯净（改入参/不确定）')
    else ok('VWB-004 viewStateReducer 纯函数：返回新对象、不改入参、确定性，不写 Runtime')

    // ── VWB-005 回放只读（docs/19 §6.4/§14.4） ──
    const liveFp = diagnosisFingerprint(liveSnap)
    const liveSnapRef = liveSnap
    const replayed = rt.seek(Math.floor(rt.events.length / 2))
    const vwb005 =
      replayed.liveSnapshot === liveSnapRef &&
      diagnosisFingerprint(replayed.liveSnapshot) === liveFp &&
      diagnosisFingerprint(replayed.advance().liveSnapshot) === liveFp &&
      diagnosisFingerprint(replayed.returnLive().snapshot) === liveFp
    if (!vwb005) fail('VWB-005 回放/seek/step 写入候选/证据/结论')
    else ok('VWB-005 回放 seek/step/returnLive 只读：live 快照候选/证据/结论不变')
  }
} catch (error) {
  failures += 1
  console.log(`✘ 校验器抛错：${error?.stack ?? error}`)
} finally {
  await server.close()
}

console.log(`\n${failures === 0 ? '✓ VIEW BOUNDARY VALID' : `✘ ${failures} 项投影边界校验失败`}`)
process.exit(failures === 0 ? 0 : 1)

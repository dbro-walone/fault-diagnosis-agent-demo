// CrossPlaneBinding 校验（docs/19 §6）：静态/动态 Binding 生成与生命周期。
// 用 Vite SSR 加载 TS 校验器（src/v2/cross-plane-binding.ts），与单元测试共用同一套口径。
//
// 用法：node scripts/validate-cross-plane-bindings.mjs
// 校验 5 个 Case 的静态 Binding（INSTANCE_OF / CONFORMS_TO / ENTRY_OBJECT_TYPE）
// 与动态 Binding（CANDIDATE / EVIDENCE_MATCHES_RULE / ROOT_CAUSE_CONFIRMED_AS）：
//   - source/target 引用存在、类型合法、状态合法；
//   - 动态 Binding 由对应 Runtime 状态激活（候选/证据/根因确认）；
//   - 全量快照只暴露 ACTIVE 状态（前端只绘制 ACTIVE）。
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

let failures = 0
try {
  const v2 = await server.ssrLoadModule('/src/v2/index.ts')
  const { listCases, loadAdaptedCase, replayCase, deriveDynamicBindings, validateCrossPlaneBindings, buildKnowledgePlaneIndex } = v2

  const cases = listCases()
  console.log(`\nCrossPlaneBinding 校验 · ${cases.length} 个 Case`)
  const index = buildKnowledgePlaneIndex()
  for (const entry of cases) {
    const adapted = loadAdaptedCase(entry.caseId)
    const snap = replayCase(entry.caseId)
    const resourceTypeOf = (objectId) => adapted.resourceTypeByObject.get(objectId) ?? null
    const dynamic = deriveDynamicBindings(snap, resourceTypeOf, index)
    const bindings = [...adapted.staticBindings, ...dynamic]
    const issues = validateCrossPlaneBindings(bindings, adapted.instanceTopology, index, snap)
    const errors = issues.filter((i) => i.severity === 'ERROR')
    const activeCount = bindings.filter((b) => b.status === 'ACTIVE').length
    console.log(
      `[${entry.caseId}] static=${adapted.staticBindings.length} dynamic=${dynamic.length} ` +
        `active=${activeCount} · issues=${issues.length} errors=${errors.length}`,
    )
    for (const issue of issues) {
      console.log(`  [${issue.code} ${issue.severity}] ${issue.message}`)
    }
    if (errors.length) failures += 1
  }
  console.log(failures ? `✘ ${failures} 个 Case 校验失败` : '✓ CROSS-PLANE BINDINGS VALID')
} finally {
  await server.close()
}

process.exit(failures ? 1 : 0)

// InstanceTopology Contract 1.0 轻量校验（docs/19 §5.11 十二条规则）。
// 用 Vite SSR 加载 TS 校验器（src/adapters/instance-topology-validate.ts），
// 与单元测试共用同一套校验口径。
//
// 用法：node scripts/validate-instance-topology.mjs
// 先运行 scripts/compile-instance-topology.mjs 生成 model/instance_topology/cases/。
import { createServer } from 'vite'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'))

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

let failures = 0
try {
  const validateMod = await server.ssrLoadModule('/src/adapters/instance-topology-validate.ts')
  const kg = {
    resourceTypes: read('model/knowledge_graph_package/ontology/resource_types.json').resource_types,
    topologyCapabilities: read('model/knowledge_graph_package/ontology/topology_capabilities.json').capabilities,
  }
  const snapshotsDir = join(root, 'model/instance_topology', 'cases')
  const files = readdirSync(snapshotsDir).filter((f) => f.endsWith('.json')).sort()
  if (files.length === 0) {
    console.error('✘ 未找到编译快照 —— 请先运行 node scripts/compile-instance-topology.mjs')
    process.exit(1)
  }
  for (const file of files) {
    const snapshot = read(`model/instance_topology/cases/${file}`)
    const issues = validateMod.validateInstanceTopology(snapshot, kg)
    const errors = issues.filter((i) => i.severity === 'ERROR')
    const tag = snapshot.provenance?.case_id ?? file.replace(/\.json$/, '')
    console.log(
      `[${tag}] resources=${snapshot.resources.length} relations=${snapshot.relations.length} ` +
        `states=${snapshot.states.length} events=${snapshot.events.length} sets=${snapshot.relation_sets.length} · ` +
        `issues=${issues.length} errors=${errors.length}`,
    )
    for (const issue of issues) {
      console.log(`  [${issue.code} ${issue.severity}] ${issue.message}`)
    }
    if (errors.length) failures += 1
  }
} finally {
  await server.close()
}

console.log(`\n${failures === 0 ? '✓ INSTANCE TOPOLOGY VALID' : `✘ ${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)

// V1 → 规范 InstanceTopology 编译脚本（docs/19 §5、§9）。
// 用 Vite SSR 加载 TS 转换器（src/adapters/v1_to_instance_topology.ts），
// 保证编译快照与运行时（case-adapter）使用同一套转换逻辑，不产生漂移。
//
// 用法：node scripts/compile-instance-topology.mjs
// 输出：model/instance_topology/cases/<case_id>.json（5 个 Case）。
import { createServer } from 'vite'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'))
const casesDir = join(root, 'cases')
const outDir = join(root, 'model/instance_topology', 'cases')

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

let count = 0
try {
  const mod = await server.ssrLoadModule('/src/adapters/v1_to_instance_topology.ts')
  const caseDirs = readdirSync(casesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort()
  for (const caseId of caseDirs) {
    const resourcesFile = join(casesDir, caseId, 'resources.json')
    const topologyFile = join(casesDir, caseId, 'topology.json')
    if (!existsSync(resourcesFile) || !existsSync(topologyFile)) continue
    const resources = read(`cases/${caseId}/resources.json`).resources
    const edges = read(`cases/${caseId}/topology.json`).edges
    const snapshot = mod.convertV1ToInstanceTopology(caseId, resources, edges)
    writeFileSync(join(outDir, `${caseId}.json`), `${JSON.stringify(snapshot, null, 2)}\n`)
    console.log(
      `✓ ${caseId}: ${snapshot.resources.length} resources / ${snapshot.relations.length} relations / ` +
        `${snapshot.states.length} states / ${snapshot.events.length} events / ${snapshot.relation_sets.length} sets`,
    )
    count += 1
  }
} finally {
  await server.close()
}

console.log(`\nCompiled ${count} case snapshots → model/instance_topology/cases/`)
process.exit(count > 0 ? 0 : 1)

// 阶段6 —— 全量校验器汇总入口（docs/19 §17）。
// 汇总跑：
//   A. 内置 TS 校验器（src/v2/validators，7 类分层中的 Case 级：Case Package /
//      Adapter Integration / Runtime Replay / Runtime Determinism / Frontend Contract）
//   B. 阶段1~5 既有校验脚本（Knowledge Package / Instance Topology / Cross Plane
//      Bindings / Leak Isolation / View Boundary）+ verify-v2
// 输出总表；任一失败 → 退出码 1。
//
// 用法：node scripts/validate-all.mjs
import { createServer } from 'vite'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = (name) => join(root, 'scripts', name)

const rows = []
const mark = (ok) => (ok ? '✓ PASS' : '✘ FAIL')

// ── A. 内置 TS 校验器（Vite SSR 加载，与 vitest 共用同一口径）──
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const v2 = await server.ssrLoadModule('/src/v2/index.ts')
  const { listCases } = v2
  const validators = await server.ssrLoadModule('/src/v2/validators/index.ts')
  const caseIds = listCases().map((c) => c.caseId)

  console.log(`\n┌────────────────────────────────────────────────────────────┐`)
  console.log(`│ 阶段6 全量校验 · ${caseIds.length} 个 Case · ${caseIds.join(' / ')}`)
  console.log(`└────────────────────────────────────────────────────────────┘\n`)

  console.log(`── A. 内置 TS 校验器（src/v2/validators）──`)
  const perCase = new Map() // validator label → { fail: string[]; issues: number }
  for (const validator of validators.VALIDATORS) {
    perCase.set(validator.label, { fail: [], issues: 0 })
    for (const caseId of caseIds) {
      const result = validator.run(caseId)
      const entry = perCase.get(validator.label)
      entry.issues += result.issues.length
      if (!result.ok) entry.fail.push(caseId)
      for (const issue of result.issues) {
        console.log(`  [${issue.code} ${issue.severity}] ${issue.message}`)
      }
    }
  }
  // 确定性校验。
  perCase.set('Runtime Determinism', { fail: [], issues: 0 })
  for (const caseId of caseIds) {
    const result = validators.VALIDATORS_DETERMINISM.run(caseId)
    const entry = perCase.get('Runtime Determinism')
    entry.issues += result.issues.length
    if (!result.ok) entry.fail.push(caseId)
  }
  for (const [label, entry] of perCase) {
    const ok = entry.fail.length === 0
    rows.push({ name: `A · ${label}`, ok })
    console.log(`  ${mark(ok)} ${label}${ok ? '' : `（FAIL：${entry.fail.join(', ')}）`} · issues=${entry.issues}`)
  }
} finally {
  await server.close()
}

// ── B. 阶段1~5 既有校验脚本 ──
console.log(`\n── B. 阶段1~5 既有校验脚本 + verify-v2 ──`)
const externalScripts = [
  'validate-knowledge-package.mjs',
  'validate-instance-topology.mjs',
  'validate-cross-plane-bindings.mjs',
  'validate-leak-isolation.mjs',
  'validate-view-boundary.mjs',
  'verify-v2.mjs',
]
for (const name of externalScripts) {
  let ok = true
  let out = ''
  try {
    out = execFileSync('node', [script(name)], { cwd: root, encoding: 'utf8', timeout: 120_000 })
  } catch (error) {
    ok = false
    out = String(error?.stdout ?? '') + String(error?.stderr ?? '')
  }
  const last = out.trim().split('\n').filter(Boolean).slice(-3).join(' | ')
  rows.push({ name: `B · ${name.replace(/\.mjs$/, '')}`, ok })
  console.log(`  ${mark(ok)} ${name}`)
  if (!ok) {
    console.log(out.trim().split('\n').map((l) => `      ${l}`).slice(-8).join('\n'))
  } else {
    console.log(`      ${last}`)
  }
}

// ── 总表 ──
console.log(`\n────────── 校验器汇总 ──────────`)
const width = Math.max(...rows.map((r) => r.name.length))
let anyFail = false
for (const row of rows) {
  if (!row.ok) anyFail = true
  console.log(`  ${row.name.padEnd(width)}  ${mark(row.ok)}`)
}
console.log(`\n${anyFail ? '✘ 存在失败校验器' : '✓ ALL VALIDATORS PASS'}（${rows.filter((r) => r.ok).length}/${rows.length}）`)
process.exit(anyFail ? 1 : 0)

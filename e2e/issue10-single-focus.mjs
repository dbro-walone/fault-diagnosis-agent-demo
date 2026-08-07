/**
 * issue#10 诊断单点聚焦（浏览器实测）。
 * 运行: node e2e/issue10-single-focus.mjs（dev server http://localhost:5173 或 dist 8080）
 *
 * 验证点：
 *  - P0 页面加载无 JS 错误
 *  - P1 诊断中只有当前推进节点一个活动高亮（SCAN_COLOR 青白）；已走过节点弱化灰、不强高亮
 *  - P2 已走过路径线弱化灰保留（灰淡、细线），顺序驱动（当前点亮 → 完成变已走过 → 下一个点亮）
 *  - P3 Planner 列表顺序稳定（seq 单调递增、不来回跳动）
 *  - P4 案例库节点诊断中不点亮（case-warm-reset-001 不出现）；诊断结束后才关联显示
 *  - P5 排查到聚合对象（storage-pool-01/S3_4 成员）自动展开成真实成员（issue#8 在聚焦视图恢复）
 *  - P6 issue#9 聚焦视图不破坏（链路只含入口∪已排查∪当前；非链路 disk-group-01 隐藏）
 *  - P7 全程无 JS 错误
 */
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const rec = (id, ok, note = '') => {
  results.push({ id, ok })
  console.log(`${ok ? '✓' : '✗'} ${id} ${note}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
await page.goto(BASE)
await wait(4500)

/** 从调试钩子读取当前 3D 图结构 + 节点着色（经 nodeColor 访问器求值）。 */
async function graphData() {
  return await page.evaluate(() => {
    const g = window.__FAULT_GRAPH__
    if (!g) return null
    const data = g.graphData()
    const nodeColorFn = typeof g.nodeColor === 'function' ? g.nodeColor() : null
    return {
      nodes: data.nodes.map((n) => ({
        id: n.id,
        plane: n.plane,
        group: n.group,
        color: typeof nodeColorFn === 'function' ? nodeColorFn(n) : null,
      })),
      links: data.links.map((l) => ({
        source: l.source?.id ?? l.source,
        target: l.target?.id ?? l.target,
        category: l.category,
      })),
    }
  })
}

function byId(d, id) {
  return d.nodes.find((n) => n.id === id)
}
function topoIds(d) {
  return d.nodes.filter((n) => n.plane === 'topology').map((n) => n.id)
}
function kgIds(d) {
  return d.nodes.filter((n) => n.plane === 'knowledge').map((n) => n.id)
}

async function startSession(text) {
  const fab = page.locator('.ontology-diagnosis-entry button').first()
  if (!(await page.locator('.ontology-diagnosis-entry textarea').isVisible().catch(() => false))) {
    await fab.click()
    await wait(300)
  }
  await page.locator('.ontology-diagnosis-entry textarea').fill(text)
  await page.locator('.ontology-diagnosis-entry > div button:has-text("开始故障诊断")').first().click().catch(async () => {
    await page.locator('button:has-text("开始故障诊断")').last().click()
  })
  await wait(2500)
}
async function step(n) {
  for (let i = 0; i < n; i++) {
    await page.locator('.ontology-lui button[title="单步推进"]').first().click().catch(() => {})
    await wait(70)
  }
  await wait(400)
}
const scanQueryText = () => page.locator('[data-testid="scan-query"]').textContent().catch(() => '')

// ── P0 页面加载无 JS 错误 ────────────────────────────────────────────────
const d0 = await graphData()
rec('P0 画布加载（__FAULT_GRAPH__ 可用）', !!d0 && d0.nodes.length > 0)
rec('P0 无 JS 错误（加载阶段）', pageErrors.length === 0, pageErrors.join(' | '))

// ── P1 诊断启动 + 推进：单点聚焦 ─────────────────────────────────────────
await startSession('数据库LUN时延突然升高，块业务变慢')

let guard0 = 0
while (!(await scanQueryText()).includes('查询') && guard0++ < 40) await step(1)
const dStart = await graphData()
const startTopo = topoIds(dStart)
rec('P1 诊断启动：聚焦链路（入口 db-business-01 可见）', startTopo.includes('db-business-01'))
rec('P1 非链路拓扑节点 disk-group-01 隐藏', !startTopo.includes('disk-group-01'))

// 推进到 controller-0a 查询态（S3_2 控制层，自动展开）。
let guard1 = 0
while (!(await scanQueryText()).includes('controller-0a') && guard1++ < 90) await step(1)
const dMid = await graphData()
const midTopo = topoIds(dMid)
const midNodes = dMid.nodes.filter((n) => n.plane === 'topology')
rec('P1 推进到 controller-0a 查询态', (await scanQueryText()).includes('controller-0a'))
rec('P1 controller-0a 为链路真实成员', midTopo.includes('controller-0a'))

// 单点聚焦：当前推进节点唯一 SCAN_COLOR；其它拓扑节点无 SCAN_COLOR。
const SCAN_COLOR = '#22d3ee'
const midScanNodes = midNodes.filter((n) => n.color === SCAN_COLOR)
rec('P1 当前推进节点唯一活动高亮（仅 controller-0a 青白）', midScanNodes.length === 1 && midScanNodes[0].id === 'controller-0a', `scanned=${midScanNodes.map((n) => n.id).join(',')}`)
rec('P1 无强 emerald 已走过高亮（旧 PATH_COLORS.node 清除）', midNodes.every((n) => n.color !== '#2f9e6e'))

// ── P5 聚合展开：推进到 storage-pool-01（S3_4 成员，非关键对象）应自动展开真实成员 ──
let guard5 = 0
while (!(await scanQueryText()).includes('storage-pool-01') && guard5++ < 110) await step(1)
const dPool = await graphData()
const poolTopo = topoIds(dPool)
rec('P5 推进到 storage-pool-01 查询态', (await scanQueryText()).includes('storage-pool-01'))
rec('P5 storage-pool-01 为聚焦视图真实成员（S3_4 自动展开）', poolTopo.includes('storage-pool-01'))
rec('P5 同层兄弟成员 lun-db01 也展开可见', poolTopo.includes('lun-db01'))
rec('P5 展开后 S3_4 聚合头隐藏', !poolTopo.includes('layer:S3_4'))

// ── P1/P2 单点 + 已走过弱化（此时 path 已累积 lun-db01/fc-port-0a/controller-0a 走过）──
const poolNodes = dPool.nodes.filter((n) => n.plane === 'topology')
const poolScanNodes = poolNodes.filter((n) => n.color === SCAN_COLOR)
rec('P1 单点聚焦：当前推进节点唯一活动高亮（仅 storage-pool-01 青白）', poolScanNodes.length === 1 && poolScanNodes[0].id === 'storage-pool-01', `scanned=${poolScanNodes.map((n) => n.id).join(',')}`)
const WALK_GRAY = '#3f4a5f'
const walked = poolNodes.filter((n) => n.color === WALK_GRAY)
rec('P1 已走过节点弱化灰保留（非活动、不强化）', walked.length > 0, `walked=${walked.map((n) => n.id).join(',')}`)
rec('P1 已走过节点不含当前推进节点', !walked.some((n) => n.id === 'storage-pool-01'))

// P2 路径线弱化：已走过边为弱化灰、当前入边为淡青（无强 emerald 全亮）。
const linkColor = await page.evaluate(() => {
  const g = window.__FAULT_GRAPH__
  const data = g.graphData()
  const linkColorFn = typeof g.linkColor === 'function' ? g.linkColor() : null
  return data.links.map((l) => ({ source: l.source?.id ?? l.source, target: l.target?.id ?? l.target, color: typeof linkColorFn === 'function' ? linkColorFn(l) : null }))
})
const brightEmeraldLinks = linkColor.filter((l) => l.color === 'rgba(52, 211, 153, 1)')
const grayLinks = linkColor.filter((l) => l.color === 'rgba(148, 163, 184, 0.3)')
const activeTealLinks = linkColor.filter((l) => l.color === 'rgba(103, 232, 249, 0.8)')
rec('P2 已走过路径线弱化灰保留', grayLinks.length > 0, `gray=${grayLinks.length}`)
rec('P2 当前入边淡青（推进方向）', activeTealLinks.length > 0, `active=${activeTealLinks.length}`)
rec('P2 无强 emerald 全亮路径线', brightEmeraldLinks.length === 0, `bright=${brightEmeraldLinks.length}`)

// P3 Planner 顺序稳定：读取右侧 Planner 目标 seq 徽标（data-testid="planner-target-seq"），
// 须单调递增且后序捕获是前序的追加（不来回跳动/重排）。
const readPlannerSeqs = () =>
  page.locator('.ontology-lui [data-testid="planner-target-seq"]').allTextContents().then((xs) => xs.map((x) => Number(x.trim()))).catch(() => [])
const seqsEarly = await readPlannerSeqs()
const monotonicEarly = seqsEarly.length >= 2 && seqsEarly.every((v, i) => i === 0 || v > seqsEarly[i - 1])
rec('P3 Planner 列表顺序稳定（seq 严格递增）', monotonicEarly, `seqs=${seqsEarly.join(',')}`)
// 推进若干步后再查一次：顺序不来回跳动（后序是前序的追加，seq 相对序不变）。
await step(6)
const seqsLater = await readPlannerSeqs()
const prefixStable = seqsEarly.every((v, i) => seqsLater[i] === v)
const monotonicLater = seqsLater.every((v, i) => i === 0 || v > seqsLater[i - 1])
rec('P3 推进后 Planner 顺序不回跳（前序保持、seq 仍递增）', prefixStable && monotonicLater, `early=${seqsEarly.join(',')} later=${seqsLater.join(',')}`)

// ── P4 案例库门控：诊断进行中（未终态）不出现历史案例节点 ────────────────
const kgMid = kgIds(dPool)
rec('P4 诊断中不出现历史案例节点（case-warm-reset-001 未点亮）', !kgMid.includes('case-warm-reset-001'), `kg=${kgMid.length}`)

// 推进到终态（controller 共 69 事件）。
let guard4 = 0
while (!(await page.locator('.ontology-lui').textContent().catch(() => '')).includes('ROOT_CAUSE_CONFIRMED') && guard4++ < 100) await step(1)
await wait(800)
const luiTerminal = await page.locator('.ontology-lui').textContent().catch(() => '')
rec('P4 终态：ROOT_CAUSE_CONFIRMED', luiTerminal.includes('ROOT_CAUSE_CONFIRMED'))
const dTerm = await graphData()
const termKg = kgIds(dTerm)
rec('P4 诊断结束后历史案例节点关联显示', termKg.includes('case-warm-reset-001'), `kg=${termKg.length}`)
rec('P4 终态图谱含故障模式 fm-controller-warm-reset', termKg.includes('fm-controller-warm-reset'))

// 单点聚焦终态：仍只有当前节点（controller-0a）一个活动高亮。
const termScanNodes = dTerm.nodes.filter((n) => n.plane === 'topology' && n.color === SCAN_COLOR)
rec('P1 终态仍只有当前推进节点一个活动高亮', termScanNodes.length === 1, `scanned=${termScanNodes.map((n) => n.id).join(',')}`)

// ── P6 issue#9 聚焦视图不破坏 ────────────────────────────────────────────
rec('P6 终态聚焦视图仍只含链路（disk-group-01 隐藏）', !topoIds(dTerm).includes('disk-group-01'))
rec('P6 终态链路包含已排查 storage-pool-01', topoIds(dTerm).includes('storage-pool-01'))

// 退出诊断 → 恢复全拓扑 + 全图谱。
await page.locator('.ontology-lui button[title="退出诊断会话"]').first().click().catch(() => {})
await wait(1200)
const dExit = await graphData()
const exitAggs = topoIds(dExit).filter((id) => id.startsWith('layer:'))
rec('P6 退出后恢复全拓扑（3 域聚合头）', JSON.stringify(exitAggs) === JSON.stringify(['layer:S1', 'layer:S2', 'layer:S3']), exitAggs.join(','))
rec('P6 退出后图谱恢复全量（> 命中集）', kgIds(dExit).length > 40, `kg=${kgIds(dExit).length}`)

rec('P7 全程无 JS 错误', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '✓' : '✗'} ISSUE#10 BROWSER CHECK · ${results.length - failed.length}/${results.length} 通过`)
if (failed.length) console.log(failed.map((f) => `  ✘ ${f.id}`).join('\n'))
process.exit(failed.length === 0 ? 0 : 1)

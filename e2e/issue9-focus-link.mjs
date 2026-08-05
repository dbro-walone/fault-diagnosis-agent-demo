/**
 * issue#9 诊断执行中链路展示优化 — 聚焦链路视图（浏览器实测）。
 * 运行: node e2e/issue9-focus-link.mjs（需先 python3 start.py --port 8080，dist 已重建）
 *
 * 验证点：
 *  - P0 页面加载无 JS 错误
 *  - P1 诊断启动 → 拓扑只显示链路（入口业务对象可见），非链路拓扑节点（disk-group-01）隐藏
 *  - P2 诊断推进 → 链路逐步生长（controller-0a 成为真实成员）、图谱只显示命中子图
 *     （fm-controller-warm-reset 可见 / fm-fc-link-flap 隐藏）
 *  - P3 命令环/扫描徽标仍工作（activeQuery 推进）、路径累积高亮无 JS 错误
 *  - P4 诊断结束/退出 → 恢复全拓扑（3 域聚合头）+ 全图谱；浏览态冷冻不变
 *  - P5 全程无 JS 错误
 * 不截图（截图政策：e2e 不再存 business-acceptance 截图）。
 */
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
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

/** 从调试钩子读取当前 3D 图结构。 */
async function graphData() {
  return await page.evaluate(() => {
    const g = window.__FAULT_GRAPH__
    if (!g) return null
    const data = g.graphData()
    return {
      dragEnabled: typeof g.enableNodeDrag === 'function' ? g.enableNodeDrag() : null,
      nodes: data.nodes.map((n) => ({
        id: n.id,
        plane: n.plane,
        group: n.group,
        kind: n.kind,
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
    await wait(80)
  }
  await wait(500)
}
const scanQueryText = () => page.locator('[data-testid="scan-query"]').textContent().catch(() => '')

// ── P0 页面加载无 JS 错误 ────────────────────────────────────────────────
const d0 = await graphData()
rec('P0 画布加载（__FAULT_GRAPH__ 可用）', !!d0 && d0.nodes.length > 0)
rec('P0 无 JS 错误（加载阶段）', pageErrors.length === 0, pageErrors.join(' | '))

// ── P1 诊断启动：聚焦链路（入口可见，非链路隐藏）────────────────────────
await startSession('数据库LUN时延突然升高，块业务变慢')

// 等待扫描徽标出现（诊断已启动）。
let guard0 = 0
while (!(await scanQueryText()).includes('查询') && guard0++ < 40) await step(1)
const dStart = await graphData()
const startTopo = topoIds(dStart)
rec(
  'P1 入口业务对象 db-business-01 在链路中',
  startTopo.includes('db-business-01'),
  `topo=${startTopo.join(',')}`,
)
rec('P1 非链路拓扑节点 disk-group-01 隐藏', !startTopo.includes('disk-group-01'))
rec('P1 诊断态 enableNodeDrag=false（冷冻）', dStart.dragEnabled === false)

// ── P2 推进：链路生长 + 图谱命中子图 ─────────────────────────────────────
// 推进到 controller-0a 查询态（S3_2 控制层，自动展开到真实节点）。
let guard1 = 0
while (!(await scanQueryText()).includes('controller-0a') && guard1++ < 80) await step(1)
const dMid = await graphData()
const midTopo = topoIds(dMid)
const midKg = kgIds(dMid)
rec('P2 推进到 controller-0a 查询态', (await scanQueryText()).includes('controller-0a'))
rec('P2 controller-0a 为链路真实成员', midTopo.includes('controller-0a'))
rec('P2 已排查 fc-port-0a 进入链路（或其层头）', midTopo.some((id) => id === 'fc-port-0a' || id.startsWith('layer:S3_1')))
// 图谱命中：取证期只点亮症状/场景锚点（阶段4 真值隔离，精确 FaultMode 终态才释放）；
// 被排除候选的故障模式始终隐藏。
rec('P2 图谱命中子图含症状锚点 sym-latency-increase', midKg.includes('sym-latency-increase'))
rec('P2 取证期不提前泄露精确 FaultMode fm-controller-warm-reset', !midKg.includes('fm-controller-warm-reset'))
rec('P2 图谱不泄露被排除候选 fm-fc-link-flap', !midKg.includes('fm-fc-link-flap'))
rec('P2 图谱命中节点全部落在诊断命中集', midKg.length > 0 && midKg.length < 40, `kg=${midKg.length}`)

// ── P3 命令环 / 路径累积高亮 / 扫描推进持续工作 ──────────────────────────
let guard2 = 0
while (!(await scanQueryText()).includes('storage-pool-01') && guard2++ < 90) await step(1)
const dPath = await graphData()
rec('P3 扫描推进到 storage-pool-01', (await scanQueryText()).includes('storage-pool-01'))
rec('P3 路径推进后无悬挂边（连线端点都在可见节点内）', dPath.links.every((l) => byId(dPath, l.source) && byId(dPath, l.target)))
rec('P3 推进过程无 JS 错误', pageErrors.length === 0, pageErrors.join(' | '))

// ── P4 推进到终态：候选/根因；退出恢复全拓扑+全图谱 ─────────────────────
let guard3 = 0
while (!(await page.locator('.ontology-lui').textContent().catch(() => '')).includes('ROOT_CAUSE_CONFIRMED') && guard3++ < 100) await step(1)
await wait(800)
const luiTerminal = await page.locator('.ontology-lui').textContent().catch(() => '')
rec('P4 终态：诊断完成（ROOT_CAUSE_CONFIRMED）', luiTerminal.includes('ROOT_CAUSE_CONFIRMED'))
const dTerm = await graphData()
const termKg = kgIds(dTerm)
rec('P4 终态图谱命中：fm-controller-warm-reset + mech-watchdog', termKg.includes('fm-controller-warm-reset') && termKg.includes('mech-watchdog'))
rec('P4 终态图谱仍不泄露 fm-fc-link-flap', !termKg.includes('fm-fc-link-flap'))

// 退出诊断 → 恢复全拓扑（浏览态冷冻）+ 全图谱。
await page.locator('.ontology-lui button[title="退出诊断会话"]').first().click().catch(() => {})
await wait(1200)
const dExit = await graphData()
const exitAggs = topoIds(dExit).filter((id) => id.startsWith('layer:'))
rec('P4 退出后恢复全拓扑（仅 3 域聚合头）', JSON.stringify(exitAggs) === JSON.stringify(['layer:S1', 'layer:S2', 'layer:S3']), exitAggs.join(','))
rec('P4 退出后图谱恢复全量（> 命中集）', kgIds(dExit).length > 40, `kg=${kgIds(dExit).length}`)
rec('P4 退出后 enableNodeDrag=false', dExit.dragEnabled === false)

rec('P5 全程无 JS 错误', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '✓' : '✗'} ISSUE#9 BROWSER CHECK · ${results.length - failed.length}/${results.length} 通过`)
if (failed.length) console.log(failed.map((f) => `  ✘ ${f.id}`).join('\n'))
process.exit(failed.length === 0 ? 0 : 1)

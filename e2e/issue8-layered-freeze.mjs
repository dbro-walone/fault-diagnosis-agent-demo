/**
 * issue#8 分层冷冻 + 聚合头隐藏 + 自动布局 + 诊断聚焦真实节点 — 浏览器实测。
 * 运行: node e2e/issue8-layered-freeze.mjs（需先 python3 start.py --port 8080，dist 已重建）
 *
 * 验证点：
 *  - P0 页面加载无 JS 错误
 *  - P1 浏览态冷冻：enableNodeDrag=false（不可拖拽拉散）、节点位置稳定不漂移
 *  - P2 需求1：展开域/子层后该层聚合头隐藏、真实成员占据、链接无悬挂
 *  - P3 需求2②：展开子层成员均匀排布（互不重叠、层级清晰）
 *  - P4 需求2③：诊断推进自动展开到目标真实节点（controller-0a），诊断结束回浏览冷冻
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
        x: n.x,
        y: n.y,
        z: n.z,
        group: n.group,
        kind: n.kind,
        plane: n.plane,
      })),
      // 3d-force-graph 会把链接端点规整为节点对象（带 .id）；统一取 id 比较。
      links: data.links.map((l) => ({
        source: l.source?.id ?? l.source,
        target: l.target?.id ?? l.target,
        category: l.category,
      })),
    }
  })
}

async function doubleClickNode(id) {
  // 直接调用画布的 onNodeClick 处理器两次（同步，落在双击判定窗口内）→ 触发聚合层展开/收起。
  // 比屏幕坐标 raycast 稳定：不依赖相机投影精度。
  return await page.evaluate((nodeId) => {
    const g = window.__FAULT_GRAPH__
    const data = g.graphData()
    const node = data.nodes.find((n) => n.id === nodeId)
    if (!node) return false
    const handler = typeof g.onNodeClick === 'function' ? g.onNodeClick() : null
    if (typeof handler !== 'function') return false
    handler(node)
    handler(node)
    return true
  }, id)
}

function byId(d, id) {
  return d.nodes.find((n) => n.id === id)
}
function topoIds(d) {
  return d.nodes.filter((n) => n.plane === 'topology').map((n) => n.id)
}
function topoMemberIds(d) {
  return d.nodes.filter((n) => n.plane === 'topology' && !n.id.startsWith('layer:')).map((n) => n.id)
}

// ── P0 无 JS 错误 ────────────────────────────────────────────────────────
const d0 = await graphData()
rec('P0 画布加载（__FAULT_GRAPH__ 可用）', !!d0 && d0.nodes.length > 0)
rec('P0 无 JS 错误（加载阶段）', pageErrors.length === 0, pageErrors.join(' | '))

// ── P1 浏览态冷冻 ────────────────────────────────────────────────────────
const dBrowse = await graphData()
rec('P1 enableNodeDrag=false（不可拖拽拉散）', dBrowse.dragEnabled === false)
const aggIds = topoIds(dBrowse).filter((id) => id.startsWith('layer:'))
rec(
  'P1 全收起仅 3 域聚合头',
  JSON.stringify(aggIds) === JSON.stringify(['layer:S1', 'layer:S2', 'layer:S3']),
  aggIds.join(','),
)
// 聚合头居中 x=0。
const centered = dBrowse.nodes
  .filter((n) => n.plane === 'topology' && n.id.startsWith('layer:'))
  .every((n) => n.x === 0)
rec('P1 域聚合头居中 x=0', centered)

// 位置稳定：等 1.5s 前后拓扑节点坐标完全一致。
const snapA = dBrowse.nodes.filter((n) => n.plane === 'topology').map((n) => `${n.id}:${n.x},${n.y},${n.z}`)
await wait(1500)
const dBrowse2 = await graphData()
const snapB = dBrowse2.nodes.filter((n) => n.plane === 'topology').map((n) => `${n.id}:${n.x},${n.y},${n.z}`)
rec('P1 浏览态节点位置稳定（无漂移）', snapA.length > 0 && JSON.stringify(snapA) === JSON.stringify(snapB))

// ── P2 需求1：展开域 → 域聚合头隐藏 ─────────────────────────────────────
const toggledS3 = await doubleClickNode('layer:S3')
await wait(400)
const dS3 = await graphData()
rec('P2 双击 S3 域头成功命中', toggledS3)
rec(
  'P2 展开 S3：S3 域聚合头隐藏',
  !byId(dS3, 'layer:S3') && toggledS3,
)
const s3SubHeaders = ['layer:S3_1', 'layer:S3_2', 'layer:S3_3', 'layer:S3_4', 'layer:S3_5'].every((id) => byId(dS3, id))
rec('P2 展开 S3：S3_1..S3_5 子层聚合头出现', s3SubHeaders)
rec('P2 展开 S3：S1/S2 域聚合头保留', !!byId(dS3, 'layer:S1') && !!byId(dS3, 'layer:S2'))

// ── P2 需求1：展开子层 → 子层聚合头隐藏 + 成员占据 ──────────────────────
const toggledS35 = await doubleClickNode('layer:S3_5')
await wait(400)
const dS35 = await graphData()
rec('P2 双击 S3_5 子层头成功命中', toggledS35)
rec('P2 展开 S3_5：S3_5 聚合头隐藏', !byId(dS35, 'layer:S3_5'))
const s35Members = ['enc-01a', 'disk-01a', 'disk-01b', 'disk-01c', 'psu-01a', 'fan-01a', 'bbu-01a'].filter((id) => byId(dS35, id))
rec('P2 展开 S3_5：7 个真实成员全部出现', s35Members.length === 7, s35Members.join(','))
// 无悬挂边。
const dangling = dS35.links.filter(
  (l) => !byId(dS35, l.source) || !byId(dS35, l.target),
).length
rec('P2 展开后无悬挂边（链接重连正确）', dangling === 0, `dangling=${dangling}`)

// ── P3 需求2②：成员均匀排布 ─────────────────────────────────────────────
const s35Members7 = ['enc-01a', 'disk-01a', 'disk-01b', 'disk-01c', 'psu-01a', 'fan-01a', 'bbu-01a']
const s35xs = s35Members7.map((id) => byId(dS35, id)?.x).filter((x) => x != null)
rec('P3 展开成员互不重叠（X 两两互异）', new Set(s35xs).size === s35xs.length, `xs=${s35xs.join(',')}`)
const sorted = [...s35xs].sort((a, b) => a - b)
rec('P3 展开成员按带均匀单调排布', JSON.stringify(s35xs) === JSON.stringify(sorted))
const bands = s35Members7.map((id) => `${byId(dS35, id).y}/${byId(dS35, id).z}`)
rec('P3 层级清晰（同带同 Y/Z）', new Set(bands).size === 1, bands[0])

// ── P4 需求2③：诊断自动展开到目标真实节点 ───────────────────────────────
await page.evaluate(() => {
  const g = window.__FAULT_GRAPH__
  // 回到初始相机（不改变状态）。
  g.cameraPosition({ x: 70, y: 30, z: 440 }, { x: 0, y: 0, z: 0 }, 0)
})
// 先退出到全收起（重新加载最干净）。
await page.goto(BASE)
await wait(4000)

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

await startSession('数据库LUN时延突然升高，块业务变慢')

// 推进到 controller-0a 成为查询对象（S3_2 控制层）。
let guard = 0
let sawController = false
while (guard++ < 80) {
  await step(1)
  const q = await scanQueryText()
  if (q.includes('controller-0a')) {
    sawController = true
    break
  }
}
rec('P4 诊断推进到 controller-0a 查询态', sawController)

const dDiag = await graphData()
rec('P4 诊断时 S3 域自动展开（域聚合头隐藏）', !byId(dDiag, 'layer:S3'))
rec('P4 诊断时 controller-0a 为真实成员节点', !!byId(dDiag, 'controller-0a'))
// controller-0a 在 S3_2：子层 S3_2 聚合头隐藏（被真实成员占据）。
rec('P4 诊断时 S3_2 子层自动展开（聚合头隐藏）', !byId(dDiag, 'layer:S3_2'))
// 扫描态节点存在且位置稳定（冷冻）。
const ctrlPos = byId(dDiag, 'controller-0a') ? { x: byId(dDiag, 'controller-0a').x, y: byId(dDiag, 'controller-0a').y, z: byId(dDiag, 'controller-0a').z } : null
await wait(1200)
const dDiag2 = await graphData()
const ctrlPos2 = byId(dDiag2, 'controller-0a') ? { x: byId(dDiag2, 'controller-0a').x, y: byId(dDiag2, 'controller-0a').y, z: byId(dDiag2, 'controller-0a').z } : null
rec(
  'P4 诊断推进中节点位置稳定（冷冻不漂移）',
  ctrlPos != null && ctrlPos2 != null && JSON.stringify(ctrlPos) === JSON.stringify(ctrlPos2),
)

// 推进到终态（controller 共 69 个事件，90 步足够覆盖）。
for (let i = 0; i < 90; i++) await step(1)
const luiText = await page.locator('.ontology-lui').textContent().catch(() => '')
rec('P4 诊断终态 LUI 显示候选/观测', luiText.includes('候选') || luiText.includes('根因'))

// 退出诊断 → 回到浏览态冷冻（退出按钮为图标按钮，title 定位）。
await page.locator('.ontology-lui button[title="退出诊断会话"]').first().click().catch(() => {})
await wait(1000)
const dExit = await graphData()
const exitAggs = topoIds(dExit).filter((id) => id.startsWith('layer:'))
rec('P4 退出诊断回到浏览冷冻（仅 3 域聚合头）', JSON.stringify(exitAggs) === JSON.stringify(['layer:S1', 'layer:S2', 'layer:S3']), exitAggs.join(','))
rec('P4 退出后 enableNodeDrag=false', dExit.dragEnabled === false)

rec('P4 全程无 JS 错误', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '✓' : '✗'} ISSUE#8 BROWSER CHECK · ${results.length - failed.length}/${results.length} 通过`)
if (failed.length) console.log(failed.map((f) => `  ✘ ${f.id}`).join('\n'))
process.exit(failed.length === 0 ? 0 : 1)

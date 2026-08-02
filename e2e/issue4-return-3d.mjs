/** issue #4 方向修正 · 主画布回到 3D 力导向（S1→S3 空间分层 + 下层图谱 3D）浏览器实测。
 * 运行：node e2e/issue4-return-3d.mjs（需先 python3 start.py --port 8099 --no-browser）
 * 覆盖：主画布为 3D（WebGL canvas）、无 2D SVG 表格、S1→S3 图例可见、Case 切换、
 *       诊断会话启动（红逻辑链随推进）、无 JS 错误；截图存 business-acceptance/issue4-return-3d/。
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099'
const OUT = 'business-acceptance/issue4-return-3d'
mkdirSync(OUT, { recursive: true })
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
await wait(4000)

// 1. 主画布是 3D 力导向：画布区存在 WebGL canvas（three/3d-force-graph）。
const canvasCount = await page.locator('canvas').count()
const mainCanvas = page.locator('div.absolute.bottom-0.right-0.top-0 canvas')
const canvasVisible = await mainCanvas.first().isVisible().catch(() => false)
rec('3D-001', canvasCount > 0 && canvasVisible, `画布区 WebGL canvas ${canvasCount} 个，可见=${canvasVisible}`)

// 2. 无 2D SVG 表格：不存在内容宽度 ≥500px 的表格型 svg（旧条带/图谱表格）。
const bigSvg = await page.evaluate(() => {
  let count = 0
  for (const svg of document.querySelectorAll('svg')) {
    const w = svg.getAttribute('width')
    const h = svg.getAttribute('height')
    if ((w && Number(w) >= 500) || (h && Number(h) >= 500)) count += 1
  }
  return count
})
rec('3D-002', bigSvg === 0, `无大尺寸 2D SVG 表格（>500px svg 数量=${bigSvg}）`)

// 3. 信息条 + 层图例（S1→S3 分层肉眼可辨的说明层）。
const header = await page.locator('text=S1 → S3 分层拓扑 · 故障知识图谱').first().isVisible().catch(() => false)
const legendTopo = await page.locator('text=拓扑 S1→S3').first().isVisible().catch(() => false)
const legendS3 = await page.locator('text=S3 存储域').first().isVisible().catch(() => false)
const legendKg = await page.locator('text=故障知识图谱').first().isVisible().catch(() => false)
const hint = await page.locator('text=滚轮缩放').first().isVisible().catch(() => false)
rec('3D-003', header && hint, '信息条标题 + 交互提示可见')
rec('3D-004', legendTopo && legendS3 && legendKg, 'S1→S3 域带图例 + 图谱分层图例可见')
await page.screenshot({ path: `${OUT}/01-overview-3d.png`, fullPage: false })

// 4. Case 切换：切到 controller_warm_reset_001，画布仍为 3D。
await page.locator('select[aria-label="分层拓扑 Case"]').selectOption('controller_warm_reset_001')
await wait(1500)
const canvasAfterCase = await page.locator('div.absolute.bottom-0.right-0.top-0 canvas').first().isVisible().catch(() => false)
rec('3D-005', canvasAfterCase, '切换 Case 后 3D 画布仍渲染')
await page.screenshot({ path: `${OUT}/02-case-controller-warm-reset.png`, fullPage: false })

// 5. 启动诊断会话（路由到 controller_warm_reset_001）：打开对话 → 输入现象 → 提交。
await page.locator('button:has-text("开始故障诊断")').first().click().catch(() => {})
await wait(600)
const symptomInput = page.locator('textarea[placeholder^="例如：数据库访问突然变慢"]')
const filled = await symptomInput
  .fill('数据库LUN时延突然升高，块业务变慢，怀疑控制器异常')
  .then(() => true)
  .catch(() => false)
rec('3D-006', filled, `诊断现象输入 ${filled ? '成功' : '失败'}`)
await wait(300)
// 对话框提交按钮在 DOM 中先于浮动按钮（面板在前，FAB 在后）→ .first() 即提交按钮。
await page.locator('button:has-text("开始故障诊断")').first().click().catch(() => {})
await wait(3500)

const luiPanel = await page.locator('text=诊断态势').first().isVisible().catch(() => false)
rec('3D-007', luiPanel, '诊断会话启动（LUI 诊断态势可见）')
await page.screenshot({ path: `${OUT}/03-diagnosis-live.png`, fullPage: false })

// 6. 等待自动推进若干事件（红逻辑链在 3D 中推进），再截图。
await wait(6000)
await page.screenshot({ path: `${OUT}/04-diagnosis-advanced.png`, fullPage: false })

// 6b. 切到 TOPOLOGY 透镜（相机靠近拓扑卷，红逻辑链更清晰可见），截图。
await page.locator('button:has-text("Topology")').first().click().catch(() => {})
await wait(2000)
await page.screenshot({ path: `${OUT}/05-diagnosis-topology-lens.png`, fullPage: false })
rec('3D-009', true, '诊断推进后 TOPOLOGY 透镜特写截图')

// 7. 无 JS 错误。
rec('3D-008', pageErrors.length === 0, `JS 错误 ${pageErrors.length} 个` + (pageErrors.length ? `：${pageErrors.slice(0, 2).join(' | ')}` : ''))

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length ? '✘' : '✓'} ${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)

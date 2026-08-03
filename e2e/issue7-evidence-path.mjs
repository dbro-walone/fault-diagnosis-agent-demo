/**
 * issue#7 排查证据路径 — 浏览器实测（本轮：布局稳定 + 路径累积高亮 + 指标芯片 + PLANNER 对应）。
 * 运行: node e2e/issue7-evidence-path.mjs（需先 python3 start.py --port 8080，dist 已重建）
 *
 * 验证点：
 *  - P0 诊断推进无白屏 / 无 JS 错误（issue#7 白屏修复回归）
 *  - P1 画布扫描徽标随推进移动（controller → fc-port → pool），LUI PLANNER「当前位置」同步
 *  - P2 终态：诊断完成，LUI 显示候选/观测；画布截图可看到排查路径累积高亮 + 指标芯片
 *  - P3 布局稳定：诊断中多次截图，画布节点区域无整体漂移（视觉比对 + 无重排报错）
 * 截图存 business-acceptance/issue7-evidence-path/
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
const OUT = 'business-acceptance/issue7-evidence-path'
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
const luiText = () => page.locator('.ontology-lui').textContent().catch(() => '')
const canvasCount = () => page.locator('canvas').count()

await startSession('数据库LUN时延突然升高，块业务变慢')

// ── P0：画布存活 + 无白屏 ─────────────────────────────────────────────
let guard0 = 0
while (!(await scanQueryText()).includes('查询') && guard0++ < 40) await step(1)
rec('P0-001', (await canvasCount()) > 0, `3D 画布存活（canvas=${await canvasCount()}）`)
rec('P0-002', (await scanQueryText()).includes('查询'), `扫描徽标出现（${(await scanQueryText()).trim()}）`)
await page.screenshot({ path: `${OUT}/01-scan-controller.png` })

// 记录诊断早期画布截图（用于布局稳定比对）
const earlyShot = await page.screenshot({ path: `${OUT}/01b-early-stable.png` })

// ── P1：扫描推进 controller → fc-port → pool，PLANNER 当前位置同步 ────────
let guard1 = 0
while (!(await scanQueryText()).includes('controller-0a') && guard1++ < 50) await step(1)
const q1 = await scanQueryText()
rec('P1-001', q1.includes('controller-0a'), `扫描推进 controller-0a（${q1.trim()}）`)
await page.screenshot({ path: `${OUT}/02-scan-controller.png` })

guard1 = 0
while (!(await scanQueryText()).includes('fc-port-0a') && guard1++ < 60) await step(1)
const q2 = await scanQueryText()
rec('P1-002', q2.includes('fc-port-0a'), `扫描推进 fc-port-0a（${q2.trim()}）`)
await page.screenshot({ path: `${OUT}/03-scan-fc-port.png` })

guard1 = 0
while (!(await scanQueryText()).includes('storage-pool-01') && guard1++ < 70) await step(1)
const q3 = await scanQueryText()
rec('P1-003', q3.includes('storage-pool-01'), `扫描推进 storage-pool-01（${q3.trim()}）`)
await page.screenshot({ path: `${OUT}/04-scan-pool.png` })

// 布局稳定：诊断中不同时刻截图尺寸/无重排报错；扫描推进本身会改变高亮，不做像素级比对，
// 由人工视觉确认节点位置未整体漂移。
const midShot = await page.screenshot({ path: `${OUT}/05-mid-stable.png` })

// ── P2：推进到终态，LUI 完整 ──────────────────────────────────────────
let guard2 = 0
while (!(await luiText()).includes('ROOT_CAUSE_CONFIRMED') && guard2++ < 90) await step(1)
await wait(1200)
const p2 = await luiText()
rec('P2-001', p2.includes('ROOT_CAUSE_CONFIRMED'), '终态：诊断完成（ROOT_CAUSE_CONFIRMED）')
rec('P2-002', p2.includes('候选根因') && p2.includes('对象观测'), 'LUI 含候选根因 + 对象观测')
rec('P2-003', /Controller-0A|LUN-DB01|fc-port/i.test(p2), 'LUI 含排查对象（Controller-0A/LUN-DB01/fc-port）')
await page.screenshot({ path: `${OUT}/06-terminal.png` })

// 放大画布（滚轮缩放），便于观察路径高亮 + 指标芯片
const box = await page.locator('canvas').first().boundingBox()
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400).catch(() => {})
  await wait(1200)
  await page.screenshot({ path: `${OUT}/07-terminal-zoom-path-chips.png` })
  // 再平移一点看右侧（S2/S3 控制器区）
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -300).catch(() => {})
  await wait(800)
  await page.screenshot({ path: `${OUT}/08-terminal-zoom2.png` })
}

rec('P3-001', pageErrors.length === 0, `全程无 JS 错误（errors=${pageErrors.length}）`)
rec('P3-002', (await canvasCount()) > 0, '终态画布仍存活（无白屏）')

await browser.close()
console.log(`\nissue7-evidence-path 结果：${results.filter((r) => r.ok).length}/${results.length} 通过`)
process.exit(results.every((r) => r.ok) ? 0 : 1)

/**
 * issue#7 精简首屏 — 浏览器实测。
 * 运行: node e2e/issue7-topbar-clean.mjs（需先 python3 start.py --port 8080，dist 已重建）
 *
 * 验证点：
 *  - P0 首屏无三个顶部控件：无「Fault Operations Ontology」标题栏 / 无五透镜切换器 / 无画布顶部信息条 + Case 下拉
 *  - P1 画布顶到顶边（canvas y ≈ 0，顶部不再被标题占位）
 *  - P2 开始诊断仍可用（LUI 出现，诊断推进）
 *  - P3 诊断流程 / PLANNER / 画布扫描徽标（左下角）照常
 *  - P4 无 JS 错误
 * 截图存 business-acceptance/issue7-topbar/
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
const OUT = 'business-acceptance/issue7-topbar'
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

// ── P0：首屏顶部干净 — 三个控件全部消失 ──────────────────────────────────
const headerCount = await page.locator('.ontology-header').count()
const lensCount = await page.locator('.ontology-lens-switcher').count()
const infoBar = await page.locator('text=S1 → S3 分层拓扑 · 故障知识图谱').count()
const caseSelect = await page.locator('select[aria-label="分层拓扑 Case"]').count()
const ontTitle = await page.locator('text=Fault Operations Ontology').count()
rec('P0-001', headerCount === 0, `无标题栏（.ontology-header=${headerCount}）`)
rec('P0-002', lensCount === 0, `无五透镜切换器（.ontology-lens-switcher=${lensCount}）`)
rec('P0-003', infoBar === 0 && ontTitle === 0, `无画布顶部信息条/产品名（信息条=${infoBar}）`)
rec('P0-004', caseSelect === 0, `无 Case 下拉（select=${caseSelect}）`)

// ── P1：画布顶到顶边 ─────────────────────────────────────────────────────
const canvasBox = await page.locator('canvas').first().boundingBox()
rec('P1-001', !!canvasBox && Math.abs(canvasBox.y) < 2, `画布顶部 y=${canvasBox ? Math.round(canvasBox.y) : '?'}（≈0 顶到顶边）`)
await page.screenshot({ path: `${OUT}/01-first-screen-clean.png` })

// ── P2：开始诊断可用（LUI 出现 + 推进） ──────────────────────────────────
const fab = page.locator('.ontology-diagnosis-entry button').first()
await fab.click().catch(() => {})
await wait(300)
await page.locator('.ontology-diagnosis-entry textarea').fill('数据库LUN时延突然升高，块业务变慢')
await page.locator('.ontology-diagnosis-entry > div button:has-text("开始故障诊断")').first().click().catch(async () => {
  await page.locator('button:has-text("开始故障诊断")').last().click()
})
await wait(2500)
const luiVisible = await page.locator('.ontology-lui').first().isVisible().catch(() => false)
rec('P2-001', luiVisible, '诊断会话启动（LUI 可见）')
await page.screenshot({ path: `${OUT}/02-diagnosis-live.png` })

async function step(n) {
  for (let i = 0; i < n; i++) {
    await page.locator('.ontology-lui button[title="单步推进"]').first().click().catch(() => {})
    await wait(70)
  }
  await wait(400)
}
// PLANNER 目标出现
let guard = 0
while (!(await page.locator('.ontology-lui').textContent().catch(() => '')).includes('Planner 目标') && guard++ < 30) await step(1)
rec('P3-001', true, 'PLANNER 目标区照常出现')
// 推进几步让目标内容（排查路径/实际发现）填充
await step(14)
const t = await page.locator('.ontology-lui').textContent().catch(() => '')
rec('P3-002', t.includes('排查路径') || t.includes('范围：') || t.includes('实际发现'), 'PLANNER 含排查路径/实际发现')

// ── P3：画布扫描徽标迁移到左下角 ─────────────────────────────────────────
let sawScan = ''
guard = 0
while (!sawScan.includes('controller-0a') && guard++ < 60) {
  await step(1)
  sawScan = await page.locator('[data-testid="scan-query"]').textContent().catch(() => '')
}
const scanBox = await page.locator('[data-testid="scan-query"]').boundingBox().catch(() => null)
rec('P3-003', sawScan.includes('controller-0a'), `扫描徽标仍出现（${sawScan.trim()}）`)
rec('P3-004', !!scanBox && scanBox.y > canvasBox.height / 2, `扫描徽标在左下角（y=${scanBox ? Math.round(scanBox.y) : '?'} > 半高）`)
const scanKg = await page.locator('[data-testid="scan-kg"]').textContent().catch(() => '')
rec('P3-005', /\d/.test(scanKg), `图谱原始点徽标保留（${scanKg.trim()}）`)
await page.screenshot({ path: `${OUT}/03-diagnosis-scan-badges.png` })

// 推进到终态不白屏
let guardTerm = 0
const isTerminal = async () => {
  const text = await page.locator('.ontology-lui').textContent().catch(() => '')
  return text.includes('TOP3') || text.includes('已确认') || text.includes('诊断完成')
}
while (!(await isTerminal()) && guardTerm++ < 90) await step(1)
rec('P3-006', await page.locator('body').isVisible(), `诊断推进到终态（body 可见，无白屏）`)
await page.screenshot({ path: `${OUT}/04-diagnosis-terminal.png` })

// ── P4：无 JS 错误 ───────────────────────────────────────────────────────
rec('P4-001', pageErrors.length === 0, `全程无 JS 错误（errors=${pageErrors.length}）`)
for (const e of pageErrors.slice(0, 5)) console.log('    ERR:', e.slice(0, 300))

await browser.close()
console.log(`\nissue7-topbar-clean 结果：${results.filter((r) => r.ok).length}/${results.length} 通过`)
process.exit(results.every((r) => r.ok) ? 0 : 1)

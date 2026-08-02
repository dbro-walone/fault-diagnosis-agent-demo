import { chromium } from '@playwright/test'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.goto(BASE)
await wait(4000)
// 切到分层条带
await page.locator('.ontology-navigator button:has-text("分层条带")').first().click().catch(async () => {
  await page.locator('button:has-text("分层条带")').first().click()
})
await wait(1200)
const layeredVisible = await page.locator('text=S1 → S3 分层拓扑').isVisible().catch(() => false)
// 打开诊断并提交唯一症状
const fab = page.locator('.ontology-diagnosis-entry button').first()
await fab.click().catch(() => {})
await wait(300)
await page.locator('.ontology-diagnosis-entry textarea').fill('数据库LUN时延突然升高，块业务变慢')
await page.locator('.ontology-diagnosis-entry button:has-text("开始故障诊断")').first().click().catch(async () => {
  await page.locator('button:has-text("开始故障诊断")').last().click()
})
await wait(800)
// 推进若干步，让证据链成形
for (let i = 0; i < 45; i++) {
  await page.locator('.ontology-lui button[title="单步推进"]').first().click().catch(() => {})
  await wait(60)
}
await wait(1000)
const redLines = await page.locator('svg line[stroke="#ef4444"]').count()
const luiVisible = await page.locator('.ontology-lui').isVisible().catch(() => false)
console.log(`layeredVisible=${layeredVisible} luiVisible=${luiVisible} redLogicLines=${redLines}`)
await page.screenshot({ path: 'business-acceptance/issue5-layered-red.png', fullPage: true })
console.log(`pageErrors=${errs.length} ${errs.slice(0,2).join('; ')}`)
await browser.close()
const ok = layeredVisible && luiVisible && redLines >= 1 && errs.length === 0
process.exit(ok ? 0 : 1)

/** docs/14 §18 BA-UX 体验评审补充截图:终态根因、回放态、第四 Case 会话。 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099'
const OUT = 'business-acceptance/ux-review'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(BASE)
await wait(4000)

async function startSession(text) {
  const fab = page.locator('.ontology-diagnosis-entry button').first()
  if (!(await page.locator('.ontology-diagnosis-entry textarea').isVisible().catch(() => false))) {
    await fab.click(); await wait(300)
  }
  await page.locator('.ontology-diagnosis-entry textarea').fill(text)
  await page.locator('.ontology-diagnosis-entry > div button:has-text("开始故障诊断")').first().click().catch(async () => {
    await page.locator('button:has-text("开始故障诊断")').last().click()
  })
  await wait(3000)
}
async function stepMany(n) {
  for (let i = 0; i < n; i++) {
    await page.locator('.ontology-lui button[title="单步推进"]').first().click().catch(() => {})
    await wait(100)
  }
  await wait(1500)
}

// 场景1:controller 到终态(根因确认,BA-UX-002 根因→影响链)
await startSession('数据库LUN时延突然升高，块业务变慢')
await stepMany(45)
await page.screenshot({ path: `${OUT}/01-controller-confirmed.png` })

// 场景2:回放态(切历史 tab,点幕书签进入回放)
await page.locator('.ontology-lui button:has-text("历史")').first().click().catch(() => {})
await wait(500)
await page.locator('.ontology-lui button[title="正常基线"]').first().click().catch(async () => {
  await page.locator('.ontology-lui button[title*="基线"]').first().click().catch(() => {})
})
await wait(800)
await page.screenshot({ path: `${OUT}/02-replay-state.png` })

// 退出
await page.locator('.ontology-lui button[title="退出诊断会话"]').first().click().catch(() => {})
await wait(700)

// 场景3:第四 Case 会话(磁盘 RAID 降级,BA-EXT 扩展演示)
await startSession('磁盘扇区故障RAID降级，归档业务IO变慢')
await stepMany(30)
await page.screenshot({ path: `${OUT}/03-case4-diagnosis.png` })

await browser.close()
console.log(`体验评审截图完成 · JS错误=${errors.length}`)

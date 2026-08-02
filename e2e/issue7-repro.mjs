/**
 * issue#7 P0 repro — 复现诊断白屏崩溃（3d-force-graph undefined x）。
 * 遍历 3 Case，自动推进 + 中途展开/折叠聚合层，捕获 pageerror。
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
const OUT = 'business-acceptance/issue7-repro'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`)
})
await page.goto(BASE)
await wait(4000)

async function startSession(text) {
  const fab = page.locator('.ontology-diagnosis-entry button').first()
  if (!(await page.locator('.ontology-diagnosis-entry textarea').isVisible().catch(() => false))) {
    await fab.click()
    await wait(300)
  }
  await page.locator('.ontology-diagnosis-entry textarea').fill(text)
  await page
    .locator('.ontology-diagnosis-entry > div button:has-text("开始故障诊断")')
    .first()
    .click()
    .catch(async () => {
      await page.locator('button:has-text("开始故障诊断")').last().click()
    })
  await wait(2000)
}

async function toggleLayers(n) {
  // 双击聚合头展开/收起（S1/S2/S3 域聚合头始终显示）
  for (let i = 0; i < n; i++) {
    const agg = page.locator('canvas').first()
    // 双击画布中心几次，触发聚合层展开收起（尽力而为）
    const box = await agg.boundingBox().catch(() => null)
    if (box) {
      await page.mouse.dblclick(box.x + box.width * 0.2, box.y + box.height * 0.35)
    }
    await wait(400)
  }
}

const TEXTS = [
  '数据库LUN时延突然升高，块业务变慢',
  'Host-B交易业务变慢，怀疑被邻居Host-A的IO突增扰邻',
  '远程复制RPO超标，怀疑复制网络丢包',
]

for (const text of TEXTS) {
  pageErrors.length = 0
  await startSession(text)
  const startedLui = await page.locator('.ontology-lui').isVisible().catch(() => false)
  if (!startedLui) {
    console.log(`[${text.slice(0, 12)}…] LUI 未出现（可能路由失败）`)
    continue
  }
  // 自动推进 40 步（每次 100ms），中途偶尔切换层
  for (let i = 0; i < 40; i++) {
    if (i % 8 === 4) await toggleLayers(1)
    await page.locator('.ontology-lui button[title="单步推进"]').first().click().catch(() => {})
    await wait(120)
    if (pageErrors.length > 0) break
  }
  const bodyVisible = await page.locator('body').isVisible().catch(() => false)
  const luiVisible = await page.locator('.ontology-lui').isVisible().catch(() => false)
  await page.screenshot({ path: `${OUT}/repro-${text.slice(0, 8)}.png` }).catch(() => {})
  console.log(
    `[${text.slice(0, 12)}…] errors=${pageErrors.length} body=${bodyVisible} lui=${luiVisible}`,
  )
  for (const e of pageErrors.slice(0, 5)) console.log('    ERR:', e.slice(0, 200))
  // 退出诊断回到主页
  await page.locator('.ontology-lui button[title="退出诊断会话"]').first().click().catch(() => {})
  await wait(1200)
}

await browser.close()

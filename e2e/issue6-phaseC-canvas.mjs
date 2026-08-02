/**
 * issue#6 阶段C — 画布深联动（逐对象诊断循环 + 图谱原始点亮）· 浏览器实测。
 * 运行:node e2e/issue6-phaseC-canvas.mjs（需先 python3 start.py --port 8080，dist 已重建）
 *
 * 验证点：
 *  - P0 诊断进入后 LUI 出现「诊断循环」区（当前焦点/查询对象 + 已判断对象判定）
 *  - P1 画布信息条出现「查询 {对象}」扫描态（随诊断推进在 controller→fc-port→lun→pool 间移动）
 *  - P2 画布信息条出现「图谱原始点 N」（诊断启动后 N>0，控制器场景收敛到 2）
 *  - P3 终态：诊断循环区展示对象判定（异常红 / 正常绿 / 受影响橙 / 候选黄）
 *  - P4 无 JS 错误
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
const OUT = 'business-acceptance/issue6-phaseC'
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
  await page
    .locator('.ontology-diagnosis-entry > div button:has-text("开始故障诊断")')
    .first()
    .click()
    .catch(async () => {
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
const scanQueryText = () =>
  page.locator('[data-testid="scan-query"]').textContent().catch(() => '')
const scanKgText = () => page.locator('[data-testid="scan-kg"]').textContent().catch(() => '')
const loopSec = () => page.locator('.ontology-lui section', { hasText: '诊断循环' }).first()
const loopText = () => loopSec().textContent().catch(() => '')
const luiText = () => page.locator('.ontology-lui').textContent().catch(() => '')

await startSession('数据库LUN时延突然升高，块业务变慢')

// ── P0：LUI「诊断循环」区出现（当前焦点/查询对象 + 已判断对象判定）────────────
let guard0 = 0
while (!(await loopText()).includes('诊断循环') && guard0++ < 40) await step(1)
const p0 = await loopText()
rec('P0-001', p0.includes('诊断循环'), 'LUI 出现「诊断循环」区')
rec('P0-002', /controller|Controller|0a/i.test(p0), `诊断循环含焦点/查询对象（${p0.slice(0, 70)}…）`)

// ── P1：画布信息条「查询 {对象}」扫描态随推进移动（controller → fc-port → lun → pool）──
let guard1 = 0
while (!(await scanQueryText()).includes('controller-0a') && guard1++ < 50) await step(1)
const q1 = await scanQueryText()
rec('P1-001', q1.includes('查询') && q1.includes('controller-0a'), `画布扫描态：${q1.trim()}`)
await page.screenshot({ path: `${OUT}/01-scan-controller.png` })

// 推进到 fc-port-0a 扫描
guard1 = 0
while (!(await scanQueryText()).includes('fc-port-0a') && guard1++ < 60) await step(1)
const q2 = await scanQueryText()
rec('P1-002', q2.includes('fc-port-0a'), `扫描态推进：${q2.trim()}`)
await page.screenshot({ path: `${OUT}/02-scan-fc-port.png` })

// 推进到 storage-pool-01 扫描（重规划后新目标）
guard1 = 0
while (!(await scanQueryText()).includes('storage-pool-01') && guard1++ < 70) await step(1)
const q3 = await scanQueryText()
rec('P1-003', q3.includes('storage-pool-01'), `扫描态推进（重规划新对象）：${q3.trim()}`)
await page.screenshot({ path: `${OUT}/03-scan-pool.png` })

// ── P2：画布信息条「图谱原始点 N」（诊断启动后 N>0）──────────────────────────
const kg1 = await scanKgText()
const kgCount1 = parseInt(kg1.replace(/\D/g, ''), 10) || 0
rec('P2-001', kgCount1 > 0, `图谱原始点 N>0（N=${kgCount1}）`)

// ── P3：推进到终态，诊断循环区展示对象判定（异常/正常/受影响/候选）───────────
let guard3 = 0
while (!(await luiText()).includes('诊断完成') && guard3++ < 80) await step(1)
await wait(1200)
const p3 = await loopText()
rec('P3-001', p3.includes('Controller-0A') && p3.includes('LUN-DB01'), `终态诊断循环含已判断对象（${p3.slice(0, 80)}…）`)
const kg2 = await scanKgText()
const kgCount2 = parseInt(kg2.replace(/\D/g, ''), 10) || 0
rec('P3-002', kgCount2 > 0 && kgCount2 <= kgCount1, `图谱原始点随诊断收敛（${kgCount1}→${kgCount2}）`)
rec('P3-003', p3.includes('异常') || p3.includes('正常') || p3.includes('受影响'), '终态诊断循环含判定语义')
await page.screenshot({ path: `${OUT}/04-terminal-verdicts.png` })

rec('P4-001', pageErrors.length === 0, `无 JS 错误（errors=${pageErrors.length}）`)

await browser.close()
console.log(`\nissue6-phaseC 结果：${results.filter((r) => r.ok).length}/${results.length} 通过`)
process.exit(results.every((r) => r.ok) ? 0 : 1)

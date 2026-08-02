/**
 * issue#6 阶段B — 对象观测三标签（告警｜性能｜日志）· 浏览器实测。
 * 运行:node e2e/issue6-phaseB-observation.mjs（需先 python3 start.py --port 8080，dist 已重建）
 *
 * 验证点：
 *  - P0 诊断进入后 LUI 出现「对象观测」区（当前焦点对象 + 告警/性能/日志三标签）
 *  - P1 焦点对象三类状态随查询推进：告警先完成=已查询—异常，性能/日志随后到位
 *  - P2 切换查看 LUN-DB01：性能已查询—异常，告警/日志保持未查询（不机械扫描）
 *  - P3 终态：焦点对象三类异常 + 未查询对象并存（按需查询）
 *  - P4 无 JS 错误
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
const OUT = 'business-acceptance/issue6-phaseB'
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
    await wait(90)
  }
  await wait(600)
}
const obsSec = () => page.locator('.ontology-lui section', { hasText: '对象观测' }).first()
const obsText = () => obsSec().textContent().catch(() => '')
const luiText = () => page.locator('.ontology-lui').textContent().catch(() => '')

await startSession('数据库LUN时延突然升高，块业务变慢')

// ── P0：对象观测区出现，含三标签与焦点对象 ──────────────────────────────────
let guard0 = 0
while (!(await obsText()).includes('告警') && guard0++ < 30) await step(1)
const p0 = await obsText()
rec('P0-001', p0.includes('对象观测') && p0.includes('告警') && p0.includes('性能') && p0.includes('日志'), '对象观测区含 告警｜性能｜日志 三标签')
rec('P0-002', /controller|Controller|0a/i.test(p0), `含焦点/被排查对象（${p0.slice(0, 60)}…）`)

// ── P1：推进到 controller-0a 三类全部查询到位（告警/性能/日志 均 已查询—异常）──
let guard1 = 0
while (!((await obsText()).includes('性能已查询—异常') && (await obsText()).includes('日志已查询—异常')) && guard1++ < 80) {
  await step(1)
}
const p1 = await obsText()
rec('P1-001', p1.includes('告警已查询—异常') && p1.includes('性能已查询—异常') && p1.includes('日志已查询—异常'), '焦点对象三类观测均 已查询—异常')
rec('P1-002', /控制器发生热复位|Watchdog超时热复位|I\/O吞吐/.test(p1), '异常条目可见（告警/日志指纹/性能吞吐）')

await page.screenshot({ path: `${OUT}/01-focus-abnormal.png` })

// ── P2：切换查看 LUN-DB01 —— 性能已查询—异常，告警/日志保持未查询 ──────────
await obsSec().getByText('LUN-DB01').first().click()
await wait(400)
const p2 = await obsText()
rec('P2-001', p2.includes('LUN-DB01') && p2.includes('性能已查询—异常'), '切换至 LUN-DB01：性能异常呈现')
rec('P2-002', p2.includes('告警未查询') && p2.includes('日志未查询'), 'LUN-DB01 告警/日志保持 未查询（不机械扫描）')
await page.screenshot({ path: `${OUT}/02-switched-lun.png` })

// 恢复跟随焦点
await obsSec().getByText('跟随焦点').first().click().catch(() => {})
await wait(300)

// ── P3：推进到终态，焦点对象三类异常 + 未查询对象并存 ────────────────────────
guard1 = 0
while (!(await luiText()).includes('诊断完成') && guard1++ < 60) await step(1)
await wait(1200)
const p3 = await obsText()
rec('P3-001', p3.includes('告警已查询—异常') && p3.includes('性能已查询—异常') && p3.includes('日志已查询—异常'), '终态焦点对象三类 已查询—异常')
// 未查询对象并存：切换到 DB-Host-01（计划内但无观测查询）。
await obsSec().getByText('DB-Host-01').first().click()
await wait(400)
const p3b = await obsText()
rec('P3-002', p3b.includes('DB-Host-01') && p3b.includes('未查询'), '未查询对象（DB-Host-01）三类保持 未查询')
await page.screenshot({ path: `${OUT}/03-terminal.png` })

rec('P4-001', pageErrors.length === 0, `无 JS 错误（errors=${pageErrors.length}）`)

await browser.close()
console.log(`\nissue6-phaseB 结果：${results.filter((r) => r.ok).length}/${results.length} 通过`)
process.exit(results.every((r) => r.ok) ? 0 : 1)

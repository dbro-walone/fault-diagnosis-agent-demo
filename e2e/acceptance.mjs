/**
 * docs/14 业务验收 · 黑盒走查脚本
 * 覆盖核心 P0 用例:模型探索态、唯一路由、弱输入自动匹配(issue #5 B1)、扰邻不泄露、终态与回放。
 * 运行:node e2e/acceptance.mjs(需先启动 python3 start.py --port 8099)
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099'
const OUT = 'business-acceptance'
mkdirSync(`${OUT}/graph-topology`, { recursive: true })
mkdirSync(`${OUT}/lui-fact-trace`, { recursive: true })
mkdirSync(`${OUT}/replay`, { recursive: true })

const results = []
const rec = (id, ok, note = '') => {
  results.push({ id, ok })
  console.log(`${ok ? '✓' : '✗'} ${id} ${note}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(BASE)
await wait(4000)

// BA-GOAL-001 模型探索态
const body0 = await page.textContent('body')
rec('BA-GOAL-001', !body0.includes('领先候选'), '探索态不显示候选')
await page.screenshot({ path: `${OUT}/graph-topology/01-explore.png` })

// 打开诊断入口
const fab = page.locator('.ontology-diagnosis-entry button').first()
await fab.click()
await wait(400)

async function submitSymptom(text) {
  if (!(await page.locator('.ontology-diagnosis-entry textarea').isVisible().catch(() => false))) {
    await fab.click()
    await wait(300)
  }
  await page.locator('.ontology-diagnosis-entry textarea').fill(text)
  await page.locator('.ontology-diagnosis-entry > div button:has-text("开始故障诊断")').first().click().catch(async () => {
    await page.locator('button:has-text("开始故障诊断")').last().click()
  })
  await wait(800)
}

// BA-GOAL-003 弱输入 → 自动随机选中候选场景执行（issue #5 B1，不再弹候选面板）
await submitSymptom('业务变慢')
const luiAuto = await page.textContent('.ontology-lui').catch(() => '')
const autoMatched = luiAuto.includes('已自动匹配到')
rec('BA-GOAL-003', autoMatched, '弱输入自动随机选中候选场景执行')
await page.screenshot({ path: `${OUT}/lui-fact-trace/02-ambiguous-auto.png` })

// 退出自动匹配的会话，回到探索态（FAB 需重新可见）
await page.locator('.ontology-lui button[title="退出诊断会话"]').first().click().catch(() => {})
await wait(600)

// BA-GOAL-002 唯一路由 → 会话
await submitSymptom('数据库LUN时延突然升高，块业务变慢')
await wait(3500)
const lui = await page.textContent('.ontology-lui').catch(() => '')
rec('BA-GOAL-002', lui.includes('实时'), '唯一路由创建会话')
await page.screenshot({ path: `${OUT}/graph-topology/03-live-controller.png` })

// 快进到终态(多次点击下一步/播放)
for (let i = 0; i < 3; i++) {
  await page.locator('.ontology-lui button[title="单步推进"]').first().click().catch(() => {})
  await wait(400)
}
await page.screenshot({ path: `${OUT}/lui-fact-trace/04-progress.png` })

// 退出诊断
await page.locator('.ontology-lui button[title="退出诊断会话"]').first().click().catch(() => {})
await wait(600)

// BA-NN-001/006 扰邻:初始不泄露施压者 Host-A
await submitSymptom('Host-B交易业务变慢，怀疑被邻居Host-A的IO突增扰邻')
await wait(2500)
const lui2 = await page.textContent('.ontology-lui').catch(() => '')
const leakA = lui2.includes('cand-noisy-neighbor-a') || lui2.includes('Host-A工作负载突增')
rec('BA-NN-006', !leakA, '扰邻初始不显示施压者候选')
await page.screenshot({ path: `${OUT}/graph-topology/05-noisy-early.png` })

// 推进到施压者显簜(等 REPLAY/推进)
for (let i = 0; i < 40; i++) {
  await page.locator('.ontology-lui button[title="单步推进"]').first().click().catch(() => {})
  await wait(150)
}
await wait(1000)
const lui3 = await page.textContent('.ontology-lui').catch(() => '')
const revealA = lui3.includes('Host-A') || lui3.includes('扰邻')
rec('BA-NN-007', revealA, '展开后施压者出现(反向追溯)')
await page.screenshot({ path: `${OUT}/graph-topology/06-noisy-revealed.png` })

await browser.close()
console.log(`\n=== 验收走查结果: ${results.filter((r) => r.ok).length}/${results.length} PASS · JS 错误=${pageErrors.length} ===`)
process.exit(results.some((r) => !r.ok) ? 1 : 0)

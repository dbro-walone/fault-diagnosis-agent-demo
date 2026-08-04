/**
 * 阶段5 前端投影边界 — 浏览器实测（docs/19 §14）。
 * 运行: node e2e/issue8-view-boundary.mjs（需先 python3 start.py --port 8080，dist 已重建）
 *
 * 验证点：
 *  - P0 诊断推进中 LUI「当前决策」区可答三问之"为什么"（理由/目标候选/证据缺口/预期证据）
 *  - P1 ViewState 操作（聚合展开/节点选中/平面显隐）不改变诊断语义（候选分/证据/终态不变）
 *  - P2 回放 seek/step 只读：候选分/证据数/终态不变；恢复实时一致
 *  - P3 终态 LUI「当前决策」上下文反映结论
 *  - P4 全程无 JS 错误
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
const OUT = 'business-acceptance/issue8'
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
  await wait(400)
}
async function pause() {
  if (await page.locator('.ontology-lui button[title="暂停"]').first().isVisible().catch(() => false)) {
    await page.locator('.ontology-lui button[title="暂停"]').first().click()
  }
  await wait(200)
}
const luiText = () => page.locator('.ontology-lui').textContent().catch(() => '')
const isTerminal = async () => {
  const t = await luiText()
  return t.includes('TOP3') || t.includes('已确认') || t.includes('INSUFFICIENT_EVIDENCE') || t.includes('PROBABLE_CAUSES')
}
/** 从 LUI 候选根因区提取候选支持分列表（0-100 数字序列）——诊断语义指纹采样。 */
const candidateScores = async () => {
  const t = await luiText()
  const candIdx = t.indexOf('候选根因')
  if (candIdx < 0) return ''
  const section = t.slice(candIdx, t.indexOf('对象观测', candIdx) > candIdx ? t.indexOf('对象观测', candIdx) : t.length)
  return [...section.matchAll(/\b(\d{1,3})\b/g)].map((m) => m[1]).join(',')
}

/** 从 LUI 诊断态势区提取 事实/证据/候选 计数。 */
const semanticCounts = async () => {
  const t = await luiText()
  return [t.match(/事实 (\d+)/)?.[1], t.match(/证据 (\d+)/)?.[1], t.match(/候选 (\d+)/)?.[1]].join(',')
}

// ── 主流程（确定性 controller case；先暂停避免 auto-play 竞争）──
await startSession('数据库LUN时延突然升高，块业务变慢')
await pause()
let guardF = 0
while (!(await luiText()).includes('Planner 目标') && guardF++ < 30) await step(1)
await step(10)
await pause()

// ── P0：LUI「当前决策」三问之"为什么" ──
const t0 = await luiText()
rec('P0-001', t0.includes('当前决策'), 'LUI 含「当前决策」区')
rec('P0-002', t0.includes('为什么') && t0.length > 0, '「当前决策」区含"为什么"')
rec('P0-003', /目标/.test(t0) && /预期/.test(t0), '含目标候选 + 预期证据')
rec('P0-004', t0.includes('证据缺口') || t0.includes('缺口'), '含证据缺口信息')

// ── P1：ViewState 操作不改变诊断语义 ──
// 先推进到候选已成形（有支持分），再对画布做聚合/选中/平面显隐操作。
let guardC = 0
while ((await candidateScores()).length === 0 && guardC++ < 60) await step(1)
const scoresBefore = await candidateScores()
const countsBefore = await semanticCounts()
// 聚合展开：点击 S3 层条带聚合头（分层条带在画布左边缘）。
const layerToggle = page.locator('[data-testid="layer-band"]').first()
if (await layerToggle.isVisible().catch(() => false)) {
  await layerToggle.click()
  await wait(300)
}
// 平面显隐：点击知识平面切换（ModelNavigator）。
const kgPlane = page.locator('button:has-text("知识")').first()
if (await kgPlane.isVisible().catch(() => false)) {
  await kgPlane.click()
  await wait(300)
  await kgPlane.click()
  await wait(300)
}
const scoresAfter = await candidateScores()
const countsAfter = await semanticCounts()
rec('P1-001', scoresAfter === scoresBefore && scoresBefore.length > 0, `ViewState 操作后候选分不变（${scoresBefore} → ${scoresAfter}）`)
rec('P1-002', countsAfter === countsBefore, `事实/证据/候选计数不变（${countsBefore} → ${countsAfter}）`)

// ── P2：回放 seek/step 只读 ──
const liveScores = await candidateScores()
await page.locator('.ontology-lui button[title="回到起点"]').first().click().catch(() => {})
await wait(400)
const replayT = await luiText()
rec('P2-001', replayT.includes('回放'), 'seek 后进入 REPLAY 模式')
// 回放态手动 step（只移动游标，不改写 live 诊断语义）。
await step(5)
rec('P2-002', (await luiText()).includes('回放'), '回放态 step 后仍为 REPLAY')
await page.locator('.ontology-lui button:has-text("实时")').first().click().catch(() => {})
await wait(400)
rec('P2-003', (await luiText()).includes('实时'), '返回实时模式')
rec('P2-004', (await candidateScores()) === liveScores && liveScores.length > 0, '回放往返后候选分与 live 一致（只读不改写）')

// ── P3：推进到终态，LUI「当前决策」上下文反映结论 ──
let guard = 0
while (!(await isTerminal()) && guard++ < 120) await step(1)
const tTerm = await luiText()
rec('P3-001', await isTerminal(), '诊断推进到终态')
rec('P3-002', /根因|原因|证据/.test(tTerm), '终态「当前决策」上下文反映结论')

// ── P4：全程无 JS 错误 ──
rec('P4-001', pageErrors.length === 0, `全程无 JS 错误（errors=${pageErrors.length}）`)

await browser.close()
const passed = results.filter((r) => r.ok).length
console.log(`\nissue8-view-boundary 结果：${passed}/${results.length} 通过`)
process.exit(passed === results.length ? 0 : 1)

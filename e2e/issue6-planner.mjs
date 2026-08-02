/**
 * issue#6 阶段A — Planner 目标呈现 · 浏览器实测（临时）。
 * 运行:node e2e/issue6-planner.mjs（需先 python3 start.py --port 8080，dist 已重建）
 *
 * 验证点：
 *  - P0 诊断进入后 LUI 出现 Planner 目标区（目标资源/故障模式/验证问题/期望发现/当前范围）
 *  - P1 当前位置（active 目标）高亮，并随诊断推进移动
 *  - P2 task-check-pool 触发重规划：出现"重新规划"横幅 + storage-pool-01 新增目标
 *  - P3 终态目标状态裁决（命中故障 / 已排除 / 已验证）
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
const OUT = 'business-acceptance/issue6-phaseA'
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

// 启动 controller 诊断
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
const luiText = () => page.locator('.ontology-lui').textContent().catch(() => '')
const plannerText = () =>
  page
    .locator('.ontology-lui section', { hasText: 'Planner 目标' })
    .first()
    .textContent()
    .catch(() => '')

await startSession('数据库LUN时延突然升高，块业务变慢')

// 推进到首个任务运行（PLAN_CREATED 已发生、目标列表就位）
let guard0 = 0
while (!(await plannerText()).includes('lun-db01') && guard0++ < 20) await step(1)

// ── P0：Planner 目标区存在，且展示 5 项目标字段 ─────────────────────────────
const p0 = await plannerText()
rec(
  'P0-001',
  p0.includes('Planner 目标') && p0.includes('lun-db01') && p0.includes('controller-0a'),
  'Planner 目标区出现且含真实目标资源',
)
rec(
  'P0-002',
  p0.includes('为什么') && p0.includes('期望发现') && p0.includes('业务专属路径'),
  '含验证问题/期望发现/当前范围',
)

// 截图 01：诊断早期，controller-0a 为当前位置（active 高亮）
await page.screenshot({ path: `${OUT}/01-early-active.png` })

// ── P1：当前位置高亮随诊断推进移动 ──────────────────────────────────────────
const activeSeqEarly = await page
  .locator('.ontology-lui section', { hasText: 'Planner 目标' })
  .locator('text=当前位置')
  .first()
  .textContent()
  .catch(() => '')
rec('P1-001', activeSeqEarly.includes('当前位置 #4'), `早期当前位置=${activeSeqEarly.trim()}`)

// ── P2：推进到 task-check-pool，触发重规划横幅 + 新增目标 ──────────────────
let guard = 0
while (!(await plannerText()).includes('重新规划') && guard++ < 40) await step(1)
const p2 = await plannerText()
rec(
  'P2-001',
  p2.includes('重新规划') && p2.includes('storage-pool-01') && p2.includes('新增目标'),
  '重规划横幅出现（原范围→扩展，新增 storage-pool-01）',
)
await page.screenshot({ path: `${OUT}/02-replan.png` })

// ── P3：推进到终态，目标状态裁决 ────────────────────────────────────────────
guard = 0
while (!(await luiText()).includes('诊断完成') && guard++ < 60) await step(1)
await wait(1200)
const p3 = await plannerText()
rec(
  'P3-001',
  p3.includes('命中故障') && p3.includes('已排除') && p3.includes('已验证'),
  '终态状态裁决（命中故障/已排除/已验证）',
)
await page.screenshot({ path: `${OUT}/03-terminal-statuses.png` })

rec('P0-003', pageErrors.length === 0, `无 JS 错误（errors=${pageErrors.length}）`)

await browser.close()
console.log(`\nissue6-phaseA 结果：${results.filter((r) => r.ok).length}/${results.length} 通过`)
process.exit(results.every((r) => r.ok) ? 0 : 1)

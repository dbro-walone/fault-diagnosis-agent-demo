/** GitHub issue #4 落地补全 · 主画布「分层拓扑（上）+ 知识图谱（下）」浏览器实测。
 * 运行：node e2e/issue4-knowledge-bottom.mjs（需先 python3 start.py --port 8099 --no-browser）
 * 覆盖：两层都可见、图谱分层/节点可见、跨层映射连线、点选拓扑→图谱高亮、
 *       点选图谱→拓扑高亮、Case 切换、诊断红逻辑链、无 JS 错误。
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099'
const OUT = 'business-acceptance/issue4-knowledge-bottom'
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

// 1. 两层都可见：条带头 + 图谱下层（层标题/节点）
const header = await page.locator('text=S1 → S3 分层拓扑 · 故障知识图谱').isVisible().catch(() => false)
const kgObjType = await page.locator('text=对象类型').first().isVisible().catch(() => false)
const kgFaultMode = await page.locator('text=故障模式').first().isVisible().catch(() => false)
const kgEvRule = await page.locator('text=证据规则').first().isVisible().catch(() => false)
const otNode = await page.locator('text=存储控制器').first().isVisible().catch(() => false)
const fmNode = await page.locator('text=控制器热复位').first().isVisible().catch(() => false)
const erNode = await page.locator('text=复位严重告警证据规则').first().isVisible().catch(() => false)
rec('KG-001', header, '两层头可见')
rec('KG-002', kgObjType && kgFaultMode && kgEvRule, '图谱分层列标题可见')
rec('KG-003', otNode && fmNode && erNode, '图谱对象类型/故障模式/证据规则节点可见')
await page.screenshot({ path: `${OUT}/01-two-layers-default.png`, fullPage: true })

// 2. 跨层映射连线（INSTANCE_OF 常显淡虚线）存在
const crossLineCount = await page.locator('svg line[stroke-dasharray="5 4"]').count()
rec('KG-004', crossLineCount > 0, `跨层映射淡虚线 ${crossLineCount} 条`)

// 3. 展开 S3 → S3.2 控制层，露出控制器成员
await page.locator('text=S3 存储系统域').first().click().catch(() => {})
await wait(500)
await page.locator('text=S3.2 控制层').first().click().catch(() => {})
await wait(700)
const ctlVisible = await page.locator('text=控制器-01A').first().isVisible().catch(() => false)
rec('KG-005', ctlVisible, '展开 S3.2 后控制器成员可见')

// 4. 点选图谱「存储控制器」→ 拓扑侧高亮环（teal 虚线矩形）+ 跨层线变亮
await page.locator('text=存储控制器').first().click().catch(() => {})
await wait(600)
const topoRings = await page.locator('svg rect[fill="none"][stroke="#2dd4bf"]').count()
rec('KG-006', topoRings >= 1, `图谱选中后拓扑高亮环 ${topoRings} 个`)
await page.screenshot({ path: `${OUT}/02-kg-selected-topo-highlight.png`, fullPage: true })

// 5. 点选拓扑「控制器-01A」→ 图谱侧高亮（含对象类型/故障模式/证据规则）
await page.locator('text=控制器-01A').first().click().catch(() => {})
await wait(600)
const kgHighlight = await page.locator('svg rect[stroke="#2dd4bf"][fill="#141a28"]').count()
rec('KG-007', kgHighlight >= 1, `拓扑选中后图谱高亮节点 ${kgHighlight} 个`)
await page.screenshot({ path: `${OUT}/03-topo-selected-kg-highlight.png`, fullPage: true })

// 6. Case 切换：切到 controller_warm_reset_001 → 拓扑模型重建、图谱仍可见
await page.locator('select[aria-label="分层拓扑 Case"]').selectOption('controller_warm_reset_001').catch(() => {})
await wait(1500)
const headerAfter = await page.locator('text=S1 → S3 分层拓扑 · 故障知识图谱').isVisible().catch(() => false)
const kgStill = await page.locator('text=对象类型').first().isVisible().catch(() => false)
// 切 Case 后展开状态重置，需重新展开 S3 → S3.2 才能看到 Controller-0A。
await page.locator('text=S3 存储系统域').first().click().catch(() => {})
await wait(400)
await page.locator('text=S3.2 控制层').first().click().catch(() => {})
await wait(700)
const ctlCount = await page.locator('svg text:has-text("Controller")').count()
rec('KG-008', headerAfter && kgStill && ctlCount >= 1, `切 Case 后拓扑/图谱重建，Controller 成员 ${ctlCount} 个`)
await page.screenshot({ path: `${OUT}/04-case-switch-controller.png`, fullPage: true })

// 7. 诊断推进 → 红逻辑链仍在上层条带（不破坏 issue#5 F2）
const fab = page.locator('.ontology-diagnosis-entry button').first()
await fab.click().catch(() => {})
await wait(300)
await page.locator('.ontology-diagnosis-entry textarea').fill('数据库LUN时延突然升高，块业务变慢')
await page.locator('.ontology-diagnosis-entry button:has-text("开始故障诊断")').first().click().catch(async () => {
  await page.locator('button:has-text("开始故障诊断")').last().click()
})
await wait(1000)
for (let i = 0; i < 48; i++) {
  await page.locator('.ontology-lui button[title="单步推进"]').first().click().catch(() => {})
  await wait(60)
}
await wait(1000)
const redLines = await page.locator('svg line[stroke="#ef4444"]').count()
rec('KG-009', redLines >= 1, `诊断推进红逻辑链 ${redLines} 条`)
await page.screenshot({ path: `${OUT}/05-diagnosis-red-logic.png`, fullPage: true })

// 8. 无 JS 错误
rec('KG-010', pageErrors.length === 0, pageErrors.slice(0, 2).join('; '))

await browser.close()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${failed === 0 ? '✓' : `✘ ${failed} FAILED`} · total ${results.length}`)
process.exit(failed === 0 ? 0 : 1)

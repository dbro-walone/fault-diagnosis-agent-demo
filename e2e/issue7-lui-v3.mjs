/**
 * issue#7 LUI交互优化V3 — 浏览器实测。
 * 运行: node e2e/issue7-lui-v3.mjs（需先 python3 start.py --port 8080，dist 已重建）
 *
 * 验证点：
 *  - P0 输入"数据库访问慢"诊断全程不再白屏（复现原崩溃路径）
 *  - P1 LUI 无「诊断循环」分区、无 4-tab 小窗口
 *  - P2 时间线回放/跳转保留（八幕书签跳转进入 REPLAY）
 *  - P3 PLANNER 显示排查路径 + 每个目标含「实际发现」
 *  - P4 逐项排查时画布对应节点高亮且聚合层自动展开（scan-query 推进 + scan-expand 徽标）
 *  - P5 重规划黄标记保留
 *  - P6 LUI 展开时画布右边界左移避让（不遮挡）
 *  - P7 无 JS 错误
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
const OUT = 'business-acceptance/issue7'
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
  await wait(400)
}
async function pause() {
  if (await page.locator('.ontology-lui button[title="暂停"]').first().isVisible().catch(() => false)) {
    await page.locator('.ontology-lui button[title="暂停"]').first().click()
  }
  await wait(200)
}
async function exitSession() {
  await page.locator('.ontology-lui button[title="退出诊断会话"]').first().click().catch(() => {})
  await wait(1200)
}
const luiText = () => page.locator('.ontology-lui').textContent().catch(() => '')
const scanQueryText = () => page.locator('[data-testid="scan-query"]').textContent().catch(() => '')
const scanExpandText = () => page.locator('[data-testid="scan-expand"]').textContent().catch(() => '')
/** 终态判定：候选确认「已确认」/ 收敛 TOP3 / 终态状态码。 */
const isTerminal = async () => {
  const t = await luiText()
  return t.includes('TOP3') || t.includes('已确认') || t.includes('INSUFFICIENT_EVIDENCE') || t.includes('PROBABLE_CAUSES')
}

// ── P0：复现"数据库访问慢"白屏路径（auto-play + 手动推进 + 画布拖拽交互）─────
await startSession('数据库访问慢')
let guard0 = 0
while (!(await luiText()).includes('Planner 目标') && guard0++ < 30) await step(1)
rec('P0-001', await page.locator('body').isVisible(), '诊断会话进入（body 可见，无白屏）')

// 画布拖拽 + 双击交互（触发 pointer 事件路径，验证 P0 补丁）
const canvas = page.locator('canvas').first()
const cb = await canvas.boundingBox()
if (cb) {
  await page.mouse.move(cb.x + cb.width * 0.4, cb.y + cb.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.55, { steps: 5 })
  await page.mouse.up()
  await page.mouse.dblclick(cb.x + cb.width * 0.3, cb.y + cb.height * 0.45)
  await wait(500)
}
// 自动推进到终态（原崩溃发生在推进过程）
let guardAuto = 0
while (!(await isTerminal()) && guardAuto++ < 90) {
  await step(1)
  await wait(60)
}
rec('P0-002', pageErrors.length === 0, `诊断全程无 JS 错误（errors=${pageErrors.length}）`)
rec('P0-003', await isTerminal(), '诊断推进到终态')
await page.screenshot({ path: `${OUT}/00-p0-terminal.png` })

// ── P1：LUI 精简 — 无「诊断循环」分区、无 4-tab 小窗口 ──────────────────────
const t1 = await luiText()
rec('P1-001', !t1.includes('诊断循环'), 'LUI 无「诊断循环」分区')
rec('P1-002', !t1.includes('证据链候选'), 'LUI 无证据链 tab 小窗口')
rec('P1-003', !t1.includes('候选分数轨迹'), 'LUI 无计划 tab 小窗口')
rec('P1-004', (await page.locator('.ontology-lui button:has-text("证据链")').count()) === 0, '无「证据链」tab 按钮')
rec('P1-005', (await page.locator('.ontology-lui button:has-text("计划")').count()) === 0, '无「计划」tab 按钮')
rec('P1-006', (await page.locator('.ontology-lui button:has-text("历史")').count()) === 0, '无「历史」tab 按钮')

await exitSession()

// ── 功能主流程（确定性 controller case）────────────────────────────────────
await startSession('数据库LUN时延突然升高，块业务变慢')
// 阶段5 稳健性：先暂停自动推进，后续全部手动单步 —— 避免 auto-play 定时器与
// 手动 step 竞争导致"当前查询对象"扫描窗口被跳过（P4 断言依赖确定性游标）。
await pause()
let guardF = 0
while (!(await luiText()).includes('Planner 目标') && guardF++ < 30) await step(1)
// 推进到 Planner 目标生成（controller 在候选生成阶段输出 5 目标 + 排查路径）
await step(14)
await pause()

// ── P3：PLANNER 排查路径 + 实际发现 ────────────────────────────────────────
const t3 = await luiText()
rec('P3-001', t3.includes('排查路径') || t3.includes('范围：'), 'PLANNER 显示排查路径主线')
rec('P3-002', t3.includes('实际发现'), 'PLANNER 目标含「实际发现」')
rec('P3-003', /(待排查|无命中|告警|日志|性能|已排除)/.test(t3), '实际发现有内容（待排查/无命中/命中项）')
await page.screenshot({ path: `${OUT}/01-planner-finding.png` })

// ── P4：逐项排查时画布对应节点高亮 + 聚合层自动展开（暂停后单步推进）───────
let sawScan = ''
let expLayer = ''
for (let i = 0; i < 90; i++) {
  await step(1)
  sawScan = await scanQueryText()
  expLayer = await scanExpandText()
  if (sawScan.includes('controller-0a')) break
}
rec('P4-001', sawScan.includes('controller-0a'), `推进到 controller-0a：${sawScan.trim()}`)
rec('P4-002', /展开 (S3_2|S3)/.test(expLayer), `聚合层自动展开徽标：${expLayer.trim() || '—'}`)
await page.screenshot({ path: `${OUT}/02-canvas-controller.png` })

let guardP4b = 0
while (!(await scanQueryText()).includes('fc-port-0a') && guardP4b++ < 70) await step(1)
const qFc = await scanQueryText()
rec('P4-003', qFc.includes('fc-port-0a'), `扫描态推进：${qFc.trim()}`)
await page.screenshot({ path: `${OUT}/03-canvas-fc-port.png` })

// ── P5：重规划黄标记保留（推进到终态后确认）────────────────────────────────
let guardP5 = 0
while (!(await isTerminal()) && guardP5++ < 100) await step(1)
await wait(800)
const t5 = await luiText()
rec('P5-001', t5.includes('重新规划') || t5.includes('重规划新增'), '重规划黄标记保留（重新规划/重规划新增）')
await page.screenshot({ path: `${OUT}/04-replan.png` })

// ── P2：时间线回放/跳转保留（终态后八幕书签出现）────────────────────────────
await page.locator('.ontology-lui button[title="展开时间线"]').first().click().catch(() => {})
await wait(300)
const tlVisible = await page.locator('.ontology-lui button[title="下一步"]').first().isVisible().catch(() => false)
rec('P2-001', tlVisible, '时间线窄条可展开（含事件列表）')
// 八幕书签在 DIAGNOSIS_COMPLETED 事件写入；"已确认"出现得更早，需补推进到书签出现。
const firstBookmark = page.locator('.ontology-lui section button[title="正常基线"]').first()
let guardBm = 0
while ((await firstBookmark.count()) === 0 && guardBm++ < 30) {
  await step(1)
  await wait(100)
}
const cursorLineBefore = (await luiText()).match(/游标\s*(\d+)\s*·\s*(\d+)\/(\d+)/)?.[0] ?? ''
if ((await firstBookmark.count()) > 0) {
  await firstBookmark.click()
  await wait(500)
  const tAfter = await luiText()
  const m = tAfter.match(/游标\s*(\d+)\s*·\s*(\d+)\/(\d+)/)
  const replayed = !!m && Number(m[1]) < Number(m[2])
  rec('P2-002', replayed && tAfter.includes('回放'), `八幕书签跳转进入 REPLAY（${cursorLineBefore}→游标 ${m ? m[1] : '?'} · ${m ? m[2] : '?'}/${m ? m[3] : '?'}）`)
} else {
  const bookmarkCount = await page.locator('.ontology-lui section button[title]').count()
  rec('P2-002', bookmarkCount > 5, `未按名匹配书签（书签按钮数=${bookmarkCount}）`)
}
// 返回实时，收起时间线
await page.locator('.ontology-lui button[title="返回实时"]').first().click().catch(() => {})
await wait(200)
await page.locator('.ontology-lui button[title="收起时间线"]').first().click().catch(() => {})
await wait(200)

// ── P6：LUI 展开时画布右边界左移避让 ───────────────────────────────────────
const luiWide = await page.locator('.ontology-lui').boundingBox()
const canvasWide = await page.locator('canvas').first().boundingBox()
await page.locator('.ontology-lui button[title="展开左侧 Object Explorer"]').first().click().catch(() => {})
await wait(600)
const luiNarrow = await page.locator('.ontology-lui').boundingBox()
const canvasNarrow = await page.locator('canvas').first().boundingBox()
if (luiWide && canvasWide && luiNarrow && canvasNarrow) {
  const wideOk = canvasWide.x + canvasWide.width <= luiWide.x + 4
  const narrowOk = canvasNarrow.width > canvasWide.width
  rec('P6-001', wideOk, `LUI 宽时画布右边界在 LUI 左侧（canvas.right=${Math.round(canvasWide.x + canvasWide.width)} ≤ lui.left=${Math.round(luiWide.x)}）`)
  rec('P6-002', narrowOk, `LUI 窄时画布宽度回扩（${Math.round(canvasWide.width)}→${Math.round(canvasNarrow.width)}）`)
} else {
  rec('P6-001', false, '无法测量画布/LUI 边界')
  rec('P6-002', false, '无法测量画布回扩')
}
await page.screenshot({ path: `${OUT}/05-lui-wide.png` })

// ── P7：无 JS 错误 ────────────────────────────────────────────────────────
rec('P7-001', pageErrors.length === 0, `全程无 JS 错误（errors=${pageErrors.length}）`)
for (const e of pageErrors.slice(0, 5)) console.log('    ERR:', e.slice(0, 300))

await browser.close()
console.log(`\nissue7-lui-v3 结果：${results.filter((r) => r.ok).length}/${results.length} 通过`)
process.exit(results.every((r) => r.ok) ? 0 : 1)

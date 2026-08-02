/**
 * GitHub issue #5 LUI 交互优化 · 浏览器实测脚本（临时）。
 * 运行:node e2e/issue5-smoke.mjs（需先 python3 start.py --port 8080，dist 已重建）
 */
import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
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

const fab = page.locator('.ontology-diagnosis-entry button').first()
async function submitSymptom(text) {
  if (!(await page.locator('.ontology-diagnosis-entry textarea').isVisible().catch(() => false))) {
    await fab.click()
    await wait(300)
  }
  await page.locator('.ontology-diagnosis-entry textarea').fill(text)
  await page.locator('.ontology-diagnosis-entry button:has-text("开始故障诊断")').first().click().catch(async () => {
    await page.locator('button:has-text("开始故障诊断")').last().click()
  })
  await wait(800)
}
async function exitDiagnosis() {
  await page.locator('.ontology-lui button[title="退出诊断会话"]').first().click().catch(() => {})
  await wait(600)
}

// ── B1：弱输入自动随机选 Case，不弹候选面板 ──────────────────────────────
await submitSymptom('业务变慢')
await wait(800)
const luiAuto = await page.textContent('.ontology-lui').catch(() => '')
const autoMatched = luiAuto.includes('已自动匹配到')
rec('B1-001', autoMatched, `弱输入自动匹配（LUI="${luiAuto.slice(0, 60).replace(/\n/g, ' ')}…"）`)

// ── F0：诊断时左栏收起 + LUI 变宽 ≈1.8× ──────────────────────────────────
const navigatorHidden = !(await page.locator('.ontology-navigator').isVisible().catch(() => false))
const luiWidth = await page.locator('.ontology-lui').evaluate((el) => el.getBoundingClientRect().width)
rec('F0-001', navigatorHidden, `诊断时左栏隐藏=${navigatorHidden}`)
rec('F0-002', luiWidth >= 700, `LUI 宽度=${Math.round(luiWidth)}px（期望≈806）`)

// 手动展开左栏开关
await page.locator('.ontology-lui button[title="展开左侧 Object Explorer"]').first().click().catch(() => {})
await wait(500)
const navigatorShown = await page.locator('.ontology-navigator').isVisible().catch(() => false)
const luiNarrow = await page.locator('.ontology-lui').evaluate((el) => el.getBoundingClientRect().width)
rec('F0-003', navigatorShown && luiNarrow < 700, `手动展开后左栏=${navigatorShown} LUI=${Math.round(luiNarrow)}px`)
// 收起回去
await page.locator('.ontology-lui button[title="收起左侧 Object Explorer"]').first().click().catch(() => {})
await wait(400)

// ── F2：推进诊断，检查画布出现 logic 红链（通过 React 状态较难，检查无错 + 截图）──
for (let i = 0; i < 40; i++) {
  await page.locator('.ontology-lui button[title="单步推进"]').first().click().catch(() => {})
  await wait(120)
}
await wait(1000)
await page.screenshot({ path: 'business-acceptance/issue5-f2-live.png', fullPage: true })
// 画布存在（flat 3D）
const canvasVisible = await page.locator('.ontology-interaction-canvas').isVisible().catch(() => false)
rec('F2-001', canvasVisible, '诊断中 flat 画布可见（红线在 3D 画布内）')

// ── F1：证据链页签在诊断态势下方、更大更醒目 ──────────────────────────────
const chainTab = await page.locator('.ontology-lui button:has-text("证据链")').first()
const chainTabFont = await chainTab.evaluate((el) => getComputedStyle(el).fontSize)
rec('F1-001', parseFloat(chainTabFont) >= 11, `证据链页签字号=${chainTabFont}`)
// 点击证据链页签，内容区可见
await chainTab.click().catch(() => {})
await wait(300)
const chainContent = await page
  .locator('.ontology-lui')
  .getByText('证据链候选', { exact: false })
  .isVisible()
  .catch(() => false)
rec('F1-002', chainContent, '证据链内容区可见')

// ── F3：快进到终态，TOP3 + 红色高亮 ──────────────────────────────────────
for (let i = 0; i < 60; i++) {
  await page.locator('.ontology-lui button[title="单步推进"]').first().click().catch(() => {})
  await wait(60)
}
await wait(1500)
const top3Badge = await page
  .locator('.ontology-lui')
  .getByText('TOP3', { exact: false })
  .isVisible()
  .catch(() => false)
rec('F3-001', top3Badge, '终态展示 TOP3 徽标')
// 检查确认候选是否红色（status-fault 类）
const redCandidate = await page.locator('.ontology-lui .border-status-fault\\/50').count()
rec('F3-002', redCandidate >= 1, `红色高亮候选数=${redCandidate}`)
await page.screenshot({ path: 'business-acceptance/issue5-f3-terminal.png', fullPage: true })

// ── F0 退出恢复左栏 ─────────────────────────────────────────────────────
await exitDiagnosis()
const navigatorBack = await page.locator('.ontology-navigator').isVisible().catch(() => false)
rec('F0-004', navigatorBack, '退出诊断后左栏恢复')

rec('PAGE-001', pageErrors.length === 0, pageErrors.slice(0, 3).join('; '))

await browser.close()
console.log(`\n=== issue#5 smoke: ${results.filter((r) => r.ok).length}/${results.length} PASS · JS 错误=${pageErrors.length} ===`)
process.exit(results.some((r) => !r.ok) ? 1 : 0)

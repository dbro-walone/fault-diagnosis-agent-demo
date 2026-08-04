// KnowledgeGraphPackage 3.0.0 重构浏览器验收（阶段1）：
//  - 故障知识图谱四层（Domain Root + L1~L4）图例渲染正常 + 每层节点计数；
//  - WebGL 画布存在；
//  - 诊断入口 UI 可打开（完整诊断回放在 headless swiftshader 下过慢，属既有环境限制；
//    诊断运行时由 scripts/verify-v2.mjs 全量覆盖）。
// 用法：node e2e/dbg-kg-package.mjs
import { chromium } from '@playwright/test'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
let failures = 0
const ok = (cond, msg) => { console.log(`${cond ? 'OK' : 'FAIL'} · ${msg}`); if (!cond) failures += 1 }
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)))

await page.goto(BASE, { timeout: 30000 })
await page.waitForSelector('canvas', { timeout: 30000 }).catch(() => {})
await wait(2500)

// 1) 知识图谱图例（Domain Root + L1~L4）
const legend = await page.locator('div:has-text("拓扑 S1→S3")').first().innerText().catch(() => '')
for (const expect of ['知识域根', 'L1 类型·场景', 'L2 故障模式', 'L3 现象·机理·证据', 'L4 规则·模板·案例']) {
  ok(legend.includes(expect), `图例含「${expect}」`)
}
// 旧六层（OBJECT_TYPE/SYMPTOM/EVIDENCE_RULE/CASE）不应再出现
ok(!legend.includes('对象类型') && !legend.includes('故障现象') && !legend.includes('证据规则'), '图例不再显示旧六层（对象类型/故障现象/证据规则）')

// 2) 每层节点计数（ROOT·1 / L1·13 / L2·9 / L3·14 / L4·13）
const navText = await page.locator('div:has-text("KNOWLEDGE LAYERS")').first().innerText().catch(() => '')
for (const expect of ['ROOT · 1', 'L1 · 13', 'L2 · 9', 'L3 · 14', 'L4 · 13']) {
  ok(navText.includes(expect), `层计数「${expect}」`)
}

// 3) WebGL 画布存在且有尺寸
const cb = await page.locator('canvas').first().boundingBox().catch(() => null)
ok(!!cb && cb.width > 50 && cb.height > 50, `WebGL 画布可见 (${cb?.width ?? 0}x${cb?.height ?? 0})`)

// 4) 诊断入口 UI 存在（完整回放由 verify-v2.mjs 覆盖）
const entryVisible = await page.locator('.ontology-diagnosis-entry button').first().isVisible().catch(() => false)
ok(entryVisible, '诊断入口按钮可见')

await page.screenshot({ path: '/tmp/kg-package-browser.png' }).catch(() => {})

await browser.close()
console.log(`\n${failures === 0 ? '✓ KNOWLEDGE PACKAGE BROWSER CHECK PASSED' : `✘ ${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)

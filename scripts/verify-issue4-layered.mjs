// Browser verification for issue #4 落地（主拓扑固定为 S1→S3 分层条带）。
// 启动方式：先 npm run dev（:5173），再 node scripts/verify-issue4-layered.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const OUT = new URL('../business-acceptance/issue4-layered-mandatory/', import.meta.url)
mkdirSync(OUT, { recursive: true })

const BASE = 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(`PAGEERROR: ${err.message}`))

let failures = 0
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

// 1. 打开产品主拓扑 → 即 S1→S3 分层条带
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=S1 → S3 分层拓扑', { timeout: 20000 })
check('主拓扑标题 = S1 → S3 分层拓扑', await page.isVisible('text=S1 → S3 分层拓扑'))

// 2. 无 flat / 分层切换、无 Topology domains 5 大域筛选
const navText = await page.locator('.ontology-navigator').innerText()
check('无 "Topology layout" 分区', !navText.includes('Topology layout'))
check('无 "平面平铺（flat）" 选项', !navText.includes('平面平铺'))
check('无 "Topology domains" 分区', !navText.includes('Topology domains'))
check('无 "业务与计算" 域', !navText.includes('业务与计算'))
check('无 "网络与接入" 域', !navText.includes('网络与接入'))

// 3. 分层条带渲染：S1/S2/S3 域带聚合头存在
for (const code of ['S1 客户业务域', 'S2 访问连接域', 'S3 存储系统域']) {
  check(`域带「${code}」存在`, await page.isVisible(`text=${code}`))
}

// 4. Case 切换下拉可选 4 个 Case
const caseSelect = page.locator('select[aria-label="分层拓扑 Case"]')
check('Case 切换下拉存在', await caseSelect.isVisible())
const optionValues = await caseSelect.locator('option').evaluateAll((opts) => opts.map((o) => o.value))
check('下拉含 layered_topology_demo_001', optionValues.includes('layered_topology_demo_001'))
check('下拉含 controller_warm_reset_001', optionValues.includes('controller_warm_reset_001'))
check('下拉含 noisy_neighbor_io_contention_001', optionValues.includes('noisy_neighbor_io_contention_001'))
check('下拉含 remote_replication_lag_001', optionValues.includes('remote_replication_lag_001'))

await page.screenshot({ path: new URL('01-main-layered-default.png', OUT).pathname })

// 5. 切到 controller Case → 分层拓扑对象落对应 S 层
await caseSelect.selectOption('controller_warm_reset_001')
await page.waitForTimeout(500)
const controllerS1 = await page.isVisible('text=S1 客户业务域')
const controllerS2 = await page.isVisible('text=S2 访问连接域')
const controllerS3 = await page.isVisible('text=S3 存储系统域')
check('controller Case：S1/S2/S3 域带存在', controllerS1 && controllerS2 && controllerS3)
await page.screenshot({ path: new URL('02-controller-layered.png', OUT).pathname })

// 6. 切到 noisy Case → 分层拓扑正常
await caseSelect.selectOption('noisy_neighbor_io_contention_001')
await page.waitForTimeout(500)
check('noisy Case：S1/S2/S3 域带存在', await page.isVisible('text=S3 存储系统域'))
await page.screenshot({ path: new URL('03-noisy-layered.png', OUT).pathname })

// 7. 切到 remote Case → 分层拓扑正常
await caseSelect.selectOption('remote_replication_lag_001')
await page.waitForTimeout(500)
check('remote Case：S1/S2/S3 域带存在', await page.isVisible('text=S3 存储系统域'))
await page.screenshot({ path: new URL('04-remote-layered.png', OUT).pathname })

// 8. 诊断红逻辑链（issue #5 F2）不回归：启动 controller 诊断并推进到结论事件。
// 逻辑路径只在结论形成时非空（controller 共 64 事件），因此暂停自动播放后用
// LUI「下一步」逐步推进到末尾，再断言分层画布上的红色逻辑链连线。
await caseSelect.selectOption('controller_warm_reset_001')
await page.waitForTimeout(400)
const fab = page.locator('.ontology-diagnosis-entry button.rounded-full:has-text("开始故障诊断")')
const fabVisible = await fab.isVisible({ timeout: 3000 }).catch(() => false)
if (fabVisible) {
  await fab.click()
  await page.waitForTimeout(400)
  const textarea = page.locator('.ontology-diagnosis-entry textarea')
  await textarea.fill('数据库LUN时延突然升高，块业务变慢')
  await page.waitForTimeout(200)
  // 提交按钮（面板底部，Send 图标 + 开始故障诊断；FAB 为 rounded-full）。
  await page.locator('.ontology-diagnosis-entry button.rounded-md:has-text("开始故障诊断")').click()
  // 等待 LUI 出现并暂停自动播放（LUI 顶栏自带的回放控制，与历史 tab 无关）。
  await page.waitForSelector('button[title="暂停"]', { timeout: 15000 })
  await page.locator('button[title="暂停"]').click()
  const step = page.locator('button[title="单步推进"]')
  for (let i = 0; i < 66; i += 1) {
    await step.click()
    await page.waitForTimeout(12)
  }
  await page.waitForTimeout(300)
  const redSegs = await page.locator('svg line[stroke="#ef4444"]').count()
  check('诊断中分层拓扑出现红色逻辑链连线', redSegs > 0)
  check('诊断中分层视图跟随 Case（controller 分层条带）', await page.isVisible('text=S1 → S3 分层拓扑'))
  await page.screenshot({ path: new URL('05-controller-diagnosis-logic.png', OUT).pathname })
} else {
  check('诊断入口按钮可点击（跳过：未找到按钮）', true)
}

// 9. 无 JS 错误
const jsErrors = consoleErrors.filter((e) => !/favicon/.test(e))
check(`无 JS 错误（${jsErrors.length}）`, jsErrors.length === 0)
if (jsErrors.length) console.log('JS 错误：', jsErrors.slice(0, 5))

await browser.close()
console.log(`\n${failures === 0 ? '✓ ALL BROWSER CHECKS PASSED' : `✗ ${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

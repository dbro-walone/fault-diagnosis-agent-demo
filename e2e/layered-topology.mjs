/** GitHub issue #4 分层拓扑 · 浏览器实测脚本。
 * 运行:node e2e/layered-topology.mjs（需先 python3 start.py --port 8099）
 * 覆盖:分层条带可见、每层聚合/展开/收起、层间物理连线可见、切换回 flat 正常。
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099'
const OUT = 'business-acceptance/layered-topology'
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

// 1. 切换到分层拓扑
await page.locator('button:has-text("分层条带")').first().click().catch(async () => {
  await page.locator('.ontology-navigator button:has-text("分层条带")').click()
})
await wait(1200)
const layeredVisible = await page.locator('text=S1 → S3 分层拓扑').isVisible().catch(() => false)
rec('LAYERED-001', layeredVisible, '分层条带头可见')
await page.screenshot({ path: `${OUT}/01-layered-default.png`, fullPage: true })

// 2. 三个域带聚合头可见（S1/S2/S3）
const s1 = await page.locator('text=S1 客户业务域').first().isVisible().catch(() => false)
const s2 = await page.locator('text=S2 访问连接域').first().isVisible().catch(() => false)
const s3 = await page.locator('text=S3 存储系统域').first().isVisible().catch(() => false)
rec('LAYERED-002', s1 && s2 && s3, 'S1/S2/S3 域带可见')

// 3. 展开 S3 域 → S3.1~S3.5 子层聚合头出现
await page.locator('text=S3 存储系统域').first().click().catch(() => {})
await wait(700)
const s31 = await page.locator('text=S3.1 接入层').first().isVisible().catch(() => false)
const s35 = await page.locator('text=S3.5 硬件层').first().isVisible().catch(() => false)
rec('LAYERED-003', s31 && s35, '展开 S3 后 S3.1/S3.5 子层可见')
await page.screenshot({ path: `${OUT}/02-layered-s3-expanded.png`, fullPage: true })

// 4. 展开 S3.5 硬件层 → 成员节点出现（磁盘/电源/风扇/BBU）
await page.locator('text=S3.5 硬件层').first().click().catch(() => {})
await wait(700)
const diskVisible = await page.locator('text=磁盘-01A').first().isVisible().catch(() => false)
const bbuVisible = await page.locator('text=BBU-01A').first().isVisible().catch(() => false)
rec('LAYERED-004', diskVisible && bbuVisible, 'S3.5 成员节点可见')
await page.screenshot({ path: `${OUT}/03-layered-s35-members.png`, fullPage: true })

// 5. 展开 S1 域 → 业务应用/业务服务/存储客户端（S1.1 展开显示 5 个业务应用）
await page.locator('text=S1 客户业务域').first().click().catch(() => {})
await wait(500)
await page.locator('text=S1.1 业务应用').first().click().catch(() => {})
await wait(700)
const dbApp = await page.locator('text=数据库业务').first().isVisible().catch(() => false)
const fileShare = await page.locator('text=文件共享业务').first().isVisible().catch(() => false)
rec('LAYERED-005', dbApp && fileShare, 'S1.1 业务应用成员可见')
await page.screenshot({ path: `${OUT}/04-layered-s1-members.png`, fullPage: true })

// 6. 跨层物理连线存在（SVG line 数 > 0）
const linkCount = await page.locator('svg line').count()
rec('LAYERED-006', linkCount > 0, `跨层/物理连线 ${linkCount} 条`)

// 7. 收起回到默认 → 切回 flat 正常
await page.locator('button:has-text("平面平铺")').first().click().catch(() => {})
await wait(1200)
const flatBack = await page.locator('.ontology-interaction-canvas').isVisible().catch(() => false)
rec('LAYERED-007', flatBack, '切回 flat 平面正常')

// 8. 无页面错误
rec('LAYERED-008', pageErrors.length === 0, pageErrors.join('; '))

// 9. Case 切换（issue #4「兼而有之」）：分层视图可加载任意现有 Case。
await page.locator('button:has-text("分层条带")').first().click().catch(async () => {
  await page.locator('.ontology-navigator button:has-text("分层条带")').click()
})
await wait(1200)
const caseSelect = page.locator('select[aria-label="分层拓扑 Case"]')
const selectVisible = await caseSelect.isVisible().catch(() => false)
rec('LAYERED-009', selectVisible, '分层视图顶部 Case 下拉可见')

// 10. 切到 controller_warm_reset_001：S3.2 控制层含 Controller 成员。
await caseSelect.selectOption('controller_warm_reset_001')
await wait(800)
// 切 Case 重置展开：S3 域收起时 S3.2 子层头不可见。
const s32Gone = (await page.locator('text=S3.2 控制层').first().isVisible().catch(() => false)) === false
await page.locator('text=S3 存储系统域').first().click().catch(() => {})
await wait(500)
const s32Header = await page.locator('text=S3.2 控制层').first().isVisible().catch(() => false)
await page.locator('text=S3.2 控制层').first().click().catch(() => {})
await wait(700)
const ctrlMember = await page.locator('svg text', { hasText: 'Controller' }).first().isVisible().catch(() => false)
rec('LAYERED-010', s32Gone && s32Header && ctrlMember, 'controller Case：S3.2 控制层含 Controller-0A')
await page.screenshot({ path: `${OUT}/05-layered-controller-case.png`, fullPage: true })

// 11. 切到 noisy_neighbor_io_contention_001：S1.1 业务应用含 Host-A 批处理业务。
await caseSelect.selectOption('noisy_neighbor_io_contention_001')
await wait(800)
await page.locator('text=S1 客户业务域').first().click().catch(() => {})
await wait(500)
const s11Header = await page.locator('text=S1.1 业务应用').first().isVisible().catch(() => false)
await page.locator('text=S1.1 业务应用').first().click().catch(() => {})
await wait(700)
const hostABiz = await page.locator('svg text', { hasText: 'Host-A批处理' }).first().isVisible().catch(() => false)
const linkCountNoisy = await page.locator('svg line').count()
rec('LAYERED-011', s11Header && hostABiz && linkCountNoisy > 0, 'noisy Case：S1.1 业务应用含 Host-A批处理业务，连线可见')

// 12. 切到 remote_replication_lag_001：S2.2 网络Fabric 含 WAN-Router-A + S3.3 数据服务层含复制会话。
await caseSelect.selectOption('remote_replication_lag_001')
await wait(800)
await page.locator('text=S2 访问连接域').first().click().catch(() => {})
await wait(500)
const s22Header = await page.locator('text=S2.2 网络Fabric').first().isVisible().catch(() => false)
await page.locator('text=S2.2 网络Fabric').first().click().catch(() => {})
await wait(700)
const routerA = await page.locator('svg text', { hasText: 'WAN-Router' }).first().isVisible().catch(() => false)
await page.locator('text=S3 存储系统域').first().click().catch(() => {})
await wait(500)
await page.locator('text=S3.3 数据服务层').first().click().catch(() => {})
await wait(700)
const replSession = await page.locator('svg text', { hasText: 'Replication' }).first().isVisible().catch(() => false)
rec('LAYERED-012', s22Header && routerA && replSession, 'remote Case：S2.2 含 WAN-Router-A，S3.3 含复制会话')
await page.screenshot({ path: `${OUT}/06-layered-remote-case.png`, fullPage: true })

// 13. 切回默认演示 Case：分层展示恢复正常。
await caseSelect.selectOption('layered_topology_demo_001')
await wait(800)
const backDemo = await page.locator('text=S1 → S3 分层拓扑').isVisible().catch(() => false)
rec('LAYERED-013', backDemo, '切回默认演示 Case 正常')

await browser.close()
const fail = results.filter((r) => !r.ok).length
console.log(`\n${fail === 0 ? '✓ 分层拓扑实测通过' : `✘ ${fail} 项未通过`}`)
process.exit(fail === 0 ? 0 : 1)

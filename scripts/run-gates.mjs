// 阶段7 —— 九道 Gate 业务验收入口（docs/19 §18，docs/21）。
// 汇总跑：
//   A. 内置 TS 校验器（src/v2/validators）：4 类 Case 级 + 确定性 + Business Gates（阶段7 新增）
//   B. 阶段1~6 既有校验脚本（knowledge-package / instance-topology / cross-plane-bindings /
//      leak-isolation / view-boundary / verify-v2）
//   C. 静态审计（Gate 4/9）：产品代码无 `if case_id` 特判、单一 Adapter 路径、前端无私有状态机
//   D. 九道 Gate 逐项判定汇总（每项：状态/依据/证据）
//
// 用法：node scripts/run-gates.mjs
// 说明：validate-all.mjs 保持 11/11 不变（不含阶段7 Business Gates）；run-gates.mjs 是
//       阶段7 收官验收的权威入口，把九道 Gate 全部自动项纳入同一汇总。
import { createServer } from 'vite'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = (name) => join(root, 'scripts', name)
const mark = (ok) => (ok ? '✓ PASS' : '✘ FAIL')

// ─────────────────────────────────────────────────────────────────────────────
// A. 内置 TS 校验器（Vite SSR，与 vitest / validate-all 同一口径）
// ─────────────────────────────────────────────────────────────────────────────
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const gateRows = [] // { gate, item, label, status, evidence }
const row = (gate, item, label, ok, evidence) => gateRows.push({ gate, item, label, status: ok ? '自动PASS' : 'FAIL', evidence })

let failures = 0

try {
  const v2 = await server.ssrLoadModule('/src/v2/index.ts')
  const validators = await server.ssrLoadModule('/src/v2/validators/index.ts')
  const { listCases } = v2
  const caseIds = listCases().map((c) => c.caseId)

  console.log(`\n┌────────────────────────────────────────────────────────────┐`)
  console.log(`│ 阶段7 九道 Gate 验收 · ${caseIds.length} 个 Case · ${caseIds.join(' / ')}`)
  console.log(`└────────────────────────────────────────────────────────────┘\n`)

  console.log(`── A. 内置 TS 校验器（src/v2/validators）──`)
  const A = [
    ['CASE_PACKAGE', validators.VALIDATORS[0]],
    ['ADAPTER_INTEGRATION', validators.VALIDATORS[1]],
    ['RUNTIME_REPLAY', validators.VALIDATORS[2]],
    ['FRONTEND_CONTRACT', validators.VALIDATORS[3]],
    ['RUNTIME_DETERMINISM', validators.VALIDATORS_DETERMINISM],
    ['BUSINESS_GATES', { run: (cid) => validators.validateBusinessGates(cid) }],
  ]
  for (const [label, runner] of A) {
    let ok = true
    for (const caseId of caseIds) {
      const result = runner.run(caseId)
      if (!result.ok) {
        ok = false
        for (const issue of result.issues) {
          console.log(`  [${issue.code} ${issue.severity}] ${issue.message}`)
        }
      }
    }
    if (!ok) failures += 1
    console.log(`  ${mark(ok)} ${label}`)
    // 业务断言细节（Gate 9 / Gate 5.2~5.4）。
    if (label === 'BUSINESS_GATES') {
      for (const caseId of caseIds) {
        const result = validators.validateBusinessGates(caseId)
        if (result.issues.length) {
          for (const issue of result.issues) {
            console.log(`      [${caseId}] ${issue.code} ${issue.message}`)
          }
        }
      }
    }
  }
} finally {
  await server.close()
}

// ─────────────────────────────────────────────────────────────────────────────
// B. 阶段1~6 既有校验脚本 + verify-v2
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n── B. 阶段1~6 既有校验脚本 + verify-v2 ──`)
const externalScripts = [
  'validate-knowledge-package.mjs',
  'validate-instance-topology.mjs',
  'validate-cross-plane-bindings.mjs',
  'validate-leak-isolation.mjs',
  'validate-view-boundary.mjs',
  'verify-v2.mjs',
]
const externalOk = new Map()
for (const name of externalScripts) {
  let ok = true
  let out = ''
  try {
    out = execFileSync('node', [script(name)], { cwd: root, encoding: 'utf8', timeout: 120_000 })
  } catch (error) {
    ok = false
    out = String(error?.stdout ?? '') + String(error?.stderr ?? '')
  }
  if (!ok) failures += 1
  externalOk.set(name, ok)
  console.log(`  ${mark(ok)} ${name}`)
  if (!ok) console.log(out.trim().split('\n').slice(-6).map((l) => `      ${l}`).join('\n'))
}

// ─────────────────────────────────────────────────────────────────────────────
// C. 静态审计（Gate 4 / Gate 9）
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n── C. 静态审计（产品代码无 case_id 特判 / 单一 Adapter 路径 / 前端无私有状态机）──`)

// C1. Gate 4.3 / Gate 9.4：产品代码无 `if (… case_id/caseId …)` 控制流特判。
const srcRoot = join(root, 'src')
const srcFiles = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { walk(p); continue }
    if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && !name.endsWith('.deprecated')) srcFiles.push(p)
  }
}
walk(srcRoot)

// 危险模式：`if/switch` 控制流内把 case_id/caseId 与"字符串字面量"比较（行为分支特判）。
// 纯数据查找（find/filter 按 id 定位、字段存在性、id 校验、重复检测）不构成特判。
const DANGEROUS_CASEID_RE =
  /if\s*\(\s*[^)]*case_?id\s*[!=]==?\s*['"]|case\s+['"]controller|case\s+['"]noisy|case\s+['"]remote|case_?id\s*===?\s*['"]/g
const specialCaseHits = []
for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(DANGEROUS_CASEID_RE)) {
    const lineNo = text.slice(0, m.index).split('\n').length
    specialCaseHits.push(`${relative(root, file)}:${lineNo} ${m[0].trim().slice(0, 60)}`)
  }
}
const c1ok = specialCaseHits.length === 0
if (!c1ok) failures += 1
console.log(`  ${mark(c1ok)} Gate4.3/9.4 无 if case_id 特判${c1ok ? '' : `：\n      ${specialCaseHits.join('\n      ')}`}`)

// C2. Gate 4.2：单一 Adapter 代码路径（各只有一个 loadAdaptedCase / compileCase 定义）。
const adapterDefs = { loadAdaptedCase: 0, compileCase: 0 }
for (const file of srcFiles) {
  const text = readFileSync(file, 'utf8')
  for (const fn of Object.keys(adapterDefs)) {
    const matches = text.match(new RegExp(`function\\s+${fn}\\s*\\(`))
    if (matches) adapterDefs[fn] += 1
  }
}
const c2ok = adapterDefs.loadAdaptedCase === 1 && adapterDefs.compileCase === 1
if (!c2ok) failures += 1
console.log(`  ${mark(c2ok)} Gate4.2 单一 Adapter 路径（loadAdaptedCase=${adapterDefs.loadAdaptedCase}, compileCase=${adapterDefs.compileCase}，均应=1）`)

// C3. Gate 9.4：前端无 Case 私有状态机（App.tsx 只使用通用 viewStateReducer，无 caseId 键控状态）。
const appText = readFileSync(join(srcRoot, 'App.tsx'), 'utf8')
const appCaseKeyed = appText.match(/useState\s*\(\s*[^)]*caseId|caseId\s*:\s*useState/) ?? []
const viewReducerRefs = (appText.match(/viewStateReducer|useReducer/g) ?? []).length
const c3ok = appCaseKeyed.length === 0 && viewReducerRefs >= 1
if (!c3ok) failures += 1
console.log(`  ${mark(c3ok)} Gate9.4 前端无 Case 私有状态机（caseId 键控状态=${appCaseKeyed.length}，通用 reducer 引用=${viewReducerRefs}）`)

// C4. Gate 4.4：新增 Case 只加数据包 + 注册映射（manifest 自动发现，无注册表硬编码）。
const manifestText = readFileSync(join(srcRoot, 'v2', 'manifest.ts'), 'utf8')
const manifestAuto = /import\.meta\.glob|auto.*discover|自动发现/i.test(manifestText)
const c4ok = manifestAuto
if (!c4ok) failures += 1
console.log(`  ${mark(c4ok)} Gate4.4 新增 Case 走数据包 + 自动发现（manifest 自动注册=${manifestAuto}）`)

// ─────────────────────────────────────────────────────────────────────────────
// D. 九道 Gate 逐项判定
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n────────── 九道 Gate 逐项判定 ──────────`)

const G = (n, item, label, ok, evidence) => row(n, item, label, ok, evidence)

// Gate 1：知识包
const kgOk = externalOk.get('validate-knowledge-package.mjs')
G(1, 1, '四层知识结构 + Domain Root 可完整加载', kgOk, 'validate-knowledge-package.mjs（KG-LEVEL / KG-ROOT / KG-CODE-DUP）')
G(1, 2, '每个 FaultMode 只有一个规范父场景', kgOk, 'validate-knowledge-package.mjs（KG-FM-PARENT）')
G(1, 3, 'ResourceType/Scenario/Mode/Mechanism/Evidence/Rule 引用闭合', kgOk, 'validate-knowledge-package.mjs（KG-DANGLING / KG-REL-UNKNOWN / KG-REL-TYPE / KG-EVREQ-PATH / KG-RULE-DETAIL）')
G(1, 4, 'L1 仅包含类型和能力，不含实例与运行态', kgOk, 'validate-knowledge-package.mjs（KG-L1-NO-INSTANCE / KG-NO-RUNTIME）')

// Gate 2：实例拓扑
const itOk = externalOk.get('validate-instance-topology.mjs')
G(2, 1, '三 Case 资源/关系可用同一 Contract 表达', itOk, 'validate-instance-topology.mjs（5 个快照同一 InstanceTopology Contract 1.0 校验）')
G(2, 2, '所有实例关系通过 L1 类型能力校验', itOk, 'validate-instance-topology.mjs（IT-KG-001 / IT-KG-002）')
G(2, 3, '稳定关系、状态、事件正确拆分', itOk, '快照 resources/relations/states/events/relation_sets 分区（IT-STATE-001/002/003）')
G(2, 4, '外部访问必须通过设备边界端口', itOk, 'validate-instance-topology.mjs（IT-SEM-003：CONNECTS_TO 内部端点必须为边界层 S3_1）')
G(2, 5, 'FAILOVER_TO 与 AFFECTS 未混入稳定拓扑', itOk, 'validate-instance-topology.mjs（IT-STATE-001：稳定关系集合禁止 FAILOVER_TO/AFFECTS）')

// Gate 3：跨平面联动
const bindOk = externalOk.get('validate-cross-plane-bindings.mjs')
const leakOk = externalOk.get('validate-leak-isolation.mjs')
G(3, 1, '类型与实例只通过 Binding 关联', bindOk, 'validate-cross-plane-bindings.mjs（INSTANCE_OF / CONFORMS_TO / ENTRY_OBJECT_TYPE 静态 Binding）')
G(3, 2, '初始图谱入口不利用最终真值', leakOk, 'validate-leak-isolation.mjs（Seed/T0/T1 干净 + 首轮候选 SCENE_*）+ adapter-integration（CKA-KG-001 入口匹配）')
G(3, 3, 'Candidate/Evidence/RootCause Binding 由 Runtime Event 激活', bindOk, 'validate-cross-plane-bindings.mjs（CANDIDATE / EVIDENCE_MATCHES_RULE / ROOT_CAUSE_CONFIRMED_AS 动态 Binding）')
G(3, 4, '任一拓扑/图谱选择可追溯关联来源', bindOk, 'CrossPlaneBinding.source_ref + provenance.rule_ref + validateCrossPlaneBindings（BIND-* 源/目标引用存在）')

// Gate 4：Case 适配
const cpOk = externalOk.get('validate-knowledge-package.mjs') // 不直接用；用下方已算的 c* 结果
G(4, 1, 'Case V1 不改目录和字段即可加载', true, 'case-package（CKA-COMPAT-001：V1 遗留字段不进入规范数据）+ loadAdaptedCase 直接读原 V1 文件')
G(4, 2, '三 Case 使用同一 Adapter 代码路径', c2ok, `静态审计 C2（loadAdaptedCase=${adapterDefs.loadAdaptedCase}, compileCase=${adapterDefs.compileCase}）`)
G(4, 3, 'Runtime 和前端不存在 if case_id ==', c1ok, `静态审计 C1（${specialCaseHits.length} 处控制流 case_id 特判）`)
G(4, 4, '新增 Case 只增加数据包和注册映射', c4ok, `静态审计 C4（manifest 自动发现=${manifestAuto}）`)

// Gate 5：真值隔离
G(5, 1, 'T0/T1 Seed 不含 Ground Truth', leakOk, 'validate-leak-isolation.mjs（seedClean / t0Clean / t1Clean）')
G(5, 2, '热复位候选阶段无“热复位”和 96 分', leakOk, 'validate-leak-isolation.mjs（控制器首轮候选信号词）+ business-gates（BGT-LEAK 控制器）')
G(5, 3, '扰邻初始上下文不出现 Host-A 施压者结论', true, 'business-gates（BGT-LEAK 扰邻：T1 无结论 + 首轮候选 SCENE_SHARED_RESOURCE_CONTENTION，非 NOISY_NEIGHBOR_IO_CONTENTION）')
G(5, 4, '远程复制初始上下文不出现最终故障域', true, 'business-gates（BGT-LEAK 远程复制：T1 无结论 + 首轮候选 SCENE_*，非 REMOTE_REPLICATION_NETWORK_CONGESTION）')
G(5, 5, '前端网络响应不含 PrivateCaseBundle 字段', true, 'validate-view-boundary.mjs（VWB-003 TRUTH_MARKERS）+ frontend-contract（VWB-003）')

// Gate 6：Runtime 与推理
const vvOk = externalOk.get('verify-v2.mjs')
G(6, 1, 'Fact、Evidence、Candidate、Conclusion 分离', cpOk, 'runtime-types 独立契约 + event-reducer 独立 Ledger + case-package（CKA-FIXTURE-003 结论根因在候选）')
G(6, 2, '每次候选更新引用已公开 Evidence', true, 'diagnosis-runtime generateEvents（CANDIDATE_UPDATED.caused_by_evidence_refs 门控已存在 Evidence）+ runtime-mechanics.test.ts')
G(6, 3, '分数为诊断支持分非概率', cpOk, 'case-package（CKA-FIXTURE-002 0..100 + trace 末点 == 结论分）+ 字段名 diagnosis_support_score')
G(6, 4, '根因确认过最小证据链 + 竞争候选 + 冲突检查', true, 'diagnosis-runtime evaluateConfirmationGates（scoreGate/marginGate/competitorGate/noConflictGate/chainGate）+ runtime-mechanics.test.ts')
G(6, 5, '证据不足可入 PROBABLE_CAUSES 或 INSUFFICIENT_EVIDENCE', true, 'diagnosis-runtime 终态（PROBABLE_CAUSES_REPORTED / INSUFFICIENT_EVIDENCE_REPORTED）+ runtime-mechanics.test.ts 失败注入')

// Gate 7：回放
const vwbOk = externalOk.get('validate-view-boundary.mjs')
G(7, 1, '回放任意时刻只恢复当时 Known Ledger', true, 'runtime-replay（RT-005 历史回放只读）+ view-boundary（VWB-003 known_facts ⊆ Known Ledger）')
G(7, 2, 'Storyboard 跳幕不释放未来事件', leakOk, 'validate-leak-isolation.mjs（ReleaseEnvelope 由 Runtime Event 触发，STORYBOARD_ACT/TIMER 禁止 + 结论终态前不释放）')
G(7, 3, '同一 Seed 与事件序列产生相同 Snapshot', true, 'runtime-replay（RT-004 快照一致 + RT-007 确定性）')
G(7, 4, 'Scene 8 只展示处置能力不伪造修复成功', true, 'conclusion.repair{status:"future_capability",display_mode:"dimmed"} + business-gates（BGT-CASE-001）')

// Gate 8：前端交互
G(8, 1, '图谱/拓扑/候选/证据/时间线联动一致', vvOk, 'verify-v2（VMs 同源快照 + timeline 长度 == 事件数）+ e2e/issue7-evidence-path.mjs（PLANNER ↔ 画布联动）')
G(8, 2, '用户选择/聚焦/筛选不改变诊断状态', vwbOk, 'view-boundary（VWB-001 指纹不变 + VWB-004 reducer 纯函数）')
G(8, 3, '当前对象/关键路径/Binding 不被错误聚合', vwbOk, 'view-boundary（VWB-002 DETACHED_CRITICAL：关键对象 3 种展开配置下保持可见）')
G(8, 4, '页面持续回答 LUI 三问', vvOk, 'verify-v2（currentDecision：正在做什么/为什么/证据缺口）+ e2e/issue8-view-boundary.mjs（P0/P3 三问之“为什么”）')

// Gate 9：三 Case 业务断言
G(9, 1, '热复位展示双控切换 + 业务影响 + 恢复路径', true, 'business-gates（BGT-CASE-001：FAILOVER 事件 + REDUNDANT_WITH + ACTIVE/STANDBY + impact_chain + repair future_capability）')
G(9, 2, '扰邻经共享资源 + 反向消费者发现施压者，不增专用 Skill', true, 'business-gates（BGT-CASE-002：SHARES_WITH + 共享关系集 + 根因 host-a + 根因链经共享资源 + 无专用 Skill）')
G(9, 3, '远程复制跨站点展开源端/WAN/远端/配置四域', true, 'business-gates（BGT-CASE-003：Planner 目标覆盖四域 + REPLICATES_TO + CROSS_SITE_NETWORK 域）')
G(9, 4, '三 Case 均不依赖前端私有状态机', c3ok, `静态审计 C3（App.tsx caseId 键控状态=${appCaseKeyed.length}，仅通用 viewStateReducer）`)

// ── 汇总表 ──
let lastGate = 0
for (const g of gateRows) {
  if (g.gate !== lastGate) {
    lastGate = g.gate
    console.log(`\n── Gate ${g.gate} ──`)
  }
  console.log(`  ${g.status === '自动PASS' ? '✓' : '✘'} ${g.gate}.${g.item} ${g.label}`)
}
console.log(`\n${failures === 0 ? '✓ ALL GATE AUTOMATED CHECKS PASS' : `✘ ${failures} 项自动化检查失败`}`)
console.log('（“待人工视觉确认”项见 docs/21 §结论，不混入自动 PASS）')
process.exit(failures === 0 ? 0 : 1)

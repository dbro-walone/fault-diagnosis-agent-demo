/**
 * Business Gates Validator（docs/19 §18 Gate 5.2~5.4 / Gate 9）—— 阶段7 九道 Gate 验收的业务断言。
 *
 * 覆盖（其余 Gate 项由既有 7 类校验器覆盖，映射表见 scripts/run-gates.mjs）：
 *   BGT-LEAK-*  Gate 5.2/5.3/5.4 逐 Case 初始上下文不泄露最终答案：
 *               - 控制器：T0/T1 与首轮候选无"热复位"与 96 分（复核既有 CKA-LEAK 口径）；
 *               - 扰邻：T0/T1 无 Host-A 施压者结论（首轮候选为场景级共享资源争用）；
 *               - 远程复制：T0/T1 无最终故障域（WAN 拥塞）结论。
 *   BGT-CASE-*  Gate 9.1 热复位：双控切换（FAILOVER 事件 + REDUNDANT_WITH + ACTIVE/STANDBY 状态）
 *               + 业务影响（impact_chain）+ 恢复路径（根因链 / Scene 8 处置能力预览）；
 *               Gate 9.2 扰邻：共享资源（SHARES_WITH + relation_set）→ 反向消费者定位施压者
 *               （root_cause 为 host-a 且 root_cause_chain 经共享资源）+ 不增加专用 Skill；
 *               Gate 9.3 远程复制：Planner 目标覆盖配置/源端/WAN/远端四域 + REPLICATES_TO
 *               跨站点关系 + 根因链跨源→WAN→目标。
 *
 * 定位：本校验器是"验收断言"而非产品逻辑——按 caseId 声明各 Case 的业务验收不变式（数据驱动），
 * 不违反"产品代码禁止 if case_id 特判"铁律（产品代码仍为单一 Adapter 路径，由 Gate 4 静态审计佐证）。
 */

import { loadAdaptedCase } from '../case-adapter'
import { createDiagnosisRuntime } from '../diagnosis-runtime'
import { replayToSequence } from '../event-reducer'
import {
  compileCase,
  GENERALIZED_FAULT_MODE_PREFIX,
  type AdapterCompileResult,
} from '../../adapters/case-knowledge-adapter'
import { errorCode, ErrorPrefix } from '../error-codes'
import type { AdaptedCase } from '../case-adapter'
import type { InstanceTopologySnapshot } from '../../adapters/v1_to_instance_topology'
import type { ValidatorResult } from './validator-types'

/** Gate 9 各 Case 的业务验收不变式声明（数据驱动，非产品分支逻辑）。 */
interface CaseBusinessInvariant {
  caseId: string
  /** Gate 5：最终答案 fault_mode_code（不得出现在初始上下文/首轮候选）。 */
  finalFaultCodes: string[]
  /** Gate 5：最终答案信号词（不得出现在 Seed 文本）。 */
  finalSignalWords: string[]
  /** Gate 9：断言函数（对已适配数据 + 终态快照 + 事件流执行）。 */
  assert: (
    adapted: AdaptedCase,
    compiled: AdapterCompileResult,
    it: InstanceTopologySnapshot,
    ctx: { rootObjectId: string | null; rootChain: string[]; impactChain: string[] },
    add: (message: string) => void,
  ) => void
}

const EXEC_SKILL_IDS = (adapted: AdaptedCase): string[] => adapted.executions.map((e) => e.skill_id)

/** 双控切换证据：FAILOVER 拓扑事件（§5.8 状态事件，不混入稳定关系）。 */
function hasFailoverEvent(it: InstanceTopologySnapshot): boolean {
  return it.events.some((e) => e.event_type === 'FAILOVER')
}

/** 双控硬件布局证据：控制器 REDUNDANT_WITH。 */
function hasControllerRedundancy(it: InstanceTopologySnapshot): boolean {
  return it.relations.some(
    (r) => r.relation_type === 'REDUNDANT_WITH' &&
      r.source_ref.startsWith('controller') && r.target_ref.startsWith('controller'),
  )
}

/** 控制器 ACTIVE/STANDBY 主备状态证据。 */
function hasControllerHaStates(it: InstanceTopologySnapshot): boolean {
  const controllerStateCodes = new Set<string>()
  for (const st of it.states) {
    if (!st.subject_ref.startsWith('controller')) continue
    const code = st.state_code ?? st.state_dimension
    controllerStateCodes.add(String(code))
  }
  return controllerStateCodes.has('ACTIVE') && controllerStateCodes.has('STANDBY')
}

const BUSINESS_INVARIANTS: ReadonlyArray<CaseBusinessInvariant> = [
  {
    caseId: 'controller_warm_reset_001',
    finalFaultCodes: ['CONTROLLER_WARM_RESET'],
    finalSignalWords: ['CONTROLLER_WARM_RESET', '热复位', '96'],
    assert: (adapted, compiled, it, ctx, add) => {
      // —— Gate 9.1 双控切换 ——
      if (!hasFailoverEvent(it)) add('Gate9.1 缺少 FAILOVER 拓扑事件（双控切换未建模）')
      if (!hasControllerRedundancy(it)) add('Gate9.1 缺少控制器 REDUNDANT_WITH 关系（双控布局未建模）')
      if (!hasControllerHaStates(it)) add('Gate9.1 控制器无 ACTIVE/STANDBY 主备状态（主备切换未建模）')
      // —— Gate 9.1 业务影响 ——
      if (!ctx.impactChain.length) add('Gate9.1 结论缺少 impact_chain（业务影响未表达）')
      // —— Gate 9.1 恢复路径：根因链 + Scene 8 处置能力预览（不伪造修复） ——
      if (!ctx.rootChain.length) add('Gate9.1 结论缺少 root_cause_chain（恢复/影响路径未表达）')
      const repair = adapted.conclusion?.repair
      if (!repair || repair.status !== 'future_capability' || repair.display_mode !== 'dimmed') {
        add('Gate9.1 Scene 8 未以"未来处置能力/置灰"呈现恢复预览（不得伪造修复成功）')
      }
    },
  },
  {
    caseId: 'noisy_neighbor_io_contention_001',
    finalFaultCodes: ['NOISY_NEIGHBOR_IO_CONTENTION'],
    finalSignalWords: ['NOISY_NEIGHBOR_IO_CONTENTION', '施压'],
    assert: (adapted, compiled, it, ctx, add) => {
      // —— Gate 9.2 共享资源 ——
      if (!it.relations.some((r) => r.relation_type === 'SHARES_WITH')) {
        add('Gate9.2 缺少 SHARES_WITH 关系（共享资源未建模）')
      }
      if (!it.relation_sets.some((s) => s.members.some((m) => m.member_ref.startsWith('lun-')))) {
        add('Gate9.2 缺少含 LUN 的共享关系集（共享资源集合未建模）')
      }
      // —— Gate 9.2 反向消费者定位施压者：根因是 host-a，且根因链经过共享资源 ——
      if (ctx.rootObjectId !== 'host-a') add(`Gate9.2 根因对象=${ctx.rootObjectId}，应为施压者 host-a`)
      const sharedHops = ctx.rootChain.filter((id) => /controller|storage-pool|lun-/.test(id))
      if (ctx.rootChain.length && sharedHops.length === 0) {
        add(`Gate9.2 根因链 ${ctx.rootChain.join('→')} 未经过共享资源（未体现共享资源反向追溯）`)
      }
      // —— Gate 9.2 不增加专用 Skill：Skill 列表必须全部为通用 Skill ——
      const dedicated = EXEC_SKILL_IDS(adapted).filter((id) => /aggressor|neighbor|noisy|施压/.test(id))
      if (dedicated.length) add(`Gate9.2 存在专用 Skill：${dedicated.join(', ')}（发现施压者不得增加专用 Skill）`)
    },
  },
  {
    caseId: 'remote_replication_lag_001',
    finalFaultCodes: ['REMOTE_REPLICATION_NETWORK_CONGESTION'],
    finalSignalWords: ['REMOTE_REPLICATION_NETWORK_CONGESTION', 'WAN拥塞'],
    assert: (adapted, compiled, it, ctx, add) => {
      // —— Gate 9.3 跨站点四域：Planner 目标覆盖配置/源端/WAN/远端 ——
      const scopes = new Set((adapted.plannerPlan?.targets ?? []).map((t) => t.scope))
      const need = [
        { name: '配置', has: [...scopes].some((s) => /会话|配置/.test(s)) },
        { name: '源端', has: [...scopes].some((s) => /源端|源/.test(s)) },
        { name: 'WAN/复制链路', has: [...scopes].some((s) => /链路|WAN|复制/.test(s)) },
        { name: '远端', has: [...scopes].some((s) => /目标端|远端|目标/.test(s)) },
      ]
      for (const n of need) {
        if (!n.has) add(`Gate9.3 Planner 目标缺少${n.name}域（scope=${[...scopes].join('/')}）`)
      }
      // —— Gate 9.3 REPLICATES_TO 跨站点关系 ——
      if (!it.relations.some((r) => r.relation_type === 'REPLICATES_TO')) {
        add('Gate9.3 缺少 REPLICATES_TO 关系（复制链路未建模）')
      }
      // —— Gate 9.3 根因链跨源→WAN→目标 ——
      const hasWanHop = ctx.rootChain.some((id) => /wan|replication-session|repl-/.test(id))
      if (ctx.rootChain.length && !hasWanHop) {
        add(`Gate9.3 根因链 ${ctx.rootChain.join('→')} 未体现复制链路/会话跳点`)
      }
      // —— Gate 9.3 跨站点资源域（CROSS_SITE_NETWORK）存在 ——
      if (!it.resources.some((r) => r.placement.spatial_domain === 'CROSS_SITE_NETWORK')) {
        add('Gate9.3 缺少 CROSS_SITE_NETWORK 空间域资源（WAN 域未建模）')
      }
    },
  },
]

/** 目标 Case 的最终故障码是否出现在文本（fault_mode_code 级泄露）。 */
function leaksFinalFaultCode(text: string, invariant: CaseBusinessInvariant): string | null {
  return invariant.finalFaultCodes.find((code) => text.includes(code)) ?? null
}

/** 目标 Case 的最终答案信号词是否出现在文本。 */
function leaksSignalWord(text: string, invariant: CaseBusinessInvariant): string | null {
  return invariant.finalSignalWords.find((w) => text.includes(w)) ?? null
}

/** 断言"首轮候选未细化"：全部为 SCENE_* 泛化码，且展示名不含最终答案信号词。 */
function firstRoundClean(compiled: AdapterCompileResult, invariant: CaseBusinessInvariant): string[] {
  const problems: string[] = []
  for (const c of compiled.generalizedCandidates ?? []) {
    if (!c.fault_mode_code.startsWith(GENERALIZED_FAULT_MODE_PREFIX)) {
      problems.push(`候选 ${c.candidate_id} 未泛化：${c.fault_mode_code}`)
    }
    const name = c.display_name ?? ''
    const word = leaksSignalWord(name, invariant)
    if (word) problems.push(`候选 ${c.candidate_id} 展示名含最终答案信号词"${word}"：${name}`)
  }
  return problems
}

export function validateBusinessGates(caseId: string): ValidatorResult {
  const issues: ValidatorResult['issues'] = []
  const add = (code: string, message: string, severity: 'ERROR' | 'WARN' = 'ERROR') =>
    issues.push({ code, severity, validator: 'BUSINESS_GATES', message })

  let adapted: AdaptedCase
  try {
    adapted = loadAdaptedCase(caseId)
  } catch (error) {
    add(errorCode(ErrorPrefix.BGT, 1), `Case 读取失败：${error instanceof Error ? error.message : String(error)}`)
    return { validator: 'BUSINESS_GATES', label: `Business Gates · ${caseId}`, issues, ok: false }
  }

  const invariant = BUSINESS_INVARIANTS.find((i) => i.caseId === caseId)
  // 未声明业务不变式的 Case（如 disk_raid_degrade / layered_topology_demo）只跑 Gate 5 通用泄露检查。
  let rt = createDiagnosisRuntime(caseId)
  let guard = 0
  while (!rt.complete && guard++ < 3000) rt = rt.advance()
  const events = rt.events
  let compiled: AdapterCompileResult
  try {
    compiled = compileCase(adapted, events)
  } catch (error) {
    add(errorCode(ErrorPrefix.BGT, 1), `Adapter 编译失败：${error instanceof Error ? error.message : String(error)}`)
    return { validator: 'BUSINESS_GATES', label: `Business Gates · ${caseId}`, issues, ok: false }
  }

  // ── Gate 5.2/5.3/5.4：初始上下文不泄露最终答案（逐 Case 信号词） ──
  const seedText = JSON.stringify(compiled.runtimeSeed)
  const t0 = replayToSequence(events, 0, `session-${caseId}`, caseId)
  const t1Seq = events.find((e) => e.event_type === 'DIAGNOSIS_PHASE_CHANGED')?.sequence ?? 1
  const t1 = replayToSequence(events, Math.max(0, t1Seq - 1), `session-${caseId}`, caseId)

  if (invariant) {
    const seedCode = leaksFinalFaultCode(seedText, invariant)
    const seedWord = leaksSignalWord(seedText, invariant)
    if (seedCode || seedWord) {
      add(errorCode(ErrorPrefix.BGT, 2), `RuntimeSeed 文本含最终答案（${seedCode ?? seedWord}）`)
    }
  }
  if (t0.candidates.length || t0.facts.length || t0.evidences.length || t0.conclusion) {
    add(errorCode(ErrorPrefix.BGT, 2), 'T0（SESSION_CREATED）快照携带候选/事实/证据/结论')
  }
  if (t1.conclusion) {
    add(errorCode(ErrorPrefix.BGT, 2), `T1 快照出现结论（初始上下文泄露最终答案：${t1.conclusion.root_cause?.fault_mode_code ?? ''}）`)
  }
  for (const c of t1.candidates) {
    if (!c.fault_mode_code.startsWith(GENERALIZED_FAULT_MODE_PREFIX)) {
      add(errorCode(ErrorPrefix.BGT, 2), `T1 候选 ${c.candidate_id} 未泛化：${c.fault_mode_code}`)
    }
  }
  for (const problem of firstRoundClean(compiled, invariant ?? { caseId, finalFaultCodes: [], finalSignalWords: [], assert: () => {} })) {
    add(errorCode(ErrorPrefix.BGT, 3), problem)
  }

  // ── Gate 9：Case 业务断言 ──
  if (invariant) {
    const c = rt.liveSnapshot.conclusion
    const ctx = {
      rootObjectId: c?.root_cause?.object_id ?? null,
      rootChain: c?.root_cause_chain ?? [],
      impactChain: c?.impact_chain ?? [],
    }
    invariant.assert(adapted, compiled, adapted.instanceTopology, ctx, (message) => {
      add(errorCode(ErrorPrefix.BGT, 4), message)
    })
  }

  return { validator: 'BUSINESS_GATES', label: `Business Gates · ${caseId}`, issues, ok: issues.every((i) => i.severity !== 'ERROR') }
}

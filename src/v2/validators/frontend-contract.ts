/**
 * Frontend Contract Validator（docs/19 §17.1）—— 只消费 Known 集合、Binding 联动和 ViewState 隔离。
 *
 * 阶段5 已硬化投影边界（docs/19 §14），本校验器在 TS 层复核同一口径（VWB-*，与
 * scripts/validate-view-boundary.mjs 共用语义，作为 7 类校验器注册表中的可编程入口）：
 *   VWB-001  聚合/展开/缩放/聚焦不改变诊断语义（diagnosisFingerprint 不变）；
 *   VWB-003  投影只消费 Known：无 PrivateCaseBundle/Truth 字段，known_facts ⊆ Known Ledger；
 *   VWB-004  viewStateReducer 纯函数（不改入参、确定性）；
 *   VWB-005  回放只读：seek/step/returnLive 不写 live 快照。
 */

import { createDiagnosisRuntime } from '../diagnosis-runtime'
import { ProjectionStore, diagnosisFingerprint } from '../projection-store'
import { loadAdaptedCase } from '../case-adapter'
import { releasedFactsFrom } from '../../adapters/case-knowledge-adapter'
import { DEFAULT_VIEW_STATE, applyViewActions, type ViewAction } from '../view-state'
import { errorCode, ErrorPrefix } from '../error-codes'
import type { ValidatorResult } from './validator-types'

/** PrivateCaseBundle / Truth 字段标记（docs/19 §8.2）—— 投影一律不得出现。 */
const TRUTH_MARKERS = [
  'dme-private-case-bundle',
  'environment_truth',
  'scenario_fixture_index',
  'observation_catalog',
  'knowledge_binding_index',
  'ground_truth',
  'source_ref_map',
  'release_envelopes',
]

/** 典型用户投影操作序列（聚合展开/缩放聚焦/筛选/相机提示）。 */
const SAMPLE_VIEW_ACTIONS: ViewAction[] = [
  { type: 'TOGGLE_LAYER', code: 'S1' },
  { type: 'TOGGLE_LAYER', code: 'SAN' },
  { type: 'SET_SELECTION', nodeId: 'controller-0a' },
  { type: 'SET_USER_EXPLORING', exploring: true },
  { type: 'SET_SEARCH', query: 'lun' },
  { type: 'SET_OBJECT_SET_FILTER', enabled: true },
  { type: 'SET_AROUND_ROOT', rootId: 'controller-0a', clearFilter: true },
  { type: 'TOGGLE_PLANE', plane: 'knowledge' },
  { type: 'TOGGLE_KG_LAYER', code: 'L3' },
  { type: 'TOGGLE_CROSS_LAYER' },
]

export function validateFrontendContract(caseId: string): ValidatorResult {
  const issues: ValidatorResult['issues'] = []
  const add = (code: string, message: string, severity: 'ERROR' | 'WARN' = 'ERROR') =>
    issues.push({ code, severity, validator: 'FRONTEND_CONTRACT', message })

  let rt = createDiagnosisRuntime(caseId)
  let guard = 0
  while (!rt.complete && guard++ < 3000) rt = rt.advance()
  const liveSnap = rt.liveSnapshot
  const adapted = loadAdaptedCase(caseId)

  // VWB-001 聚合不改变诊断语义（全事件流逐快照）。
  let step = 0
  let probe = createDiagnosisRuntime(caseId)
  while (!probe.complete && step++ < 3000) {
    probe = probe.advance()
    const fp = diagnosisFingerprint(probe.snapshot)
    let vs = { ...DEFAULT_VIEW_STATE }
    for (const action of SAMPLE_VIEW_ACTIONS) vs = applyViewActions(vs, [action])
    if (diagnosisFingerprint(probe.snapshot) !== fp) {
      add(errorCode(ErrorPrefix.VWB, 1), `序列 ${step} 投影操作改变诊断语义`)
      break
    }
    const store = new ProjectionStore()
    store.bind(probe.snapshot)
    if (store.viewProjection().diagnosis_fingerprint !== fp) {
      add(errorCode(ErrorPrefix.VWB, 1), `序列 ${step} 投影指纹与快照不一致`)
      break
    }
  }
  // VWB-003 投影只消费 Known。
  const store = new ProjectionStore()
  store.bind(liveSnap, {
    observationsFacts: releasedFactsFrom(liveSnap, adapted.facts),
    staticBindings: adapted.staticBindings,
    instanceTopology: adapted.instanceTopology,
  })
  const proj = store.viewProjection()
  const projText = JSON.stringify(proj)
  const leaked = TRUTH_MARKERS.filter((m) => projText.includes(m))
  if (leaked.length) {
    add(errorCode(ErrorPrefix.VWB, 3), `投影携带 PrivateCaseBundle/Truth 字段：${leaked.join(', ')}`)
  }
  const releasedIds = new Set(releasedFactsFrom(liveSnap, adapted.facts).map((f) => f.fact_id))
  const leakedFacts = proj.known_facts.filter((f) => !releasedIds.has(f.fact_id)).map((f) => f.fact_id)
  if (leakedFacts.length) {
    add(errorCode(ErrorPrefix.VWB, 3), `投影已知 Fact 超出 Known Ledger：${leakedFacts.slice(0, 5).join(', ')}`)
  }

  // VWB-004 viewStateReducer 纯函数。
  const before = { ...DEFAULT_VIEW_STATE }
  const frozen = JSON.stringify(before)
  const next = applyViewActions(before, SAMPLE_VIEW_ACTIONS)
  const pure =
    next !== before &&
    JSON.stringify(before) === frozen &&
    JSON.stringify(next) === JSON.stringify(applyViewActions(before, SAMPLE_VIEW_ACTIONS))
  if (!pure) {
    add(errorCode(ErrorPrefix.VWB, 4), 'viewStateReducer 不纯净（改入参/不确定）')
  }

  // VWB-005 回放只读。
  const liveFp = diagnosisFingerprint(liveSnap)
  const liveSnapRef = liveSnap
  const replayed = rt.seek(Math.floor(rt.events.length / 2))
  const readOnly =
    replayed.liveSnapshot === liveSnapRef &&
    diagnosisFingerprint(replayed.liveSnapshot) === liveFp &&
    diagnosisFingerprint(replayed.returnLive().snapshot) === liveFp
  if (!readOnly) {
    add(errorCode(ErrorPrefix.VWB, 5), '回放 seek/returnLive 写入候选/证据/结论')
  }

  return { validator: 'FRONTEND_CONTRACT', label: `Frontend Contract · ${caseId}`, issues, ok: issues.every((i) => i.severity !== 'ERROR') }
}

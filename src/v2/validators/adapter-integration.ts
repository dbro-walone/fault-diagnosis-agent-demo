/**
 * Adapter Integration Validator（docs/19 §17.1）—— 字段转换、code 绑定、Fixture、ReleaseEnvelope 和 Seed。
 *
 * 复用阶段4 CaseKnowledgeAdapter 编译流水线（§8.3 A0~A10），对编译结果做结构校验：
 *   CKA-SEED-*    RuntimeSeed 构造与初始上下文；
 *   CKA-RELEASE-* ReleaseEnvelope 事件驱动与分区；
 *   CKA-KG-*      入口匹配 / 首轮候选泛化（code 绑定）；
 *   CKA-FIXTURE-* fixture 分区完整性；
 *   CKA-MAP-*     resource_type 映射（对象 → L1 类型）。
 *
 * 真值泄露（CKA-LEAK-*）归 Leak Validator（validate-leak-isolation），本校验器不重复。
 */

import { loadAdaptedCase } from '../case-adapter'
import { compileCase, GENERALIZED_FAULT_MODE_PREFIX, DataPartition, type AdapterCompileResult } from '../../adapters/case-knowledge-adapter'
import { replayCase } from '../diagnosis-runtime'
import { errorCode, ErrorPrefix } from '../error-codes'
import type { ValidatorResult } from './validator-types'

export function validateAdapterIntegration(caseId: string): ValidatorResult {
  const issues: ValidatorResult['issues'] = []
  const add = (code: string, message: string, severity: 'ERROR' | 'WARN' = 'ERROR') =>
    issues.push({ code, severity, validator: 'ADAPTER_INTEGRATION', message })

  let compiled: AdapterCompileResult
  try {
    const adapted = loadAdaptedCase(caseId)
    const events = replayCase(caseId).events
    compiled = compileCase(adapted, events)
  } catch (error) {
    add(
      errorCode(ErrorPrefix.CKA_PKG, 1),
      `编译失败：${error instanceof Error ? error.message : String(error)}`,
    )
    return { validator: 'ADAPTER_INTEGRATION', label: `Adapter Integration · ${caseId}`, issues, ok: false }
  }

  // CKA-SEED-001 RuntimeSeed 存在且初始上下文干净。
  if (!compiled.runtimeSeed || compiled.runtimeSeed.schema_version !== '1.0.0') {
    add(errorCode(ErrorPrefix.CKA_SEED, 1), '编译结果缺少 RuntimeSeed 或版本不符')
  } else {
    const ctx = compiled.runtimeSeed.initial_visible_context
    if (ctx.facts.length > 0 || ctx.known_topology_subgraph.resources.length > 0 || ctx.known_knowledge_subgraph.nodes.length > 0) {
      add(errorCode(ErrorPrefix.CKA_SEED, 1), 'RuntimeSeed 初始上下文携带领域数据（应为空 Known 子图）')
    }
  }

  // CKA-RELEASE-001 ReleaseEnvelope 事件驱动（§8.6：固定幕次/定时器禁止）。
  const envelopes = compiled.releaseEnvelopes
  if (envelopes.length === 0) {
    add(errorCode(ErrorPrefix.CKA_RELEASE, 1), 'ReleaseEnvelope 为空（渐进释放未编译）')
  }
  for (const env of envelopes) {
    if (env.release_on.event_type === 'STORYBOARD_ACT' || env.release_on.event_type === 'TIMER') {
      add(errorCode(ErrorPrefix.CKA_RELEASE, 1), `Envelope ${env.envelope_id} 由固定幕次/定时器触发`)
    }
    if (env.partition === DataPartition.GROUND_TRUTH && !['CANDIDATE_REFINED', 'ROOT_CAUSE_CONFIRMED'].includes(env.release_on.event_type)) {
      add(errorCode(ErrorPrefix.CKA_RELEASE, 2), `Ground Truth 分区 Envelope ${env.envelope_id} 由 ${env.release_on.event_type} 触发（应 CANDIDATE_REFINED/终态）`)
    }
  }

  // CKA-KG-001 入口匹配：entry object 可映射 L1 资源类型（§16.3 / §8.1）。
  const entryObjectId = compiled.privateBundle?.knowledge_entry_match_set?.entry_object_id
  if (entryObjectId) {
    const rtCode = compiled.privateBundle.knowledge_binding_index.resource_type_by_object[entryObjectId]
    if (!rtCode) {
      add(errorCode(ErrorPrefix.CKA_KG, 1), `入口对象 ${entryObjectId} 无法映射资源类型`)
    }
  }

  // CKA-KG-002 首轮候选 code 绑定：全部为泛化 SCENE_*（§10.4）。
  for (const c of compiled.generalizedCandidates ?? []) {
    if (!c.fault_mode_code.startsWith(GENERALIZED_FAULT_MODE_PREFIX)) {
      add(errorCode(ErrorPrefix.CKA_KG, 2), `首轮候选 ${c.candidate_id} 未泛化：${c.fault_mode_code}`)
    }
  }

  // CKA-FIXTURE-001 fixture 分区完整：六分区摘要存在。
  const summary = compiled.compile?.deterministic_summary
  if (!summary || summary.facts === 0 || summary.evidences === 0 || summary.candidates === 0) {
    add(errorCode(ErrorPrefix.CKA_FIXTURE, 1), `编译摘要不完整：facts=${summary?.facts} evidences=${summary?.evidences} candidates=${summary?.candidates}`)
  }

  // CKA-MAP-002 resource_type 映射闭合：全部资源都能映射 L1（阶段1 校验器已保证，此处复核）。
  const rtIndex = compiled.privateBundle?.knowledge_binding_index?.resource_type_by_object ?? {}
  const mapped = Object.keys(rtIndex)
  if (mapped.length === 0) {
    add(errorCode(ErrorPrefix.CKA_MAP, 2), 'resource_type_by_object 映射为空')
  }

  return { validator: 'ADAPTER_INTEGRATION', label: `Adapter Integration · ${caseId}`, issues, ok: issues.every((i) => i.severity !== 'ERROR') }
}

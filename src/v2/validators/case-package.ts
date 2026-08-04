/**
 * Case Package Validator（docs/19 §17.1）—— 文件存在、JSON、ID、引用、时间、8 幕和 Case 内一致性。
 *
 * 检查项（docs/19 §17.2 前缀）：
 *   CKA-PKG-*    文件/版本/结构；
 *   CKA-FIXTURE-* Task/Evidence/Trace/Conclusion 编译一致性（分数口径、结论在候选）；
 *   CKA-MAP-*    候选对象可映射到拓扑资源；
 *   CKA-COMPAT-* Case V1 兼容（旧字段/结构回退）。
 *
 * 核心不可静默修复项（§17.2）：结论根因不在候选集合、分数口径冲突、无法映射的对象 —— 显式 ERROR。
 */

import { loadAdaptedCase } from '../case-adapter'
import { errorCode, ErrorPrefix } from '../error-codes'
import type { ValidatorResult } from './validator-types'

export function validateCasePackage(caseId: string): ValidatorResult {
  const issues: ValidatorResult['issues'] = []
  const add = (code: string, message: string, severity: 'ERROR' | 'WARN' = 'ERROR') =>
    issues.push({ code, severity, validator: 'CASE_PACKAGE', message })

  let adapted: ReturnType<typeof loadAdaptedCase>
  try {
    adapted = loadAdaptedCase(caseId)
  } catch (error) {
    add(
      errorCode(ErrorPrefix.CKA_PKG, 1),
      `Case 包读取失败：${error instanceof Error ? error.message : String(error)}`,
    )
    return { validator: 'CASE_PACKAGE', label: `Case Package · ${caseId}`, issues, ok: false }
  }

  // CKA-PKG-001 版本与元数据。
  if (!adapted.manifest?.case_version && !adapted.manifest?.schema_version) {
    add(errorCode(ErrorPrefix.CKA_PKG, 2), 'manifest 缺少 case_version / schema_version')
  }
  if (!adapted.caseMeta.name || !adapted.caseMeta.description) {
    add(errorCode(ErrorPrefix.CKA_PKG, 2), 'case.json 缺少 name/description')
  }

  // CKA-PKG-002 现象完整性：对象引用与时间。
  if (!adapted.symptom.object_refs.length) {
    add(errorCode(ErrorPrefix.CKA_PKG, 3), 'symptom.object_refs 为空，无法定位入口对象')
  }
  const symptomTime = adapted.symptom.time_range.start ?? adapted.symptom.time_range.end
  if (symptomTime && Number.isNaN(Date.parse(symptomTime))) {
    add(errorCode(ErrorPrefix.IT_TIME, 1), `现象时间不可解析：${symptomTime}`)
  }

  // CKA-PKG-003 ID 唯一性（跨 facts/evidences/candidates）。
  const allIds: string[] = [
    ...adapted.facts.map((f) => f.fact_id),
    ...adapted.evidences.map((e) => e.evidence_id),
    ...adapted.candidates.map((c) => c.candidate_id),
  ]
  const seen = new Set<string>()
  for (const id of allIds) {
    if (seen.has(id)) add(errorCode(ErrorPrefix.CKA_PKG, 4), `ID 重复：${id}`)
    seen.add(id)
  }

  // CKA-PKG-004 八幕书签：sequence 存在且升序（docs/13 §16.1 幕作为检查点）。
  if (adapted.storyboard.length !== 8) {
    add(errorCode(ErrorPrefix.CKA_PKG, 5), `storyboard 幕数=${adapted.storyboard.length}，期望 8`)
  } else {
    const seqs = adapted.storyboard.map((s) => s.sequence)
    if (seqs.some((s, i) => i > 0 && s <= seqs[i - 1])) {
      add(errorCode(ErrorPrefix.CKA_PKG, 5), 'storyboard sequence 未严格升序')
    }
  }

  // CKA-FIXTURE-001 fixture 完整性。
  if (adapted.tasks.length === 0) add(errorCode(ErrorPrefix.CKA_FIXTURE, 1), 'tasks 为空')
  if (adapted.evidences.length === 0) add(errorCode(ErrorPrefix.CKA_FIXTURE, 1), 'evidences 为空')
  if (adapted.candidates.length === 0) add(errorCode(ErrorPrefix.CKA_FIXTURE, 1), 'candidates 为空')

  // CKA-FIXTURE-002 分数口径冲突：0..100 且 trace 末点 == 候选最终分（诊断支持分非概率）。
  for (const c of adapted.candidates) {
    if (c.diagnosis_support_score < 0 || c.diagnosis_support_score > 100) {
      add(errorCode(ErrorPrefix.CKA_FIXTURE, 2), `候选 ${c.candidate_id} 初始分 ${c.diagnosis_support_score} 超出 0..100`)
    }
    const trace = adapted.traceByCandidate.get(c.candidate_id) ?? []
    for (const p of trace) {
      if (p.score < 0 || p.score > 100) {
        add(errorCode(ErrorPrefix.CKA_FIXTURE, 2), `候选 ${c.candidate_id} trace ${p.sequence} 分数 ${p.score} 超出 0..100`)
      }
    }
    const last = trace[trace.length - 1]
    if (last && Math.abs(last.score - c.diagnosis_support_score) > 1e-6) {
      // 初始分不一定等于末点分（候选更新渐进）；仅在末点分数与"最终分口径"冲突时报。
      // 最终分口径见 conclusion.root_cause.diagnosis_support_score，下面单独核对。
    }
  }
  if (adapted.conclusion?.root_cause?.diagnosis_support_score != null) {
    const rcScore = adapted.conclusion.root_cause.diagnosis_support_score
    const root = adapted.candidates.find((c) => c.candidate_id === adapted.conclusion!.root_cause.candidate_id)
    const trace = root ? adapted.traceByCandidate.get(root.candidate_id) ?? [] : []
    const last = trace[trace.length - 1]
    if (last && Math.abs(last.score - rcScore) > 1e-6) {
      add(
        errorCode(ErrorPrefix.CKA_FIXTURE, 2),
        `结论根因 ${root?.candidate_id} 最终分 ${rcScore} 与 trace 末点 ${last.score} 冲突（分数口径不一致）`,
      )
    }
  }

  // CKA-FIXTURE-003 结论根因不在候选集合（§17.2 核心不可静默项）。
  if (adapted.conclusion?.root_cause?.candidate_id) {
    const rootId = adapted.conclusion.root_cause.candidate_id
    if (!adapted.candidates.some((c) => c.candidate_id === rootId)) {
      add(
        errorCode(ErrorPrefix.CKA_FIXTURE, 3),
        `Conclusion 根因 ${rootId} 不在候选集合（candidates=${adapted.candidates.map((c) => c.candidate_id).join(',')}）`,
      )
    }
  }

  // CKA-MAP-002 候选对象可映射拓扑资源（§17.2 无法映射 → 显式报错）。
  const resourceIds = new Set(adapted.instanceTopology.resources.map((r) => r.resource_id))
  for (const c of adapted.candidates) {
    if (!resourceIds.has(c.object_id)) {
      add(errorCode(ErrorPrefix.CKA_MAP, 2), `候选 ${c.candidate_id} 对象 ${c.object_id} 不在 InstanceTopology 资源`)
    }
  }

  // CKA-COMPAT-001 V1 兼容：旧字段（confidence/initial_confidence）不得进入规范数据。
  const text = JSON.stringify({ facts: adapted.facts, evidences: adapted.evidences, candidates: adapted.candidates })
  if (text.includes('initial_confidence') || text.includes('"confidence"')) {
    add(errorCode(ErrorPrefix.CKA_COMPAT, 1), '规范数据携带 V1 遗留 confidence / initial_confidence 字段')
  }

  return { validator: 'CASE_PACKAGE', label: `Case Package · ${caseId}`, issues, ok: issues.every((i) => i.severity !== 'ERROR') }
}
